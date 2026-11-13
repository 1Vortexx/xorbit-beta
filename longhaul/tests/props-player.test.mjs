// Player controller. Run: node --import <node-three-loader.mjs> tests/props-player.test.mjs
import assert from "node:assert";
import * as THREE from "three";
import { Player, RADIUS } from "../js/player.js";
import { on } from "../js/core/bus.js";

const flat = () => 0;
const mk = (x, z, yaw = 0) => { const p = new Player({ heightAt: flat, surfaceAt: () => "concrete" }); p.teleport(x, z, yaw); return p; };
const run = (p, secs, input, cols, dt = 1 / 60, opts = {}) => {
  const inp = { fwd: 0, side: 0, sprint: false, crouch: false, jump: false, look: { yaw: p.yaw, pitch: p.pitch }, ...input };
  for (let t = 0; t < secs; t += dt) p.update(dt, inp, cols, opts);
};
// wall across the path at z = 5 (0.2 m thick), 2.4 m high; a door-sized box in the gap at x 0..1
const wallL = { kind: "box", x: -50, z: 5, hx: 50, hz: 0.1, yaw: 0, y0: 0, y1: 2.4 };
const wallR = { kind: "box", x: 51, z: 5, hx: 50, hz: 0.1, yaw: 0, y0: 0, y1: 2.4 };
const door = { kind: "box", x: 0.5, z: 5, hx: 0.5, hz: 0.05, yaw: 0, y0: 0, y1: 2.1, solid: true };
const cols = [wallL, wallR, door];

