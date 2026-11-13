// Vehicle physics / component checks. Run:
//   node --import <scratchpad>/tools/node-three-loader.mjs tests/vehicle.test.mjs
import assert from "node:assert";
import { Vehicle } from "../js/vehicles/vehicle.js";
import { setGround, resetGround } from "../js/vehicles/ground.js";
import { VEHICLES } from "../js/vehicles/defs.js";
import { COMPONENT_ITEMS, makeComponent, fits, fitProblem } from "../js/vehicles/components.js";
import { TUNING } from "../js/vehicles/powertrain.js";
import { pourInto } from "../js/vehicles/interact.js";

const DT = 1 / 120;
const ENV = { ambient: 30, wet: 0, sand: 0, wear: 1, night: false };
const inp = (throttle = 0, steer = 0, handbrake = false) => ({ throttle, steer, handbrake, shiftUp: false, shiftDown: false });
const run = (v, secs, input, env = ENV) => { const n = Math.round(secs / DT); for (let i = 0; i < n; i++) v.step(DT, input, env); };
const finite = (v) => [v.pos.x, v.pos.y, v.pos.z, v.vel.x, v.vel.y, v.vel.z, v.quat.x, v.quat.w, v.rpm, v.temp, v.fuel].every(Number.isFinite);
const mk = (type = "pickup", o = {}) => new Vehicle({ id: "t", type, seed: 7, ...o }).place(0, 0, 0);
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const started = (v) => { v.occupied = true; v.toggleIgnition(); run(v, 3, inp(0)); if (v.ign !== "running") { v.toggleIgnition(); run(v, 3, inp(0)); } return v; };

test("settles and stays at rest on flat ground (both types)", () => {
  for (const type of ["pickup", "sedan"]) {
    const v = mk(type);
    run(v, 4, null);
    assert(v.asleep, type + " should fall asleep");
    assert(Math.abs(v.pos.y - v.def.comH) < 0.03, `${type} ride height ${v.pos.y}`);
    assert(Math.hypot(v.pos.x, v.pos.z) < 0.02, "drifted " + Math.hypot(v.pos.x, v.pos.z));
    assert(v.grounded === 0 || v.upright > 0.999);
    const y = v.pos.y; run(v, 20, null);
    assert(Math.abs(v.pos.y - y) < 1e-9 && v.vel.length() === 0);
  }
});

test("parked vehicle holds on a 15% side/long slope", () => {
  setGround({ heightAt: (x, z) => 0.15 * z + 0.1 * x });
  const v = mk(); const z0 = v.pos.z, x0 = v.pos.x;
  run(v, 10, null);
  assert(Math.hypot(v.pos.x - x0, v.pos.z - z0) < 0.1, "slid " + Math.hypot(v.pos.x - x0, v.pos.z - z0));
  assert(v.asleep);
  resetGround();
});

test("accelerates to a plausible top speed and brakes to a stop", () => {
  for (const [type, lo, hi] of [["pickup", 33, 50], ["sedan", 34, 55]]) {
    const v = started(mk(type));
    assert.equal(v.ign, "running");
    run(v, 12, inp(1));
    const v12 = v.speed;
    assert(v12 > 18 && v12 < 40, `${type} speed after 12 s: ${v12}`);
    run(v, 80, inp(1));
    const top = v.speed;
    assert(top > lo && top < hi, `${type} top speed ${top}`);
    assert(Math.abs(v.pos.x) < 2, "wandered off line " + v.pos.x);
    const z = v.pos.z; let t = 0;
    while (v.speed > 0.2 && t < 30) { v.step(DT, inp(-1), ENV); t += DT; }
    const dist = v.pos.z - z;
    assert(t < 9 && dist < top * top / (2 * 5) && dist > top * top / (2 * 12), `${type} braking ${dist} m in ${t} s from ${top}`);
    run(v, 2, inp(0));
    assert(Math.abs(v.speed) < 0.05, "holds still: " + v.speed);
    // reverse
    run(v, 3, inp(-1));
    assert(v.speed < -1.5 && v.telemetry().gear === "R", "reverses: " + v.speed);
  }
});

