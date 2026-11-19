// Injury and death: fatal damage sticks, hard crashes hurt and wreck the car, badly hurt players crawl. Run:
//   node --import <scratchpad>/tools/node-three-loader.mjs tests/injury.test.mjs
import assert from "node:assert";
import { Needs, crashInjury, fallInjury, CRAWL_BELOW } from "../js/survival.js";
import { Vehicle } from "../js/vehicles/vehicle.js";
import { Player } from "../js/player.js";

const DT = 1 / 120, ENV = { ambient: 25, wet: 0, sand: 0, wear: 1, night: false };
{
  const n = new Needs();
  n.hurt(100, "A crash");
  n.update(1 / 3600, { temp: 25, rate: 1 });      // the same frame's needs tick used to heal it back off zero
  assert.ok(n.dead && n.health === 0, "a fatal blow stays fatal");
  console.log("✓ death sticks");
}
// Straight into a wall at kmh: health lost and whether the car still runs
function crash(kmh) {
  const wall = { kind: "box", x: 0, z: 3, hx: 10, hz: 0.5, yaw: 0 };
  const v = new Vehicle({ id: "t", type: "sedan", seed: 7, getColliders: () => [wall] }).place(0, 0, 0);
  v.occupied = true; v.toggleIgnition();
  for (let i = 0; i < 400; i++) v.step(DT, { throttle: 0, steer: 0 }, ENV);
  v.vel.set(0, 0, kmh / 3.6); v.speed = kmh / 3.6;
  let hurt = 0;
  for (let i = 0; i < 240; i++) { v.step(DT, { throttle: 0, steer: 0 }, ENV); const t = v.telemetry(); if (t.impact > 0.5) hurt += crashInjury(t.impact); }
  return { hurt, runs: v.ign === "running", engine: v.slots.engine.cond };
}
{
  const c60 = crash(60), c90 = crash(90), c100 = crash(100), c130 = crash(130), c160 = crash(160);
  assert.ok(c60.hurt < 20 && c60.runs, "60 km/h: a knock, the car runs");
  assert.ok(c90.runs && c90.engine > 0, "90 km/h: damaged but still running");
  assert.ok(c100.hurt >= 40 && !c100.runs && c100.engine === 0, `100 km/h: badly hurt (${c100.hurt.toFixed(0)}) and the car is wrecked`);
  assert.ok(c130.hurt > 100 - CRAWL_BELOW && c130.hurt < 100, `130 km/h: barely alive, crawling (${c130.hurt.toFixed(0)})`);
  assert.ok(c160.hurt >= 100, `160 km/h: fatal (${c160.hurt.toFixed(0)})`);
  console.log(`✓ crashes: 60 → ${c60.hurt.toFixed(0)}, 100 → ${c100.hurt.toFixed(0)} (wrecked), 130 → ${c130.hurt.toFixed(0)}, 160 → ${c160.hurt.toFixed(0)}`);
}
{
  assert.strictEqual(fallInjury(5), 0, "a jump never hurts");
  assert.ok(fallInjury(26) >= 100, "a cliff kills");
  const p = new Player(), q = new Player();
  q.crawling = true;
  const walk = { fwd: 1, side: 0, sprint: true, jump: false, crouch: false };
  for (let i = 0; i < 120; i++) { p.update(1 / 60, walk); q.update(1 / 60, walk); }
  assert.ok(q.pos.z > 0.3 && q.pos.z < p.pos.z / 4, `crawling is slow: ${q.pos.z.toFixed(2)} m vs ${p.pos.z.toFixed(2)} m in 2 s`);
  assert.ok(!q.sprinting && q.height < 1, "no sprinting, flat on the ground");
  console.log("✓ falls and crawling");
}