// 1. sprinting straight at the wall, at several frame rates
for (const dt of [1 / 30, 1 / 60, 1 / 144, 0.1]) {
  const p = mk(-3, 0);
  run(p, 4, { fwd: 1, sprint: true }, cols, dt);
  assert(p.pos.z <= 4.9 - RADIUS + 1e-6, `went through the wall at dt ${dt}: z=${p.pos.z}`);
  assert(p.pos.z > 4.4, "should have reached the wall, z=" + p.pos.z);
}
// 2. diagonal approaches and strafing along the wall, including into the corner by the closed door
for (let i = 0; i < 60; i++) {
  const yaw = -1.3 + (i / 59) * 2.6, p = mk(-2 + (i % 5), 1, yaw);
  run(p, 5, { fwd: 1, side: i % 3 - 1, sprint: i % 2 === 0 }, cols);
  assert(p.pos.z <= 4.95 - RADIUS + 1e-6, `diagonal ${i} got through: ${p.pos.x.toFixed(2)}, ${p.pos.z.toFixed(2)}`);
}
// 3. closed door blocks, open door (solid: false) lets the player through
{
  let p = mk(0.5, 2);
  run(p, 3, { fwd: 1, sprint: true }, cols);
  assert(p.pos.z < 5, "closed door must block");
  door.solid = false;
  p = mk(0.5, 2);
  run(p, 3, { fwd: 1 }, cols);
  assert(p.pos.z > 6, "open door must let the player pass, z=" + p.pos.z);
  door.solid = true;
}
// 4. sprint speed, stamina drain and recovery, no sprint when exhausted or without energy
{
  const p = mk(0, -200);
  run(p, 2, { fwd: 1 }, []);
  const walk = Math.hypot(p.vel.x, p.vel.z);
  run(p, 2, { fwd: 1, sprint: true }, []);
  const sprint = Math.hypot(p.vel.x, p.vel.z);
  assert(walk > 3 && walk < 4.2 && sprint > 5.5 && sprint < 7 && p.sprinting, `speeds ${walk} ${sprint}`);
  assert(p.stamina < 1);
  run(p, 30, { fwd: 1, sprint: true }, []);
  assert(p.stamina < 0.31 && !p.sprinting || p.stamina <= 0.31, "stamina " + p.stamina);
  run(p, 0.5, { fwd: 1, sprint: true }, []);
  run(p, 20, {}, []);
  assert(p.stamina > 0.95 && Math.hypot(p.vel.x, p.vel.z) < 0.01);
  run(p, 1, { fwd: 1, sprint: true }, [], 1 / 60, { needs: { energy: 3 } });
  assert(!p.sprinting, "no sprint with very low energy");
  p.encumbered = true; run(p, 1, { fwd: 1, sprint: true }, []);
  assert(!p.sprinting && Math.hypot(p.vel.x, p.vel.z) < 1.6, "encumbered is slow");
}
// 5. jump + land (sfx), crouch height, cannot stand under a low beam
{
  const heard = [];
  const off = on("sfx", (e) => heard.push(e.name));
  const p = mk(0, -50);
  let maxY = 0;
  p.update(1 / 60, { fwd: 0, side: 0, jump: true, look: { yaw: 0, pitch: 0 } }, []);
  for (let i = 0; i < 120; i++) { p.update(1 / 60, { fwd: 0, side: 0, jump: true, look: { yaw: 0, pitch: 0 } }, []); maxY = Math.max(maxY, p.pos.y); }
  assert(maxY > 0.45 && maxY < 1 && p.grounded && p.pos.y === 0, "jump apex " + maxY);
  assert(heard.includes("land"), "land sfx");
  run(p, 3, { fwd: 1 }, []);
  assert(heard.filter((n) => n === "footstep").length >= 8, "footsteps");
  off();
  const beam = { kind: "box", x: 0, z: -40, hx: 3, hz: 1, yaw: 0, y0: 1.3, y1: 2.5 };
  const q = mk(0, -43);
  run(q, 3, { fwd: 1 }, [beam]);
  assert(q.pos.z < -41, "standing player is blocked by the low beam");
  run(q, 0.9, { fwd: 1, crouch: true }, [beam]);
  assert(q.pos.z > -41 && q.crouched, "crouched player fits under it");
  run(q, 0.3, {}, [beam]);
  assert(q.crouched, "cannot stand up under the beam");
  const e1 = q.eye().y;
  run(q, 3, { fwd: 1, crouch: true }, [beam]); run(q, 1, {}, [beam]);
  assert(!q.crouched && q.eye().y > e1 + 0.5);
}
// 6. step up a 0.25 m ledge, blocked by a 0.5 m one; terrain is followed; never below it
{
  const low = { kind: "box", x: 0, z: 3, hx: 2, hz: 1, yaw: 0, y0: 0, y1: 0.25 };
  const p = mk(0, 0); run(p, 0.85, { fwd: 1 }, [low]);
  assert(Math.abs(p.pos.y - 0.25) < 1e-9 && p.pos.z > 2, "stepped up: " + p.pos.y);
  const high = { kind: "box", x: 0, z: 3, hx: 2, hz: 1, yaw: 0, y0: 0, y1: 0.5 };
  const q = mk(0, 0); run(q, 2, { fwd: 1 }, [high]);
  assert(q.pos.y === 0 && q.pos.z < 2, "0.5 m ledge blocks");
  const hill = (x, z) => 2 * Math.sin(z * 0.2);
  const h = new Player({ heightAt: hill }); h.teleport(0, 0, 0);
  const inp = { fwd: 1, side: 0, sprint: true, look: { yaw: 0, pitch: 0 } };
  for (let i = 0; i < 1200; i++) { h.update(1 / 60, inp, []); assert(h.pos.y >= hill(h.pos.x, h.pos.z) - 1e-9); assert(h.pos.y - hill(h.pos.x, h.pos.z) < 0.6); }
  assert(h.pos.z > 40);
  const cliff = (x, z) => (z > 5 ? (z - 5) * 4 : 0);
  const c = new Player({ heightAt: cliff }); c.teleport(0, 0, 0);
  for (let i = 0; i < 600; i++) c.update(1 / 60, inp, []);
  assert(c.pos.z < 5.2, "too steep to climb: z=" + c.pos.z);
}
// 7. exit spot selection
{
  const yAxis = new THREE.Vector3(0, 1, 0);
  const veh = (x, z, yaw) => {
    const v = { pos: new THREE.Vector3(x, 0.6, z), quat: new THREE.Quaternion().setFromAxisAngle(yAxis, yaw) };
    const loc = (lx, lz) => ({ x: x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z: z - lx * Math.sin(yaw) + lz * Math.cos(yaw) });
    v.colliders = () => [{ kind: "box", x, z, hx: 0.95, hz: 2.4, yaw, y0: 0, y1: 1.8 }];
    v.exitSpots = () => [loc(1.7, 0.3), loc(-1.7, 0.3), loc(0, -3.3)];
    return v;
  };
  const free = (p, cols, v) => {
    const all = [...cols, ...v.colliders()];
    for (const o of all) { const t = { x: p.pos.x, z: p.pos.z }; const s = Math.sin(o.yaw || 0), c = Math.cos(o.yaw || 0), dx = t.x - o.x, dz = t.z - o.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c; assert(Math.abs(lx) >= o.hx + RADIUS - 1e-6 || Math.abs(lz) >= o.hz + RADIUS - 1e-6, "exit spot inside geometry"); }
  };
  let v = veh(0, 0, 0), p = mk(50, 50);
  let s = p.exitVehicle(v, []);
  assert(Math.abs(s.x - 1.7) < 1e-9 && Math.abs(s.z - 0.3) < 1e-9 && p.pos.x === s.x && p.yaw === 0, "driver side first");
  // wall hard against the driver's door → passenger side
  const wall = { kind: "box", x: 1.3, z: 0, hx: 0.1, hz: 6, yaw: 0, y0: 0, y1: 3 };
  s = p.exitVehicle(v, [wall]);
  assert(Math.abs(s.x + 1.7) < 1e-9, "blocked driver side → passenger side"); free(p, [wall], v);
  // a spot that is free but on the far side of a wall is rejected too
  const wall2 = { kind: "box", x: 1.15, z: 0, hx: 0.1, hz: 6, yaw: 0, y0: 0, y1: 3 };
  s = p.exitVehicle(v, [wall2]);
  assert(s.x < 0, "never step out through a wall");
  // both sides blocked → rear
  const wallB = { kind: "box", x: -1.3, z: 0, hx: 0.1, hz: 6, yaw: 0, y0: 0, y1: 3 };
  s = p.exitVehicle(v, [wall, wallB]);
  assert(Math.abs(s.z + 3.3) < 1e-9 && Math.abs(s.x) < 1e-9, "rear spot"); free(p, [wall, wallB], v);
  // all three blocked → ring search finds somewhere free and reachable
  const wallC = { kind: "box", x: 0, z: -3.2, hx: 1.2, hz: 0.1, yaw: 0, y0: 0, y1: 3 };
  s = p.exitVehicle(v, [wall, wallB, wallC]);
  free(p, [wall, wallB, wallC], v);
  assert(Math.abs(p.pos.x) < 1.2 && p.pos.z > 2.4, "ring search: in front of the vehicle, got " + p.pos.x + ", " + p.pos.z);
  // rotated vehicle, the combined list already containing its own colliders
  v = veh(10, 10, 1.1);
  s = p.exitVehicle(v, [...v.colliders()]);
  free(p, [], v); assert(Math.abs(p.yaw - 1.1) < 1e-9);
  // steep drop beside the driver's door
  const drop = new Player({ heightAt: (x) => (x > 1 ? -6 : 0) });
  v = veh(0, 0, 0); s = drop.exitVehicle(v, []);
  assert(s.x < 0 && drop.pos.y === 0, "avoid the drop");
  // completely boxed in → on the roof, not inside anything
  const ring = [];
  for (let i = 0; i < 4; i++) ring.push({ kind: "box", x: 0, z: 0, hx: 9, hz: 9, yaw: 0, y0: 0, y1: 3 });
  s = p.exitVehicle(veh(0, 0, 0), ring);
  assert(s.roof && p.pos.y >= 1.8);
}
// 8. serialise
{
  const p = mk(3, 4, 1); p.pitch = 0.2; p.stamina = 0.5;
  const q = new Player({ heightAt: flat }); q.restore(JSON.parse(JSON.stringify(p.serialize())));
  assert.deepEqual(q.pos.toArray(), [3, 0, 4]); assert.equal(q.yaw, 1); assert.equal(q.pitch, 0.2); assert.equal(q.stamina, 0.5);
}
// Sound follows actual travel/contact, never idle input against an obstacle.
for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
  const events = [], off = on("sfx", (e) => events.push(e));
  const p = mk(0, 0);
  const barrel = { kind: "circle", x: 0, z: 2, r: 0.29, y0: 0, y1: 0.88, soundMaterial: "metal" };
  run(p, 3, { fwd: 1 }, [barrel], dt);
  const bumps = events.filter((e) => e.name === "bump");
  assert.equal(bumps.length, 1, `one clink on contact, no machine-gun repeats at ${dt}`);
  assert.equal(bumps[0].opts.material, "metal");
  events.length = 0;
  run(p, 1, {}, [barrel], dt);
  assert(!events.some((e) => e.name === "footstep" || e.name === "bump"), "standing still is silent");
  run(p, 1, { fwd: -1 }, [barrel], dt);
  run(p, 2, { fwd: 1 }, [barrel], dt);
  assert(events.some((e) => e.name === "bump"), "a fresh approach can clink again");
  off();
}
console.log("player ok");