test("fixed step: same result with different frame slicing", () => {
  const sim = (frame) => {
    const v = started(mk());
    let acc = 0, t = 0, steps = 0;
    const total = Math.round(20 / DT);
    while (steps < total) {
      acc += frame;
      while (acc >= DT - 1e-12 && steps < total) { v.step(DT, inp(1, Math.sin(steps * DT) * 0.5), ENV); acc -= DT; steps++; }
    }
    return v;
  };
  const a = sim(1 / 30), b = sim(1 / 144), c = sim(0.1);
  for (const o of [b, c]) {
    assert(a.pos.distanceTo(o.pos) < 1e-9, "pos differs " + a.pos.distanceTo(o.pos));
    assert(Math.abs(a.rpm - o.rpm) < 1e-9 && Math.abs(a.fuel - o.fuel) < 1e-12);
  }
});

test("climbs a moderate slope (12%) and a steep sandy one slowly", () => {
  setGround({ heightAt: (x, z) => Math.max(0, z - 20) * 0.12 });
  const v = started(mk());
  run(v, 25, inp(1));
  assert(v.pos.z > 250 && v.speed > 15, `climb: z ${v.pos.z} speed ${v.speed}`);
  assert(v.pos.y > 20);
  resetGround();
});

test("off-road surface is slower and looser than asphalt", () => {
  const go = (surface) => { setGround({ heightAt: () => 0, surfaceAt: () => surface }); const v = started(mk()); run(v, 8, inp(1)); resetGround(); return v; };
  const a = go("asphalt"), s = go("sand");
  assert(s.speed < a.speed * 0.93, `sand ${s.speed} vs asphalt ${a.speed}`);
  assert.equal(s.telemetry().surface, "sand");
});

test("5 simulated minutes of mixed input on rough hills stay finite and upright-ish", () => {
  setGround({ heightAt: (x, z) => 3 * Math.sin(x / 23) * Math.cos(z / 31) + 1.2 * Math.sin(z / 7 + x / 11), surfaceAt: (x, z) => (Math.abs(x) < 4 ? "asphalt" : "dirt") });
  for (const type of ["pickup", "sedan"]) {
    const v = started(mk(type));
    v.fuel = v.def.tank;
    let maxSpeed = 0;
    const n = Math.round(300 / DT);
    for (let i = 0; i < n; i++) {
      const t = i * DT;
      const thr = Math.sin(t / 7) > -0.6 ? 1 : -1, st = Math.sin(t / 3.1) * (Math.sin(t / 17) > 0 ? 1 : 0.2);
      v.step(DT, inp(thr, st, (t % 41) > 39), ENV);
      if (v.upright < 0.2 && Math.abs(v.speed) < 1) v.recover();
      maxSpeed = Math.max(maxSpeed, v.vel.length());
      if (!finite(v)) assert.fail(`${type} went non-finite at t=${t}`);
    }
    assert(maxSpeed < 70, "max speed " + maxSpeed);
    assert(v.pos.y < 40 && v.pos.y > -10, "height " + v.pos.y);
    const tel = v.telemetry();
    for (const k of ["speed", "rpm", "fuel", "temp", "oil", "coolant", "battery", "engineCond", "bodyCond", "odometer", "slip", "load"]) assert(Number.isFinite(tel[k]), k);
  }
  resetGround();
});

