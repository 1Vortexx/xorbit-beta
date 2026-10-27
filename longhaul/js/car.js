// Long Haul – pickup truck: low-poly model and a small raycast-suspension vehicle model
import * as THREE from "three";
import { heightAt, normalAt, onRoad, roadX, roadY, roadDir } from "./world.js";

export const TANK = 60;          // litres
const MASS = 1400;
const INERTIA = new THREE.Vector3(2980, 3100, 720); // pitch (x), yaw (y), roll (z)
const GRAVITY = 9.81;
const SPRING = 30000, DAMPER = 3000;
const REST = 0.45, RADIUS = 0.38, MOUNT_Y = -0.25;
const ENGINE_F = 7000, VMAX = 36, REVERSE_MAX = 8;
const BRAKE_F = 4000;            // per wheel
const DRAG = 0.42;

const WHEELS = [
  { x: 0.85, z: 1.4, front: true },
  { x: -0.85, z: 1.4, front: true },
  { x: 0.85, z: -1.35, front: false },
  { x: -0.85, z: -1.35, front: false },
];
// Body points that push back if the truck ends up on its side or roof
const HULL = [
  [0.95, -0.35, 2.35], [-0.95, -0.35, 2.35], [0.95, -0.35, -2.35], [-0.95, -0.35, -2.35],
  [0.88, 1.2, 1.25], [-0.88, 1.2, 1.25], [0.88, 1.2, -0.6], [-0.88, 1.2, -0.6],
];

// Scratch vectors (no allocation in the physics loop)
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const r = new THREE.Vector3(), mp = new THREE.Vector3(), n = new THREE.Vector3(), vp = new THREE.Vector3();
const fdir = new THREE.Vector3(), sdir = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3();
const force = new THREE.Vector3(), torque = new THREE.Vector3(), tire = new THREE.Vector3(), rApply = new THREE.Vector3();
const qInv = new THREE.Quaternion(), dq = new THREE.Quaternion(), qSteer = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);

// What the truck's condition does to the physics (filled in by parts.js)
export const DEFAULT_MODS = { power: 1, grip: [1, 1, 1, 1], flat: [false, false, false, false], wet: 1, leak: 0 };
const BODY_CIRCLES = [1.35, -1.35]; // collision circles along the body (local z)
const BODY_R = 1.1;

export class Car {
  constructor(scene) {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.angVel = new THREE.Vector3();
    this.steer = 0;
    this.fuel = TANK * 0.5;
    this.odometer = 0;
    this.speed = 0;          // forward speed, m/s
    this.throttle = 0;       // smoothed 0..1 for audio
    this.grounded = 0;       // wheels touching
    this.upright = 1;
    this.running = true;     // engine running (decided by parts.js)
    this.impact = 0;         // crash severity collected since the last read
    this.flat = [false, false, false, false];
    this.wheels = WHEELS.map((w) => ({ ...w, susp: REST, spin: 0, contact: false }));
    this.mesh = this.buildMesh();
    scene.add(this.mesh);
  }

  get engineOn() { return this.running; }

  // Crash severity since the last call (used for damage)
  takeImpact() { const i = this.impact; this.impact = 0; return i; }

