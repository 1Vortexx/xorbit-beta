// Long Haul – vehicles entry point: prepare() and the Vehicles manager (spawning, streaming, persistence, lights).
import * as THREE from "three";
import { on, emit } from "../core/bus.js";
import { ws } from "../core/worldstate.js";
import { Vehicle } from "./vehicle.js";
import { VEHICLES, PAINTS, WHEEL_SLOTS } from "./defs.js";
import { setGround, mulberry } from "./ground.js";
import { makeComponent } from "./components.js";
import { prepareMaterials, paintMaterial, materialsReady, disposeMaterials } from "./materials.js";
import { buildVisual } from "./models.js";
import { registerTargets, unregisterTargets } from "./interact.js";

export { Vehicle } from "./vehicle.js";
export { VEHICLES, VEHICLE_TYPES, PAINTS } from "./defs.js";
export { COMPONENT_ITEMS, ENGINES, FLUID_ITEMS, fits, fitProblem, makeComponent } from "./components.js";
export { setGround, resetGround } from "./ground.js";
export { TUNING } from "./powertrain.js";
export { pourInto } from "./interact.js";

const LOAD_R = 260, UNLOAD_R = 340;
const tick = () => new Promise((r) => setTimeout(r, 0));

// Build textures/materials in slices and point the physics at the real terrain. report(pct 0..1, label)
export async function prepare(report = () => {}) {
  report(0, "Vehicles: terrain");
  let terrain = null;
  try { terrain = await import("../world/terrain.js"); } catch (e) { try { terrain = await import("../world.js"); } catch (e2) { terrain = null; } }
  if (terrain && terrain.heightAt) {
    setGround({
      heightAt: terrain.heightAt, normalAt: terrain.normalAt, surfaceAt: terrain.surfaceAt, onRoad: terrain.onRoad,
      roadX: terrain.roadX, roadY: terrain.roadY, roadDir: terrain.roadDir,
    });
  }
  await tick();
  report(0.3, "Vehicles: materials");
  prepareMaterials();
  await tick();
  report(0.7, "Vehicles: paint");
  paintMaterial(STARTER_PAINT, 0.6);
  await tick();
  report(1, "Vehicles ready");
}

const STARTER_PAINT = 0x4f8f8c;

// Deterministic state of a recoverable vehicle from its spawn seed: worn parts and 1–3 defects that the player can
// fix with parts and fluids the game provides.
export function seedVehicle(v, seed) {
  const R = mulberry(seed >>> 0), d = v.def;
  v.paint = PAINTS[(R() * PAINTS.length) | 0][1];
  v.wearLook = 0.35 + 0.65 * R();
  const s = v.slots;
  s.engine.cond = 25 + R() * 50; s.battery.cond = 35 + R() * 45; s.battery.charge = R() * 70; s.radiator.cond = 30 + R() * 55;
  for (const k of WHEEL_SLOTS) s[k].cond = 20 + R() * 55;
  v.bodyCond = 40 + R() * 45;
  v.fuel = d.tank * (0.03 + 0.2 * R()); v.oil = d.oilCap * (0.3 + 0.55 * R()); v.coolant = d.coolantCap * (0.25 + 0.65 * R());
  v.odometer = (80000 + R() * 220000) * 1000;
  const defects = [];
  const roll = (p, name, fn) => { if (R() < p) { defects.push(name); fn(); } };
  roll(0.3, "no battery", () => { s.battery = null; });
  roll(0.25, "dead battery", () => { if (s.battery) s.battery.charge = R() * 4; });
  roll(0.45, "flat tyre", () => { s[WHEEL_SLOTS[(R() * 4) | 0]].flat = true; });
  roll(0.25, "missing wheel", () => { s[WHEEL_SLOTS[(R() * 4) | 0]] = null; });
  roll(0.12, "no engine", () => { s.engine = null; });
  roll(0.35, "empty tank", () => { v.fuel = 0; });
  roll(0.3, "low oil", () => { v.oil = d.oilCap * 0.08; });
  roll(0.12, "no radiator", () => { s.radiator = null; v.coolant = 0; });
  roll(0.2, "no coolant", () => { v.coolant = 0; });
  if (!defects.length) { defects.push("dead battery"); if (s.battery) s.battery.charge = 2; }
  v.defects = defects;
  return v;
}