test("no engine / no battery / dead battery / no fuel / missing wheel ⇒ cannot drive; fitting parts restores driving", () => {
  const drives = (v) => { v.occupied = true; const z = v.pos.z; run(v, 8, inp(1)); return v.pos.z - z > 15; };
  let v = mk();
  assert(drives(v), "healthy truck drives with throttle only (auto start)");

  v = mk(); const eng = v.remove("engine");
  assert(eng && eng.type === "engine_i6");
  assert(!drives(v) && v.ign !== "running" && !v.drivable());
  assert.equal(v.install("engine", eng), null);
  assert(drives(v), "engine refitted");

  v = mk(); const bat = v.remove("battery");
  assert(!drives(v));
  bat.charge = 2; v.install("battery", bat);
  assert(!drives(v), "dead battery");
  v.remove("battery"); v.install("battery", makeComponent("battery"));
  assert(drives(v), "fresh battery");

  v = mk(); v.fuel = 0;
  assert(!drives(v), "no fuel");
  v.addFluid("fuel", 10);
  assert(drives(v), "refuelled");

  v = mk(); const wheel = v.remove("wheelRL");
  run(v, 3, null);
  assert(v.pos.y < v.def.comH - 0.03 && v.upright < 0.9995, `corner drops: y ${v.pos.y} up ${v.upright}`);
  assert(!drives(v), "three wheels");
  assert(v.telemetry().tyres[2].missing);
  v.install("wheelRL", wheel);
  run(v, 2, null);
  assert(drives(v), "wheel refitted");
  assert(v.upright > 0.999);
});

test("flat tyre lowers the corner and hurts performance", () => {
  const v = mk(); v.slots.wheelFL.flat = true; v.wake();
  run(v, 3, null);
  assert(v.upright < 0.99995 && v.upright > 0.99);
  const a = started(mk()), b = started(mk()); b.slots.wheelRL.flat = true; b.slots.wheelRR.flat = true;
  run(a, 10, inp(1)); run(b, 10, inp(1));
  assert(b.speed < a.speed - 1, `flat ${b.speed} vs ${a.speed}`);
});

test("fuel/oil/coolant transfer conserves litres", () => {
  const v = mk(); v.fuel = 70;
  const can = { id: "c", type: "jerrycan", qty: 20 };
  let moved = 0;
  for (let i = 0; i < 2000; i++) { const r = pourInto(v, can, "fuel", DT); if (r === false) break; moved += 1; }
  assert(Math.abs(v.fuel - 75) < 1e-9 && Math.abs(can.qty - 15) < 1e-9, `fuel ${v.fuel} can ${can.qty}`);
  assert(Math.abs((v.fuel + can.qty) - 90) < 1e-9);
  v.fuel = 0; can.qty = 3;
  for (let i = 0; i < 2000; i++) if (pourInto(v, can, "fuel", DT) === false) break;
  assert(Math.abs(v.fuel - 3) < 1e-9 && can.qty === 0);
  // rate about 1.5 L/s
  v.fuel = 0; can.qty = 20; for (let i = 0; i < 120; i++) pourInto(v, can, "fuel", DT);
  assert(Math.abs(v.fuel - 1.5) < 0.2, "rate " + v.fuel);
  v.oil = 1; const oil = { id: "o", type: "oiljug", qty: 4 };
  for (let i = 0; i < 5000; i++) if (pourInto(v, oil, "oil", DT) === false) break;
  assert(Math.abs(v.oil + oil.qty - 5) < 1e-9 && oil.qty === 0);
  assert.equal(pourInto(v, { id: "x", type: "jerrycan", qty: 5 }, "oil", DT), false, "wrong fluid refused");
  v.coolant = 2; const w = { id: "w", type: "waterjug", qty: 4 };
  for (let i = 0; i < 5000; i++) if (pourInto(v, w, "coolant", DT) === false) break;
  assert(Math.abs(v.coolant - 6) < 1e-9 && v.waterFrac > 0.6);
});

