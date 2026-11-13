// Props physics + persistence. Run: node --import <node-three-loader.mjs> tests/props.test.mjs
import assert from "node:assert";
import * as THREE from "three";
import { Props } from "../js/props.js";
import { ITEMS, FIXED_IDS, makeItem, itemsReady } from "../js/items.js";
import { ws } from "../js/core/worldstate.js";
import { emit } from "../js/core/bus.js";

await itemsReady;
// deterministic rng
let seed = 12345;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const R = (a, b) => a + (b - a) * rnd();

// bumpy ground, a 12 x 12 m room made of 0.2 m walls (unbounded height), a table and a pillar inside
const heightAt = (x, z) => 0.6 * Math.sin(x * 0.4) * Math.cos(z * 0.3) + 0.05 * Math.sin(x * 3.1 + z * 2.3);
const walls = [
  { kind: "box", x: 0, z: 6.1, hx: 6.2, hz: 0.1, yaw: 0 }, { kind: "box", x: 0, z: -6.1, hx: 6.2, hz: 0.1, yaw: 0 },
  { kind: "box", x: 6.1, z: 0, hx: 6.2, hz: 0.1, yaw: Math.PI / 2 }, { kind: "box", x: -6.1, z: 0, hx: 6.2, hz: 0.1, yaw: Math.PI / 2 },
];
const table = { kind: "box", x: 2, z: 2, hx: 0.8, hz: 0.5, yaw: 0.4, y0: 0, y1: 1.5 };
const pillar = { kind: "circle", x: -2, z: -1, r: 0.4 };
const colliders = [...walls, table, pillar];
const root = new THREE.Group();
const props = new Props({ root, getColliders: () => colliders, heightAt, surfaceAt: (x) => (x > 0 ? "concrete" : "sand"), listen: false });

// 1. thousands of random throws: always come to rest, never below the ground, never through a wall
const N = 3000, dt = 1 / 60;
let maxSteps = 0;
for (let i = 0; i < N; i++) {
  const type = FIXED_IDS[i % FIXED_IDS.length];
  const x = R(-5.3, 5.3), z = R(-5.3, 5.3);
  const fast = i % 3 === 0, sp = fast ? R(25, 60) : R(0, 14);
  const a = R(0, Math.PI * 2), el = R(-0.6, 1.2);
  const vel = new THREE.Vector3(Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp, Math.sin(a) * Math.cos(el) * sp);
  const quat = new THREE.Quaternion(R(-1, 1), R(-1, 1), R(-1, 1), R(-1, 1)).normalize();
  const p = props.spawn(makeItem(type), [x, heightAt(x, z) + R(0.5, 2.5), z], { vel, quat, angVel: new THREE.Vector3(R(-9, 9), R(-9, 9), R(-9, 9)) });
  // a spawn inside the table / pillar is pushed out by the first step; that is fine
  let steps = 0;
  const step = i % 7 === 0 ? 1 / 20 : i % 5 === 0 ? 1 / 144 : dt;   // frame-rate independence
  while (!p.asleep && steps < 3000) {
    props.update(step); steps++;
    const g = heightAt(p.pos.x, p.pos.z);
    assert(Number.isFinite(p.pos.x + p.pos.y + p.pos.z), "finite");
    assert(p.pos.y - p.hy >= g - 1e-6, `below ground: ${type} ${p.pos.y - p.hy} < ${g}`);
    assert(Math.abs(p.pos.x) < 6 && Math.abs(p.pos.z) < 6, `escaped the room: ${type} at ${p.pos.x.toFixed(2)}, ${p.pos.z.toFixed(2)} (throw ${i}, speed ${sp.toFixed(1)})`);
  }
  assert(p.asleep, `did not come to rest: ${type} throw ${i} v=${p.vel.length()}`);
  maxSteps = Math.max(maxSteps, steps);
  // at rest: sitting on the terrain or on the table top, flat on a face
  const g = heightAt(p.pos.x, p.pos.z), bottom = p.pos.y - p.hy;
  assert(Math.abs(bottom - g) < 1e-3 || Math.abs(bottom - table.y1) < 1e-3, `resting in mid-air: ${type} bottom ${bottom} ground ${g}`);
  const s = ITEMS[type].size;
  assert(s.some((v) => Math.abs(v / 2 - p.hy) < 1e-3), "not lying on a face");
  props.remove(p.id);
}
assert.equal(props.list.length, 0);

