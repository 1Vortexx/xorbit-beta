// Long Haul – camera rig: cab (default), chase, on foot and the slow menu shot.
// The camera lives under worldRoot, so positions here are absolute world coordinates.
import * as THREE from "three";
import { heightAt } from "./world/terrain.js";

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), fwd = new THREE.Vector3();
const lookQ = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, "YXZ");
const Y = new THREE.Vector3(0, 1, 0);

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.chasePos = new THREE.Vector3();
    this.chaseReady = false;
    this.shakeAmt = 0;
    this.menuAngle = 0.6;
    this.fovKick = 0;
  }

  shake(amount) { this.shakeAmt = Math.min(0.5, this.shakeAmt + amount); }
  snap() { this.chaseReady = false; }

  // motion: 0..1 preference (0 = no bob, sway, shake or speed FOV)
  cab(dt, vehicle, look, motion) {
    const cam = this.camera;
    vehicle.seatEye(tmp);
    const m = vehicle.camMotion;
    if (m && motion > 0) {
      tmp2.set(m.x || 0, m.y || 0, m.z || 0).multiplyScalar(motion).applyQuaternion(vehicle.quat);
      tmp.add(tmp2);
    }
    cam.position.copy(tmp);
    euler.set(look.pitch, look.yaw, (m && m.roll ? m.roll : 0) * motion);
    cam.quaternion.copy(vehicle.quat).multiply(lookQ.setFromEuler(euler));
    cam.rotateY(Math.PI); // the camera looks down −z, vehicles face +z
  }

  chase(dt, vehicle, look) {
    const cam = this.camera;
    fwd.set(0, 0, 1).applyQuaternion(vehicle.quat);
    fwd.y = 0;
    if (fwd.lengthSq() < 0.01) fwd.set(0, 0, 1);
    fwd.normalize().applyAxisAngle(Y, look.yaw);
    const dist = 7.6, height = 2.9 + Math.max(-1, Math.min(2.5, look.pitch * 3));
    tmp.copy(vehicle.pos).addScaledVector(fwd, -dist);
    tmp.y = Math.max(vehicle.pos.y + height, heightAt(tmp.x, tmp.z) + 0.9);
    if (!this.chaseReady) { this.chasePos.copy(tmp); this.chaseReady = true; }
    else this.chasePos.lerp(tmp, 1 - Math.exp(-dt * 5.5));
    // Never let the smoothed camera sink into a dune
    this.chasePos.y = Math.max(this.chasePos.y, heightAt(this.chasePos.x, this.chasePos.z) + 0.6);
    cam.position.copy(this.chasePos);
    tmp2.copy(vehicle.pos).addScaledVector(fwd, 3.5);
    tmp2.y += 1.1;
    cam.up.set(0, 1, 0);
    cam.lookAt(tmp2);
  }

  // Slow arc around a point, framed so the subject sits right of centre (the menu is on the left)
  menu(dt, focus, reduceMotion) {
    const cam = this.camera;
    if (!reduceMotion) this.menuAngle += dt * 0.022;
    const a = 0.75 + Math.sin(this.menuAngle) * 0.45, r = 8.2;
    tmp.set(focus.x + Math.sin(a + focus.yaw) * r, 0, focus.z + Math.cos(a + focus.yaw) * r);
    tmp.y = Math.max(focus.y + 1.55, heightAt(tmp.x, tmp.z) + 1.2);
    cam.position.copy(tmp);
    // Aim left of the subject so it lands on the right-hand side of the frame
    fwd.set(focus.x - tmp.x, 0, focus.z - tmp.z).normalize();
    tmp2.set(focus.x + fwd.z * 2.6, focus.y + 0.9, focus.z - fwd.x * 2.6);
    cam.up.set(0, 1, 0);
    cam.lookAt(tmp2);
  }

  // After the mode-specific placement: shake and the small speed FOV change
  finish(dt, baseFov, speed, motion) {
    const cam = this.camera;
    if (this.shakeAmt > 0) {
      const s = this.shakeAmt * motion;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.8);
    }
    const kick = Math.min(6, Math.max(0, speed - 12) * 0.22) * motion;
    this.fovKick += (kick - this.fovKick) * Math.min(1, dt * 2);
    const fov = baseFov + this.fovKick;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }
}
