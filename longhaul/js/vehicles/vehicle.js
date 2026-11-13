// Long Haul – Vehicle: rigid body on a raycast suspension, tyres, drivetrain glue, damage, persistence.
// Pure simulation (THREE math only, no DOM): the visual rig is attached by index.js, so this runs in Node.
import * as THREE from "three";
import { resolveCircle } from "../core/collide.js";
import { notify, sfx } from "../core/bus.js";
import { VEHICLES, GRAVITY, WHEEL_SLOTS, SLOTS, SLOT_LABEL } from "./defs.js";
import { ground, SURFACES, bumpNoise, mulberry } from "./ground.js";
import { COMPONENT_ITEMS, ENGINES, fitProblem, makeComponent, partNote } from "./components.js";
import {
  powertrainStep, conditionStep, applyImpact, beginCrank, stopEngine, warnings, batteryCharge, missingWheels,
  startProblem, driveProblem, TUNING, OVERHEAT,
} from "./powertrain.js";

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const Y = new THREE.Vector3(0, 1, 0);
const DRUM_R = 0.13, FLAT_DROP = 0.07;
const NO_INPUT = { throttle: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false };
const DEFAULT_ENV = { ambient: 30, wet: 0, sand: 0, wear: 1, night: false };

// Scratch (no allocation in the physics loop)
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const r = new THREE.Vector3(), mp = new THREE.Vector3(), n = new THREE.Vector3(), vp = new THREE.Vector3();
const fdir = new THREE.Vector3(), sdir = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3();
const force = new THREE.Vector3(), torque = new THREE.Vector3(), tire = new THREE.Vector3(), rApply = new THREE.Vector3();
const qInv = new THREE.Quaternion(), dq = new THREE.Quaternion(), qSteer = new THREE.Quaternion();
const m4 = new THREE.Matrix4(), pt = { x: 0, z: 0 }, hit = {};

export class Vehicle {
  // opts: { id, type, seed, getColliders(x, z, r) }
  constructor(opts = {}) {
    this.id = opts.id || "veh";
    this.type = opts.type || "pickup";
    this.def = VEHICLES[this.type];
    if (!this.def) throw new Error("Unknown vehicle type " + this.type);
    this.seed = opts.seed >>> 0 || 1;
    this.rand = mulberry(this.seed ^ 0x9e3779b9);
    this.getColliders = opts.getColliders || null;
    this.paint = opts.paint ?? 0x4f8f8c;
    this.wearLook = opts.wearLook ?? 0.5;    // 0 tidy .. 1 rust bucket (visual only)

    this.pos = new THREE.Vector3(0, this.def.comH, 0);
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.speed = 0;
    this.steer = 0;            // front wheel angle (rad, + = left)
    this.time = 0;
    this.mesh = new THREE.Group();
    this.mesh.name = "vehicle:" + this.id;
    this.rig = null;

    const d = this.def;
    this.slots = {
      engine: makeComponent(d.defaultEngine), battery: makeComponent("battery"), radiator: makeComponent("radiator"),
      wheelFL: makeComponent(d.wheel), wheelFR: makeComponent(d.wheel), wheelRL: makeComponent(d.wheel), wheelRR: makeComponent(d.wheel),
    };
    this.fuel = d.tank * 0.5; this.oil = d.oilCap; this.coolant = d.coolantCap; this.waterFrac = 0;
    this.temp = 30; this.bodyCond = 100; this.odometer = 0;
    this.doors = { driver: 0, passenger: 0, hood: 0, [d.rearDoor]: 0 };
    this.doorTarget = { driver: 0, passenger: 0, hood: 0, [d.rearDoor]: 0 };
    this.cargo = { zone: d.cargoZone, items: [] };
    this.occupied = false;

    // Drivetrain
    this.ign = "off"; this.crankT = 0; this._crankCool = 0;
    this.rpm = 0; this.redline = 4200; this.gear = 1; this.sel = "D"; this.gearMode = "auto"; this.shiftT = 0;
    this.throttle = 0; this.brake = 0; this.load = 0; this.slip = 0; this.engineTorque = 0;
    this.oilPressure = 0; this.charging = false; this.overheating = false;
    this.parkingBrake = false; this.lights = false; this.hornOn = false;
    this.driveRadius = d.wheelR;

    // Chassis state
    this.wheels = d.wheels.map((w, i) => ({ x: w.x, z: w.z, front: w.front, comp: d.sag[i], contact: false, spin: 0, slip: 0, surface: "asphalt", load: 0 }));
    this.grounded = 0; this.upright = 1; this.surface = "asphalt";
    this.impact = 0;                 // crash severity since the last telemetry() call
    this.asleep = false; this._still = 0; this._wasDriven = false;
    this.camMotion = { x: 0, y: 0, z: 0, roll: 0 };
    this._acc = new THREE.Vector3(); this._velPrev = new THREE.Vector3();
    this._col = []; this._colT = 0; this._colAt = new THREE.Vector3(1e9, 0, 1e9);
    this._pourT = 0;
    this.dirty = false; this.others = null;
    this._spawn = null;
  }

