// Convoy checks: a parked truck stays visible to the others, and time of day / weather follow the leader. Run:
//   node --import <scratchpad>/tools/node-three-loader.mjs tests/convoy.test.mjs
import assert from "node:assert";
// Just enough of a page for name tags (canvas) and the convoy panel
const ctx = new Proxy({}, {
  get: (_, k) => k === "measureText" ? () => ({ width: 60 }) : k === "getImageData" || k === "createImageData" ? (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(4 * (w || 1) * (h || 1)) })
    : () => ctx,
  set: () => true,
});
const el = () => ({ getContext: () => ctx, setAttribute() {}, appendChild() {}, width: 0, height: 0, style: {} });
globalThis.document = { createElement: el, querySelector: () => null, body: el() };
import * as THREE from "three";
import { Convoy } from "../js/convoy.js";

// Two players wired to each other through a fake channel
function pair() {
  const clocks = { a: [], b: [] }, woke = { a: [], b: [] };
  const make = (id, key) => {
    const c = new Convoy({ root: new THREE.Group(), onClock: (p) => clocks[key].push(p), onSleep: (h) => woke[key].push(h) });
    c.me = { id, name: id }; c.code = "TEST1"; c.status = "joined";
    return c;
  };
  const a = make("aaa", "a"), b = make("bbb", "b");
  a.channel = { send: (ev, p) => b.receive(ev, structuredClone(p)), close() {} };
  b.channel = { send: (ev, p) => a.receive(ev, structuredClone(p)), close() {} };
  return { a, b, clocks, woke };
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const WX = { current: "rain", target: "rain", blend: 1, hoursLeft: 3, wetness: 1 };
const truck = { id: "t1", pos: V(5, 0, 40), quat: new THREE.Quaternion(), type: "pickup", paint: 0, seed: 7, wearLook: 0, steer: 0, lights: false };
const driving = { seed: 1, m: "car", p: truck.pos, q: truck.quat, v: V(0, 0, 0), sp: 0, vt: "pickup", pa: 0, vs: 7, w: 0, st: 0, l: false, fs: [], tm: 0.5, wx: WX };
const walking = { seed: 1, m: "foot", p: V(9, 0, 40), v: V(0, 0, 0), sp: 0, yaw: 0, pk: truck, tm: 0.5, wx: WX };

{
  const { a, b } = pair();
  const send = (l) => { for (let i = 0; i < 6; i++) { a._sendT = 0; a.tick(0.25, l, V(0, 0, 0)); b.tick(0.25, { ...walking, pk: null, p: V(0, 0, 0), tm: 0.2, wx: null }, V(0, 0, 0)); } };
  send(driving);
  const ghost = b.members.get("aaa").ghost;
  assert.ok(ghost.car && ghost.car.mesh.visible, "driving: truck visible");
  send(walking);
  assert.ok(ghost.car.mesh.visible, "on foot: parked truck still visible");
  assert.ok(ghost.car.pos.distanceTo(truck.pos) < 0.05, "parked truck where it was left");
  assert.ok(b.ghostCars(5, 40).length === 1, "parked truck is solid");
  send({ ...walking, pk: null });
  assert.ok(!ghost.car.mesh.visible, "no parked truck sent: hidden");
  console.log("✓ parked truck");
}
{
  const { a, b, clocks } = pair();
  for (let i = 0; i < 6; i++) {
    a._sendT = b._sendT = 0;
    a.tick(0.25, { ...walking, tm: 0.5 }, V(0, 0, 0));
    b.tick(0.25, { ...walking, tm: 0.2 }, V(0, 0, 0));
  }
  assert.ok(clocks.b.length > 0 && clocks.b.every((c) => c.tm === 0.5 && c.wx.current === "rain"), "b follows the leader a");
  assert.strictEqual(clocks.a.length, 0, "the leader ignores the others");
  // The leader pauses: b takes over the clock
  clocks.a.length = 0;
  a._liveAt = a._sentAt = -1e9; a.keepAlive();
  for (let i = 0; i < 4; i++) { b._sendT = 0; b.tick(0.25, { ...walking, tm: 0.2 }, V(0, 0, 0)); }
  assert.ok(clocks.a.length > 0 && clocks.a.every((c) => c.tm === 0.2), "a paused: follows b");
  console.log("✓ clock and weather");
}
{
  const { a, b, woke } = pair();
  const step = (la, lb) => { a._sendT = b._sendT = 0.5; a.tick(0.25, la, V(0, 0, 0)); b.tick(0.25, lb, V(0, 0, 0)); };
  for (let i = 0; i < 4; i++) step(walking, walking);
  assert.deepStrictEqual(a.sleepers(3), { asleep: 1, of: 2, hours: 3 }, "a asleep, b awake: wait");
  step({ ...walking, zz: 3 }, { ...walking, zz: 6 });      // falling asleep goes out without waiting for the next send
  assert.deepStrictEqual(a.sleepers(3), { asleep: 2, of: 2, hours: 6 }, "both asleep: the longest sleep wins");
  assert.strictEqual(a.leader(), "aaa");
  a.wakeAll(6);
  assert.deepStrictEqual(woke.b, [6], "everyone wakes after the same hours");
  step(walking, { ...walking, zz: 6 });
  assert.strictEqual(a.sleepers(0).asleep, 1, "getting up counts at once");
  step(walking, walking);
  b._liveAt = b._sentAt = -1e9; b.keepAlive();
  assert.deepStrictEqual(a.sleepers(3), { asleep: 2, of: 2, hours: 3 }, "a paused player counts as asleep, without choosing the hours");
  console.log("✓ everyone sleeps together");
}
