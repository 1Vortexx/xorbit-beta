// The Meridian: one parked car in 500, showroom condition, V12. Run:
//   node --import <scratchpad>/tools/node-three-loader.mjs tests/meridian.test.mjs
import assert from "node:assert";
import { Vehicle } from "../js/vehicles/vehicle.js";
import { parkedType, pristineVehicle, MERIDIAN_CHANCE } from "../js/vehicles/index.js";
import { WHEEL_SLOTS } from "../js/vehicles/defs.js";
import { fits, makeComponent } from "../js/vehicles/components.js";

const DT = 1 / 120, ENV = { ambient: 30, wet: 0, sand: 0, wear: 1, night: false };
const inp = (throttle = 0, steer = 0) => ({ throttle, steer, handbrake: false, shiftUp: false, shiftDown: false });
const run = (v, secs, i) => { for (let k = 0; k < Math.round(secs / DT); k++) v.step(DT, i, ENV); };

{
  let n = 0; const N = 200000;
  for (let s = 1; s <= N; s++) if (parkedType(s % 2 ? "sedan" : "pickup", s) === "meridian") n++;
  const rate = n / N;
  assert.ok(Math.abs(rate - MERIDIAN_CHANCE) < MERIDIAN_CHANCE * 0.25, `about 1 in 500: got 1 in ${Math.round(1 / rate)}`);
  assert.strictEqual(parkedType("sedan", 12345), parkedType("sedan", 12345), "same seed, same car (every convoy member agrees)");
  assert.strictEqual(parkedType("poopmobile", 1), "poopmobile", "only ordinary parked cars are swapped");
  console.log(`✓ 1 in ${Math.round(1 / rate)} parked cars`);
}
{
  const v = pristineVehicle(new Vehicle({ id: "m", type: "meridian", seed: 3 }).place(0, 0, 0));
  assert.strictEqual(v.slots.engine.type, "engine_v12");
  for (const k of ["engine", "battery", "radiator", ...WHEEL_SLOTS]) assert.strictEqual(v.slots[k].cond, 100, k);
  for (const k of WHEEL_SLOTS) assert.ok(v.slots[k].type === "wheel_15ww" && !v.slots[k].flat, k);
  assert.strictEqual(v.bodyCond, 100); assert.strictEqual(v.fuel, v.def.tank); assert.strictEqual(v.oil, v.def.oilCap);
  assert.strictEqual(v.wearLook, 0); assert.deepStrictEqual(v.defects, []);
  assert.ok(fits("meridian", "engine", makeComponent("engine_v12")) && !fits("sedan", "engine", makeComponent("engine_v12")), "the V12 only fits the Meridian");
  console.log("✓ showroom condition");
}
{
  const v = pristineVehicle(new Vehicle({ id: "m", type: "meridian", seed: 3 }).place(0, 0, 0));
  v.occupied = true; v.parkingBrake = false; v.toggleIgnition(); run(v, 3, inp(0));
  assert.strictEqual(v.ign, "running", "starts first time");
  let t = 0; while (v.speed * 3.6 < 100 && t < 20) { v.step(DT, inp(1), ENV); t += DT; }
  assert.ok(t < 6, `0–100 km/h in ${t.toFixed(1)} s`);
  run(v, 40, inp(1));
  assert.ok(v.speed * 3.6 > 240, `top speed ${Math.round(v.speed * 3.6)} km/h`);
  console.log(`✓ V12: 0–100 in ${t.toFixed(1)} s, ${Math.round(v.speed * 3.6)} km/h after 40 s`);
}