  // ── Small API ───────────────────────────────────────────────────────────────────────────
  say(text, level = "info", key = "veh") { if (text && (this.occupied || this._announce)) notify(text, { level, key: "veh:" + key, icon: "🚗" }); this.lastMessage = text; }
  modified() { this.dirty = true; }
  wake() { this.asleep = false; this._still = 0; }
  get engineSpec() { const e = this.slots.engine; return e ? ENGINES[e.type] : null; }
  get running() { return this.ign === "running"; }

  toggleIgnition() {
    this.modified();
    if (this.ign === "running" || this.ign === "cranking") { stopEngine(this, "off"); return this.ign; }
    beginCrank(this);
    return this.ign;
  }
  setLights(mode) {
    const on = mode === undefined ? !this.lights : !!mode && mode !== "off";
    if (on && this.ign !== "running" && batteryCharge(this) <= 0.5) { this.lights = false; this.say("The lights stay dark. The battery is dead.", "warn", "lights"); return false; }
    this.lights = on; this.modified();
    return on;
  }
  toggleParkingBrake() { this.parkingBrake = !this.parkingBrake; this.wake(); this.modified(); return this.parkingBrake; }
  setGearMode(mode) {
    this.gearMode = mode === "manual" ? "manual" : "auto";
    if (this.gearMode === "manual") { if (this.sel === "R") this.gear = -1; }
    else this.sel = this.gear < 0 ? "R" : "D";
    return this.gearMode;
  }
  horn(on) { this.hornOn = !!on && (this.ign === "running" || batteryCharge(this) > 1); return this.hornOn; }

  setDoor(name, open, quiet) {
    if (!(name in this.doors)) return;
    const t = open ? 1 : 0;
    if (this.doorTarget[name] === t) return;
    this.doorTarget[name] = t; this.modified();
    if (!quiet) sfx(name === "hood" ? (t ? "hood_open" : "hood_close") : (t ? "door_open" : "door_close"), { pos: this.pos });
  }
  toggleDoor(name) { this.setDoor(name, !(this.doorTarget[name] > 0.5)); }

  // ── Components ──────────────────────────────────────────────────────────────────────────
  canInstall(slot, item) { return this.slots[slot] ? "Something is already fitted there" : fitProblem(this.type, slot, item); }
  install(slot, item) {
    const why = this.canInstall(slot, item);
    if (why) return why;
    this.slots[slot] = item;
    if (slot === "engine") { this.rpm = 0; }
    this.wake(); this.modified(); this.rig?.slotsChanged();
    return null;
  }
  remove(slot) {
    const item = this.slots[slot];
    if (!item) return null;
    this.slots[slot] = null;
    if (slot === "engine" || slot === "battery") { if (this.ign !== "off" && (slot === "engine" || this.ign !== "running")) stopEngine(this, "off"); }
    if (slot === "radiator") this.coolant = 0;
    this.wake(); this.modified(); this.rig?.slotsChanged();
    return item;
  }
  // Add up to `litres` of a fluid ("fuel" | "oil" | "coolant" | "water"); returns the litres actually taken.
  addFluid(fluid, litres) {
    const d = this.def;
    let took = 0;
    if (fluid === "fuel") { took = clamp(litres, 0, d.tank - this.fuel); this.fuel += took; }
    else if (fluid === "oil") { took = clamp(litres, 0, d.oilCap - this.oil); this.oil += took; }
    else if (fluid === "coolant" || fluid === "water") {
      if (!this.slots.radiator) return 0;
      took = clamp(litres, 0, d.coolantCap - this.coolant);
      const water = this.waterFrac * this.coolant + (fluid === "water" ? took : 0);
      this.coolant += took;
      this.waterFrac = this.coolant > 0 ? water / this.coolant : 0;
    }
    if (took > 0) this.modified();
    return took;
  }
  // Repair kit: restores body and engine condition
  repair(amount = 40, what = "both") {
    if (what !== "engine") this.bodyCond = Math.min(100, this.bodyCond + amount);
    const e = this.slots.engine;
    if (e && what !== "body") e.cond = Math.min(100, e.cond + amount);
    this.modified();
  }

