// Long Haul – physical props: every loose item in the world, the item in the hands and secured vehicle cargo.
// Loose props use a compact custom body (no physics library): position + velocity + a quaternion that tumbles in the
// air and settles onto a face on the ground. Ground = heightAt plus the tops of colliders that have a y1 (tables,
// counters, truck beds), walls = resolveCircle against the shared 2.5D colliders.
import * as THREE from "three";
import { on, sfx } from "./core/bus.js";
import { ws } from "./core/worldstate.js";
import { resolveCircle, circleFree } from "./core/collide.js";
import { addTarget, removeAllUnder } from "./core/targets.js";
import { origin } from "./core/origin.js";
import { ITEMS, itemLabel, qtyText, itemMass, useItem, useVerb, buildMesh } from "./items.js";

// Terrain comes from the world agent's module. Loaded without blocking; until it resolves (or when it is missing,
// e.g. in the dev harness) the ground is flat. Pass heightAt / surfaceAt to the constructor to override.
export const terrain = { heightAt: () => 0, surfaceAt: () => "dirt", CHUNK: 200 };
export const terrainReady = import("./world/terrain.js")
  .then((m) => { terrain.heightAt = m.heightAt; if (m.surfaceAt) terrain.surfaceAt = m.surfaceAt; if (m.CHUNK) terrain.CHUNK = m.CHUNK; return true; })
  .catch(() => false);

const G = 9.81, MAX_SPEED = 40, SLEEP_AFTER = 0.3, CHECK_EVERY = 10;
const SURF = { // restitution, friction coefficient
  asphalt: [0.32, 0.75], concrete: [0.34, 0.75], wood: [0.3, 0.6], rock: [0.3, 0.7], gravel: [0.16, 0.9], dirt: [0.14, 0.85], sand: [0.04, 1.3],
};
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _p = { x: 0, z: 0 }, _hit = {};
let pickMat = null;

// Is (x, z) inside a collider's footprint
export function insideCollider(o, x, z) {
  const dx = x - o.x, dz = z - o.z;
  if (o.kind === "box") {
    const s = Math.sin(o.yaw), c = Math.cos(o.yaw);
    return Math.abs(dx * c - dz * s) <= o.hx && Math.abs(dx * s + dz * c) <= o.hz;
  }
  return dx * dx + dz * dz <= o.r * o.r;
}
// Highest surface a thing whose underside is at `bottom` can rest on at (x, z): terrain or a collider top below it
export function supportY(x, z, bottom, colliders, heightAt, tol = 0.1) {
  let g = heightAt(x, z);
  if (colliders) for (const o of colliders) {
    if (o.solid === false || o.y1 === undefined || o.y1 <= g || o.y1 > bottom + tol) continue;
    if (insideCollider(o, x, z)) g = o.y1;
  }
  return g;
}

export class Props {
  constructor({ root, getColliders, getVehicle, heightAt, surfaceAt, chunkSize, listen = true } = {}) {
    this.root = root;
    this.getColliders = getColliders || (() => []);
    this.getVehicle = getVehicle || (() => null);
    this._heightAt = heightAt || null;
    this._surfaceAt = surfaceAt || null;
    this._chunk = chunkSize || 0;
    this.map = new Map();        // id → Prop
    this.loaded = new Set();     // chunk indices currently loaded
    this.frame = 0;
    this.offs = [];
    if (listen) {
      this.offs.push(on("chunk:load", (c) => this.loadChunk(c)));
      this.offs.push(on("chunk:unload", (c) => this.unloadChunk(c)));
      this.offs.push(on("vehicle:load", (v) => this.restoreCargo(v)));
      this.offs.push(on("vehicle:unload", (v) => this.dropCargo(v)));
    }
  }
  heightAt(x, z) { return (this._heightAt || terrain.heightAt)(x, z); }
  surfaceAt(x, z) { return (this._surfaceAt || terrain.surfaceAt)(x, z); }
  get CHUNK() { return this._chunk || terrain.CHUNK; }
  get list() { return [...this.map.values()]; }
  get(id) { return this.map.get(id) || null; }
  chunkOf(z) { return Math.floor(z / this.CHUNK); }

