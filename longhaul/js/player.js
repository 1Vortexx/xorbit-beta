// Long Haul – first-person controller on foot.
// Capsule-like body (circle of RADIUS between feet and head) against the shared 2.5D colliders, terrain from heightAt.
// Conventions (kept from the old controller): forward = (sin yaw, cos yaw), +side = left, positive pitch looks down.
import * as THREE from "three";
import { sfx } from "./core/bus.js";
import { resolveCircle, circleFree } from "./core/collide.js";

const terrain = { heightAt: () => 0, surfaceAt: () => "dirt" };
import("./world/terrain.js")
  .then((m) => { terrain.heightAt = m.heightAt; if (m.surfaceAt) terrain.surfaceAt = m.surfaceAt; })
  .catch(() => {});

export const RADIUS = 0.32, HEIGHT = 1.8, CROUCH_HEIGHT = 1.1, EYE = 1.66, CROUCH_EYE = 0.98, STEP = 0.3;
const WALK = 3.7, SPRINT = 6.4, CROUCH = 1.8, HEAVY = 1.5;
const GRAVITY = 18, JUMP = 5.0, MAX_SLOPE = 1.25 /* rise/run ≈ 51° */;
const euler = new THREE.Euler(0, 0, 0, "YXZ");
const _p = { x: 0, z: 0 };

function inside(o, x, z) {
  const dx = x - o.x, dz = z - o.z;
  if (o.kind === "box") {
    const s = Math.sin(o.yaw), c = Math.cos(o.yaw);
    return Math.abs(dx * c - dz * s) <= o.hx && Math.abs(dx * s + dz * c) <= o.hz;
  }
  return dx * dx + dz * dz <= o.r * o.r;
}

export class Player {
  constructor(opts = {}) {
    this.pos = new THREE.Vector3();     // feet, absolute
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.stamina = 1;                   // 0..1
    this.exhausted = false;
    this.sprinting = false;
    this.crouched = false;
    this.grounded = true;
    this.encumbered = false;            // set by Interaction while carrying something heavy
    this.surface = "dirt";
    this.lastImpact = 0;                // landing speed of the most recent landing (m/s); main may turn it into injury
    this.camMotion = 1;
    this._heightAt = opts.heightAt || null;
    this._surfaceAt = opts.surfaceAt || null;
    this._bumpCooldown = 0;
    this._contactAge = 1;
    this._eye = EYE;                    // smoothed eye height
    this._lift = 0;                     // smooths step-ups for the camera
    this._bob = 0; this._bobAmp = 0; this._stride = 0; this._rest = 0; this._dip = 0;
  }
  get height() { return this.crouched ? CROUCH_HEIGHT : HEIGHT; }
  heightAt(x, z) { return (this._heightAt || terrain.heightAt)(x, z); }
  surfaceAt(x, z) { return (this._surfaceAt || terrain.surfaceAt)(x, z); }

  // Floor under the feet: terrain, or the top of a collider low enough to step onto
  floorAt(x, z, feet, colliders) {
    let g = this.heightAt(x, z);
    if (colliders) for (const o of colliders) {
      if (o.solid === false || o.y1 === undefined || o.y1 <= g || o.y1 > feet + STEP + 0.02) continue;
      if (inside(o, x, z)) g = o.y1;
    }
    return g;
  }

