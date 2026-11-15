// Long Haul – NPC driving (ARCHITECTURE §14.5). A Pursuer is a driver, not a force: it reads the world the way a
// driver could (road shape, slope, colliders and vehicles ahead) and writes ordinary control input to `vehicle.ai`.
// Vehicles.step then runs that vehicle through exactly the same physics as the player's: same traction, damage,
// fuel burn and collisions. Nothing here moves, turns or repairs a vehicle. Pure logic (no THREE, no DOM).
//
// Pipeline: update(dt) every frame → crash window → disableCheck → ignition / lights → recovery or
//   _think() at PURSUIT_RULES.planHz (target observation with reaction lag, state, goal, avoidance fan, speed limit)
//   → _drive() every frame (steering towards the planned bearing, throttle / brake towards the planned speed).
import { emit, sfx } from "../core/bus.js";
import { pushOut } from "../core/collide.js";
import { ground, SURFACES } from "../vehicles/ground.js";
import { RESTART_BELOW } from "../vehicles/powertrain.js";

const G = 9.81;

export const PURSUIT_RULES = {
  // Per difficulty. reaction: seconds between seeing and acting. pace: throttle ceiling (1 = floor it; never more
  // than the pedal allows). grip: share of the available tyre grip the driver dares to use in bends.
  // mistakeEvery: seconds of active driving between mistakes [min, max], drawn from the seeded stream.
  easy:   { reaction: 0.45, pace: 0.82, grip: 0.5,  mistakeEvery: [7, 14] },
  normal: { reaction: 0.3,  pace: 0.92, grip: 0.6,  mistakeEvery: [12, 24] },
  hard:   { reaction: 0.18, pace: 1.0,  grip: 0.7,  mistakeEvery: [22, 45] },
  planHz: 10,              // sensing / planning rate; steering and pedals run every frame
  brakeShare: 0.6,         // share of the surface's grip assumed when planning a stop (late-braking mistake: × lateFactor)
  lateFactor: 1.6, lateGrip: 1.35, wideMetres: [2, 4], overGain: 1.9, mistakeSeconds: [1.5, 3.5],
  offroadTop: 22,          // m/s the driver is willing to do off the asphalt
  closeRange: 45,          // m: "chasing" → "closing"
  holdSpeed: 2, holdRange: 30, holdDistance: 7,   // target slower than holdSpeed within holdRange → stop holdDistance away
  crashSeverity: 7,        // summed impact severity (≈ lost m/s × 2.2) inside 0.2 s that counts as a crash, not a tap
  recoverPause: 1.0, reverseFor: 2.2, reverseMetres: 6,
  stuckSeconds: 4,         // throttle applied, engine running, less than stuckProgress metres made in this long → one try
  stuckProgress: 1.5, unstickTries: 3, stuckResetDistance: 15,
  wreckedBody: 5, wreckedEngine: 5,   // condition floors for "wrecked"
  ignitionRetry: 1.8,
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const FAN = [0, 0.14, 0.3, 0.5, 0.8, 1.2];
const _p = { x: 0, z: 0 };

// Why this vehicle cannot go on chasing (null = it can). Pure. history = { stuckTime, tries } as kept by a Pursuer.
// "stuck" needs PURSUIT_RULES.unstickTries reverse attempts *and* another PURSUIT_RULES.stuckSeconds without
// progress under throttle; "wrecked" is body or engine condition under the floor. Never time or distance.
export function disableCheck(vehicle, history = null) {
  const reason = vehicle.disabledReason();
  if (reason) return reason;
  const e = vehicle.slots.engine;
  if (vehicle.bodyCond <= PURSUIT_RULES.wreckedBody || (e && e.cond <= PURSUIT_RULES.wreckedEngine)) return "wrecked";
  if (history && (history.tries || 0) >= PURSUIT_RULES.unstickTries && (history.stuckTime || 0) >= PURSUIT_RULES.stuckSeconds) return "stuck";
  return null;
}

export class Pursuer {
  constructor({ id, vehicle, seed, diff, getColliders, getVehicles, terrain } = {}) {
    this.id = id; this.vehicle = vehicle; this.diff = PURSUIT_RULES[diff] && typeof PURSUIT_RULES[diff] === "object" ? diff : "normal";
    this.cfg = PURSUIT_RULES[this.diff];
    this.getColliders = getColliders || null; this.getVehicles = getVehicles || null;
    this.ground = terrain || ground;
    this._rs = (seed >>> 0) || 1;                 // seeded stream position (serialized)
    this.state = "idle"; this.disabledReason = null; this.stoppedNearTarget = false;
    this.history = { stuckTime: 0, tries: 0, ax: vehicle.pos.x, az: vehicle.pos.z, sx: vehicle.pos.x, sz: vehicle.pos.z };
    this._target = null;
    this._planT = this.roll() / PURSUIT_RULES.planHz;   // stagger planning between pursuers
    this._plan = { bearing: vehicle.yaw, v: 0, look: 10, hold: true };
    this._mistakeIn = this._nextMistake(); this._mistake = null;
    this._ignT = 0; this._seen = vehicle.impactSum || 0; this._impSum = 0; this._impT = 0;
    this._rec = null; this._side = 0; this._block = Infinity; this._fanSide = 1; this._obs = [];
    this.controls = { throttle: 0, steer: 0, handbrake: true, shiftUp: false, shiftDown: false };
    this.debug = { mistakes: 0, crashes: 0, plans: 0 };
    vehicle.pinned = true;
    if (vehicle.seatFree("driver")) vehicle.claimSeat("driver", id);
    this.driver = vehicle.seats.driver;
  }
  get canContinue() { return !this.disabledReason; }
  roll() { this._rs = (Math.imul(this._rs, 1664525) + 1013904223) >>> 0; return this._rs / 4294967296; }
  _nextMistake() { const [a, b] = this.cfg.mistakeEvery; return a + (b - a) * this.roll(); }
  setTarget(fn) { this._target = typeof fn === "function" ? fn : null; this._obs.length = 0; }

  _set(throttle, steer, handbrake = false) {
    const c = this.controls;
    c.throttle = throttle; c.steer = steer; c.handbrake = handbrake; c.shiftUp = false; c.shiftDown = false;
    this.vehicle.ai = c;
  }
  // Foot on the brake (never a negative throttle at a crawl: an automatic would select reverse)
  _brake(steer = 0) { const s = this.vehicle.speed; this._set(s > 0.6 ? -1 : s < -0.6 ? 1 : 0, steer, Math.abs(s) < 1.5); }

  // Per frame. env is optional ({ night }); without it the env of the vehicle's last physics step is used.
  update(dt, env = null) {
    if (!this.canContinue) return;
    const v = this.vehicle, R = PURSUIT_RULES;
    // ── Crash window: sum what the physics reported over 0.2 s, so one crash is one event and a tap is nothing ──
    const got = (v.impactSum || 0) - this._seen; this._seen = v.impactSum || 0;
    v.impact = 0;                                   // nobody reads an NPC car's cab shake; do not let it pile up
    let crashed = 0;
    if (got > 0) { this._impSum += got; if (this._impT <= 0) this._impT = 0.2; }
    if (this._impT > 0) {
      this._impT -= dt;
      if (this._impT <= 0) { if (this._impSum >= R.crashSeverity) crashed = this._impSum; this._impSum = 0; }
    }
    if (crashed) {
      this.debug.crashes++;
      emit("pursuer:crash", { id: this.id, severity: crashed });
      sfx("crash", { pos: v.pos, vol: clamp(crashed / 24, 0.25, 1) });
    }
    const reason = disableCheck(v, this.history);
    if (reason) { this._disable(reason); return; }

    const t = this._target ? this._target() : null;
    if (!t || !t.pos) {
      if (this._rec) this._endRecovery();
      this.state = "idle"; this.stoppedNearTarget = false; this._brake(); return;
    }
    v.parkingBrake = false;
    const night = !!(env || v.lastEnv || {}).night;
    if (v.running && night !== !!v.lights) v.setLights(night);
    if (this.state === "idle") this.state = "chasing";

    // ── Ignition: the real key, again after a failed start ──
    if (!v.running) {
      this._brake();
      if (v.ign !== "cranking") {
        this._ignT -= dt;
        if (this._ignT <= 0) {
          if (v.temp >= RESTART_BELOW) this._ignT = 1;            // too hot: wait rather than flatten the battery
          else { v.toggleIgnition(); this._ignT = R.ignitionRetry; }
        }
      }
      return;
    }
    this._ignT = 0;

    if (crashed && !this._rec) this._startRecovery(true);
    if (this._rec) { this._recover(dt, t); return; }

    // ── Stuck bookkeeping ──
    const h = this.history;
    if (Math.hypot(v.pos.x - h.ax, v.pos.z - h.az) > R.stuckProgress) { h.ax = v.pos.x; h.az = v.pos.z; h.stuckTime = 0; }
    else if (Math.abs(this.controls.throttle) > 0.3 && !this._plan.hold) h.stuckTime += dt;
    if (h.tries && Math.hypot(v.pos.x - h.sx, v.pos.z - h.sz) > R.stuckResetDistance) h.tries = 0;
    if (h.stuckTime >= R.stuckSeconds && h.tries < R.unstickTries) {
      if (!h.tries) { h.sx = v.pos.x; h.sz = v.pos.z; }
      h.tries++; h.stuckTime = 0;
      this._startRecovery(false);
      this._recover(dt, t); return;
    }

    this._planT -= dt;
    if (this._planT <= 0) { this._planT += 1 / R.planHz; if (this._planT < 0) this._planT = 0; this._think(t, 1 / R.planHz); }
    this._drive(dt);
  }

  // ── Sensing ───────────────────────────────────────────────────────────────────────────────────────────────
  _obstacles(cx, cz, r, skip = null) {
    const v = this.vehicle, out = [];
    const list = this.getColliders ? this.getColliders(cx, cz, r) || [] : [];
    for (const c of list) if (c.solid !== false && c.vehicle !== v && !(skip && c.vehicle === skip)) out.push(c);
    const cars = this.getVehicles ? this.getVehicles() || [] : [];
    for (const car of cars) {
      if (car === v || car === skip || Math.hypot(car.pos.x - cx, car.pos.z - cz) > r + 4) continue;
      let have = false;
      for (const c of out) if (c.vehicle === car) { have = true; break; }
      if (!have) for (const c of car.colliders()) out.push(c);
    }
    return out;
  }
  _hitAt(x, z, r, list, y0, y1) {
    for (const o of list) {
      if ((o.y0 !== undefined && y1 < o.y0) || (o.y1 !== undefined && y0 > o.y1)) continue;
      _p.x = x; _p.z = z;
      if (pushOut(_p, r, o, null) > 0) return o;
    }
    return null;
  }
  // Free distance along a bearing (terrain too steep or a collider in the swept width ends it)
  _probe(bearing, sight, list, out) {
    const v = this.vehicle, g = this.ground, p = v.pos, sx = Math.sin(bearing), sz = Math.cos(bearing);
    const r = v.def.halfW + 0.5;
    let free = sight, lastH = g.heightAt(p.x, p.z), lastD = 0;
    out.blocker = null;
    for (let d = 2; d <= sight; d += d < 30 ? 2 : 3) {
      const x = p.x + sx * d, z = p.z + sz * d, hgt = g.heightAt(x, z);
      if (Math.abs(hgt - lastH) / (d - lastD) > 0.45) { free = lastD; break; }
      const o = list.length ? this._hitAt(x, z, r, list, hgt + 0.3, hgt + v.def.height) : null;
      if (o) { free = Math.max(0, d - 2); out.blocker = o; break; }
      lastH = hgt; lastD = d;
    }
    out.free = free;
    return out;
  }

  // ── Planning (planHz) ─────────────────────────────────────────────────────────────────────────────────────
  _think(t, dt) {
    const v = this.vehicle, R = PURSUIT_RULES, cfg = this.cfg, g = this.ground, p = v.pos, plan = this._plan;
    this.debug.plans++;
    const speed = Math.abs(v.speed), yaw = v.yaw;

    // Mistakes: a seeded lapse now and then, more often on "easy"
    let m = this._mistake;
    if (m) { m.t -= dt; if (m.t <= 0) m = this._mistake = null; }
    else if (this.state === "chasing" || this.state === "closing") {
      this._mistakeIn -= dt;
      if (this._mistakeIn <= 0) {
        const k = this.roll(), [d0, d1] = R.mistakeSeconds;
        m = this._mistake = { kind: k < 0.4 ? "late" : k < 0.75 ? "wide" : "over", t: d0 + (d1 - d0) * this.roll(), mag: this.roll(), sign: this.roll() < 0.5 ? -1 : 1 };
        this._mistakeIn = this._nextMistake();
        this.debug.mistakes++;
      }
    }

    // What the driver saw `reaction` seconds ago
    const obs = this._obs;
    obs.push({ x: t.pos.x, z: t.pos.z, vx: t.vel ? t.vel.x : 0, vz: t.vel ? t.vel.z : 0 });
    const keep = Math.round(cfg.reaction * R.planHz) + 1;
    while (obs.length > keep) obs.shift();
    const q = obs[0];
    const dx = q.x - p.x, dz = q.z - p.z, dist = Math.hypot(dx, dz);
    const tSpeed = Math.hypot(q.vx, q.vz);

    const surf = SURFACES[v.surface] || SURFACES.asphalt;
    const late = m && m.kind === "late";
    const aBrake = R.brakeShare * surf.mu * G * (late ? R.lateFactor : 1);
    const aLat = cfg.grip * surf.mu * G * (late ? R.lateGrip : 1);

    // State
    const holdNow = dist < R.holdRange && tSpeed < R.holdSpeed + (this.state === "holding" ? 1.5 : 0);
    const prev = this.state;
    this.state = holdNow ? "holding" : dist < R.closeRange + (prev === "closing" ? 15 : 0) ? "closing" : "chasing";
    if (this.state !== "closing") { this._side = 0; this._block = Infinity; }

    let gx = q.x, gz = q.z, want = Infinity, hold = false, roadMode = false;
    const look = clamp(6 + speed * 0.9, 7, 40);
    // Target heading
    let hx, hz;
    if (tSpeed > 2) { hx = q.vx / tSpeed; hz = q.vz / tSpeed; }
    else if (t.vehicle) { const ty = t.vehicle.yaw; hx = Math.sin(ty); hz = Math.cos(ty); }
    else { hx = dist > 0.01 ? dx / dist : 0; hz = dist > 0.01 ? dz / dist : 1; }
    const along = -(dx * hx + dz * hz), lat = -(dx * hz - dz * hx);     // me in the target's frame (+lat = its left)

    if (this.state === "holding") {
      const D = R.holdDistance;
      let sx, sz;
      if (along > 1) { sx = q.x + hx * D; sz = q.z + hz * D; }                 // I am ahead of it: block its nose
      else { const k = dist > 0.01 ? D / dist : 0; sx = q.x - dx * k; sz = q.z - dz * k; }
      const d = Math.hypot(sx - p.x, sz - p.z);
      if (dist <= D + 1.2 || d < 1.5) hold = true;
      else { gx = sx; gz = sz; want = Math.min(9, Math.sqrt(2 * 2.2 * Math.max(0, d - 0.5)) + 0.6); }
    } else if (this.state === "closing") {
      const tAlong = tSpeed;
      if (!this._side) {
        const off = q.x - g.roadX(q.z);
        this._side = Math.abs(lat) > 1.2 ? Math.sign(lat) : Math.abs(off) < 9 ? (Math.sign(-off * hz) || 1) : (this.roll() < 0.5 ? -1 : 1);
      }
      const side = this._side, W = 3.3;
      if (along < 4.5) {
        // Behind or alongside: come up beside it
        const a = along + Math.max(10, speed * 0.8);
        gx = q.x + hx * a + hz * side * W; gz = q.z + hz * a - hx * side * W;
        want = tAlong + clamp((6 - along) * 0.5, 2, 9);
        this._block = Infinity;
      } else {
        // Ahead: move over in front of it and slow down, so it has to slow, swerve or hit a real car
        const w = W * clamp(1 - (along - 4.5) / 6, 0, 1), a = along + 12;
        gx = q.x + hx * a + hz * side * w; gz = q.z + hz * a - hx * side * w;
        if (this._block === Infinity) this._block = Math.max(tAlong, speed);
        if (Math.abs(lat) < 2.6) this._block = Math.max(Math.max(0, tAlong - 6), this._block - 1.6 * dt);
        want = Math.max(0, Math.min(tAlong + (9 - along) * 0.8, this._block));
      }
    } else {
      // Chasing: along the road when the target is on / near it and further along, otherwise straight for an intercept
      const tOff = Math.abs(q.x - g.roadX(q.z)), mOff = Math.abs(p.x - g.roadX(p.z));
      if (tOff < 9 && mOff < 30 && Math.abs(dz) > look + 8) {
        roadMode = true;
        const dir = dz > 0 ? 1 : -1;
        gz = p.z + dir * look;
        let lane = -2 * dir;                                              // right-hand lane for the way we are going
        if (m && m.kind === "wide") lane += m.sign * (R.wideMetres[0] + (R.wideMetres[1] - R.wideMetres[0]) * m.mag);
        gx = g.roadX(gz) + lane;
        // Bends ahead: no faster than can still be braked down to each bend's cornering speed
        for (const s of [0, 12, 25, 40, 60, 85, 115, 150]) {
          const z = p.z + dir * s;
          const k = Math.abs(g.roadX(z + 10) - 2 * g.roadX(z) + g.roadX(z - 10)) / 100;
          if (k < 1e-5) continue;
          const vc = Math.sqrt(aLat / k);
          want = Math.min(want, Math.sqrt(vc * vc + 2 * aBrake * s));
        }
      } else {
        const ti = clamp(dist / Math.max(8, speed), 0, 3) * 0.7;
        gx = q.x + q.vx * ti; gz = q.z + q.vz * ti;
      }
    }
    if (v.surface !== "asphalt" && v.surface !== "concrete") want = Math.min(want, R.offroadTop);

    if (hold) {
      plan.hold = true; plan.v = 0; plan.bearing = yaw; plan.look = look;
      this.stoppedNearTarget = speed < 0.5 && dist <= R.holdDistance + 2;
      return;
    }
    this.stoppedNearTarget = false;

    // ── Avoidance fan: the smallest clear deviation from the wanted bearing; else the longest run, braking for it ──
    let bearing = Math.atan2(gx - p.x, gz - p.z);
    if (m && m.kind === "wide" && !roadMode) bearing += m.sign * (0.08 + 0.1 * m.mag);
    const goalD = Math.hypot(gx - p.x, gz - p.z);
    let sight = clamp(10 + speed * 0.5 + (speed * speed) / (2 * aBrake), 14, 120);
    if (this.state === "holding") sight = Math.min(sight, Math.max(4, goalD));
    const list = this._obstacles(p.x + Math.sin(bearing) * sight * 0.5, p.z + Math.cos(bearing) * sight * 0.5, sight * 0.5 + 8);
    const probe = this._probeOut || (this._probeOut = { free: 0, blocker: null });
    let best = -Infinity, bestOff = 0, bestFree = 0, bestBlock = null;
    outer:
    for (const a of FAN) {
      for (const sgn of a ? [this._fanSide, -this._fanSide] : [1]) {
        const off = a * sgn;
        this._probe(bearing + off, sight, list, probe);
        const score = probe.free - a * 14;
        if (score > best) { best = score; bestOff = off; bestFree = probe.free; bestBlock = probe.blocker; }
        if (probe.free >= sight - 0.01) break outer;
      }
    }
    if (bestOff) this._fanSide = Math.sign(bestOff);
    bearing += bestOff;
    if (bestFree < sight - 0.01) {
      // Cannot clear it: slow to what the obstacle is doing (a moving car ahead) or stop short of it
      let vo = 0;
      const ov = bestBlock && bestBlock.vehicle;
      if (ov) vo = Math.max(0, ov.vel.x * Math.sin(bearing) + ov.vel.z * Math.cos(bearing));
      want = Math.min(want, Math.sqrt(vo * vo + 2 * aBrake * Math.max(0, bestFree - 4)) + (bestFree > 5 ? 1.2 : 0));
    }
    // Cornering: the turn needed to reach the aim point at this look-ahead
    const ang = wrap(bearing - yaw);
    const kappa = (2 * Math.abs(Math.sin(ang))) / look + (Math.abs(ang) > 1.4 ? 0.2 : 0);
    if (kappa > 1e-4) want = Math.min(want, Math.max(3, Math.sqrt(aLat / kappa)));
    plan.hold = false; plan.bearing = bearing; plan.look = look; plan.v = want;
  }

  // ── Controls (every frame) ────────────────────────────────────────────────────────────────────────────────
  _drive(dt) {
    const v = this.vehicle, plan = this._plan, d = v.def, m = this._mistake;
    if (plan.hold) {
      this._brake();
      if (Math.abs(v.speed) < 0.5 && this.state === "holding") this.stoppedNearTarget = true;
      return;
    }
    const ang = wrap(plan.bearing - v.yaw), sp = v.speed;
    const delta = Math.atan((d.wheelbase * 2 * Math.sin(clamp(ang, -1.5, 1.5))) / plan.look);
    const maxSteer = Math.min(d.steerLock, Math.atan((d.wheelbase * 11.3) / Math.max(1, sp * sp)));
    let steer = (delta / maxSteer) * (m && m.kind === "over" ? PURSUIT_RULES.overGain : 1);
    if (Math.abs(ang) > 1.5) steer = Math.sign(ang);
    if (sp < -0.5) steer = -steer;                       // rolling backwards: steer the other way
    steer = clamp(steer, -1, 1);
    const err = plan.v - sp;
    let thr = 0;
    if (err > 0.3) thr = clamp(err * 0.35, 0.1, this.cfg.pace);
    else if (err < -1.2 && sp > 1) thr = -clamp((-err - 0.6) * 0.4, 0.15, 1);
    this._set(thr, steer, false);
  }

  // ── Crash / stuck recovery ────────────────────────────────────────────────────────────────────────────────
  _noseIn() {
    const v = this.vehicle, yaw = v.yaw, s = Math.sin(yaw), c = Math.cos(yaw), d = v.def;
    const list = this._obstacles(v.pos.x, v.pos.z, 12);
    if (!list.length) return false;
    const y = v.pos.y - d.comH;
    for (const a of [d.zFront + 0.4, d.zFront + 1.6, d.zFront + 2.8]) {
      if (this._hitAt(v.pos.x + s * a, v.pos.z + c * a, d.halfW * 0.9, list, y + 0.3, y + d.height)) return true;
    }
    return false;
  }
  _startRecovery(crash) {
    const v = this.vehicle;
    this._rec = { phase: crash ? "pause" : "reverse", t: crash ? PURSUIT_RULES.recoverPause * (0.8 + 0.6 * this.roll()) : PURSUIT_RULES.reverseFor,
      x: v.pos.x, z: v.pos.z, flip: this.history.tries % 2 === 0 && !crash ? -1 : 1 };
    this.state = "recovering"; this.stoppedNearTarget = false;
    emit("pursuer:recovering", { id: this.id });
  }
  _endRecovery() {
    this._rec = null; this._planT = 0; this._plan.hold = true; this._plan.v = 0;
    this.history.ax = this.vehicle.pos.x; this.history.az = this.vehicle.pos.z; this.history.stuckTime = 0;
    this.state = "chasing";
    emit("pursuer:recovered", { id: this.id });
  }
  _recover(dt, t) {
    const v = this.vehicle, r = this._rec, R = PURSUIT_RULES;
    r.t -= dt;
    if (r.phase === "pause") {
      this._brake();
      if (r.t <= 0) {
        if (this._noseIn()) { r.phase = "reverse"; r.t = R.reverseFor; r.x = v.pos.x; r.z = v.pos.z; }
        else this._endRecovery();
      }
      return;
    }
    // Back out, swinging the nose towards the target
    const ang = wrap(Math.atan2(t.pos.x - v.pos.x, t.pos.z - v.pos.z) - v.yaw);
    this._set(v.speed > 0.6 ? -1 : -0.7, -(Math.sign(ang) || 1) * r.flip, false);
    if (r.t <= 0 || Math.hypot(v.pos.x - r.x, v.pos.z - r.z) > R.reverseMetres) this._endRecovery();
  }

  _disable(reason) {
    this.state = "disabled"; this.disabledReason = reason; this.stoppedNearTarget = false; this._rec = null;
    this.dispose();
    emit("pursuer:disabled", { id: this.id, reason });
  }

  // ── Persistence ───────────────────────────────────────────────────────────────────────────────────────────
  serialize() {
    return {
      v: 2, state: this.state, disabledReason: this.disabledReason, rs: this._rs, history: { ...this.history },
      mistakeIn: this._mistakeIn, mistake: this._mistake ? { ...this._mistake } : null, rec: this._rec ? { ...this._rec } : null,
      side: this._side, block: this._block === Infinity ? null : this._block, fanSide: this._fanSide, ignT: this._ignT,
      stopped: this.stoppedNearTarget, hold: this._plan.hold,
    };
  }
  restore(rec) {
    if (!rec) return this;
    const num = (x, def) => (typeof x === "number" && isFinite(x) ? x : def);
    this._rs = (num(rec.rs, num(rec.random, this._rs)) >>> 0) || 1;
    const h = rec.history || {}, me = this.history;
    for (const k of ["stuckTime", "tries", "ax", "az", "sx", "sz"]) me[k] = num(h[k], me[k]);
    this._mistakeIn = num(rec.mistakeIn, this._mistakeIn);
    const m = rec.mistake;
    this._mistake = m && typeof m.kind === "string" ? { kind: m.kind, t: num(m.t, 0), mag: num(m.mag, 0.5), sign: m.sign < 0 ? -1 : 1 } : null;
    const r = rec.rec;
    this._rec = r && (r.phase === "pause" || r.phase === "reverse") ? { phase: r.phase, t: num(r.t, 0), x: num(r.x, this.vehicle.pos.x), z: num(r.z, this.vehicle.pos.z), flip: r.flip < 0 ? -1 : 1 } : null;
    this._side = num(rec.side, 0); this._block = num(rec.block, Infinity); this._fanSide = rec.fanSide < 0 ? -1 : 1;
    this._ignT = num(rec.ignT, 0);
    const states = ["idle", "chasing", "closing", "holding", "recovering", "disabled"];
    this.state = states.includes(rec.state) ? rec.state : "idle";
    if (this.state === "recovering" && !this._rec) this.state = "chasing";
    this.disabledReason = typeof rec.disabledReason === "string" ? rec.disabledReason : null;
    if (this.disabledReason) this.state = "disabled";
    this.stoppedNearTarget = !!rec.stopped && this.state === "holding";
    this._plan.hold = rec.hold !== false; this._plan.v = 0; this._planT = 0;
    this._seen = this.vehicle.impactSum || 0; this._impSum = 0; this._impT = 0; this._obs.length = 0;
    if (!this.canContinue) this.dispose();
    return this;
  }
  // Let go of the vehicle (also called by the owner when the driver gets out): controls released, handbrake on.
  dispose() {
    const v = this.vehicle;
    v.ai = null; v.pinned = false; v.parkingBrake = true;
    if (v.seats.driver === this.driver && this.driver !== "player") v.releaseSeat("driver");
  }
}