  // ── Placement ───────────────────────────────────────────────────────────────────────────
  // Rest the vehicle on the terrain at (x, z) facing yaw, tilted to match the ground under the wheels.
  place(x, z, yaw = 0) {
    const d = this.def, s = Math.sin(yaw), c = Math.cos(yaw);
    const h = (lx, lz) => ground.heightAt(x + lx * c + lz * s, z - lx * s + lz * c);
    const t = d.track / 2;
    const hf = (h(t, d.axleF) + h(-t, d.axleF)) / 2, hr = (h(t, d.axleR) + h(-t, d.axleR)) / 2;
    const hl = (h(t, d.axleF) + h(t, d.axleR)) / 2, hrt = (h(-t, d.axleF) + h(-t, d.axleR)) / 2;
    const pitch = (hf - hr) / d.wheelbase, roll = (hl - hrt) / d.track;
    // Basis: forward rises with pitch, left rises with roll
    v1.set(s, pitch, c).normalize();                 // forward
    v2.set(c, roll, -s).normalize();                 // left
    v3.crossVectors(v1, v2).normalize();             // up = fwd × left
    v2.crossVectors(v3, v1).normalize();
    m4.makeBasis(v2, v3, v1);
    this.quat.setFromRotationMatrix(m4).normalize();
    const h0 = hr + pitch * (0 - d.axleR);
    this.pos.set(x, h0 + d.comH * v3.y + 0.01, z);
    this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0); this.steer = 0; this.speed = 0;
    for (let i = 0; i < 4; i++) this.wheels[i].comp = d.sag[i];
    this.wake();
    return this;
  }
  // Put the vehicle on the road at (or near) z, in the right-hand lane, pointing down the road
  placeOnRoad(z) {
    const dir = ground.roadDir(z);
    return this.place(ground.roadX(z) - dir.z * 2, z + dir.x * 2, Math.atan2(dir.x, dir.z));
  }
  // Un-stick: set the vehicle back on its wheels where it is
  recover() {
    fwd.set(0, 0, 1).applyQuaternion(this.quat);
    let yaw = Math.atan2(fwd.x, fwd.z);
    if (!isFinite(yaw)) yaw = 0;
    if (!isFinite(this.pos.x) || !isFinite(this.pos.z)) { const s = this._spawn; this.pos.set(s ? s.pos[0] : 0, 0, s ? s.pos[2] : 0); }
    this.place(this.pos.x, this.pos.z, yaw);
    this.pos.y += 0.15;
    return this;
  }

  // ── Queries ─────────────────────────────────────────────────────────────────────────────
  seatEye(out = new THREE.Vector3()) {
    const e = this.def.seatEye;
    return out.set(e[0], e[1], e[2]).applyQuaternion(this.quat).add(this.pos);
  }
  localToWorld(lx, ly, lz, out = new THREE.Vector3()) { return out.set(lx, ly, lz).applyQuaternion(this.quat).add(this.pos); }
  exitSpots() {
    return this.def.exits.map(([x, z]) => { v1.set(x, 0, z).applyQuaternion(this.quat); return { x: this.pos.x + v1.x, z: this.pos.z + v1.z }; });
  }
  get yaw() { v1.set(0, 0, 1).applyQuaternion(this.quat); return Math.atan2(v1.x, v1.z); }
  colliders() {
    const d = this.def, b = d.body, yaw = this.yaw, s = Math.sin(yaw), c = Math.cos(yaw);
    const base = this.pos.y - d.comH;
    const box = (z0, z1, top) => {
      const zc = (z0 + z1) / 2;
      return { kind: "box", x: this.pos.x + s * zc, z: this.pos.z + c * zc, hx: d.halfW, hz: (z1 - z0) / 2, yaw, y0: base + 0.15, y1: base + top, vehicle: this };
    };
    return [box(b.zCabBack, d.zFront, b.roofY), box(d.zRear, b.zCabBack, b.style === "pickup" ? b.beltY : b.deckY)];
  }
  inspect() {
    const d = this.def, out = [];
    for (const slot of SLOTS) {
      const item = this.slots[slot];
      out.push({ slot, label: SLOT_LABEL[slot], item, cond: item ? Math.round(item.cond ?? 100) : 0, note: item ? `${COMPONENT_ITEMS[item.type].name}: ${partNote(item)}` : "missing" });
    }
    out.push({ slot: "body", label: "Body", item: null, cond: Math.round(this.bodyCond), note: this.bodyCond < 35 ? "leaking fuel" : this.bodyCond < 70 ? "dented" : "straight" });
    out.push({ slot: "fuel", label: "Fuel", item: null, cond: Math.round((this.fuel / d.tank) * 100), note: `${this.fuel.toFixed(1)} / ${d.tank} L` });
    out.push({ slot: "oil", label: "Engine oil", item: null, cond: Math.round((this.oil / d.oilCap) * 100), note: `${this.oil.toFixed(1)} / ${d.oilCap} L` });
    out.push({ slot: "coolant", label: "Coolant", item: null, cond: Math.round((this.coolant / d.coolantCap) * 100), note: `${this.coolant.toFixed(1)} / ${d.coolantCap} L${this.waterFrac > 0.4 ? " (mostly water)" : ""}` });
    return out;
  }
  gearLabel() {
    if (this.ign !== "running" && this.gearMode === "auto") return this.parkingBrake || !this.occupied ? "P" : "N";
    if (this.gearMode === "auto") return this.parkingBrake && Math.abs(this.speed) < 0.3 && this.throttle < 0.02 ? "P" : this.sel;
    return this.gear < 0 ? "R" : this.gear === 0 ? "N" : String(this.gear);
  }
  drivable() { return !startProblem(this) && !driveProblem(this); }
  telemetry() {
    const d = this.def, s = this.slots;
    const impact = this.impact; this.impact = 0;
    return {
      speed: this.speed, rpm: this.rpm, redline: this.redline, gear: this.gearLabel(), gearMode: this.gearMode, ignition: this.ign,
      throttle: this.throttle, brake: this.brake, load: this.load, slip: this.slip, surface: this.surface, grounded: this.grounded,
      fuel: this.fuel, tank: d.tank, temp: this.temp, overheating: this.temp > OVERHEAT,
      oil: this.oil, oilCap: d.oilCap, oilPressure: this.oilPressure, coolant: this.coolant, coolantCap: d.coolantCap,
      battery: batteryCharge(this), charging: this.charging,
      engineCond: s.engine ? s.engine.cond : 0, bodyCond: this.bodyCond,
      tyres: WHEEL_SLOTS.map((k) => ({ cond: s[k] ? s[k].cond : 0, flat: !!(s[k] && s[k].flat), missing: !s[k] })),
      parkingBrake: this.parkingBrake, lights: this.lights, horn: this.hornOn, odometer: this.odometer,
      warnings: warnings(this), impact, upright: this.upright, steer: this.steer,
    };
  }

  // ── Fixed step ──────────────────────────────────────────────────────────────────────────
  // input = null → parked (brakes held). env see ARCHITECTURE §5.
  step(dt, input, env = DEFAULT_ENV, others = null) {
    const driven = !!input;
    if (driven !== this._wasDriven) { this._wasDriven = driven; this.wake(); }
    this.time += dt;
    if (this.asleep && !driven) {
      if (this.ign !== "off") {
        if (!this.occupied && this.ign === "on") this.ign = "off";
        powertrainStep(this, dt, 0, env); conditionStep(this, dt, env, 0);
      } else if (this.temp > (env.ambient ?? 30) + 0.5 || this.lights) conditionStep(this, dt, env, 0);
      return;
    }
    const d = this.def, inp = input || NO_INPUT;
    up.copy(Y).applyQuaternion(this.quat);
    fwd.set(0, 0, 1).applyQuaternion(this.quat);
    this.speed = this.vel.dot(fwd);
    this.upright = up.y;
    const speed = this.speed, speedAbs = Math.abs(speed);

    // ── Controls ──
    const maxSteer = Math.min(d.steerLock, Math.atan((d.wheelbase * 11.3) / Math.max(1, speed * speed)));
    const target = clamp(inp.steer, -1, 1) * maxSteer;
    const rate = (Math.abs(target) < Math.abs(this.steer) ? 3.4 : 2.2) * dt;
    this.steer += clamp(target - this.steer, -rate, rate);

    let gas = 0, brake = 0;
    const thr = clamp(inp.throttle || 0, -1, 1);
    if (driven) {
      if (this.gearMode === "auto") {
        if (thr > 0) { if (this.sel === "R" && speed < -0.5) brake = thr; else { this.sel = "D"; gas = thr; } }
        else if (thr < 0) { if (speed > 0.5) brake = -thr; else { this.sel = "R"; gas = -thr; } }
        else if (speedAbs < 0.6) brake = 1;
      } else {
        if (inp.shiftUp) { if (this.gear < d.gears.length && !(this.gear < 0 && speed < -1.5)) { this.gear++; this.shiftT = 0.25; } }
        if (inp.shiftDown) { if (this.gear > 0 || (this.gear === 0 && speed < 1.5)) { this.gear--; this.shiftT = 0.25; } }
        if (thr > 0) gas = thr; else if (thr < 0) brake = -thr;
        else if (speedAbs < 0.4 && this.gear === 0) brake = 0.3;
      }
      // Forgiving restart: pressing the throttle with a stopped engine turns the key
      if (TUNING.autoStart && gas > 0 && this.ign !== "running" && this.ign !== "cranking" && this._crankCool <= 0) beginCrank(this);
    } else {
      brake = 1;
      if (!this.occupied && this.ign === "on") this.ign = "off";
    }
    this.throttle += clamp(gas - this.throttle, -8 * dt, 5 * dt);
    this.brake += clamp(brake - this.brake, -10 * dt, 8 * dt);
    const hand = !!inp.handbrake || this.parkingBrake || !driven;

    const drive = powertrainStep(this, dt, this.throttle, env);

    // ── Forces ──
    force.set(0, -GRAVITY * d.mass, 0);
    torque.set(0, 0, 0);
    const mq = d.mass / 4;
    const wasGrounded = this.grounded, vyBefore = this.vel.y;
    this.grounded = 0;
    const wet = env.wet || 0;
    const brakeTotal = d.brakeG * d.mass * GRAVITY * this.brake;
    let slipMax = 0, drivenContacts = 0;
    for (let wi = 2; wi < 4; wi++) if (this.wheels[wi].contact) drivenContacts++;
    const hubY = d.wheelR - d.comH;

    for (let wi = 0; wi < 4; wi++) {
      const w = this.wheels[wi], item = this.slots[WHEEL_SLOTS[wi]];
      const cr = !item ? DRUM_R : item.flat ? d.wheelR - FLAT_DROP : d.wheelR;   // contact radius
      r.set(w.x, hubY - d.sag[wi], w.z).applyQuaternion(this.quat);              // hub at full droop
      mp.copy(this.pos).add(r);
      const surf = ground.surfaceAt(mp.x, mp.z), S = SURFACES[surf] || SURFACES.asphalt;
      let gh = ground.heightAt(mp.x, mp.z);
      if (S.rough) gh += S.rough * bumpNoise(mp.x * 1.4, mp.z * 1.4);
      let comp = cr - (mp.y - gh);
      const compPrev = w.comp;
      w.contact = comp > 0 && up.y > 0.2;
      v1.copy(this.angVel).cross(r);
      vp.copy(this.vel).add(v1);
      if (!w.contact) {
        w.comp = Math.max(0, w.comp - 2.5 * dt);
        w.spin += ((w.front ? speed : speed * (1 + this.slip)) / d.wheelR) * dt; w.slip = 0; w.load = 0;
        continue;
      }
      this.grounded++;
      w.surface = surf;
      ground.normalAt(mp.x, mp.z, n);
      // Spring + damper, progressive bump stop
      let N = d.spring[wi] * comp - d.damper[wi] * vp.dot(n);
      if (comp > d.susp.travel) N += d.spring[wi] * 5 * (comp - d.susp.travel);
      // Anti-roll bar couples the two wheels of an axle
      const other = this.wheels[wi ^ 1];
      N += d.susp.arb * (w.front ? 1 : 0.45) * (clamp(comp, 0, d.susp.travel) - clamp(other.comp, 0, d.susp.travel));
      N = clamp(N, 0, d.mass * GRAVITY * 2.5);
      w.comp = clamp(comp, 0, d.susp.travel + 0.04);
      w.load = N;
      v2.copy(n).multiplyScalar(N);
      force.add(v2);
      torque.add(v3.copy(r).cross(v2));

      // Tyre frame on the ground plane
      fdir.copy(fwd);
      if (w.front) fdir.applyQuaternion(qSteer.setFromAxisAngle(up, this.steer));
      fdir.addScaledVector(n, -fdir.dot(n)).normalize();
      sdir.copy(n).cross(fdir).normalize();
      const vf = vp.dot(fdir), vs = vp.dot(sdir), vfa = Math.abs(vf);

      const tyre = !item ? 0.42 : item.flat ? 0.5 : 0.7 + 0.3 * Math.min(1, item.cond / 60);
      const Nstat = d.cornerMass[wi] * GRAVITY;
      let mu = S.mu * tyre * (1 - S.wet * wet) * clamp(1.08 - 0.08 * (N / Nstat), 0.82, 1.08);
      const roll = !item ? 0.5 : S.roll + (item.flat ? 0.13 : 0) + (env.sand ? 0.004 * env.sand : 0);
      const maxF = mu * N;

      // Lateral: slip-angle curve at speed, static hold (with gravity compensation) at a crawl
      const alpha = Math.abs(Math.atan2(vs, vfa + 0.6));
      const low = clamp(1 - (vfa - 1.5) / 2.5, 0, 1);
      let curve = Math.min(1, alpha / S.peak + low);
      if (alpha > S.peak) curve *= 1 - 0.14 * Math.min(1, (alpha - S.peak) / 0.5);
      const latNeed = mq * (-(vs / dt) * 0.5 + GRAVITY * sdir.y);
      let lat = clamp(latNeed, -maxF * curve, maxF * curve);

      // Longitudinal: drive + passive (brake, rolling resistance) that can only oppose motion
      let lon = 0, B = roll * N;
      if (!w.front && drive && drivenContacts) lon = drive / drivenContacts;
      B += brakeTotal * (w.front ? d.brakeBias : 1 - d.brakeBias) / 2;
      if (hand && !w.front) B += d.mass * GRAVITY * 0.45;
      if (!item) B += maxF;
      const holdNeed = mq * (-(vf / dt) + GRAVITY * fdir.y) - lon;
      const demand = Math.abs(lon);
      lon += clamp(holdNeed, -B, B);

      const tot = Math.hypot(lat, lon);
      if (tot > maxF && tot > 0) { lat *= maxF / tot; lon *= maxF / tot; }
      w.slip = clamp(Math.max((demand - maxF) / (maxF + 1), (alpha - S.peak * 1.3) / 0.35 * Math.min(1, vfa / 4), (B > maxF && vfa > 2) ? 1 : 0), 0, 1);
      if (w.slip > slipMax) slipMax = w.slip;

      tire.copy(fdir).multiplyScalar(lon).addScaledVector(sdir, lat);
      force.add(tire);
      // Apply tyre forces part-way up towards the centre of mass (anti-dive / anti-roll geometry)
      rApply.copy(r).addScaledVector(n, -cr);
      rApply.addScaledVector(up, -rApply.dot(up) * (1 - d.susp.lever));
      torque.add(v3.copy(rApply).cross(tire));

      const locked = B > maxF && this.brake > 0.9 || (hand && !w.front && (inp.handbrake || this.parkingBrake));
      w.spin += (locked ? 0 : (vf / d.wheelR) * (1 + (!w.front && demand > maxF ? Math.sign(drive) * Math.sign(vf || 1) * 0.8 * w.slip + (vfa < 2 ? w.slip * 6 / Math.max(vfa, 0.5) : 0) : 0))) * dt;
    }
    this.slip += (slipMax - this.slip) * Math.min(1, dt * 10);
    if (this.grounded) this.surface = this.wheels[this.wheels[2].contact ? 2 : this.wheels[0].contact ? 0 : this.wheels[1].contact ? 1 : 3].surface;

    // Hull contact (belly, on its side / roof)
    let hullHits = 0;
    for (const h of d.hull) {
      r.set(h[0], h[1], h[2]).applyQuaternion(this.quat);
      mp.copy(this.pos).add(r);
      const pen = ground.heightAt(mp.x, mp.z) - mp.y;
      if (pen <= 0) continue;
      hullHits++;
      v1.copy(this.angVel).cross(r);
      vp.copy(this.vel).add(v1);
      if (vp.y < -4) { const sev = (-vp.y - 4) * 3 * dt * 60; this.impact += sev; applyImpact(this, sev, false); }
      const fN = Math.max(0, d.mass * 55 * Math.min(pen, 0.5) - d.mass * 4.5 * Math.min(0, vp.y));
      const fr = Math.min(d.mass * 1.1, (0.7 * fN) / (Math.hypot(vp.x, vp.z) + 0.3));
      v2.set(-vp.x * fr, fN, -vp.z * fr);
      force.add(v2);
      torque.add(v3.copy(r).cross(v2));
    }

    // Air drag
    force.addScaledVector(this.vel, -d.cdA * this.vel.length());

    // ── Integrate ──
    this.vel.addScaledVector(force, dt / d.mass);
    qInv.copy(this.quat).invert();
    v1.copy(torque).applyQuaternion(qInv);
    v2.copy(this.angVel).applyQuaternion(qInv);
    v2.x += (v1.x / d.inertia[0]) * dt;
    v2.y += (v1.y / d.inertia[1]) * dt;
    v2.z += (v1.z / d.inertia[2]) * dt;
    v2.x *= 1 - 0.9 * dt; v2.y *= 1 - 0.35 * dt; v2.z *= 1 - 0.9 * dt;
    this.angVel.copy(v2.applyQuaternion(this.quat));
    const wl = this.angVel.length(); if (wl > 12) this.angVel.multiplyScalar(12 / wl);
    const vl = this.vel.length(); if (vl > 90) this.vel.multiplyScalar(90 / vl);

    this.pos.addScaledVector(this.vel, dt);
    dq.set(this.angVel.x * dt * 0.5, this.angVel.y * dt * 0.5, this.angVel.z * dt * 0.5, 0).multiply(this.quat);
    this.quat.set(this.quat.x + dq.x, this.quat.y + dq.y, this.quat.z + dq.z, this.quat.w + dq.w).normalize();

    if (!isFinite(this.pos.x + this.pos.y + this.pos.z + this.quat.w + this.vel.x + this.angVel.x)) {
      this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0); this.quat.identity(); this.recover();
    }
    // Never fall through the world
    const floor = ground.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y < floor + 0.1) { this.pos.y = floor + 0.1; if (this.vel.y < 0) this.vel.y = 0; }

    // Hard landing
    if (wasGrounded < 2 && this.grounded >= 2 && vyBefore < -6) { const sev = (-vyBefore - 6) * 4; this.impact += sev; applyImpact(this, sev, false); }

    // ── Obstacles and other vehicles ──
    this._collide(dt, others);

    // ── Bookkeeping ──
    const sp = this.vel.length(), dist = sp * dt;
    this.odometer += dist;
    if (dist > 0.0005 && driven) this.dirty = true;
    conditionStep(this, dt, env, this.grounded ? dist : 0);

    // Cabin motion: low-passed body acceleration + engine shake
    v1.copy(this.vel).sub(this._velPrev).multiplyScalar(1 / dt);
    this._velPrev.copy(this.vel);
    this._acc.lerp(v1, Math.min(1, dt * 7));
    v2.copy(this._acc).applyQuaternion(qInv);
    const cm = this.camMotion;
    let shake = 0;
    if (this.ign === "running") shake = (0.0009 + 0.0016 * (this.engineSpec.idle / Math.max(this.rpm, 300))) * (1 + (100 - this.slots.engine.cond) / 60);
    else if (this.ign === "cranking") shake = 0.004;
    const ph = this.time * Math.min(38, Math.max(8, this.rpm / 60)) * 6.283;
    cm.x = clamp(-v2.x * 0.0035, -0.04, 0.04) + shake * 0.6 * Math.sin(ph * 0.5);
    cm.y = clamp(-v2.y * 0.004, -0.05, 0.05) + shake * Math.sin(ph);
    cm.z = clamp(-v2.z * 0.005, -0.06, 0.06);
    cm.roll = clamp(v2.x * 0.0022, -0.03, 0.03);

    // Sleep when parked and still
    if (!driven) {
      if (sp < 0.06 && this.angVel.lengthSq() < 0.003 && (this.grounded >= 3 || hullHits >= 2 || this.grounded + hullHits >= 3)) {
        this._still += dt;
        if (this._still > 1.2) { this.asleep = true; this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0); this.speed = 0; this.slip = 0; cm.x = cm.y = cm.z = cm.roll = 0; }
      } else this._still = 0;
    }
  }

  _collide(dt, others) {
    const d = this.def;
    // Refresh the nearby static collider list now and then
    this._colT -= dt;
    if (this.getColliders && (this._colT <= 0 || Math.abs(this.pos.x - this._colAt.x) + Math.abs(this.pos.z - this._colAt.z) > 4)) {
      this._col = this.getColliders(this.pos.x, this.pos.z, 16) || [];
      this._colT = 0.35; this._colAt.copy(this.pos);
    }
    let list = this._col;
    if (others) {
      for (const o of others) {
        if (o === this || Math.abs(o.pos.x - this.pos.x) + Math.abs(o.pos.z - this.pos.z) > 12) continue;
        if (list === this._col) list = this._col.slice();
        list.push(...o.colliders());
      }
    }
    if (!list.length) return;
    fwd.set(0, 0, 1).applyQuaternion(this.quat);
    const R = d.halfW, base = this.pos.y - d.comH;
    const y0 = base + 0.3, y1 = base + d.height;
    const zs = [d.zFront - R, (d.zFront + d.zRear) / 2, d.zRear + R];
    for (let ci = 0; ci < 3; ci++) {
      const cz = zs[ci];
      pt.x = this.pos.x + fwd.x * cz; pt.z = this.pos.z + fwd.z * cz;
      const px = pt.x, pz = pt.z;
      const c = resolveCircle(pt, R, list, y0, y1, hit);
      if (!c) continue;
      this.pos.x += pt.x - px; this.pos.z += pt.z - pz;
      const nx = c.nx, nz = c.nz;
      const rx = fwd.x * cz - nx * R, rz = fwd.z * cz - nz * R;
      const vpx = this.vel.x + this.angVel.y * rz, vpz = this.vel.z - this.angVel.y * rx;
      const ov = c.collider.vehicle;
      let vn = vpx * nx + vpz * nz;
      if (ov) vn -= ov.vel.x * nx + ov.vel.z * nz;
      if (vn >= 0) continue;
      const rxn = rz * nx - rx * nz;
      const invM = 1 / d.mass + (rxn * rxn) / d.inertia[1] + (ov ? 1 / ov.def.mass : 0);
      const J = (-1.12 * vn) / invM;
      this.vel.x += (nx * J) / d.mass; this.vel.z += (nz * J) / d.mass;
      this.angVel.y += (rxn * J) / d.inertia[1];
      if (ov) { ov.vel.x -= (nx * J) / ov.def.mass; ov.vel.z -= (nz * J) / ov.def.mass; ov.wake(); }
      if (-vn > 2.5) {
        const sev = (-vn - 2.5) * 2.2;
        this.impact += sev; applyImpact(this, sev, ci === 0);
        if (ov) applyImpact(ov, sev * 0.6, false);
      }
    }
  }

  // ── Per frame ───────────────────────────────────────────────────────────────────────────
  update(dt, env = DEFAULT_ENV, focus = null) {
    let moving = false;
    for (const k in this.doors) {
      const t = this.doorTarget[k], c = this.doors[k];
      if (c !== t) { const sp = (k === "hood" ? 1.6 : 2.6) * dt; this.doors[k] = c < t ? Math.min(t, c + sp) : Math.max(t, c - sp); moving = true; }
    }
    if (this._pourT > 0) { this._pourT -= dt; if (this._pourT <= 0) sfx("pour_stop", { pos: this.pos }); }
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.copy(this.quat);
    if (this.rig) this.rig.update(dt, env, moving, focus);
  }

  // ── Persistence ─────────────────────────────────────────────────────────────────────────
  serialize() {
    const a = (v) => [v.x, v.y, v.z];
    const slots = {};
    for (const s of SLOTS) slots[s] = this.slots[s] ? { ...this.slots[s] } : null;
    return {
      id: this.id, type: this.type, seed: this.seed, paint: this.paint, wearLook: this.wearLook,
      pos: a(this.pos), quat: [this.quat.x, this.quat.y, this.quat.z, this.quat.w], vel: a(this.vel), angVel: a(this.angVel),
      slots, fuel: this.fuel, oil: this.oil, coolant: this.coolant, waterFrac: this.waterFrac, temp: this.temp,
      bodyCond: this.bodyCond, odometer: this.odometer,
      doors: { ...this.doorTarget }, cargo: this.cargo.items.map((c) => ({ item: c.item, lpos: c.lpos, lyaw: c.lyaw })),
      ign: this.ign === "running" ? "running" : "off", gear: this.gear, sel: this.sel, gearMode: this.gearMode,
      parkingBrake: this.parkingBrake, lights: this.lights, rpm: this.rpm, steer: this.steer, time: this.time,
    };
  }
  restore(rec) {
    if (!rec) return this;
    const d = this.def, num = (v, def, lo = -Infinity, hi = Infinity) => (typeof v === "number" && isFinite(v) ? clamp(v, lo, hi) : def);
    if (Array.isArray(rec.pos)) this.pos.fromArray(rec.pos);
    if (Array.isArray(rec.quat)) this.quat.fromArray(rec.quat).normalize();
    this.vel.fromArray(rec.vel || [0, 0, 0]); this.angVel.fromArray(rec.angVel || [0, 0, 0]);
    if (rec.paint !== undefined) this.paint = rec.paint;
    if (rec.wearLook !== undefined) this.wearLook = rec.wearLook;
    if (rec.slots) for (const s of SLOTS) this.slots[s] = rec.slots[s] ? { ...rec.slots[s] } : null;
    this.fuel = num(rec.fuel, this.fuel, 0, d.tank); this.oil = num(rec.oil, this.oil, 0, d.oilCap);
    this.coolant = num(rec.coolant, this.coolant, 0, d.coolantCap); this.waterFrac = num(rec.waterFrac, 0, 0, 1);
    this.temp = num(rec.temp, 30, -40, 400); this.bodyCond = num(rec.bodyCond, 100, 0, 100); this.odometer = num(rec.odometer, 0, 0);
    if (rec.doors) for (const k in this.doors) { const t = rec.doors[k] ? 1 : 0; this.doorTarget[k] = t; this.doors[k] = t; }
    this.cargo.items = Array.isArray(rec.cargo) ? rec.cargo.map((c) => ({ item: c.item, lpos: c.lpos, lyaw: c.lyaw })) : [];
    this.ign = rec.ign === "running" && this.slots.engine ? "running" : "off";
    this.gear = num(rec.gear, 1, -1, d.gears.length) | 0; this.sel = rec.sel === "R" ? "R" : "D";
    this.gearMode = rec.gearMode === "manual" ? "manual" : "auto";
    this.parkingBrake = !!rec.parkingBrake; this.lights = !!rec.lights;
    this.rpm = num(rec.rpm, 0, 0, 9000); this.steer = num(rec.steer, 0, -1, 1); this.time = num(rec.time, 0, 0);
    this._velPrev.copy(this.vel); this._acc.set(0, 0, 0);
    this.speed = this.vel.dot(v1.set(0, 0, 1).applyQuaternion(this.quat));
    this.throttle = 0; this.brake = 0; this.shiftT = 0; this.crankT = 0; this.impact = 0;
    this.wake(); this.rig?.slotsChanged();
    return this;
  }
}

export { missingWheels, startProblem, driveProblem };