  buildMesh() {
    const g = new THREE.Group();
    const lam = (c, extra) => new THREE.MeshLambertMaterial(Object.assign({ color: c, flatShading: true }, extra));
    const paint = lam(0x3f7f86), trim = lam(0x2c2f33), glass = lam(0x1b2730), chrome = lam(0xb9b9b4);
    const add = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
    };
    add(new THREE.BoxGeometry(1.9, 0.7, 4.7), paint, 0, 0.05, 0);            // lower body
    add(new THREE.BoxGeometry(1.75, 0.8, 1.9), paint, 0, 0.8, 0.3);          // cab
    // Glass is hidden in the cab view so it doesn't block the camera
    this.glassMeshes = [
      add(new THREE.BoxGeometry(1.77, 0.42, 1.6), glass, 0, 0.88, 0.32),     // window band
      add(new THREE.BoxGeometry(1.6, 0.44, 0.06), glass, 0, 0.86, 1.27),     // windscreen
    ];
    add(new THREE.BoxGeometry(0.1, 0.35, 1.75), paint, 0.9, 0.58, -1.45);    // bed sides
    add(new THREE.BoxGeometry(0.1, 0.35, 1.75), paint, -0.9, 0.58, -1.45);
    add(new THREE.BoxGeometry(1.9, 0.35, 0.1), paint, 0, 0.58, -2.3);         // tailgate
    add(new THREE.BoxGeometry(1.7, 0.05, 1.7), trim, 0, 0.41, -1.45);         // bed floor
    add(new THREE.BoxGeometry(1.98, 0.22, 0.18), chrome, 0, -0.18, 2.4);      // bumpers
    add(new THREE.BoxGeometry(1.98, 0.22, 0.18), chrome, 0, -0.18, -2.4);
    this.headMat = new THREE.MeshLambertMaterial({ color: 0xfff6dc, emissive: 0x000000 });
    this.tailMat = new THREE.MeshLambertMaterial({ color: 0x7a1010, emissive: 0x000000 });
    for (const x of [0.62, -0.62]) {
      add(new THREE.BoxGeometry(0.36, 0.18, 0.06), this.headMat, x, 0.2, 2.36);
      add(new THREE.BoxGeometry(0.3, 0.16, 0.06), this.tailMat, x, 0.22, -2.36);
    }
    // Wheels: pivot (steering) → wheel (spin)
    const tyreGeo = new THREE.CylinderGeometry(RADIUS, RADIUS, 0.3, 14); tyreGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.32, 8); hubGeo.rotateZ(Math.PI / 2);
    const tyreMat = lam(0x1d1d1f), hubMat = lam(0x9a9a96);
    this.wheelMeshes = this.wheels.map((w) => {
      const pivot = new THREE.Group();
      pivot.position.set(w.x, MOUNT_Y - REST, w.z);
      const wheel = new THREE.Group();
      const t = new THREE.Mesh(tyreGeo, tyreMat); t.castShadow = true;
      const h = new THREE.Mesh(hubGeo, hubMat);
      wheel.add(t, h);
      pivot.add(wheel);
      g.add(pivot);
      return { pivot, wheel };
    });
    // Headlights
    this.lights = [];
    for (const x of [0.62, -0.62]) {
      const s = new THREE.SpotLight(0xfff1d0, 0, 90, 0.5, 0.55, 1.4);
      s.position.set(x, 0.2, 2.4);
      s.target.position.set(x * 1.4, -0.9, 26);
      g.add(s, s.target);
      this.lights.push(s);
    }
    return g;
  }

  setCabView(on) { this.glassMeshes.forEach((m) => { m.visible = !on; }); }

  setHeadlights(on, lite) {
    this.headMat.emissive.setHex(on ? 0xfff1c0 : 0x000000);
    this.tailMat.emissive.setHex(on ? 0xa01515 : 0x000000);
    this.lights.forEach((l, i) => {
      // Lite mode keeps one brighter lamp instead of two
      const use = on && (!lite || i === 0);
      l.intensity = use ? (lite ? 420 : 260) : 0;
      l.visible = use;
    });
  }

  // Put the truck on the road at (or near) z, pointing down the road
  placeOnRoad(z) {
    const dir = roadDir(z);
    this.pos.set(roadX(z) - dir.z * 2, roadY(z) + 1.05, z + dir.x * 2); // right-hand lane
    this.quat.setFromAxisAngle(Y, Math.atan2(dir.x, dir.z));
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.steer = 0;
  }

  step(dt, input, mods = DEFAULT_MODS, colliders = null) {
    up.copy(Y).applyQuaternion(this.quat);
    fwd.set(0, 0, 1).applyQuaternion(this.quat);
    this.speed = this.vel.dot(fwd);
    this.upright = up.y;

    // Steering: less lock at speed
    const maxSteer = 0.55 / (1 + Math.abs(this.speed) / 14);
    const target = input.steer * maxSteer;
    const rate = 2.6 * dt;
    this.steer += Math.max(-rate, Math.min(rate, target - this.steer));

    // Pedals
    let drive = 0, brake = 0;
    if (input.throttle > 0) {
      if (this.speed < -0.5) brake = 1;
      else if (this.engineOn) drive = ENGINE_F * mods.power * Math.max(0, 1 - this.speed / (VMAX * (0.6 + 0.4 * mods.power)));
    } else if (input.throttle < 0) {
      if (this.speed > 0.5) brake = 1;
      else if (this.engineOn) drive = -ENGINE_F * 0.6 * mods.power * Math.max(0, 1 + this.speed / REVERSE_MAX);
    } else if (Math.abs(this.speed) < 0.6) {
      brake = 1; // hold still when stopped
    }
    const hand = input.handbrake;

    force.set(0, -GRAVITY * MASS, 0);
    torque.set(0, 0, 0);
    const m4 = MASS / 4;
    const wasGrounded = this.grounded;
    const vyBefore = this.vel.y;
    this.grounded = 0;
    this.flat = mods.flat;

    for (let wi = 0; wi < 4; wi++) {
      const w = this.wheels[wi];
      r.set(w.x, MOUNT_Y, w.z).applyQuaternion(this.quat);
      mp.copy(this.pos).add(r);
      const ground = heightAt(mp.x, mp.z);
      const dist = mp.y - ground;
      const comp = REST + RADIUS - dist;
      w.contact = comp > 0;
      w.susp = Math.max(0, Math.min(REST, dist - RADIUS));
      v1.copy(this.angVel).cross(r);
      vp.copy(this.vel).add(v1);
      if (!w.contact) { w.spin += (this.speed / RADIUS) * dt; continue; }
      this.grounded++;

      normalAt(mp.x, mp.z, n);
      const N = Math.max(0, SPRING * Math.min(comp, 0.6) - DAMPER * vp.dot(n));
      v2.copy(n).multiplyScalar(N);
      force.add(v2);
      torque.add(v3.copy(r).cross(v2));

      // Tyre frame on the ground plane
      fdir.copy(fwd);
      if (w.front) fdir.applyQuaternion(qSteer.setFromAxisAngle(up, this.steer));
      fdir.addScaledVector(n, -fdir.dot(n)).normalize();
      sdir.copy(n).cross(fdir).normalize();
      const vf = vp.dot(fdir), vs = vp.dot(sdir);

      const paved = onRoad(mp.x, mp.z);
      const mu = (paved ? 1.05 : 0.75) * (hand && !w.front ? 0.55 : 1) * mods.grip[wi] * mods.wet;
      const roll = (paved ? 0.012 : 0.05) + (mods.flat[wi] ? 0.12 : 0);
      const stopF = (Math.abs(vf) * m4) / dt;

      let lat = -vs * (m4 / dt) * 0.6 * (hand && !w.front ? 0.35 : 1);
      let lon = 0;
      if (!w.front && drive) lon += drive / 2;
      const b = (hand && !w.front ? BRAKE_F * 1.6 : 0) + brake * BRAKE_F;
      lon -= Math.sign(vf) * Math.min(b + roll * N, stopF);

      const maxF = mu * N, tot = Math.hypot(lat, lon);
      if (tot > maxF) { lat *= maxF / tot; lon *= maxF / tot; }

      tire.copy(fdir).multiplyScalar(lon).addScaledVector(sdir, lat);
      force.add(tire);
      // Apply tyre forces near the centre of mass so the truck doesn't roll over too easily
      rApply.copy(r).addScaledVector(up, -r.dot(up) - 0.1);
      torque.add(v3.copy(rApply).cross(tire));

      w.spin += (vf / RADIUS) * dt;
    }

    // Hull contact (on its side / roof)
    for (const h of HULL) {
      r.set(h[0], h[1], h[2]).applyQuaternion(this.quat);
      mp.copy(this.pos).add(r);
      const pen = heightAt(mp.x, mp.z) - mp.y;
      if (pen <= 0) continue;
      v1.copy(this.angVel).cross(r);
      vp.copy(this.vel).add(v1);
      if (vp.y < -4) this.impact += (-vp.y - 4) * 3;
      const fN = Math.max(0, 80000 * pen - 6000 * Math.min(0, vp.y));
      v2.set(-vp.x * 1500, fN, -vp.z * 1500);
      force.add(v2);
      torque.add(v3.copy(r).cross(v2));
    }

    // Air drag
    force.addScaledVector(this.vel, -DRAG * this.vel.length());

    // Integrate
    this.vel.addScaledVector(force, dt / MASS);
    qInv.copy(this.quat).invert();
    v1.copy(torque).applyQuaternion(qInv);
    v2.copy(this.angVel).applyQuaternion(qInv);
    v2.x += (v1.x / INERTIA.x) * dt;
    v2.y += (v1.y / INERTIA.y) * dt;
    v2.z += (v1.z / INERTIA.z) * dt;
    v2.x *= 1 - 1.2 * dt; v2.y *= 1 - 0.4 * dt; v2.z *= 1 - 1.2 * dt;
    this.angVel.copy(v2.applyQuaternion(this.quat));

    this.pos.addScaledVector(this.vel, dt);
    dq.set(this.angVel.x * dt * 0.5, this.angVel.y * dt * 0.5, this.angVel.z * dt * 0.5, 0).multiply(this.quat);
    this.quat.set(this.quat.x + dq.x, this.quat.y + dq.y, this.quat.z + dq.z, this.quat.w + dq.w).normalize();

    // Hard landing
    if (wasGrounded < 2 && this.grounded >= 2 && vyBefore < -6) this.impact += (-vyBefore - 6) * 4;

    // Obstacles: rocks, poles, wrecks, station buildings
    if (colliders) this.collide(colliders);

    // Fuel and distance
    const sp = this.vel.length();
    this.odometer += sp * dt;
    const thr = drive ? Math.abs(input.throttle) : 0;
    if (this.engineOn) {
      this.fuel -= (0.002 + thr * 0.11 * (0.4 + 0.6 * Math.min(1, sp / VMAX))) * dt;
    }
    this.fuel = Math.max(0, this.fuel - mods.leak * dt);
    this.throttle += (thr - this.throttle) * Math.min(1, dt * 6);
  }

  collide(colliders) {
    fwd.set(0, 0, 1).applyQuaternion(this.quat);
    for (const cz of BODY_CIRCLES) {
      const cx = this.pos.x + fwd.x * cz, czw = this.pos.z + fwd.z * cz;
      for (const o of colliders) {
        const dx = cx - o.x, dz = czw - o.z;
        const d2 = dx * dx + dz * dz, rr = BODY_R + o.r;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
        this.pos.x += nx * (rr - d);
        this.pos.z += nz * (rr - d);
        // Velocity of the contact point, including spin
        const rx = fwd.x * cz - nx * BODY_R, rz = fwd.z * cz - nz * BODY_R;
        const vpx = this.vel.x + this.angVel.y * rz, vpz = this.vel.z - this.angVel.y * rx; // v + ω × r
        const vn = vpx * nx + vpz * nz;
        if (vn >= 0) continue;
        const rxn = rz * nx - rx * nz; // (r × n).y
        const J = (-(1.1) * vn) / (1 / MASS + (rxn * rxn) / INERTIA.y); // restitution 0.1
        this.vel.x += (nx * J) / MASS;
        this.vel.z += (nz * J) / MASS;
        this.angVel.y += (rxn * J) / INERTIA.y;
        if (-vn > 2.5) this.impact += (-vn - 2.5) * 2.2;
      }
    }
  }

  syncMesh() {
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.copy(this.quat);
    this.wheels.forEach((w, i) => {
      const m = this.wheelMeshes[i];
      m.pivot.position.y = MOUNT_Y - w.susp + (this.flat[i] ? 0.12 : 0);
      m.wheel.scale.set(1, this.flat[i] ? 0.7 : 1, this.flat[i] ? 0.7 : 1);
      m.pivot.rotation.y = w.front ? this.steer : 0;
      m.wheel.rotation.x = w.spin;
    });
  }

  serialize() {
    const a = (v) => [v.x, v.y, v.z];
    return {
      pos: a(this.pos), vel: a(this.vel), angVel: a(this.angVel),
      quat: [this.quat.x, this.quat.y, this.quat.z, this.quat.w],
      fuel: this.fuel, odometer: this.odometer,
    };
  }
  restore(d) {
    this.pos.fromArray(d.pos); this.vel.fromArray(d.vel); this.angVel.fromArray(d.angVel || [0, 0, 0]);
    this.quat.fromArray(d.quat).normalize();
    this.fuel = Math.max(0, Math.min(TANK, d.fuel));
    this.odometer = d.odometer || 0;
  }
}