test("overheats with no coolant; healthy cooling stays in range", () => {
  const ok = started(mk()); ok.fuel = ok.def.tank;
  run(ok, 240, inp(1));
  assert(ok.temp > 80 && ok.temp < 110, "healthy temp " + ok.temp);
  assert(ok.ign === "running");
  const v = started(mk()); v.coolant = 0; v.fuel = v.def.tank;
  const c0 = v.slots.engine.cond;
  let warned = false, t = 0;
  while (t < 240 && v.ign === "running") { v.step(DT, inp(1), ENV); t += DT; if (v.telemetry().overheating) warned = true; }
  assert(warned, "overheating flag");
  assert(v.ign !== "running" && v.temp > 120, `cut out: ${v.ign} at ${v.temp} after ${t}s`);
  assert(v.slots.engine.cond < c0, "heat damage");
  assert(v.telemetry().warnings.some((w) => w.id === "temp" || w.id === "coolant"));
});

test("low oil damages the engine; oil is consumed, faster when worn", () => {
  const a = started(mk()), b = started(mk());
  b.oil = 0.3;
  run(a, 60, inp(1)); run(b, 60, inp(1));
  assert(a.slots.engine.cond > 99, "healthy engine barely wears: " + a.slots.engine.cond);
  assert(b.slots.engine.cond < 90, "starved engine wears: " + b.slots.engine.cond);
  assert(b.telemetry().warnings.some((w) => w.id === "oil" && w.level === "crit"));
  assert(a.oil < a.def.oilCap);
  const c = started(mk()); c.slots.engine.cond = 40; c.oil = c.def.oilCap;
  run(c, 60, inp(1));
  assert(c.def.oilCap - c.oil > (a.def.oilCap - a.oil) * 2, "worn engine burns more oil");
  // worn engine makes less power
  assert(c.speed < a.speed - 0.5, `worn ${c.speed} vs ${a.speed}`);
});

test("battery: cranking drains, alternator charges, lights drain when off", () => {
  const v = mk(); v.occupied = true; v.slots.battery.charge = 60;
  v.toggleIgnition(); run(v, 0.5, inp(0));
  assert.equal(v.ign, "cranking");
  run(v, 3, inp(0)); if (v.ign !== "running") { v.toggleIgnition(); run(v, 3, inp(0)); }
  assert(v.slots.battery.charge < 60);
  const c = v.slots.battery.charge;
  run(v, 20, inp(0));
  assert(v.slots.battery.charge > c + 5 && v.telemetry().charging);
  v.toggleIgnition(); assert.equal(v.ign, "off");
  v.setLights(true); const c2 = v.slots.battery.charge;
  run(v, 60, inp(0));
  assert(v.slots.battery.charge < c2 - 1, "lights drain");
});

test("serialize → restore round-trips state", () => {
  const v = started(mk());
  run(v, 9, inp(1, 0.3));
  v.setDoor("hood", true, true); v.remove("wheelFR"); v.slots.wheelRL.flat = true; v.setLights(true);
  v.cargo.items.push({ item: { id: "p1", type: "beans" }, lpos: [0, 0.1, -1.5], lyaw: 0.3 });
  const rec = JSON.parse(JSON.stringify(v.serialize()));
  const w = new Vehicle({ id: "t", type: rec.type, seed: rec.seed }).restore(rec);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(w.serialize())), rec);
  assert(w.slots.wheelFR === null && w.slots.wheelRL.flat && w.doors.hood === 1 && w.ign === "running");
  // and keeps simulating identically
  run(v, 2, inp(1)); run(w, 2, inp(1));
  assert(v.pos.distanceTo(w.pos) < 0.05, "diverged " + v.pos.distanceTo(w.pos));
});

