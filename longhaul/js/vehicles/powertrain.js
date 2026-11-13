// Long Haul – drivetrain and component condition model (pure logic, no THREE, runs in Node).
// Operates on a Vehicle's plain state; see vehicle.js for the fields.
import { ENGINES, torqueAt } from "./components.js";
import { WHEEL_SLOTS } from "./defs.js";

export const OVERHEAT = 115, CUTOUT = 128, RESTART_BELOW = 112, THERMOSTAT = 82;
// Tunable balance knobs (the lead may adjust at runtime)
export const TUNING = { fuelScale: 3, oilScale: 6, wearScale: 1, autoStart: true };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const WHEEL_NAMES = ["front left", "front right", "rear left", "rear right"];

export function batteryCharge(v) {
  const b = v.slots.battery;
  return b ? Math.max(0, Math.min(b.charge ?? 100, b.cond ?? 100)) : 0;
}
export function missingWheels(v) { let n = 0; for (const s of WHEEL_SLOTS) if (!v.slots[s]) n++; return n; }

// Why the vehicle cannot be started / driven right now (null = fine). Used for messages and tests.
export function startProblem(v) {
  const e = v.slots.engine;
  if (!e) return "There is no engine under the hood.";
  if (!v.slots.battery) return "No battery. Nothing happens.";
  if (batteryCharge(v) < 8) return "The battery is dead. The starter just clicks.";
  if (e.cond <= 0) return "The engine is seized. It will not turn.";
  if (v.fuel <= 0.02) return "The engine turns over but the tank is dry.";
  if (v.temp >= RESTART_BELOW) return "The engine is too hot to restart. Let it cool.";
  return null;
}
export function driveProblem(v) {
  if (missingWheels(v)) return "A wheel is missing.";
  return null;
}

export function beginCrank(v) {
  const e = v.slots.engine;
  if (!e || !v.slots.battery || batteryCharge(v) < 8) {
    v.ign = "off"; v._crankCool = 1.2;
    v.say(startProblem(v), "warn", "ign");
    return false;
  }
  v.ign = "cranking";
  const cold = clamp((40 - v.temp) / 60, 0, 1);
  v.crankT = 0.65 + (1 - e.cond / 100) * 0.9 + cold * 0.3 + (batteryCharge(v) < 30 ? 0.5 : 0);
  return true;
}

export function stopEngine(v, to = "off") { v.ign = to; v.crankT = 0; v.charging = false; }