// 2. a wall stops a prop thrown straight at it; it stays on the near side
{
  const p = props.spawn(makeItem("beans"), [0, heightAt(0, 3) + 1.2, 3], { vel: new THREE.Vector3(0, 2, 38) });
  for (let i = 0; i < 900 && !p.asleep; i++) props.update(dt);
  assert(p.asleep && p.pos.z < 6.0 - p.r + 1e-6, "wall did not stop it: z=" + p.pos.z);
  props.remove(p.id);
}
// 3. resting on a collider top (table), then the support goes away → it wakes and falls to the ground
{
  const top = { kind: "box", x: -4, z: 4, hx: 0.5, hz: 0.5, yaw: 0, y0: 0, y1: 2 };
  colliders.push(top);
  const p = props.spawn(makeItem("medkit"), [-4, 2.6, 4], {});
  for (let i = 0; i < 600 && !p.asleep; i++) props.update(dt);
  assert(p.asleep && Math.abs(p.pos.y - p.hy - 2) < 1e-3, "should rest on the table top, y=" + p.pos.y);
  colliders.pop();
  for (let i = 0; i < 600; i++) props.update(dt);
  assert(p.asleep && Math.abs(p.pos.y - p.hy - heightAt(p.pos.x, p.pos.z)) < 1e-3, "should have fallen to the ground");
  // a collider moving into a sleeping prop (vehicle) pushes it out
  const car = { kind: "box", x: p.pos.x + 0.1, z: p.pos.z, hx: 1, hz: 2, yaw: 0, y0: -5, y1: 5 };
  colliders.push(car);
  for (let i = 0; i < 300; i++) props.update(dt);
  assert(Math.abs(p.pos.x - car.x) >= 1 + p.r - 1e-6 || Math.abs(p.pos.z - car.z) >= 2 + p.r - 1e-6, "not pushed out of the vehicle footprint");
  colliders.pop();
  props.remove(p.id);
}
// 4. NaN / below-ground positions are repaired, never lost
{
  const p = props.spawn(makeItem("soda"), [1, -50, 1], {});
  assert(p.pos.y - p.hy >= heightAt(1, 1) - 1e-9);
  p.vel.set(NaN, 0, 0); props.wake(p); props.update(dt); props.update(dt);
  assert(Number.isFinite(p.pos.x) && p.pos.y - p.hy >= heightAt(p.pos.x, p.pos.z) - 1e-6 && props.get(p.id) === p);
  props.remove(p.id);
}
props.dispose();

