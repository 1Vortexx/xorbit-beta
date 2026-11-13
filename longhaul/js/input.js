// Long Haul – keyboard and mouse input.
// Action names are the contract (ARCHITECTURE §6). Modes: "drive" | "foot" | "overlay" | "none".
//   drive / foot : the bound keys of that mode (+ the "always" group) reach the game and are preventDefault-ed
//   overlay      : nothing reaches the game – menus.js owns the keyboard (Esc = back/resume, Tab/I closes the inventory)
//   none         : nothing is read and nothing is prevented (the page / host keeps its keys)
// Everything is released on blur, tab hide, pointer-lock loss and whenever the mode changes.
import { emit } from "./core/bus.js";

// group: "always" | "drive" | "foot". keys: KeyboardEvent.code, or Mouse0 / Mouse2 / WheelDown / WheelUp.
export const BINDINGS = [
  { action: "pause", group: "always", keys: ["Escape", "KeyP"], desc: "Pause menu" },
  { action: "inventory", group: "always", keys: ["Tab", "KeyI"], desc: "Inventory, vehicle and journey" },
  { action: "mute", group: "always", keys: ["KeyM"], desc: "Mute all sound" },
  { action: "radioNext", group: "always", keys: ["KeyN"], desc: "Radio: next track" },

  { action: "throttle", group: "drive", keys: ["KeyW", "ArrowUp"], desc: "Accelerate" },
  { action: "brake", group: "drive", keys: ["KeyS", "ArrowDown"], desc: "Brake / reverse" },
  { action: "left", group: "drive", keys: ["KeyA", "ArrowLeft"], desc: "Steer left" },
  { action: "right", group: "drive", keys: ["KeyD", "ArrowRight"], desc: "Steer right" },
  { action: "handbrake", group: "drive", keys: ["Space"], desc: "Handbrake (hold)" },
  { action: "parkingBrake", group: "drive", keys: ["KeyB"], desc: "Parking brake on / off" },
  { action: "ignition", group: "drive", keys: ["KeyK"], desc: "Ignition / start engine" },
  { action: "shiftUp", group: "drive", keys: ["ShiftLeft", "ShiftRight"], desc: "Shift up (manual gearbox)" },
  { action: "shiftDown", group: "drive", keys: ["ControlLeft", "ControlRight"], desc: "Shift down (manual gearbox)" },
  { action: "gearMode", group: "drive", keys: ["KeyG"], desc: "Gearbox auto / manual" },
  { action: "lights", group: "drive", keys: ["KeyL"], desc: "Headlights" },
  { action: "horn", group: "drive", keys: ["KeyH"], desc: "Horn" },
  { action: "camera", group: "drive", keys: ["KeyC"], desc: "Camera: cab / chase" },
  { action: "exit", group: "drive", keys: ["KeyF"], desc: "Get out" },
  { action: "sleep", group: "drive", keys: ["KeyZ"], desc: "Sleep in the cab" },
  { action: "recover", group: "drive", keys: ["KeyR"], desc: "Recover a stuck vehicle" },

  { action: "fwd", group: "foot", keys: ["KeyW", "ArrowUp"], desc: "Walk forward" },
  { action: "back", group: "foot", keys: ["KeyS", "ArrowDown"], desc: "Walk back" },
  { action: "left", group: "foot", keys: ["KeyA", "ArrowLeft"], desc: "Step left" },
  { action: "right", group: "foot", keys: ["KeyD", "ArrowRight"], desc: "Step right" },
  { action: "sprint", group: "foot", keys: ["ShiftLeft", "ShiftRight"], desc: "Sprint (hold)" },
  { action: "jump", group: "foot", keys: ["Space"], desc: "Jump" },
  { action: "crouch", group: "foot", keys: ["ControlLeft", "ControlRight", "KeyC"], desc: "Crouch (hold)" },
  { action: "use", group: "foot", keys: ["KeyE"], desc: "Use / interact (hold where shown)" },
  { action: "alt", group: "foot", keys: ["KeyF"], desc: "Second action / get in" },
  { action: "grab", group: "foot", keys: ["Mouse0"], desc: "Pick up / put down" },
  { action: "throw", group: "foot", keys: ["Mouse2"], desc: "Throw the held item" },
  { action: "rotate", group: "foot", keys: ["KeyR"], desc: "Rotate the held item (hold + mouse)" },
  { action: "stow", group: "foot", keys: ["KeyQ"], desc: "Held item to pocket / pocket to hands" },
  { action: "slot1", group: "foot", keys: ["Digit1"], desc: "Select pocket 1" },
  { action: "slot2", group: "foot", keys: ["Digit2"], desc: "Select pocket 2" },
  { action: "slot3", group: "foot", keys: ["Digit3"], desc: "Select pocket 3" },
  { action: "slot4", group: "foot", keys: ["Digit4"], desc: "Select pocket 4" },
  { action: "slot5", group: "foot", keys: ["Digit5"], desc: "Select pocket 5" },
  { action: "slot6", group: "foot", keys: ["Digit6"], desc: "Select pocket 6" },
  { action: "slotNext", group: "foot", keys: ["WheelDown"], desc: "Next pocket" },
  { action: "slotPrev", group: "foot", keys: ["WheelUp"], desc: "Previous pocket" },
  { action: "consume", group: "foot", keys: ["KeyX"], desc: "Use the selected pocket item" },
  { action: "flashlight", group: "foot", keys: ["KeyT"], desc: "Flashlight" },
];