  // input: see interact.js (fwd, side, sprint, crouch, jump, look). colliders: Collider[] near the player.
  // opts: { needs, camMotion, canSprint }
  update(dt, input, colliders = [], opts = {}) {
    dt = Math.min(dt, 0.1);
    this._bumpCooldown = Math.max(0, this._bumpCooldown - dt);
    this._contactAge += dt;
    if (input.look && !this.lookLocked) { this.yaw = input.look.yaw; this.pitch = input.look.pitch; }
    if (opts.camMotion !== undefined) this.camMotion = opts.camMotion;
    const energy = opts.needs ? opts.needs.energy : 100;

    // crouch (cannot stand up under something low)
    if (input.crouch) this.crouched = true;
    else if (this.crouched && circleFree(this.pos.x, this.pos.z, RADIUS - 0.02, colliders, this.pos.y + CROUCH_HEIGHT, this.pos.y + HEIGHT)) this.crouched = false;

    // wish direction
    let f = input.fwd || 0, s = input.side || 0;
    const len = Math.hypot(f, s);
    if (len > 1) { f /= len; s /= len; }
    const moving = len > 0.05;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = sin * f + cos * s, wz = cos * f - sin * s;

    // sprint + stamina
    const canSprint = opts.canSprint !== false && energy > 8 && !this.exhausted && !this.crouched && !this.encumbered;
    this.sprinting = !!(input.sprint && canSprint && moving && f > 0.3 && this.grounded);
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - dt / 16);
      this._rest = 0;
      if (this.stamina <= 0) this.exhausted = true;
    } else {
      this._rest += dt;
      if (this._rest > 0.8) this.stamina = Math.min(1, this.stamina + dt / (moving ? 14 : 8) * (energy < 25 ? 0.5 : 1));
      if (this.exhausted && this.stamina > 0.3) this.exhausted = false;
    }
    let speed = this.sprinting ? SPRINT : this.crouched ? CROUCH : WALK;
    if (this.encumbered) speed = Math.min(speed, HEAVY);
    if (f < -0.1) speed *= 0.75;
    if (energy < 10) speed *= 0.8;

    // smooth acceleration (less control in the air)
    const k = 1 - Math.exp(-(this.grounded ? (moving ? 11 : 14) : 2) * dt);
    this.vel.x += (wx * speed - this.vel.x) * k;
    this.vel.z += (wz * speed - this.vel.z) * k;

    // jump
    if (input.jump && this.grounded && !this.encumbered && !this._jumpHeld && this.stamina > 0.08) {
      this.vel.y = JUMP; this.grounded = false; this.crouched = false;
      this.stamina = Math.max(0, this.stamina - 0.06);
    }
    this._jumpHeld = !!input.jump;

    // integrate in small steps so a fast frame cannot skip a thin wall
    const n = Math.max(1, Math.ceil(dt / (1 / 90)));
    const h = dt / n;
    let travelled = 0;
    for (let i = 0; i < n; i++) travelled += this._step(h, colliders);

    // head bob + footsteps
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && hs > 0.4 && travelled > 0) {
      const stride = this.sprinting ? 1.15 : this.crouched ? 0.55 : 0.78;
      this._bob += (travelled / stride) * Math.PI;
      this._stride += travelled;
      if (this._stride >= stride) {
        this._stride = 0;
        this.surface = this.surfaceAt(this.pos.x, this.pos.z);
        sfx("footstep", { surface: this.surface, vol: this.sprinting ? 1 : this.crouched ? 0.35 : 0.65 });
      }
    }
    const amp = this.grounded && hs > 0.4 ? (this.sprinting ? 0.05 : 0.028) : 0;
    this._bobAmp += (amp - this._bobAmp) * Math.min(1, dt * 8);
    this._eye += ((this.crouched ? CROUCH_EYE : EYE) - this._eye) * Math.min(1, dt * 10);
    this._lift *= Math.exp(-dt * 12);
    this._dip *= Math.exp(-dt * 9);
    return this;
  }

  _step(h, colliders) {
    const p = this.pos, ox = p.x, oz = p.z;
    const before = this.floorAt(p.x, p.z, p.y, colliders);
    p.x += this.vel.x * h; p.z += this.vel.z * h;
    // walls, closed doors, furniture, vehicles: anything taller than a step, overlapping the body
    _p.x = p.x; _p.z = p.z;
    const hit = resolveCircle(_p, RADIUS, colliders, p.y + STEP + 0.02, p.y + this.height);
    if (hit) {
      p.x = _p.x; p.z = _p.z;
      const vn = this.vel.x * hit.nx + this.vel.z * hit.nz;
      if (vn < 0) {
        if (-vn > 0.65 && this._bumpCooldown <= 0 && this._contactAge > 0.15) {
          sfx("bump", { material: hit.collider.soundMaterial || "solid", vol: Math.min(1, 0.25 + (-vn / SPRINT) * 0.75) });
          this._bumpCooldown = 0.4;
        }
        this.vel.x -= vn * hit.nx; this.vel.z -= vn * hit.nz;
      }
      this._contactAge = 0;
    }
    let floor = this.floorAt(p.x, p.z, p.y, colliders);
    // too steep to climb: slide back (terrain only – ledges are handled by the colliders)
    const run = Math.hypot(p.x - ox, p.z - oz);
    if (this.grounded && run > 1e-5 && this.heightAt(p.x, p.z) - this.heightAt(ox, oz) > run * MAX_SLOPE) {
      p.x = ox; p.z = oz; floor = before;
      this.vel.x *= 0.5; this.vel.z *= 0.5;
    }
    // vertical
    if (this.grounded) {
      if (floor >= p.y - 0.35) {           // follow the ground, up steps and down slopes
        if (floor > p.y + 0.02) this._lift -= floor - p.y;
        p.y = floor; this.vel.y = 0;
      } else this.grounded = false;        // walked off a ledge
    }
    if (!this.grounded) {
      this.vel.y -= GRAVITY * h;
      p.y += this.vel.y * h;
      // bump the head
      if (this.vel.y > 0 && !circleFree(p.x, p.z, RADIUS - 0.04, colliders, p.y + this.height - 0.05, p.y + this.height + 0.02)) this.vel.y = 0;
      const f2 = this.floorAt(p.x, p.z, p.y, colliders);
      if (p.y <= f2 && this.vel.y <= 0) {
        const impact = -this.vel.y;
        p.y = f2; this.vel.y = 0; this.grounded = true;
        this.lastImpact = impact;
        if (impact > 2.5) {
          sfx("land", { vol: Math.min(1, impact / 9), surface: this.surfaceAt(p.x, p.z) });
          this._dip = Math.min(0.16, impact * 0.012);
        }
      }
    }
    // never under the terrain
    const g = this.heightAt(p.x, p.z);
    if (p.y < g) { p.y = g; this.vel.y = Math.max(0, this.vel.y); this.grounded = true; }
    return Math.hypot(p.x - ox, p.z - oz);
  }

  // Absolute eye position (with bob)
  eye(out = new THREE.Vector3()) {
    const m = this.camMotion;
    return out.set(this.pos.x, this.pos.y + this._eye + (Math.sin(this._bob * 2) * this._bobAmp - this._dip) * m + this._lift, this.pos.z);
  }
  applyCamera(camera) {
    this.eye(camera.position);
    const m = this.camMotion, sway = Math.cos(this._bob) * this._bobAmp * 0.5 * m;
    camera.position.x += Math.cos(this.yaw) * sway;
    camera.position.z -= Math.sin(this.yaw) * sway;
    euler.set(-this.pitch, this.yaw + Math.PI, Math.cos(this._bob) * this._bobAmp * 0.12 * m);
    camera.quaternion.setFromEuler(euler);
  }
  // Unit view direction
  dir(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp);
  }

  teleport(x, z, yaw) {
    this.pos.set(x, this.heightAt(x, z), z);
    this.vel.set(0, 0, 0);
    if (yaw !== undefined) this.yaw = yaw;
    this.grounded = true; this._lift = 0; this._dip = 0;
  }

  // Can the player stand at (x, z)?  colliders = everything nearby (world + vehicles)
  canStand(x, z, colliders, refY) {
    const y = this.heightAt(x, z);
    if (refY !== undefined && Math.abs(y - refY) > 1.6) return false;                       // cliff / steep drop
    if (!circleFree(x, z, RADIUS + 0.04, colliders, y + STEP + 0.02, y + HEIGHT)) return false;
    for (let i = 0; i < 4; i++) {                                                           // not balanced on a steep slope
      const a = i * Math.PI / 2, d = 0.4;
      if (Math.abs(this.heightAt(x + Math.cos(a) * d, z + Math.sin(a) * d) - y) > d * 1.4) return false;
    }
    return true;
  }
  // Step out of a vehicle: first free exit spot (best first), then a ring search. Never inside geometry.
  // colliders: world + other vehicles near the vehicle (its own colliders are added here). Returns the spot used.
  exitVehicle(vehicle, colliders = []) {
    const own = vehicle.colliders ? vehicle.colliders() : [];
    const all = colliders.concat(own.filter((o) => !colliders.includes(o)));
    const vx = vehicle.pos.x, vz = vehicle.pos.z, vy = this.heightAt(vx, vz);
    // nothing solid between the spot and the vehicle (so we do not step out through a wall)
    const reachable = (x, z) => {
      const d = Math.hypot(vx - x, vz - z), n = Math.ceil(d / 0.15);
      for (let i = 1; i <= n; i++) {
        const t = i / n, px = x + (vx - x) * t, pz = z + (vz - z) * t, py = this.heightAt(px, pz);
        if (!circleFree(px, pz, 0.12, own)) return true;
        if (!circleFree(px, pz, 0.12, colliders, py + STEP + 0.02, py + HEIGHT)) return false;
      }
      return true;
    };
    const ok = (x, z) => this.canStand(x, z, all, vy) && reachable(x, z);
    let spot = null;
    for (const s of vehicle.exitSpots ? vehicle.exitSpots() : []) if (ok(s.x, s.z)) { spot = { x: s.x, z: s.z }; break; }
    for (let r = 1.6; !spot && r <= 8; r += 0.5) {
      for (let i = 0; i < 20 && !spot; i++) {
        // start at the driver's side (+x local) and fan out
        const a = (i % 2 ? -1 : 1) * Math.ceil(i / 2) * (Math.PI / 10);
        const q = vehicle.quat, lx = Math.cos(a) * r, lz = Math.sin(a) * r;
        let dx = lx, dz = lz;
        if (q) { const fy = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)); dx = lx * Math.cos(fy) + lz * Math.sin(fy); dz = -lx * Math.sin(fy) + lz * Math.cos(fy); }
        if (ok(vx + dx, vz + dz)) spot = { x: vx + dx, z: vz + dz };
      }
    }
    let y;
    if (!spot) { // boxed in on every side: stand on top of the vehicle rather than inside anything
      spot = { x: vx, z: vz, roof: true };
      y = Math.max(vy, ...own.map((o) => (o.y1 === undefined ? vy + 2 : o.y1))) + 0.02;
    } else y = this.heightAt(spot.x, spot.z);
    this.pos.set(spot.x, y, spot.z);
    this.vel.set(0, 0, 0);
    if (vehicle.quat) { const q = vehicle.quat; this.yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)); }
    this.pitch = 0;
    this.grounded = !spot.roof; this.crouched = false; this._lift = 0; this._dip = 0;
    return spot;
  }

  serialize() {
    return { pos: [this.pos.x, this.pos.y, this.pos.z], yaw: this.yaw, pitch: this.pitch, stamina: this.stamina, crouched: this.crouched };
  }
  restore(d) {
    if (!d) return;
    if (d.pos) this.pos.fromArray(d.pos);
    this.yaw = d.yaw || 0; this.pitch = d.pitch || 0;
    this.stamina = d.stamina ?? 1; this.crouched = !!d.crouched;
    this.vel.set(0, 0, 0); this.grounded = true; this.exhausted = false;
    const g = this.heightAt(this.pos.x, this.pos.z);
    if (!(this.pos.y >= g)) this.pos.y = g;
  }
}