// 5. chunk unload → load round trip through ws (events on the bus)
{
  ws.reset();
  const flat = () => 0;
  const P = new Props({ root: new THREE.Group(), getColliders: () => [], heightAt: flat, chunkSize: 200 });
  const chunk = (k) => ({ k, z0: k * 200, spawns: k === 0 ? [
    { id: "s:1", type: "beans", pos: [1, 0, 10], yaw: 0.3 },
    { id: "s:2", type: "water", pos: [2, 0.9, 12], yaw: 0 },          // on a shelf: must stay put, untouched
    { id: "s:3", type: "fuelcan", qty: 4, pos: [3, 0, 14], yaw: 1 },
    { id: "s:4", type: "jerky", pos: [4, 0, 16], yaw: 0 },
    { id: "s:5", type: "wheel_16", cond: 61, pos: [5, 0, 18], yaw: 0 },
    { id: "s:6", type: "waterjug", pos: [6, 1.1, 20], yaw: 0 },      // on a shelf, will be drunk from in place
  ] : [] });
  const c0 = chunk(0), c1 = chunk(1);
  emit("chunk:load", c0); emit("chunk:load", c1);
  assert.equal(P.list.length, 6);
  assert.equal(P.get("s:3").item.qty, 4); assert.equal(P.get("s:5").item.cond, 61);
  const shelfY = P.get("s:2").pos.y;
  assert(Math.abs(shelfY - (0.9 + 0.11)) < 1e-9, "spawn pos is the point the item stands on");
  for (let i = 0; i < 120; i++) P.update(1 / 60);
  assert.equal(P.get("s:2").pos.y, shelfY, "untouched shelf prop does not fall");
  // move one (pick up + put down elsewhere), consume one, change a quantity in place, throw one into the next chunk
  const beans = P.get("s:1"); P.hold(beans); beans.pos.set(-3, 1, 30); P.unhold(beans);
  P.remove("s:4");
  P.get("s:6").item.qty = 2.5;
  const wheel = P.get("s:5"); P.hold(wheel); wheel.pos.set(0, 1, 199); P.unhold(wheel, new THREE.Vector3(0, 2, 6));
  const bought = P.spawn(makeItem("coffee"), [7, 1, 50], {});
  for (let i = 0; i < 400; i++) P.update(1 / 60);
  assert(beans.asleep && wheel.asleep && wheel.pos.z > 200, "wheel should have rolled into chunk 1, z=" + wheel.pos.z);
  const beansPos = beans.pos.toArray(), wheelPos = wheel.pos.toArray(), boughtPos = bought.pos.toArray();
  emit("chunk:unload", c0);
  assert.deepEqual(P.list.map((p) => p.id), ["s:5"], "only the wheel (now in chunk 1) stays loaded");
  assert(ws.removed.has("s:1") && ws.removed.has("s:4") && ws.removed.has("s:6") && !ws.removed.has("s:2") && !ws.removed.has("s:3"));
  assert(ws.props.has("s:1") && !ws.props.has("s:4") && ws.props.has(bought.id) && ws.props.has("s:6") && !ws.props.has("s:2") && !ws.props.has("s:3"));
  assert.equal(ws.props.get("s:1").at, "world");
  emit("chunk:unload", c1);
  assert.equal(P.list.length, 0);
  assert(ws.props.has("s:5") && ws.removed.has("s:5"));
  // survive a save
  const saved = JSON.parse(JSON.stringify(ws.serialize()));
  ws.restore(saved);
  emit("chunk:load", chunk(0));
  assert.deepEqual(P.list.map((p) => p.id).sort(), ["s:1", "s:2", "s:3", "s:6", bought.id].sort());
  assert(!P.get("s:4"), "consumed prop must not respawn");
  assert(!P.get("s:5"), "the wheel now belongs to chunk 1");
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  assert(near(P.get("s:1").pos.toArray(), beansPos), "moved prop stays where it was left");
  assert(near(P.get(bought.id).pos.toArray(), boughtPos));
  assert.equal(P.get("s:6").item.qty, 2.5);
  assert(Math.abs(P.get("s:6").pos.y - (1.1 + 0.15)) < 1e-9, "changed-in-place shelf prop stays on its shelf");
  for (let i = 0; i < 200; i++) P.update(1 / 60);
  assert(near(P.get("s:1").pos.toArray(), beansPos) && Math.abs(P.get("s:6").pos.y - 1.25) < 1e-9 && P.get("s:2").pos.y === shelfY);
  emit("chunk:load", chunk(1));
  assert(near(P.get("s:5").pos.toArray(), wheelPos) && P.get("s:5").item.cond === 61);
  // flush writes live modified props without unloading; a second round trip is stable
  const b2 = P.get("s:1"); P.hold(b2); b2.pos.set(-1, 0.5, 40); P.unhold(b2);
  for (let i = 0; i < 200; i++) P.update(1 / 60);
  P.flush();
  assert(near(ws.props.get("s:1").pos, b2.pos.toArray()));
  const count = ws.props.size;
  emit("chunk:unload", c0); emit("chunk:unload", c1); emit("chunk:load", chunk(0)); emit("chunk:load", chunk(1));
  assert.equal(ws.props.size, count); assert.equal(P.list.length, 6);
  // picked up for good → record gone, id stays removed
  P.remove("s:1");
  assert(!ws.props.has("s:1") && ws.removed.has("s:1"));
  P.dispose();
}