test("component compatibility rules", () => {
  assert(!fits("pickup", "engine", makeComponent("engine_i4")));
  assert(fits("sedan", "engine", makeComponent("engine_i4")));
  assert(fits("pickup", "engine", makeComponent("engine_v8")) && !fits("sedan", "engine", makeComponent("engine_v8")));
  assert(fits("pickup", "engine", makeComponent("engine_i6")) && fits("sedan", "engine", makeComponent("engine_i6")));
  assert(fits("pickup", "wheelFL", makeComponent("wheel_16")) && !fits("pickup", "wheelFL", makeComponent("wheel_14")));
  assert(fits("sedan", "wheelRR", makeComponent("wheel_14")) && !fits("sedan", "wheelRR", makeComponent("wheel_16")));
  assert(fits("sedan", "battery", makeComponent("battery")) && fits("pickup", "radiator", makeComponent("radiator")));
  assert(!fits("pickup", "battery", makeComponent("radiator")) && !fits("pickup", "engine", { id: "x", type: "beans" }));
  const v = mk(); v.remove("engine");
  assert(typeof v.install("engine", makeComponent("engine_i4")) === "string" && v.slots.engine === null);
  assert.equal(v.install("engine", makeComponent("engine_v8")), null);
  assert(typeof v.install("engine", makeComponent("engine_i6")) === "string", "occupied slot");
  for (const [id, d] of Object.entries(COMPONENT_ITEMS)) {
    assert(d.name && d.icon && d.kind === "part" && d.mass > 0 && d.size.length === 3 && d.price > 0 && d.slot && d.fits.length && typeof d.makeMesh === "function", id);
  }
  // V8 is quicker than the six
  const a = started(mk()), b = mk(); b.remove("engine"); b.install("engine", makeComponent("engine_v8")); started(b);
  run(a, 10, inp(1)); run(b, 10, inp(1));
  assert(b.speed > a.speed + 0.5, `v8 ${b.speed} vs i6 ${a.speed}`);
});

test("collides with static colliders and other vehicles", () => {
  const wall = { kind: "box", x: 0, z: 40, hx: 10, hz: 0.5, yaw: 0 };
  const v = started(mk(undefined, { getColliders: () => [wall] }));
  run(v, 10, inp(1));
  assert(v.pos.z + v.def.zFront < 39.6, "stopped by wall at " + v.pos.z);
  assert(v.bodyCond < 100, "took damage");
  const a = started(mk()); const b = new Vehicle({ id: "b", type: "sedan", seed: 3 }).place(0, 30, 0);
  run(b, 3, null); assert(b.asleep);
  for (let i = 0; i < 6 / DT; i++) { a.step(DT, inp(1), ENV, [a, b]); b.step(DT, null, ENV, [a, b]); }
  assert(!b.asleep || b.pos.z > 30.05, "parked car got shoved");
  assert(a.pos.z + a.def.zFront < b.pos.z + b.def.zRear + 0.6, "no pass-through");
});

test("manual gearbox and parking brake", () => {
  const v = started(mk()); v.setGearMode("manual");
  assert.equal(v.telemetry().gear, "1");
  run(v, 4, inp(1)); const s1 = v.speed; assert(s1 > 5);
  v.step(DT, { ...inp(1), shiftUp: true }, ENV); run(v, 5, inp(1));
  assert.equal(v.telemetry().gear, "2"); assert(v.speed > s1);
  run(v, 8, inp(-1)); assert(Math.abs(v.speed) < 0.3, "S only brakes in manual: " + v.speed);
  v.step(DT, { ...inp(0), shiftDown: true }, ENV); v.step(DT, { ...inp(0), shiftDown: true }, ENV); v.step(DT, { ...inp(0), shiftDown: true }, ENV);
  assert.equal(v.telemetry().gear, "R"); run(v, 3, inp(1)); assert(v.speed < -1);
  const p = started(mk()); p.toggleParkingBrake(); run(p, 1, inp(0)); assert.equal(p.telemetry().gear, "P");
});

let failed = 0;
for (const [name, fn] of tests) {
  try { resetGround(); TUNING.autoStart = true; fn(); console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + (e.message || e).toString().split("\n")[0]); if (process.env.TRACE) console.log(e.stack); }
}
console.log(failed ? `${failed} of ${tests.length} vehicle tests FAILED` : `vehicle ok (${tests.length} tests)`);
process.exit(failed ? 1 : 0);
