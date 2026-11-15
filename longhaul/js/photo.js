// Long Haul – photo mode. The world freezes, the HUD hides and the camera becomes a free-flying one (WASD, Space / Q,
// mouse look, wheel zoom). M releases the mouse (click the game to take it back), LMB / Enter saves a PNG of the
// clean frame. main.js owns the state switch; this module owns the camera, the hint overlay and the screenshots.
import * as THREE from "three";
import { took, isDown, look, exitLock, requestLock, locked, keyLabel } from "./input.js";
import { heightAt } from "./world/terrain.js";
import { sfx } from "./core/bus.js";

const SPEED = 6, FAST = 24, RANGE = 160;          // m/s; how far the camera may stray from where photo mode began
const FOV_MIN = 15, FOV_MAX = 100;
const _e = new THREE.Euler(0, 0, 0, "YXZ"), _v = new THREE.Vector3(), _w = new THREE.Vector3();

let saved = null, home = new THREE.Vector3(), hint = null, hintT = 0, flash = null;

function overlay() {
  if (hint) return;
  hint = document.createElement("div");
  hint.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);padding:8px 14px;border-radius:6px;"
    + "background:rgba(0,0,0,.55);color:#eee;font:13px/1.4 system-ui,sans-serif;pointer-events:none;z-index:50;transition:opacity .6s;text-align:center";
  flash = document.createElement("div");
  flash.style.cssText = "position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:51;transition:opacity .35s";
  document.body.append(hint, flash);
}
function say(text, secs = 5) {
  overlay();
  hint.textContent = text;
  hint.style.opacity = "1";
  hintT = secs;
}
const help = () => `Photo mode · WASD fly · Space/Q up/down · Shift fast · wheel zoom · Click/Enter screenshot · `
  + `${keyLabel("KeyM")} ${locked() ? "release" : "recapture"} mouse · ${keyLabel("KeyP")}/Esc exit`;

export const photo = {
  active: false,

  enter(camera) {
    this.active = true;
    saved = { yaw: look.yaw, pitch: look.pitch, clamp: look.clamp, fov: camera.fov };
    _e.setFromQuaternion(camera.quaternion);
    look.yaw = _e.y; look.pitch = -_e.x; look.clamp = false;
    home.copy(camera.position);
    say(help(), 6);
  },

  exit(camera) {
    this.active = false;
    look.yaw = saved.yaw; look.pitch = saved.pitch; look.clamp = saved.clamp;
    camera.fov = saved.fov; camera.updateProjectionMatrix();
    if (hint) { hint.style.opacity = "0"; hintT = 0; }
    requestLock();
  },

  update(dt, camera, renderShot) {
    if (took("photoMouse")) {
      if (locked()) exitLock(); else requestLock();
      say(locked() ? "Mouse released – press M or click the game to take it back" : help(), 4);
    }
    // Zoom
    if (look.wheel) {
      camera.fov = THREE.MathUtils.clamp(camera.fov * (1 + Math.sign(look.wheel) * 0.08), FOV_MIN, FOV_MAX);
      camera.updateProjectionMatrix();
    }
    // Look + fly (the camera is a child of worldRoot, so its position is absolute)
    camera.quaternion.setFromEuler(_e.set(-look.pitch, look.yaw, 0, "YXZ"));
    const f = (isDown("fwd") ? 1 : 0) - (isDown("back") ? 1 : 0), s = (isDown("right") ? 1 : 0) - (isDown("left") ? 1 : 0);
    const u = (isDown("up") ? 1 : 0) - (isDown("down") ? 1 : 0);
    _v.set(s, 0, -f).applyQuaternion(camera.quaternion);
    _v.y += u;
    if (_v.lengthSq() > 0) camera.position.addScaledVector(_v.normalize(), (isDown("fast") ? FAST : SPEED) * dt);
    // Stay near the frozen scene and above the ground
    _w.subVectors(camera.position, home);
    if (_w.length() > RANGE) camera.position.copy(home).addScaledVector(_w.normalize(), RANGE);
    const gy = heightAt(camera.position.x, camera.position.z) + 0.3;      // camera is under worldRoot: absolute coordinates
    if (camera.position.y < gy) camera.position.y = gy;
    camera.updateMatrixWorld(true);

    if (took("photoShot")) this.shoot(renderShot);

    if (hintT > 0 && (hintT -= dt) <= 0 && hint) hint.style.opacity = "0";
  },

  // Render a clean frame and save it straight away (the drawing buffer is only readable in the same task).
  shoot(renderShot) {
    renderShot();
    const canvas = document.getElementById("game");
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").replace(/\..*/, "");
    canvas.toBlob((blob) => {
      if (!blob) { say("Screenshot failed", 3); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `longhaul-${stamp}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      say(`Saved ${a.download} to your downloads`, 3);
    }, "image/png");
    overlay();
    flash.style.transition = "none"; flash.style.opacity = "0.6";
    requestAnimationFrame(() => { flash.style.transition = "opacity .35s"; flash.style.opacity = "0"; });
    sfx("switch");
  },
};