export class Vehicles {
  constructor({ root, getColliders } = {}) {
    this.root = root;
    this.getColliders = getColliders || null;
    this.list = [];
    this.byId = new Map();
    this.chunks = new Map();
    this._tick = 0; this._scan = true; this._focus = [];
    this._off = [
      on("chunk:load", (c) => { if (c) { this.chunks.set(c.k, c); this._scan = true; } }),
      on("chunk:unload", (c) => { if (c) this.chunks.delete(c.k); }),
    ];
    // Two headlight spots shared by whichever lit vehicle matters most (constant light count = no shader rebuilds)
    this.spots = [];
    if (root) {
      this.lightHome = new THREE.Group(); this.lightHome.name = "vehicleLights"; root.add(this.lightHome);
      for (let i = 0; i < 2; i++) {
        const s = new THREE.SpotLight(0xfff0d2, 0, 85, 0.52, 0.6, 1.5);
        s.castShadow = false;
        this.lightHome.add(s, s.target);
        this.spots.push(s);
      }
      this._litOn = null;
    }
  }

  get(id) { return this.byId.get(id) || null; }

  _add(v, visual = true) {
    v.getColliders = this.getColliders;
    if (visual && this.root && typeof document !== "undefined") {
      v.rig = buildVisual(v);
      registerTargets(v, v.rig);
    }
    if (this.root) this.root.add(v.mesh);
    v.update(0);
    this.list.push(v); this.byId.set(v.id, v);
    emit("vehicle:load", v);
    return v;
  }
  _fromRecord(rec) {
    const v = new Vehicle({ id: rec.id, type: rec.type, seed: rec.seed, paint: rec.paint, wearLook: rec.wearLook });
    v.restore(rec);
    v._spawn = null; v.dirty = true;
    return this._add(v);
  }
  _fromSeed(spawn) {
    const type = VEHICLES[spawn.type] ? spawn.type : "sedan";
    const v = new Vehicle({ id: spawn.id, type, seed: spawn.seed });
    seedVehicle(v, spawn.seed);
    v.place(spawn.pos[0], spawn.pos[2], spawn.yaw || 0);
    v._spawn = { pos: [v.pos.x, v.pos.y, v.pos.z] };
    v.dirty = false;
    return this._add(v);
  }

  // Worn but usable pickup, id "starter". Uses the saved record when there is one.
  spawnStarter(spawn = { x: 0, z: 0, yaw: 0 }) {
    const old = this.get("starter");
    if (old) return old;
    const rec = ws.vehicles.get("starter");
    if (rec) return this._fromRecord(rec);
    const v = new Vehicle({ id: "starter", type: "pickup", seed: 1978, paint: STARTER_PAINT, wearLook: 0.6 });
    const s = v.slots, d = v.def;
    s.engine.cond = 62; s.battery.cond = 68; s.battery.charge = 82; s.radiator.cond = 64;
    s.wheelFL.cond = 58; s.wheelFR.cond = 63; s.wheelRL.cond = 55; s.wheelRR.cond = 60;
    v.bodyCond = 70; v.fuel = d.tank * 0.5; v.oil = d.oilCap * 0.72; v.coolant = d.coolantCap * 0.85;
    v.odometer = 187345 * 1000;
    v.place(spawn.x, spawn.z, spawn.yaw || 0);
    v._spawn = null; v.dirty = true;
    return this._add(v);
  }
  // Extra (dev / debug / shops): add any vehicle. opts: { id, type, seed, x, z, yaw, pristine }
  spawn(opts) {
    const v = new Vehicle({ id: opts.id || ws.newId("V"), type: opts.type || "pickup", seed: opts.seed || 1, paint: opts.paint, wearLook: opts.wearLook });
    if (opts.seed && !opts.pristine) seedVehicle(v, opts.seed);
    if (opts.paint !== undefined) v.paint = opts.paint;
    if (opts.wearLook !== undefined) v.wearLook = opts.wearLook;
    v.place(opts.x || 0, opts.z || 0, opts.yaw || 0);
    v._spawn = null; v.dirty = true;
    return this._add(v);
  }

