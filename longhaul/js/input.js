// Long Haul – keyboard and mouse input
const held = new Set();
const pressed = new Set();   // keys pressed since the last frame
const MAP = {
  KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down",
  KeyA: "left", KeyD: "right", ArrowLeft: "aleft", ArrowRight: "aright",
  Space: "hand", KeyE: "use", KeyC: "camera", KeyR: "reset", KeyL: "lights",
  KeyM: "mute", KeyF: "door", Escape: "pause", KeyP: "pause",
  ShiftLeft: "sprint", ShiftRight: "sprint", Tab: "inventory", KeyI: "inventory",
  KeyZ: "sleep", KeyH: "horn",
};

// Mouse look. clamp: limit how far you can turn your head (cab view)
export const look = { yaw: 0, pitch: 0, clamp: true, sens: 1 };
// "play": all keys, "overlay": only pause/inventory (menus open over the game), "none": leave keys to the page
let mode = () => "play";

export function initInput(canvas, getMode) {
  if (getMode) mode = getMode;
  addEventListener("keydown", (e) => {
    const a = MAP[e.code];
    if (!a) return;
    const m = mode();
    if (m === "none" || (m === "overlay" && a !== "pause" && a !== "inventory")) return;
    e.preventDefault();
    if (!held.has(a)) pressed.add(a);
    held.add(a);
  });
  addEventListener("keyup", (e) => { const a = MAP[e.code]; if (a) held.delete(a); });
  addEventListener("blur", () => held.clear());
  addEventListener("mousemove", (e) => {
    if (document.pointerLockElement !== canvas) return;
    const k = 0.0025 * look.sens;
    look.yaw -= e.movementX * k;
    if (look.clamp) look.yaw = Math.max(-2.2, Math.min(2.2, look.yaw));
    look.pitch = Math.max(-0.9, Math.min(1.2, look.pitch + e.movementY * k)); // + looks down
  });
}

const h = (a) => (held.has(a) ? 1 : 0);
export function controls() {
  return {
    throttle: h("up") - h("down"),
    steer: h("left") + h("aleft") - h("right") - h("aright"),
    handbrake: held.has("hand"),
    use: held.has("use"),
    horn: held.has("horn"),
  };
}
export function footControls() {
  return { fwd: h("up") - h("down"), side: h("left") - h("right"), turn: h("aleft") - h("aright"), sprint: held.has("sprint") };
}

// True once per key press
export function took(action) {
  if (!pressed.has(action)) return false;
  pressed.delete(action);
  return true;
}
export function endFrame() { pressed.clear(); }
export function releaseAll() { held.clear(); pressed.clear(); }