// One fixed step of the drivetrain. gas 0..1. Returns the total drive force (N, + = forward) at the driven wheels.
export function powertrainStep(v, dt, gas, env) {
  const def = v.def, e = v.slots.engine, spec = e ? ENGINES[e.type] : null;
  v.redline = spec ? spec.redline : 4000;
  if (v._crankCool > 0) v._crankCool -= dt;

  if (v.ign === "cranking") {
    const b = v.slots.battery;
    if (b) b.charge = Math.max(0, (b.charge ?? 100) - 3.2 * dt);
    v.crankT -= dt;
    v.rpm += (210 + 40 * Math.sin(v.time * 31) - v.rpm) * Math.min(1, dt * 12);
    if (!b || batteryCharge(v) < 4 || !e) { stopEngine(v, "on"); v._crankCool = 1.5; v.say(startProblem(v) || "The starter gave up.", "warn", "ign"); }
    else if (v.crankT <= 0) {
      const why = startProblem(v);
      const chance = why ? 0 : 0.55 + e.cond / 200 - (batteryCharge(v) < 25 ? 0.2 : 0);
      if (!why && v.rand() < chance) { v.ign = "running"; v.rpm = Math.max(v.rpm, spec.idle * 0.8); v.shiftT = 0; }
      else { stopEngine(v, "on"); v._crankCool = 1.5; v.say(why || "The engine coughed but did not catch. Try again.", "warn", "ign"); }
    }
  }

  if (v.ign === "running") {
    let why = null;
    if (!e) why = "The engine is gone.";
    else if (v.fuel <= 0) why = "Out of fuel.";
    else if (e.cond <= 0) why = "The engine seized.";
    else if (v.temp >= CUTOUT) why = "The engine overheated and cut out.";
    if (why) { stopEngine(v, "on"); v.say(why, "crit", "ign"); }
  }

  if (v.ign !== "running") {
    if (v.ign !== "cranking") v.rpm = Math.max(0, v.rpm - 2200 * dt);
    v.load = 0; v.engineTorque = 0;
    // Left in gear with the engine off: light engine braking only in manual; automatics freewheel
    return 0;
  }

  // ── Gear selection ──
  const n = def.gears.length;
  if (v.shiftT > 0) v.shiftT -= dt;
  const ratioOf = (g) => (g > 0 ? def.gears[g - 1] : g < 0 ? def.reverse : 0);
  const speedAbs = Math.abs(v.speed);
  const k = (def.final * 30) / (Math.PI * v.driveRadius);
  if (v.gearMode === "auto") {
    if (v.sel === "R") v.gear = -1;
    else if (v.sel === "N") v.gear = 0;
    else {
      if (v.gear < 1) { v.gear = 1; }
      if (v.shiftT <= 0) {
        const wr = speedAbs * k * ratioOf(v.gear);
        const up = lerp(0.46, 0.93, gas) * spec.redline;
        if (v.gear < n && wr > up) { v.gear++; v.shiftT = 0.35; }
        else if (v.gear > 1 && wr < lerp(0.24, 0.5, gas) * spec.redline && speedAbs * k * ratioOf(v.gear - 1) < up * 0.88) { v.gear--; v.shiftT = 0.3; }
      }
    }
  }
  const ratio = ratioOf(v.gear);
  const wheelRpm = speedAbs * k * ratio;

  // ── Engine speed through a torque converter / forgiving automatic clutch ──
  let thr = gas * (v.shiftT > 0 ? 0.35 : 1);
  const power = (0.5 + 0.5 * Math.min(1, e.cond / 60)) * (v.temp > OVERHEAT ? 0.7 : 1) * (v.oilPressure < 0.25 ? 0.85 : 1);
  let target;
  if (ratio === 0) target = spec.idle + thr * (spec.redline * 0.96 - spec.idle);
  else target = Math.max(spec.idle + thr * (def.stall - spec.idle) + v.slip * 700 * thr, wheelRpm);
  // Rough idle on a tired engine
  if (e.cond < 45) target += Math.sin(v.time * 9.1) * Math.sin(v.time * 2.3) * (45 - e.cond) * 3;
  const d = target - v.rpm;
  v.rpm += clamp(d, -3200 * dt, (ratio === 0 ? 5200 : 4200) * dt);
  if (ratio !== 0 && v.rpm < wheelRpm) v.rpm = wheelRpm;
  let cut = false;
  if (v.rpm > spec.redline) { cut = true; if (ratio === 0) v.rpm = spec.redline; }

  let T = 0, engineT = 0;
  if (ratio !== 0) {
    const sr = clamp(wheelRpm / Math.max(v.rpm, 1), 0, 1);
    const mult = 1 + (def.convMult - 1) * clamp(1 - sr / 0.88, 0, 1);
    if (!cut) { engineT = torqueAt(spec, v.rpm) * thr * power; T = engineT * mult; }
    // Engine braking when coasting in gear
    if (gas < 0.05 && wheelRpm > spec.idle + 150) T = -(14 + v.rpm * 0.011) * (spec.torque[3][1] / 340);
    if (cut) T = -30;
  } else if (!cut) engineT = torqueAt(spec, v.rpm) * thr * power * 0.15;
  v.engineTorque = engineT;
  v.load = ratio !== 0 ? thr : thr * 0.25;

  // Fuel: idle flow + brake-specific consumption of the power actually made
  const kW = (engineT * v.rpm * Math.PI) / 30 / 1000;
  v.fuel = Math.max(0, v.fuel - ((spec.fuelIdle + spec.bsfc * kW) / 3600) * TUNING.fuelScale * dt);

  if (driveProblem(v)) return 0;
  const dir = v.gear < 0 ? -1 : 1;
  return (T * ratio * def.final * def.driveEff / v.driveRadius) * dir;
}