const KEY_LABELS = {
  Escape: "Esc", Space: "Space", Tab: "Tab", ShiftLeft: "Shift", ShiftRight: "Shift", ControlLeft: "Ctrl", ControlRight: "Ctrl",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Mouse0: "LMB", Mouse1: "MMB", Mouse2: "RMB",
  WheelDown: "Wheel ↓", WheelUp: "Wheel ↑", Enter: "Enter",
};
export function keyLabel(code) {
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}
// Primary key of an action as the player reads it: "E", "LMB", "Shift". Unknown actions return the name itself.
export function bindingLabel(action) {
  const b = BINDINGS.find((x) => x.action === action);
  return b ? keyLabel(b.keys[0]) : String(action);
}
// Every distinct label of a binding, e.g. ["W", "↑"].
export function bindingLabels(binding) {
  return [...new Set(binding.keys.map(keyLabel))];
}

// code → actions per group
const byCode = { always: new Map(), drive: new Map(), foot: new Map() };
for (const b of BINDINGS) for (const k of b.keys) {
  const m = byCode[b.group];
  if (!m.has(k)) m.set(k, []);
  m.get(k).push(b.action);
}
const codeActions = new Map(); // code → every action in any group (for key-up)
for (const g of Object.values(byCode)) for (const [k, list] of g) codeActions.set(k, [...(codeActions.get(k) || []), ...list]);

const held = new Set();      // action names currently down
const pressed = new Set();   // action names pressed since the last endFrame()
const downCodes = new Map(); // physical code → actions it put down (so key-up releases exactly those)

// Shared look state. yaw/pitch in radians (+pitch looks down). dx/dy: raw mouse movement of the current frame (px).
// clamp: limit head turn (cab view). sens / invertY come from prefs (main copies them here).
export const look = { yaw: 0, pitch: 0, dx: 0, dy: 0, clamp: false, sens: 1, invertY: false };

let canvas = null;
let getMode = () => "none";
let lastMode = "none";
let lockOk = true;           // false after a pointer-lock error: drag with the left button to look instead
let silentUnlock = false;    // exitLock() was called by the game: do not treat the loss as a pause request
let lastPauseAt = -1e9;      // de-duplicates Esc key + pointer-lock loss
let wheelAcc = 0, wheelAt = 0;
let dragLook = false;

const playing = (m) => m === "drive" || m === "foot";
// A menu screen is open (set by menus.js) → behave as "overlay" whatever the game says.
const menuOpen = () => !!document.documentElement.dataset.lhMenu;
function mode() {
  let m = getMode ? getMode() : "none";
  if (m !== "none" && menuOpen()) m = "overlay";
  if (m !== lastMode) { lastMode = m; releaseAll(); }
  return m;
}
const typing = (e) => {
  const t = e.target;
  return !!t && t !== canvas && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ""));
};

function press(code, m) {
  const acts = [...(byCode.always.get(code) || []), ...(byCode[m]?.get(code) || [])];
  if (!acts.length) return false;
  if (!downCodes.has(code)) {
    downCodes.set(code, acts);
    for (const a of acts) { pressed.add(a); held.add(a); }
  }
  return true;
}
function release(code) {
  const acts = downCodes.get(code);
  if (!acts) return;
  downCodes.delete(code);
  for (const a of acts) {
    let still = false;   // another key of the same action may still be down (W and ↑)
    for (const list of downCodes.values()) if (list.includes(a)) { still = true; break; }
    if (!still) held.delete(a);
  }
}

function onKeyDown(e) {
  const m = mode();
  if (!playing(m) || typing(e)) return;
  if (e.metaKey || e.altKey) return;                 // leave OS / browser shortcuts alone
  if (e.code === "Escape") {
    const now = performance.now();
    if (now - lastPauseAt < 400) { e.preventDefault(); return; }   // lock loss already asked for a pause
    lastPauseAt = now;
  }
  const bound = byCode.always.has(e.code) || byCode[m].has(e.code);
  if (!bound) return;
  e.preventDefault();                                // Tab, Space, arrows, Ctrl+S … stay in the game
  if (e.repeat) return;
  press(e.code, m);
}
function onKeyUp(e) { release(e.code); }