  differs(v) {
    if (v.dirty || !v._spawn || v.cargo.items.length) return true;
    const s = v._spawn.pos;
    return Math.abs(v.pos.x - s[0]) + Math.abs(v.pos.z - s[2]) > 0.75;
  }
  _remove(v, save = true) {
    if (save && this.differs(v)) ws.vehicles.set(v.id, v.serialize());
    if (this._litOn === v) this._park();
    emit("vehicle:unload", v);
    unregisterTargets(v);
    if (v.rig) { v.rig.dispose(); v.rig = null; }
    if (v.mesh.parent) v.mesh.parent.remove(v.mesh);
    this.list.splice(this.list.indexOf(v), 1); this.byId.delete(v.id);
  }
  remove(v, save = true) { if (this.byId.get(v.id) === v) this._remove(v, save); }

  // Load / unload around the focus points (player, driven vehicle). Cheap: the full scan runs a few times a second.
  sync(focusPoints = []) {
    this._focus = focusPoints;
    if (!this._scan && ++this._tick % 20) return;
    this._scan = false;
    const near = (x, z, R) => { for (const f of focusPoints) { const dx = f.x - x, dz = f.z - z; if (dx * dx + dz * dz < R * R) return true; } return false; };
    for (const v of [...this.list]) if (!v.occupied && !near(v.pos.x, v.pos.z, UNLOAD_R)) this._remove(v, true);
    for (const c of this.chunks.values()) {
      for (const s of c.vehicleSpawns || []) {
        if (this.byId.has(s.id) || ws.vehicles.has(s.id) || !near(s.pos[0], s.pos[2], LOAD_R)) continue;
        this._fromSeed(s);
      }
    }
    for (const [id, rec] of ws.vehicles) {
      if (this.byId.has(id) || !rec || !Array.isArray(rec.pos) || !VEHICLES[rec.type] || !near(rec.pos[0], rec.pos[2], LOAD_R)) continue;
      this._fromRecord(rec);
    }
  }

  // Fixed step: full physics for the driven and moving vehicles; parked ones sleep.
  step(dt, driven, input, env) {
    const many = this.list.length > 1 ? this.list : null;
    for (const v of this.list) v.step(dt, v === driven ? (input || { throttle: 0, steer: 0 }) : null, env, many);
  }

  // Per frame: mesh sync, door / gauge / wheel animation, headlight rig.
  update(dt, env) {
    let best = null, bd = Infinity;
    const f = this._focus[0];
    for (const v of this.list) {
      v.update(dt, env);
      if (!v.rig || !v.rig.lit) continue;
      const d = v.occupied ? -1 : f ? (v.pos.x - f.x) ** 2 + (v.pos.z - f.z) ** 2 : 0;
      if (d < bd && d < 150 * 150) { bd = d; best = v; }
    }
    if (best !== this._litOn) {
      if (best) {
        this.spots.forEach((s, i) => {
          const p = best.rig.lampPos[i];
          best.rig.root.add(s, s.target);
          s.position.set(p[0], p[1], p[2]);
          s.target.position.set(p[0] * 1.5, p[1] - 1.0, p[2] + 24);
          s.intensity = 420;
        });
        this._litOn = best;
      } else this._park();
    }
  }
  _park() {
    for (const s of this.spots) { this.lightHome.add(s, s.target); s.intensity = 0; s.position.set(0, -50, 0); s.target.position.set(0, -51, 1); }
    this._litOn = null;
  }

  // Nearest loaded vehicle to (x, z) within maxDist, optionally only parked ones (fuel pumps)
  nearest(x, z, maxDist = Infinity, parkedOnly = false) {
    let best = null, bd = maxDist * maxDist;
    for (const v of this.list) {
      if (parkedOnly && Math.abs(v.speed) > 0.5) continue;
      const d = (v.pos.x - x) ** 2 + (v.pos.z - z) ** 2;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  // Write every loaded, modified vehicle to ws.vehicles (call before saving)
  flush() { for (const v of this.list) if (this.differs(v)) ws.vehicles.set(v.id, v.serialize()); }

  // Drop every loaded vehicle without saving (new game / load game: call, then ws.restore(), then sync again)
  clear() { for (const v of [...this.list]) this._remove(v, false); this._scan = true; }

  dispose() {
    this.clear();
    for (const off of this._off) off();
    for (const s of this.spots) { s.parent?.remove(s.target); s.parent?.remove(s); s.dispose(); }
    if (this.lightHome?.parent) this.lightHome.parent.remove(this.lightHome);
    this.spots = [];
  }
}