// One fixed step of wear, fluids, temperature and electrics. `dist` = metres travelled this step.
export function conditionStep(v, dt, env, dist) {
  const def = v.def, e = v.slots.engine, spec = e ? ENGINES[e.type] : null;
  const running = v.ign === "running";
  const wear = (env.wear ?? 1) * TUNING.wearScale, sand = env.sand || 0, ambient = env.ambient ?? 30;
  const km = dist / 1000;
  const speedAbs = Math.abs(v.speed);

  // ── Oil ──
  const oilFrac = v.oil / def.oilCap;
  v.oilPressure = running ? clamp(oilFrac / 0.45, 0, 1) * (0.45 + 0.55 * Math.min(1, v.rpm / 2000)) * (0.6 + 0.4 * e.cond / 100) : 0;
  if (running) {
    const rr = v.rpm / spec.redline;
    const worn = 1 + 8 * Math.pow(1 - e.cond / 100, 2);
    v.oil = Math.max(0, v.oil - (spec.oilUse / 3600) * worn * (0.4 + 1.6 * rr) * TUNING.oilScale * wear * dt);
    if (oilFrac < 0.35) {
      const starve = (0.35 - oilFrac) / 0.35;
      e.cond = Math.max(0, e.cond - Math.pow(starve, 1.5) * (0.25 + 1.6 * rr) * dt);
    }
    e.cond = Math.max(0, e.cond - km * 0.03 * wear * (1 + sand * 2 + (v.temp > 105 ? 1 : 0)));
    // A tired engine can die at idle
    if (e.cond < 35 && v.rpm < spec.idle + 250 && v.rand() < ((35 - e.cond) / 35) * 0.012 * dt) {
      stopEngine(v, "on"); v.say("The engine stalled.", "warn", "ign");
    }
  }

  // ── Cooling ──
  const rad = v.slots.radiator;
  if (!rad && v.coolant > 0) v.coolant = 0;
  const heat = running ? lerp(spec.heat[0], spec.heat[1], v.load) * (1 + 0.25 * sand) : 0;
  const coolFrac = rad ? Math.min(1, v.coolant / (def.coolantCap * 0.9)) : 0;
  const radEff = coolFrac * (rad ? 0.5 + 0.5 * Math.min(1, rad.cond / 50) : 0) * (0.65 + 0.35 * Math.min(1, speedAbs / 18)) * (1 - 0.3 * sand);
  const dT = v.temp - ambient;
  const open = clamp((v.temp - THERMOSTAT) / 10, 0, 1);
  const cool = (0.003 + (running ? 0 : 0.002) + 0.0228 * radEff * open) * dT;
  v.temp = Math.max(ambient, v.temp + (heat - cool) * dt);
  if (!(v.temp < 400)) v.temp = 400;
  const boil = 118 - 12 * v.waterFrac;
  if (v.temp > boil && v.coolant > 0) v.coolant = Math.max(0, v.coolant - 0.035 * dt);
  if (running && rad && rad.cond < 50 && v.coolant > 0) v.coolant = Math.max(0, v.coolant - ((50 - rad.cond) / 50) * 0.004 * dt);
  if (running && v.coolant > 0) v.coolant = Math.max(0, v.coolant - km * 0.004 * wear);
  if (e && v.temp > OVERHEAT) e.cond = Math.max(0, e.cond - (v.temp - OVERHEAT) * 0.05 * dt);
  v.overheating = v.temp > OVERHEAT;

  // ── Electrics ──
  const b = v.slots.battery;
  v.charging = false;
  if (b) {
    let c = b.charge ?? 100;
    if (running) {
      const net = 1.1 * Math.min(1, v.rpm / 1100) - (v.lights ? 0.12 : 0);
      c += net * dt; v.charging = net > 0;
      b.cond = Math.max(0, b.cond - dt * 0.0004 * wear);
    } else {
      c -= ((v.lights ? 0.05 : 0) + (v.ign === "on" ? 0.012 : 0)) * dt;
    }
    b.charge = clamp(c, 0, 100);
  }
  if (v.lights && !running && batteryCharge(v) <= 0.5) v.lights = false;

  // ── Tyres ──
  if (km > 0) {
    for (let i = 0; i < 4; i++) {
      const w = v.slots[WHEEL_SLOTS[i]], st = v.wheels[i];
      if (!w || !st.contact) continue;
      if (w.flat) { w.cond = Math.max(0, w.cond - km * 6 * wear); continue; }
      const paved = st.surface === "asphalt" || st.surface === "concrete";
      w.cond = Math.max(0, w.cond - km * (paved ? 0.25 : 0.8) * (1 + st.slip * 6) * wear);
      if (w.cond < 25 && v.rand() < ((25 - w.cond) / 25) * 0.35 * km) puncture(v, i);
    }
  }

  // ── Body: a badly damaged body leaks fuel ──
  if (v.bodyCond < 35 && v.fuel > 0) v.fuel = Math.max(0, v.fuel - ((35 - v.bodyCond) / 35) * 0.004 * dt);
}