function onMouseDown(e) {
  const m = mode();
  if (!playing(m)) return;
  canvas.focus({ preventScroll: true });
  if (document.pointerLockElement !== canvas) {
    const wasOk = lockOk;
    requestLock();                                   // retried on every click, so a transient refusal heals itself
    if (wasOk) { e.preventDefault(); return; }       // this click only re-acquires the mouse
    if (e.button === 0) dragLook = true;             // lock unavailable: drag to look, clicks still act
  }
  if (m !== "foot") return;
  if (e.button === 0 || e.button === 2) { press("Mouse" + e.button, m); e.preventDefault(); }
}
function onMouseUp(e) { release("Mouse" + e.button); if (e.button === 0) dragLook = false; }

function onMouseMove(e) {
  const lockedNow = document.pointerLockElement === canvas;
  if (!lockedNow && !(dragLook && !lockOk)) return;
  if (!playing(lastMode)) return;
  const mx = e.movementX || 0, my = e.movementY || 0;
  look.dx += mx; look.dy += my;
  if (held.has("rotate")) return;                    // the interaction system rotates the held item with dx/dy
  const k = 0.0025 * (look.sens || 1);
  look.yaw -= mx * k;
  if (look.clamp) look.yaw = Math.max(-2.2, Math.min(2.2, look.yaw));
  const lo = look.clamp ? -0.9 : -1.45, hi = look.clamp ? 1.2 : 1.45;
  look.pitch = Math.max(lo, Math.min(hi, look.pitch + my * k * (look.invertY ? -1 : 1)));
}

function onWheel(e) {
  const m = mode();
  if (!playing(m)) return;
  e.preventDefault();
  if (m !== "foot") return;
  const now = performance.now();
  if (now - wheelAt > 250) wheelAcc = 0;
  wheelAcc += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
  if (Math.abs(wheelAcc) >= 40 && now - wheelAt > 70) {
    pressed.add(wheelAcc > 0 ? "slotNext" : "slotPrev");
    wheelAcc = 0; wheelAt = now;
  }
}

function onLockChange() {
  const isLocked = document.pointerLockElement === canvas;
  if (isLocked) lockOk = true;
  emit("pointerlock", isLocked);
  if (isLocked) return;
  const wasPlaying = playing(mode());
  releaseAll();
  if (silentUnlock) { silentUnlock = false; return; }
  if (!wasPlaying) return;
  const now = performance.now();
  if (now - lastPauseAt < 400) return;               // Esc keydown already produced the pause edge
  lastPauseAt = now;
  emit("pause:request");
}
function onLockError() {
  lockOk = false;                                    // e.g. sandboxed frame: fall back to drag-to-look
  emit("pointerlock", false);
}

export function initInput(canvasEl, getModeFn) {
  canvas = canvasEl;
  if (getModeFn) getMode = getModeFn;
  lastMode = getMode();
  addEventListener("keydown", onKeyDown);
  addEventListener("keyup", onKeyUp);
  addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", () => { if (document.hidden) releaseAll(); });
  canvas.addEventListener("mousedown", onMouseDown);
  addEventListener("mouseup", onMouseUp);
  addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("pointerlockchange", onLockChange);
  document.addEventListener("pointerlockerror", onLockError);
}

const h = (a) => (held.has(a) ? 1 : 0);

// Driving controls for Vehicles.step. steer: +1 = left (vehicle-local +x). shiftUp/shiftDown are edges (consumed here).
export function drive() {
  if (mode() !== "drive") return { throttle: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false, horn: false };
  return {
    throttle: h("throttle") - h("brake"),
    steer: h("left") - h("right"),
    handbrake: held.has("handbrake"),
    shiftUp: took("shiftUp"),
    shiftDown: took("shiftDown"),
    horn: held.has("horn"),
  };
}

const NONE = new Set();
// On-foot controls. side: +1 = left. pressed/held are the live action sets (do not mutate; use took() to consume an edge).
export function foot() {
  if (mode() !== "foot") return { fwd: 0, side: 0, sprint: false, crouch: false, jump: false, look, pressed: NONE, held: NONE };
  return {
    fwd: h("fwd") - h("back"),
    side: h("left") - h("right"),
    sprint: held.has("sprint"),
    crouch: held.has("crouch"),
    jump: held.has("jump"),
    look, pressed, held,
  };
}

// True once per press (consumes the edge).
export function took(action) {
  mode();
  if (!pressed.has(action)) return false;
  pressed.delete(action);
  return true;
}
export function isDown(action) { mode(); return held.has(action); }

// Call once at the end of every frame: clears edges and this frame's mouse deltas, and notices mode changes.
export function endFrame() {
  pressed.clear();
  look.dx = 0; look.dy = 0;
  mode();
}
export function releaseAll() {
  held.clear(); pressed.clear(); downCodes.clear();
  look.dx = 0; look.dy = 0; dragLook = false; wheelAcc = 0;
}

export function requestLock() {
  if (!canvas || document.pointerLockElement === canvas) return;
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => { lockOk = false; });
  } catch { lockOk = false; }
}
// Leave pointer lock on purpose (opening a menu) without triggering "pause:request".
export function exitLock() {
  if (document.pointerLockElement !== canvas) return;
  silentUnlock = true;
  document.exitPointerLock();
}
export function locked() { return !!canvas && document.pointerLockElement === canvas; }