  // ── creation ──────────────────────────────────────────────────────────────────────────────────────────────
  // pos: absolute centre of the item ([x,y,z] or Vector3). opts: { yaw | quat, vel, angVel, base (pos is the point
  // the item stands on), fixed (placed scenery: never simulated until touched), asleep, held, seeded }
  spawn(item, pos, opts = {}) {
    if (this.map.has(item.id)) this._destroy(this.map.get(item.id));
    const def = ITEMS[item.type];
    if (!def) return null;
    const mesh = this._build(item, def);
    const p = {
      id: item.id, item, def, mesh,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), angVel: new THREE.Vector3(), quat: mesh.quaternion,
      size: def.size, hy: def.size[1] / 2,
      r: Math.max(0.05, Math.min(0.42, 0.5 * Math.max(def.size[0], def.size[2]) * 0.9)),
      asleep: !!(opts.fixed || opts.asleep), fixed: !!opts.fixed, held: !!opts.held, secured: null,
      seeded: !!opts.seeded, moved: !opts.fixed && !opts.pristine, snap: "", lastQty: item.qty,
      still: 0, grounded: false, lastThud: 0,
    };
    if (Array.isArray(pos)) p.pos.fromArray(pos); else p.pos.copy(pos);
    if (opts.quat) { if (Array.isArray(opts.quat)) p.quat.fromArray(opts.quat); else p.quat.copy(opts.quat); p.quat.normalize(); }
    else p.quat.setFromAxisAngle(UP, opts.yaw || 0);
    this._extent(p);
    if (opts.base) p.pos.y += p.hy;
    if (opts.vel) p.vel.copy(opts.vel);
    if (opts.angVel) p.angVel.copy(opts.angVel);
    p.snap = JSON.stringify(item);
    if (!p.fixed && !p.held) this._clampAboveGround(p);
    mesh.position.copy(p.pos);
    this.root.add(mesh);
    mesh.updateMatrixWorld(true);
    this.map.set(p.id, p);
    this._register(p);
    return p;
  }
  _build(item, def) {
    const mesh = buildMesh(item);
    const g = new THREE.Group();
    g.add(mesh);
    g.userData.setFill = mesh.userData.setFill;
    // generous invisible pick volume so small things are easy to aim at
    if (!pickMat) pickMat = new THREE.MeshBasicMaterial({ visible: false });
    const s = def.size, pick = new THREE.Mesh(new THREE.BoxGeometry(Math.max(s[0], 0.14), Math.max(s[1], 0.1), Math.max(s[2], 0.14)), pickMat);
    pick.name = "pick";
    g.add(pick);
    g.name = "prop:" + item.type;
    return g;
  }
  _register(p) {
    const self = this, item = p.item, def = p.def;
    p.target = addTarget(p.mesh, {
      id: p.id, kind: "prop", prop: p, item,
      name: () => itemLabel(item),
      info: () => ({
        cond: item.cond, qty: qtyText(item) || undefined,
        note: p.secured ? "Secured cargo" : def.cap && !(item.qty > 0.01) ? "Empty" : undefined,
      }),
      reach: 2.6,
      actions(ctx) {
        const out = [];
        if (p.held) return out;
        if (!ctx.held) out.push({
          key: "grab", label: p.secured ? "Take out" : "Pick up",
          run(c) {
            if (c.held) return;
            const from = self.pose(p);
            self.take(p);
            c.giveHeld(item, from);
            c.sfx("pickup");
          },
        });
        if (def.use) out.push({
          key: "use", label: useVerb(def),
          run(c) { const r = useItem(c, item); if (r.ok && r.consumed) self.remove(p.id); else if (r.ok) self.touch(p); },
        });
        if (def.pocket) out.push({
          key: "alt", label: "Stow in pocket",
          run(c) {
            if (c.pocketAdd(item)) { self.remove(p.id); c.sfx("pickup"); }
            else { c.notify("Your pockets are full", { level: "warn", key: "pockets" }); c.sfx("error"); }
          },
        });
        return out;
      },
    });
  }
  _destroy(p) {
    removeAllUnder(p.mesh);
    if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
    p.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    if (this.map.get(p.id) === p) this.map.delete(p.id);
    p.dead = true;
  }

  // ── removal / persistence ─────────────────────────────────────────────────────────────────────────────────
  _gone(p) { if (p.seeded) ws.removed.add(p.id); ws.props.delete(p.id); }
  // The item left the world for good (eaten, pocketed, installed, picked up). Returns the instance.
  remove(id) {
    const p = typeof id === "object" ? id : this.map.get(id);
    if (!p || p.dead) return null;
    if (p.secured) this._unlist(p);
    this._gone(p);
    this._destroy(p);
    return p.item;
  }
  take(p) { return this.remove(p); }
  // Mark a prop as changed without moving it (its quantity was altered in place)
  touch(p) { if (p.mesh.userData.setFill && p.def.cap) p.mesh.userData.setFill((p.item.qty || 0) / p.def.cap); p.lastQty = p.item.qty; }
  _dirty(p) { return p.moved || !p.seeded || JSON.stringify(p.item) !== p.snap; }
  _store(p) {
    if (p.held || p.secured || p.dead) return;
    if (!this._dirty(p)) return;
    const rec = { item: p.item, at: "world", pos: p.pos.toArray(), quat: p.quat.toArray() };
    if (p.fixed) rec.fixed = 1;
    ws.props.set(p.id, rec);
    if (p.seeded) ws.removed.add(p.id);
  }
  // Write every live, modified loose prop to ws (call before saving). Cargo lives in vehicle.cargo.items.
  flush() { for (const p of this.map.values()) this._store(p); }

  loadChunk(chunk) {
    const k = chunk.k !== undefined && Number.isInteger(chunk.k) ? chunk.k : Math.round(chunk.z0 / this.CHUNK);
    chunk._propK = k;
    this.loaded.add(k);
    for (const s of chunk.spawns || []) {
      if (ws.removed.has(s.id) || ws.props.has(s.id) || this.map.has(s.id) || !ITEMS[s.type]) continue;
      const item = { id: s.id, type: s.type };
      const def = ITEMS[s.type];
      if (s.qty !== undefined) item.qty = s.qty; else if (def.cap) item.qty = def.cap;
      if (s.cond !== undefined) item.cond = s.cond; else if (def.kind === "part") item.cond = 100;
      if (s.flat) item.flat = true;
      this.spawn(item, s.pos, { yaw: s.yaw || 0, base: true, fixed: true, seeded: true });
    }
    for (const [id, rec] of ws.props) {
      if (rec.at !== "world" || !rec.pos || this.chunkOf(rec.pos[2]) !== k || this.map.has(id) || !ITEMS[rec.item.type]) continue;
      const p = this.spawn(rec.item, rec.pos, { quat: rec.quat, fixed: !!rec.fixed, asleep: true, seeded: ws.removed.has(id) || !!rec.fixed });
      if (p) { p.moved = !rec.fixed; if (rec.fixed) p.snap = ""; }
    }
  }
  unloadChunk(chunk) {
    const k = chunk._propK !== undefined ? chunk._propK : Number.isInteger(chunk.k) ? chunk.k : Math.round(chunk.z0 / this.CHUNK);
    this.loaded.delete(k);
    for (const p of [...this.map.values()]) {
      if (p.held || p.secured || this.chunkOf(p.pos.z) !== k) continue;
      this._store(p);
      this._destroy(p);
    }
  }

  // ── hands ─────────────────────────────────────────────────────────────────────────────────────────────────
  // Absolute pose of a prop wherever it is (loose, held or riding in a vehicle)
  pose(p) {
    if (!p.secured) return { pos: p.pos.clone(), quat: p.quat.clone() };
    p.mesh.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion();
    p.mesh.matrixWorld.decompose(pos, quat, _v);
    return { pos: pos.add(origin), quat };
  }
  hold(p) {
    if (p.secured) this.release(p);
    this._gone(p);
    p.held = true; p.fixed = false; p.moved = true; p.asleep = true;
    p.vel.set(0, 0, 0); p.angVel.set(0, 0, 0);
  }
  // Let go of a held prop: it becomes a loose body again
  unhold(p, vel, angVel) {
    p.held = false;
    if (vel) p.vel.copy(vel); else p.vel.set(0, 0, 0);
    if (angVel) p.angVel.copy(angVel); else p.angVel.set(0, 0, 0);
    this.wake(p);
    this._clampAboveGround(p);
  }
  wake(p) { p.asleep = false; p.fixed = false; p.moved = true; p.still = 0; }
  // Put a prop down at rest (no fall): pos = absolute centre
  rest(p, pos, yaw) {
    p.held = false; p.fixed = false; p.moved = true;
    p.pos.copy(pos);
    if (yaw !== undefined) p.quat.setFromAxisAngle(UP, yaw);
    p.vel.set(0, 0, 0); p.angVel.set(0, 0, 0);
    this._extent(p);
    p.asleep = true;
    this._clampAboveGround(p);
    p.mesh.position.copy(p.pos);
    p.mesh.updateMatrixWorld(true);
  }

  // ── cargo ─────────────────────────────────────────────────────────────────────────────────────────────────
  secure(p, vehicle, lpos, lyaw = 0) {
    if (p.secured) this._unlist(p);
    this._gone(p);
    const entry = { item: p.item, lpos: [lpos[0], lpos[1], lpos[2]], lyaw };
    vehicle.cargo.items.push(entry);
    this._attach(p, vehicle, entry);
    return entry;
  }
  _attach(p, vehicle, entry) {
    p.secured = { vehicle, entry };
    p.held = false; p.fixed = false; p.asleep = true; p.moved = true;
    p.vel.set(0, 0, 0); p.angVel.set(0, 0, 0);
    vehicle.mesh.add(p.mesh);
    p.mesh.position.fromArray(entry.lpos);
    p.mesh.quaternion.setFromAxisAngle(UP, entry.lyaw || 0);
  }
  _unlist(p) {
    const { vehicle, entry } = p.secured, arr = vehicle.cargo.items, i = arr.indexOf(entry);
    if (i >= 0) arr.splice(i, 1);
    else { const j = arr.findIndex((e) => e.item && e.item.id === p.id); if (j >= 0) arr.splice(j, 1); }
  }
  // Free a secured prop: it becomes a loose body where it sits
  release(p, vel) {
    if (!p.secured) return;
    const pose = this.pose(p), v = p.secured.vehicle;
    this._unlist(p);
    p.secured = null;
    this.root.add(p.mesh);
    p.pos.copy(pose.pos); p.quat.copy(pose.quat);
    p.mesh.position.copy(p.pos);
    if (vel) p.vel.copy(vel); else if (v.vel) p.vel.copy(v.vel);
    this._extent(p);
    this.wake(p);
  }
  // (Re)build the meshes for vehicle.cargo.items. Idempotent.
  restoreCargo(vehicle) {
    if (!vehicle || !vehicle.cargo || !vehicle.mesh) return;
    const items = vehicle.cargo.items || (vehicle.cargo.items = []);
    for (const p of [...this.map.values()]) {
      if (p.secured && p.secured.vehicle === vehicle && !items.includes(p.secured.entry)) {
        const e = items.find((e) => e.item && e.item.id === p.id);
        if (e) { p.secured.entry = e; p.item = e.item; p.mesh.position.fromArray(e.lpos); p.mesh.quaternion.setFromAxisAngle(UP, e.lyaw || 0); }
        else this._destroy(p);
      }
    }
    for (const e of items) {
      if (!e || !e.item || !ITEMS[e.item.type]) continue;
      const cur = this.map.get(e.item.id);
      if (cur && cur.secured && cur.secured.vehicle === vehicle) continue;
      const p = this.spawn(e.item, [0, 0, 0], { held: true });
      this._attach(p, vehicle, e);
      ws.props.delete(p.id);
    }
  }
  // The vehicle is unloading: drop the meshes, keep vehicle.cargo.items (the vehicle serialises it)
  dropCargo(vehicle) {
    for (const p of [...this.map.values()]) if (p.secured && p.secured.vehicle === vehicle) this._destroy(p);
  }
  cargoOf(vehicle) { return this.list.filter((p) => p.secured && p.secured.vehicle === vehicle); }

  // ── physics ───────────────────────────────────────────────────────────────────────────────────────────────
  // Vertical half extent of the oriented box
  _extent(p) {
    _m.makeRotationFromQuaternion(p.quat);
    const e = _m.elements, s = p.size;
    p.hy = 0.5 * (Math.abs(e[1]) * s[0] + Math.abs(e[5]) * s[1] + Math.abs(e[9]) * s[2]);
  }
  _clampAboveGround(p) {
    if (!Number.isFinite(p.pos.x + p.pos.y + p.pos.z)) { p.pos.copy(p.safe || _v.set(0, 0, 0)); p.vel.set(0, 0, 0); }
    const g = this.heightAt(p.pos.x, p.pos.z);
    if (p.pos.y - p.hy < g) p.pos.y = g + p.hy;
  }
  // Orientation with the nearest face flat on the ground
  _restQuat(p, out) {
    _m.makeRotationFromQuaternion(p.quat);
    const e = _m.elements;
    let best = 0, by = 0;
    for (let i = 0; i < 3; i++) { const y = e[i * 4 + 1]; if (Math.abs(y) > Math.abs(by)) { by = y; best = i; } }
    _a.set(e[best * 4], e[best * 4 + 1], e[best * 4 + 2]).multiplyScalar(by < 0 ? -1 : 1).normalize();
    _q2.setFromUnitVectors(_a, UP);
    return out.copy(_q2).multiply(p.quat).normalize();
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    if (dt <= 0) return;
    this.frame++;
    let i = 0;
    for (const p of this.map.values()) {
      i++;
      if (p.item.qty !== p.lastQty) this.touch(p);
      if (p.held || p.secured || p.fixed) continue;
      if (p.asleep) {
        if ((i + this.frame) % CHECK_EVERY === 0) this._check(p);
        if (p.asleep) continue;
      }
      this._simulate(p, dt);
      p.mesh.position.copy(p.pos);
      p.mesh.updateMatrixWorld(true);   // keep the raycast in step without waiting for the next render
      // left the loaded world (thrown across a chunk border): park it in ws until that chunk loads
      if (this.loaded.size && !this.loaded.has(this.chunkOf(p.pos.z)) && p.asleep) { this._store(p); this._destroy(p); }
    }
  }
  // Sleeping props: wake when something moved into them or their support went away
  _check(p) {
    const cols = this.getColliders(p.pos.x, p.pos.z, p.r + 0.3);
    const bottom = p.pos.y - p.hy, g = supportY(p.pos.x, p.pos.z, bottom, cols, (x, z) => this.heightAt(x, z), 0.03);
    if (bottom < g - 1e-4) { p.pos.y = g + p.hy; p.mesh.position.copy(p.pos); }
    else if (bottom > g + 0.04) { this.wake(p); return; }
    if (!circleFree(p.pos.x, p.pos.z, p.r - 0.012, cols, bottom + 0.04, p.pos.y + p.hy)) this.wake(p);   // margin: resting contact is not a push
  }
  _simulate(p, dt) {
    const sp = p.vel.length();
    if (sp > MAX_SPEED) p.vel.multiplyScalar(MAX_SPEED / sp);
    const speed = Math.min(sp, MAX_SPEED);
    const cols = this.getColliders(p.pos.x, p.pos.z, p.r + speed * dt + 0.6);
    // substeps: never move more than half a radius at a time, so nothing can tunnel through a wall
    const n = Math.max(1, Math.ceil(Math.max(speed * dt / (p.r * 0.5), dt * 120)));
    const h = dt / n;
    const H = (x, z) => this.heightAt(x, z);
    if (!p.safe) p.safe = new THREE.Vector3();
    for (let s = 0; s < n; s++) {
      p.safe.copy(p.pos);
      p.vel.y -= G * h;
      p.pos.addScaledVector(p.vel, h);
      // tumble
      const w = p.angVel.length();
      if (w > 1e-3) { _q.setFromAxisAngle(_a.copy(p.angVel).divideScalar(w), w * h); p.quat.premultiply(_q).normalize(); }
      this._extent(p);
      // walls
      let bottom = p.pos.y - p.hy;
      _p.x = p.pos.x; _p.z = p.pos.z;
      const hit = resolveCircle(_p, p.r, cols, bottom + 0.04, p.pos.y + p.hy, _hit);
      if (hit) {
        p.pos.x = _p.x; p.pos.z = _p.z;
        const vn = p.vel.x * hit.nx + p.vel.z * hit.nz;
        if (vn < 0) {
          const e = 0.3;
          p.vel.x -= (1 + e) * vn * hit.nx; p.vel.z -= (1 + e) * vn * hit.nz;
          p.vel.x *= 0.9; p.vel.z *= 0.9;
          p.angVel.multiplyScalar(0.7);
          if (vn < -2) this._thud(p, -vn);
        }
      }
      // ground / supporting tops
      const g = supportY(p.pos.x, p.pos.z, bottom, cols, H);
      p.grounded = false;
      if (bottom <= g) {
        p.pos.y = g + p.hy;
        p.grounded = true;
        const [rest, mu] = SURF[this.surfaceAt(p.pos.x, p.pos.z)] || SURF.dirt;
        if (p.vel.y < -1.1) {
          this._thud(p, -p.vel.y);
          p.vel.y = -p.vel.y * rest * (p.def.bounce ?? 1) / (1 + itemMass(p.item) / 25);
          p.vel.x *= 0.8; p.vel.z *= 0.8;
          p.angVel.multiplyScalar(0.6);
        } else if (p.vel.y < 0) p.vel.y = 0;
        // Coulomb friction
        const vh = Math.hypot(p.vel.x, p.vel.z), drop = mu * G * h;
        if (vh <= drop) { p.vel.x = 0; p.vel.z = 0; }
        else { const k = (vh - drop) / vh; p.vel.x *= k; p.vel.z *= k; }
        // settle onto the nearest face
        const k = 1 - Math.exp(-14 * h);
        p.angVel.multiplyScalar(Math.exp(-10 * h));
        this._restQuat(p, _q);
        p.quat.slerp(_q, k);
        this._extent(p);
        if (p.pos.y - p.hy < g) p.pos.y = g + p.hy;
        const flat = 1 - Math.abs(p.quat.dot(_q));
        if (vh < 0.08 && Math.abs(p.vel.y) < 0.2 && flat < 2e-4) {
          p.still += h;
          if (p.still > SLEEP_AFTER) {
            p.quat.copy(_q); this._extent(p);
            p.pos.y = g + p.hy;
            p.vel.set(0, 0, 0); p.angVel.set(0, 0, 0);
            p.asleep = true;
            break;
          }
        } else p.still = 0;
      } else p.still = 0;
    }
    // hard guarantee: finite, and never under the terrain
    this._clampAboveGround(p);
  }
  _thud(p, v) {
    const now = this.frame;
    if (now - p.lastThud < 8) return;
    p.lastThud = now;
    sfx(v > 5 || itemMass(p.item) > 8 ? "thud" : "drop", { vol: Math.min(1, v / 8), pos: p.pos });
  }

  clear() { for (const p of [...this.map.values()]) this._destroy(p); this.loaded.clear(); }
  dispose() { this.clear(); this.offs.forEach((f) => f()); this.offs.length = 0; }
}