export function puncture(v, i) {
  const w = v.slots[WHEEL_SLOTS[i]];
  if (!w || w.flat) return;
  w.flat = true;
  v.modified();
  if (v.occupied) v.say(`Flat tyre (${WHEEL_NAMES[i]})`, "crit", "tyre");
}

// Crash damage. sev is roughly the lost speed in m/s scaled up.
export function applyImpact(v, sev, frontal = true) {
  if (sev < 1) return;
  v.bodyCond = Math.max(0, v.bodyCond - sev * 1.1);
  const e = v.slots.engine, r = v.slots.radiator;
  if (e) e.cond = Math.max(0, e.cond - sev * 0.3);
  if (r && frontal) r.cond = Math.max(0, r.cond - sev * 0.9);
  const t = (v.rand() * 4) | 0, w = v.slots[WHEEL_SLOTS[t]];
  if (w) { w.cond = Math.max(0, w.cond - sev * 0.6); if (sev > 18 && v.rand() < 0.35) puncture(v, t); }
  v.modified();
}

export function warnings(v) {
  const out = [], def = v.def, e = v.slots.engine;
  const push = (id, level, text) => out.push({ id, level, text });
  const ff = v.fuel / def.tank;
  if (ff <= 0) push("fuel", "crit", "Out of fuel"); else if (ff < 0.12) push("fuel", "warn", "Low fuel");
  if (v.temp >= CUTOUT - 5) push("temp", "crit", "Engine overheating"); else if (v.temp > OVERHEAT - 5) push("temp", "warn", "Engine running hot");
  const of = v.oil / def.oilCap;
  if (e) { if (of < 0.2) push("oil", "crit", "No oil pressure"); else if (of < 0.4) push("oil", "warn", "Oil level low"); }
  const cf = v.coolant / def.coolantCap;
  if (!v.slots.radiator) push("coolant", "crit", "No radiator"); else if (cf < 0.25) push("coolant", "crit", "Coolant nearly gone"); else if (cf < 0.55) push("coolant", "warn", "Coolant low");
  if (!v.slots.battery) push("battery", "crit", "No battery");
  else { const c = batteryCharge(v); if (c < 8) push("battery", "crit", "Battery dead"); else if (c < 25 || (v.ign === "running" && !v.charging)) push("battery", "warn", "Battery low"); }
  let tyre = null;
  for (let i = 0; i < 4; i++) {
    const w = v.slots[WHEEL_SLOTS[i]];
    if (!w) tyre = { l: "crit", t: `Wheel missing (${WHEEL_NAMES[i]})` };
    else if (w.flat && tyre?.l !== "crit") tyre = { l: "crit", t: `Flat tyre (${WHEEL_NAMES[i]})` };
    else if (w.cond < 20 && !tyre) tyre = { l: "warn", t: "Tyres badly worn" };
  }
  if (tyre) push("tyre", tyre.l, tyre.t);
  if (!e) push("engine", "crit", "No engine"); else if (e.cond <= 0) push("engine", "crit", "Engine seized"); else if (e.cond < 25) push("engine", "warn", "Engine failing");
  if (v.bodyCond < 15) push("body", "crit", "Body wrecked, leaking fuel"); else if (v.bodyCond < 35) push("body", "warn", "Body damaged, fuel leak");
  return out;
}