// 6. secured cargo round-trips through a mock vehicle's serialise
{
  ws.reset();
  const root = new THREE.Group();
  const P = new Props({ root, getColliders: () => [], heightAt: () => 0, chunkSize: 200 });
  const mkVehicle = (rec) => {
    const v = {
      id: "starter", pos: new THREE.Vector3(10, 0, 20), quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5),
      vel: new THREE.Vector3(), mesh: new THREE.Group(),
      cargo: { zone: { min: [-0.7, 0.6, -2.2], max: [0.7, 1.2, -0.4] }, items: [] },
      serialize() { return JSON.parse(JSON.stringify({ id: this.id, pos: this.pos.toArray(), cargo: { items: this.cargo.items } })); },
      restore(r) { this.cargo.items = r.cargo.items; },
    };
    v.mesh.position.copy(v.pos); v.mesh.quaternion.copy(v.quat); root.add(v.mesh); root.updateMatrixWorld(true);
    if (rec) v.restore(rec);
    return v;
  };
  const v = mkVehicle();
  emit("chunk:load", { k: 0, z0: 0, spawns: [{ id: "s:9", type: "jerrycan", qty: 12, pos: [0, 0, 5], yaw: 0 }] });
  const can = P.get("s:9"), eng = P.spawn(makeItem("engine_i6", { cond: 80 }), [1, 1, 1], {});
  P.secure(can, v, [0.2, 0.83, -1], Math.PI / 2);
  P.secure(eng, v, [-0.3, 0.93, -1.6], 0);
  assert.equal(v.cargo.items.length, 2);
  assert(can.mesh.parent === v.mesh && can.secured && ws.removed.has("s:9") && !ws.props.has("s:9"));
  assert.deepEqual(can.mesh.position.toArray(), [0.2, 0.83, -1]);
  for (let i = 0; i < 60; i++) P.update(1 / 60);
  assert.deepEqual(can.mesh.position.toArray(), [0.2, 0.83, -1], "no physics on secured cargo");
  P.flush();
  assert.equal(ws.props.size, 0, "cargo lives in the vehicle record, not in ws.props");
  const rec = v.serialize();
  emit("vehicle:unload", v); root.remove(v.mesh);
  assert.equal(P.list.length, 0); assert.equal(v.cargo.items.length, 2);
  emit("chunk:unload", { k: 0, z0: 0 });
  const v2 = mkVehicle(JSON.parse(JSON.stringify(rec)));
  emit("vehicle:load", v2);
  emit("chunk:load", { k: 0, z0: 0, spawns: [{ id: "s:9", type: "jerrycan", qty: 12, pos: [0, 0, 5], yaw: 0 }] });
  assert.equal(P.list.length, 2, "cargo restored, seeded jerry can not duplicated");
  const can2 = P.get("s:9");
  assert(can2.secured && can2.mesh.parent === v2.mesh && can2.item.qty === 12 && can2.item === v2.cargo.items[0].item);
  assert.deepEqual(can2.mesh.position.toArray(), [0.2, 0.83, -1]);
  assert.equal(P.get(eng.id).item.cond, 80);
  P.restoreCargo(v2); assert.equal(P.list.length, 2, "restoreCargo is idempotent");
  // taking it out frees it at its world pose and keeps the array in sync
  const pose = P.pose(can2);
  const expect = new THREE.Vector3(0.2, 0.83, -1).applyQuaternion(v2.quat).add(v2.pos);
  assert(pose.pos.distanceTo(expect) < 1e-9);
  P.release(can2);
  assert(!can2.secured && can2.mesh.parent === root && v2.cargo.items.length === 1 && v2.cargo.items[0].item.id === eng.id);
  assert(can2.pos.distanceTo(expect) < 1e-9);
  for (let i = 0; i < 300; i++) P.update(1 / 60);
  assert(can2.asleep && Math.abs(can2.pos.y - can2.hy) < 1e-3);
  P.remove(eng.id);
  assert.equal(v2.cargo.items.length, 0);
  P.dispose();
}
console.log("props ok (max steps to rest " + maxSteps + ")");
