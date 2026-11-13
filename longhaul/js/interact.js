// Long Haul – the one interaction system: look-at target + actions, carrying, pockets, cargo placement.
// See ARCHITECTURE.md §6/§7. main.js feeds an input object every frame and passes the result to the HUD.
import * as THREE from "three";
import { notify, sfx } from "./core/bus.js";
import { raycastTargets } from "./core/targets.js";
import { resolveCircle, circleFree } from "./core/collide.js";
import { origin } from "./core/origin.js";
import { ITEMS, itemLabel, qtyText, itemMass, useItem, useVerb, buildMesh } from "./items.js";
import { supportY, insideCollider } from "./props.js";

export const REACH = 2.6, HEAVY_KG = 25;
const KEY_LABEL = { use: "E", alt: "F", grab: "LMB", throw: "RMB" };
const KEYS = ["use", "alt", "grab"];
const EMPTY = new Set();
const UP = new THREE.Vector3(0, 1, 0);
const _eye = new THREE.Vector3(), _dir = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = { x: 0, z: 0 };
const yawOf = (q) => Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
const val = (v) => (typeof v === "function" ? v() : v);

export class Interaction {
  constructor({ camera, player, props, pockets, hooks = {} }) {
    this.camera = camera; this.player = player; this.props = props; this.pockets = pockets; this.hooks = hooks;
    this.heldProp = null;
    this.rel = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);   // held orientation relative to the player's yaw
    this.rot = null;            // look angles frozen while rotating
    this.rotating = false;
    this.active = null;         // { key, target, kind: "hold"|"tick", t, label, progress }
    this.lock = {};             // key → wait for release
    this.target = null;         // raw Target under the crosshair
    this.hit = null;
    this.cargo = null;          // current cargo placement { vehicle, lpos, lyaw, ok, reason }
    this.placeSpot = null;      // { x, y, z } surface point the held item can be put on
    this.ghost = null;
    this.flashlight = false;
    this.light = null;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.camera = camera;
    this.state = { target: null, actions: [], held: null, cargoHint: null, progress: null };
    const self = this;
    // ctx handed to every Action (ARCHITECTURE.md §6) – plus hasTool, needs, pockets
    this.ctx = {
      get held() { return self.heldProp ? self.heldProp.item : null; },
      consumeHeld: () => self.consumeHeld(),
      giveHeld: (item, from) => self.giveHeld(item, from),
      dropItem: (item, pos, vel) => self.props.spawn(item, pos, { vel }),
      pocketAdd: (item) => self.pockets.add(item),
      // A tool counts when it is in the hands, in a pocket, or lying within arm's reach (a jack sits by the wheel)
      hasTool: (type) => !!(self.heldProp && self.heldProp.item.type === type) || self.pockets.has(type) || self._toolNearby(type),
      player, pockets,
      enterVehicle: (v) => { self.dropHeld(); if (hooks.enterVehicle) return hooks.enterVehicle(v); },
      openShop: (site) => hooks.openShop && hooks.openShop(site),
      sleep: (where) => hooks.sleep && hooks.sleep(where),
      get wallet() { return val(hooks.wallet) || { money: 0 }; },
      get needs() { return val(hooks.needs) || (self._needs || (self._needs = { health: 100, hunger: 100, thirst: 100, energy: 100 })); },
      notify, sfx,
    };
  }
  get held() { return this.heldProp ? this.heldProp.item : null; }
  colliders(x, z, r) { const c = this.hooks.getColliders ? this.hooks.getColliders(x, z, r) : this.props.getColliders(x, z, r); return c ? c.slice() : []; }

  // ── hands ─────────────────────────────────────────────────────────────────────────────────────────────────
  // Put an instance in the hands. from: optional { pos, quat } (absolute) the item starts at, for a smooth pick-up.
  giveHeld(item, from) {
    if (this.heldProp || !ITEMS[item.type]) return false;
    const pos = from && from.pos ? from.pos : this._holdPoint(null, _v).clone();
    const p = this.props.spawn(item, pos, { held: true, quat: from && from.quat });
    if (!p) return false;
    this.props.hold(p);
    this.heldProp = p;
    this.rel.setFromAxisAngle(UP, Math.PI);
    this.player.encumbered = itemMass(item) > HEAVY_KG;
    return true;
  }
  consumeHeld() {
    const p = this.heldProp;
    if (!p) return null;
    this._letGo();
    return this.props.remove(p);
  }
  _letGo() { this.heldProp = null; this.player.encumbered = false; this.cargo = null; this.placeSpot = null; this._hideGhost(); }
  // Let the held item fall where it is
  dropHeld(vel) {
    const p = this.heldProp;
    if (!p) return null;
    this._letGo();
    const v = vel || _v.set(this.player.vel.x * 0.6, 0, this.player.vel.z * 0.6);
    this.props.unhold(p, v);
    return p;
  }
  throwHeld() {
    const p = this.heldProp;
    if (!p) return null;
    const mass = itemMass(p.item);
    if (mass > HEAVY_KG) { sfx("drop"); return this.dropHeld(); }
    const speed = Math.max(3, Math.min(10, 13 / (1 + mass / 4)));
    this.player.dir(_dir);
    const vel = new THREE.Vector3().copy(_dir).multiplyScalar(speed);
    vel.y += 1.2; vel.x += this.player.vel.x; vel.z += this.player.vel.z;
    const spin = new THREE.Vector3(Math.cos(this.player.yaw), 0, -Math.sin(this.player.yaw)).multiplyScalar(7 / (1 + mass / 3));
    spin.y = 1.5;
    this._letGo();
    this.props.unhold(p, vel, spin);
    sfx("throw");
    return p;
  }
  // Remove the held prop without dropping it and forget any running action (new game / leaving the world)
  clear() {
    if (this.heldProp) { const p = this.heldProp; this._letGo(); this.props._destroy(p); }
    this.active = null; this.lock = {}; this.target = null; this.hit = null; this.rot = null; this.rotating = false;
    this.player.lookLocked = false;
    this._hideGhost();
    if (this.light) this.light.visible = false;
    this.state = { target: null, actions: [], held: null, cargoHint: null, progress: null };
  }
  serialize() { return { held: this.heldProp ? { ...this.heldProp.item } : null, pockets: this.pockets.serialize(), flashlight: this.flashlight }; }
  restore(d) {
    this.clear();
    this.pockets.restore(d && d.pockets);
    this.flashlight = !!(d && d.flashlight);
    if (d && d.held && ITEMS[d.held.type]) this.giveHeld({ ...d.held });
  }

  // Where the hands want the item (absolute), kept out of walls and the ground
  _holdPoint(p, out) {
    const pl = this.player;
    pl.eye(_eye); pl.dir(_dir);
    const s = p ? p.size : [0.2, 0.2, 0.2], big = Math.max(s[0], s[1], s[2]);
    const heavy = pl.encumbered;
    const dist = Math.max(0.62, Math.min(1.3, 0.5 + big * 0.75)), sag = heavy ? 0.45 : 0.14 + big * 0.3;
    const r = p ? p.r : 0.1, hy = p ? p.hy : 0.1;
    const cols = this._cols = this.colliders(_eye.x, _eye.z, dist + r + 1);
    const H = (x, z) => this.props.heightAt(x, z);
    let found = false;
    for (let t = 0.2; t <= dist + 1e-6; t += 0.06) {
      const x = _eye.x + _dir.x * t, z = _eye.z + _dir.z * t;
      let y = _eye.y + _dir.y * t - sag * (t / dist);
      const floor = supportY(x, z, y - hy, cols, H, 0.22);
      if (y - hy < floor + 0.015) y = floor + hy + 0.015;
      if (y + hy > _eye.y + 0.9) break;
      if (!circleFree(x, z, r, cols, y - hy + 0.03, y + hy)) break;
      out.set(x, y, z); found = true;
    }
    if (!found) {
      const floor = H(_eye.x, _eye.z);
      out.set(_eye.x, Math.max(_eye.y - 0.45, floor + hy + 0.015), _eye.z);
    }
    return out;
  }
  _updateHeld(dt, input) {
    const p = this.heldProp, pl = this.player, look = input.look;
    // rotate mode: R held + mouse turns the item, the view stays put
    const rotating = !!(p && input.held && input.held.has("rotate"));
    if (rotating && look) {
      if (!this.rot) this.rot = { yaw: look.yaw, pitch: look.pitch };
      const dyaw = (look.yaw - this.rot.yaw) || -(look.dx || 0) * 0.0025;
      const dpitch = (look.pitch - this.rot.pitch) || (look.dy || 0) * 0.0025;
      if (dyaw || dpitch) {
        // world rotation: about up, and about the player's left axis; expressed in the player-yaw frame
        _q.setFromAxisAngle(UP, -dyaw * 1.6);
        _q2.setFromAxisAngle(_v.set(Math.cos(pl.yaw), 0, -Math.sin(pl.yaw)), -dpitch * 1.6);
        _q.multiply(_q2);
        _q2.setFromAxisAngle(UP, pl.yaw);
        this.rel.premultiply(_q2).premultiply(_q).premultiply(_q2.invert()).normalize();
      }
      look.yaw = this.rot.yaw; look.pitch = this.rot.pitch;
      if ("dx" in look) { look.dx = 0; look.dy = 0; }
      pl.yaw = this.rot.yaw; pl.pitch = this.rot.pitch;
    } else this.rot = null;
    this.rotating = rotating;
    pl.lookLocked = rotating;
    if (!p) return;
    // orientation
    _q.setFromAxisAngle(UP, pl.yaw).multiply(this.rel);
    p.quat.slerp(_q, 1 - Math.exp(-18 * dt));
    this.props._extent(p);
    // position: smoothed towards the hold point, then pushed out of anything solid
    const goal = this._holdPoint(p, _w);
    const far = p.pos.distanceToSquared(goal) > 9;
    p.pos.lerp(goal, far ? 1 : 1 - Math.exp(-22 * dt));
    const cols = this._cols;
    _p.x = p.pos.x; _p.z = p.pos.z;
    if (resolveCircle(_p, p.r, cols, p.pos.y - p.hy + 0.03, p.pos.y + p.hy)) { p.pos.x = _p.x; p.pos.z = _p.z; }
    const floor = supportY(p.pos.x, p.pos.z, p.pos.y - p.hy, cols, (x, z) => this.props.heightAt(x, z), 0.22);
    if (p.pos.y - p.hy < floor) p.pos.y = floor + p.hy;
    p.mesh.position.copy(p.pos);
    p.vel.set(0, 0, 0);
  }

  // ── cargo ghost / placement ───────────────────────────────────────────────────────────────────────────────
  // Where the held item would sit in the vehicle's cargo zone for a hit at `point` (render space)
  cargoPlacement(vehicle, point, p = this.heldProp, floorAim = true) {
    const zone = vehicle.cargo && vehicle.cargo.zone;
    if (!zone || !p) return null;
    vehicle.mesh.updateWorldMatrix(true, false);
    const l = vehicle.mesh.worldToLocal(_v.copy(point));
    // Prefer where the view ray meets the cargo floor (so aiming over a bed wall still places precisely)
    if (this._rayO && floorAim) {
      const o = vehicle.mesh.worldToLocal(_w.copy(this._rayO)), e = vehicle.mesh.worldToLocal(_eye.copy(this._rayO).add(this._rayD));
      const dy = e.y - o.y;
      if (dy < -0.05) {
        const t = (zone.min[1] - o.y) / dy, fx = o.x + (e.x - o.x) * t, fz = o.z + (e.z - o.z) * t, m = 0.25;
        if (t > 0 && t < 4 && fx > zone.min[0] - m && fx < zone.max[0] + m && fz > zone.min[2] - m && fz < zone.max[2] + m) { l.x = fx; l.z = fz; }
      }
    }
    vehicle.mesh.getWorldQuaternion(_q);
    let steps = Math.round((yawOf(p.quat) - yawOf(_q)) / (Math.PI / 2));
    const s = p.def.size, zw = zone.max[0] - zone.min[0], zd = zone.max[2] - zone.min[2];
    const ext = (st) => (st & 1 ? [s[2] / 2, s[0] / 2] : [s[0] / 2, s[2] / 2]);
    let [hx, hz] = ext(steps), reason = null;
    if (hx * 2 > zw || hz * 2 > zd) { steps += 1; [hx, hz] = ext(steps); }
    if (hx * 2 > zw || hz * 2 > zd) reason = "it is too big";
    const hy = s[1] / 2;
    const x = Math.max(zone.min[0] + hx, Math.min(zone.max[0] - hx, l.x));
    const z = Math.max(zone.min[2] + hz, Math.min(zone.max[2] - hz, l.z));
    let y = zone.min[1];
    for (let pass = 0; pass < 12; pass++) {
      let moved = false;
      for (const e of vehicle.cargo.items) {
        const d = e.item && ITEMS[e.item.type];
        if (!d || e.item.id === p.id) continue;
        const q = Math.abs((e.lyaw || 0) / (Math.PI / 2)), odd = Math.round(q) & 1, snapped = Math.abs(q - Math.round(q)) < 0.01;
        const m = Math.max(d.size[0], d.size[2]) / 2;
        const ex = snapped ? (odd ? d.size[2] : d.size[0]) / 2 : m, ez = snapped ? (odd ? d.size[0] : d.size[2]) / 2 : m, ey = d.size[1] / 2;
        if (Math.abs(x - e.lpos[0]) >= hx + ex - 0.004 || Math.abs(z - e.lpos[2]) >= hz + ez - 0.004) continue;
        const top = e.lpos[1] + ey, bot = e.lpos[1] - ey;
        if (y < top - 0.004 && y + hy * 2 > bot + 0.004) { y = top; moved = true; }
      }
      if (!moved) break;
    }
    if (!reason && y + hy * 2 > zone.max[1] + 1e-6) reason = "there is no room here";
    return { vehicle, lpos: [x, y + hy, z], lyaw: steps * Math.PI / 2, ok: !reason, reason };
  }
  _showGhost(place) {
    const p = this.heldProp;
    if (!this.ghost || this.ghost.id !== p.id) {
      this._disposeGhost();
      const mat = new THREE.MeshBasicMaterial({ color: 0x55ff88, transparent: true, opacity: 0.6, depthWrite: false });
      const mesh = buildMesh(p.item);
      mesh.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = false; } });
      this.ghost = { id: p.id, mesh, mat };
    }
    const g = this.ghost;
    g.mat.color.set(place.ok ? 0x55ff88 : 0xff4a3a);
    if (g.mesh.parent !== place.vehicle.mesh) place.vehicle.mesh.add(g.mesh);
    g.mesh.position.fromArray(place.lpos);
    g.mesh.quaternion.setFromAxisAngle(UP, place.lyaw);
    g.mesh.visible = true;
  }
  _hideGhost() { if (this.ghost) { this.ghost.mesh.visible = false; if (this.ghost.mesh.parent) this.ghost.mesh.parent.remove(this.ghost.mesh); } }
  _disposeGhost() {
    if (!this.ghost) return;
    this._hideGhost();
    this.ghost.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.ghost.mat.dispose();
    this.ghost = null;
  }
  // First surface (terrain or the top of a collider) under the crosshair within reach where the held item fits upright
  _findPlaceSpot(p) {
    const cols = this._cols || [], H = (x, z) => this.props.heightAt(x, z);
    this.player.eye(_eye); this.player.dir(_dir);
    let py = _eye.y;
    for (let t = 0.3; t <= REACH; t += 0.04) {
      const x = _eye.x + _dir.x * t, y = _eye.y + _dir.y * t, z = _eye.z + _dir.z * t;
      let top = null;
      const g = H(x, z);
      if (y <= g) top = g;
      for (const o of cols) {
        if (o.solid === false || !insideCollider(o, x, z)) continue;
        if (o.y0 !== undefined && y < o.y0) continue;
        if (o.y1 === undefined || y <= o.y1) {
          if (o.y1 !== undefined && py >= o.y1) top = Math.max(top ?? -Infinity, o.y1);   // came down onto its top
          else return null;                                                               // ran into its side
        }
      }
      if (top !== null) {
        const h = p.def.size[1];
        if (!circleFree(x, z, p.r, cols, top + 0.04, top + h)) return null;
        return { x, y: top, z };
      }
      py = y;
    }
    return null;
  }

  // ── per frame ─────────────────────────────────────────────────────────────────────────────────────────────
  update(dt, input = {}) {
    const pressed = input.pressed || EMPTY, down = input.held || EMPTY;
    const ctx = this.ctx, pl = this.player;
    for (let i = 0; i < 6; i++) if (pressed.has("slot" + (i + 1))) this.pockets.select(i);
    if (pressed.has("flashlight")) {
      if (ctx.hasTool("flashlight")) { this.flashlight = !this.flashlight; sfx("ui_click"); }
      else notify("You don't have a flashlight", { level: "warn", key: "flashlight" });
    }
    this._updateLight();
    if (this.heldProp && this.heldProp.dead) this._letGo();
    this._updateHeld(dt, input);
    const p = this.heldProp;

    // look-at target
    pl.eye(_eye); pl.dir(_dir);
    this.raycaster.set(_v.copy(_eye).sub(origin), _dir);
    (this._rayO || (this._rayO = new THREE.Vector3())).copy(this.raycaster.ray.origin);
    (this._rayD || (this._rayD = new THREE.Vector3())).copy(_dir);
    let hit = raycastTargets(this.raycaster, 6, p ? p.mesh : null);
    if (hit && hit.distance > (hit.target.reach ?? REACH)) hit = null;
    this.hit = hit;
    const target = this.target = hit ? hit.target : null;
    let list = [];
    if (target && target.actions) { try { list = target.actions(ctx) || []; } catch (e) { console.error(e); list = []; } }

    // cargo placement: a held item aimed at a cargo target
    let cargoHint = null;
    this.cargo = null;
    // … or at something already secured in it (to stack on top / put beside)
    const cargoV = target && (target.cargoOf || (target.prop && target.prop.secured && target.prop.secured.vehicle));
    if (p && cargoV && cargoV.cargo) {
      const place = this.cargo = this.cargoPlacement(cargoV, hit.point, p, !!target.cargoOf);
      if (place) {
        this._showGhost(place);
        let where = (target.cargoOf && val(target.name)) || (cargoV.def && cargoV.def.name) || "cargo area";
        where = /^the /i.test(where) ? where : "the " + where.toLowerCase();
        cargoHint = place.ok ? `LMB – secure it in ${where}. Secured cargo rides along.` : `Won't fit in ${where}: ${place.reason}`;
        list = list.filter((a) => a.key !== "grab");
        list.push({
          key: "grab", label: "Secure cargo", blocked: place.ok ? undefined : "Won't fit: " + place.reason,
          run: () => { const held = this.heldProp; this._letGo(); this.props.secure(held, place.vehicle, place.lpos, place.lyaw); sfx("drop"); },
        });
      }
    } else this._hideGhost();
    this.placeSpot = p ? this._findPlaceSpot(p) : null;

    // keys → actions
    const out = [];
    let progress = null;
    const act = this.active;
    if (act && (act.target !== target || !down.has(act.key))) this.active = null;
    for (const key of KEYS) {
      if (!down.has(key)) this.lock[key] = false;
      const mine = list.filter((a) => a.key === key);
      for (const a of mine) out.push({ key: KEY_LABEL[key], label: a.label, blocked: a.blocked || null, progress: null, _a: a });
      // with full hands a blocked grab does not get in the way of dropping
      let a = mine.find((a) => !a.blocked) || mine[0];
      if (a && a.blocked && key === "grab" && p && !this.cargo) a = null;
      const row = a && out.find((r) => r._a === a);
      const edge = pressed.has(key);
      if (!a) { if (edge) this._builtin(key); continue; }
      if (a.blocked) { if (edge) { notify(a.blocked, { level: "warn", key: "blocked" }); sfx("error"); } continue; }
      if (this.lock[key]) continue;
      if (a.tick) {
        if (edge) this.active = { key, target, kind: "tick", label: a.label };
        if (this.active && this.active.key === key && this.active.kind === "tick" && down.has(key)) {
          let r;
          try { r = a.tick(ctx, dt); } catch (e) { r = false; this._fail(e); }
          if (r === false) { this.active = null; this.lock[key] = true; }
          else { row.progress = typeof r === "number" ? Math.max(0, Math.min(1, r)) : null; progress = { label: a.label, pct: row.progress ?? 0 }; }
        }
      } else if (a.hold) {
        if (edge) this.active = { key, target, kind: "hold", t: 0, label: a.label };
        if (this.active && this.active.key === key && this.active.kind === "hold") {
          this.active.t += dt;
          const f = Math.min(1, this.active.t / a.hold);
          row.progress = f; progress = { label: a.label, pct: f };
          if (f >= 1) { this.active = null; this.lock[key] = true; this._run(a); progress = null; row.progress = null; }
        }
      } else if (edge && a.run) { this.lock[key] = true; this._run(a); }
    }
    if (pressed.has("throw") && this.heldProp) this.throwHeld();
    if (pressed.has("stow")) this._stow();
    if (pressed.has("consume")) this._consume();

    // HUD state
    const h = this.heldProp;
    let tinfo = null;
    if (target) {
      let info = {};
      try { info = (target.info && target.info()) || {}; } catch (e) { info = {}; }
      tinfo = { name: String(val(target.name) ?? ""), cond: info.cond ?? null, qty: info.qty ?? null, note: info.note ?? null };
    }
    let held = null;
    if (h) {
      const hints = this.cargo ? (this.cargo.ok ? ["LMB secure"] : []) : ["LMB drop"];
      if (!pl.encumbered) hints.push("RMB throw");
      hints.push("R rotate");
      if (this.placeSpot && !list.some((a) => a.key === "alt")) hints.push("F place");
      if (h.def.use && !list.some((a) => a.key === "use")) hints.push("E " + useVerb(h.def).toLowerCase());
      if (h.def.pocket) hints.push("Q stow");
      held = { name: itemLabel(h.item), qty: qtyText(h.item), hints };
      if (pl.encumbered) held.heavy = true;
    }
    this.state = {
      target: tinfo,
      actions: out.map(({ key, label, blocked, progress }) => ({ key, label, blocked, progress })),
      held, cargoHint, progress,
    };
    return this.state;
  }
  _fail(e) {
    if (typeof e === "string") { notify(e, { level: "warn", key: "blocked" }); sfx("error"); }
    else console.error(e);
  }
  _run(a) { try { a.run(this.ctx); } catch (e) { this._fail(e); } }
  // Keys that no target action claimed
  _builtin(key) {
    const p = this.heldProp;
    if (!p) return;
    if (key === "grab") { this.dropHeld(); sfx("drop", { vol: 0.5 }); }
    else if (key === "alt") {
      const s = this.placeSpot;
      if (!s) { notify("Nothing to put it on within reach", { level: "info", key: "place" }); return; }
      this._letGo();
      _q.setFromAxisAngle(UP, this.player.yaw).multiply(this.rel);
      this.props.rest(p, _v.set(s.x, s.y + p.def.size[1] / 2, s.z), yawOf(_q));
      sfx("drop", { vol: 0.6 });
    } else if (key === "use" && p.def.use) {
      const r = useItem(this.ctx, p.item);
      if (r.ok && r.consumed) this.consumeHeld();
    }
  }
  // Q: held → pocket, or selected pocket item → hands
  _stow() {
    const p = this.heldProp;
    if (p) {
      if (!p.def.pocket) { notify("That won't fit in a pocket", { level: "warn", key: "pockets" }); sfx("error"); return; }
      if (!this.pockets.add(p.item)) { notify("Your pockets are full", { level: "warn", key: "pockets" }); sfx("error"); return; }
      this.consumeHeld();
      sfx("pickup", { vol: 0.6 });
    } else {
      const item = this.pockets.take();
      if (!item) return;
      if (!this.giveHeld(item)) this.pockets.add(item); else sfx("pickup", { vol: 0.6 });
    }
  }
  _toolNearby(type) {
    const pp = this.player.pos;
    for (const p of this.props.list) {
      if (p.item.type !== type || p === this.heldProp) continue;
      const w = this.props.pose(p).pos;
      const x = Array.isArray(w) ? w[0] : w.x, z = Array.isArray(w) ? w[2] : w.z;
      if (Math.hypot(x - pp.x, z - pp.z) < 3.5) return true;
    }
    return false;
  }

  // X: use the selected pocket item (also called by the inventory screen: consumeSlot(i))
  _consume() { return this.consumeSlot(this.pockets.selected); }
  consumeSlot(i) {
    const item = this.pockets.peek(i);
    if (!item) return { ok: false, msg: "That pocket is empty" };
    const def = ITEMS[item.type];
    if (!def.use) { notify(`${def.name}: nothing to use it on like this`, { level: "info", key: "use" }); return { ok: false, msg: "Not usable" }; }
    const r = useItem(this.ctx, item);
    if (r.ok && r.consumed) this.pockets.take(i);
    return r;
  }
  // Drop one item from a pocket slot at the player's feet (inventory screen)
  dropSlot(i) {
    const item = this.pockets.take(i);
    if (!item) return null;
    this.player.eye(_eye); this.player.dir(_dir);
    const cols = this.colliders(_eye.x, _eye.z, 1.5);
    _p.x = _eye.x + _dir.x * 0.5; _p.z = _eye.z + _dir.z * 0.5;
    if (!circleFree(_p.x, _p.z, 0.2, cols, this.player.pos.y + 0.3, _eye.y)) { _p.x = _eye.x; _p.z = _eye.z; }
    return this.props.spawn(item, [_p.x, _eye.y - 0.5, _p.z], {});
  }
  _updateLight() {
    const want = this.flashlight && this.ctx.hasTool("flashlight");
    if (!want) { if (this.light) this.light.visible = false; if (this.flashlight && !this.ctx.hasTool("flashlight")) this.flashlight = false; return; }
    if (!this.light) {
      this.light = new THREE.SpotLight(0xfff0d0, 60, 45, 0.42, 0.5, 1.6);
      this.light.castShadow = false;
      this.props.root.add(this.light, this.light.target);
    }
    this.player.eye(_eye); this.player.dir(_dir);
    this.light.visible = true;
    this.light.position.set(_eye.x, _eye.y - 0.15, _eye.z);
    this.light.target.position.copy(_eye).addScaledVector(_dir, 6);
  }
  dispose() { this.clear(); this._disposeGhost(); if (this.light) { this.light.parent && this.light.parent.remove(this.light, this.light.target); this.light.dispose(); this.light = null; } }
}
