// Long Haul – walking around on foot (first person)
import * as THREE from "three";
import { heightAt } from "./world.js";

const EYE = 1.68, RADIUS = 0.35;
const WALK = 3.8, SPRINT = 6.8;
const euler = new THREE.Euler(0, 0, 0, "YXZ");

export class Player {
  constructor() {
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.bob = 0;
    this.sprinting = false;
  }

  // Step out of the driver's door
  exitTruck(car) {
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(car.quat);
    side.y = 0; side.normalize();
    this.pos.copy(car.pos).addScaledVector(side, 1.9);
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quat);
    this.yaw = Math.atan2(f.x, f.z);
    this.pitch = 0;
  }

  // move: { fwd, side, sprint, turn }, colliders: [{x,z,r}], canSprint: has energy
  update(dt, move, colliders, canSprint) {
    this.yaw += move.turn * 2.2 * dt;
    this.sprinting = move.sprint && canSprint && (move.fwd || move.side);
    const speed = this.sprinting ? SPRINT : WALK;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // Forward is +z rotated by yaw; strafing left is +x rotated by yaw
    let dx = sin * move.fwd + cos * move.side;
    let dz = cos * move.fwd - sin * move.side;
    const len = Math.hypot(dx, dz);
    if (len > 0) { dx /= len; dz /= len; }
    this.pos.x += dx * speed * dt;
    this.pos.z += dz * speed * dt;
    for (const o of colliders) {
      const ox = this.pos.x - o.x, oz = this.pos.z - o.z;
      const d = Math.hypot(ox, oz), rr = RADIUS + o.r;
      if (d < rr && d > 1e-6) { this.pos.x += (ox / d) * (rr - d); this.pos.z += (oz / d) * (rr - d); }
    }
    const g = heightAt(this.pos.x, this.pos.z);
    this.pos.y += (g - this.pos.y) * Math.min(1, dt * 14);
    if (len > 0) this.bob += dt * speed * 2.1;
  }

  applyCamera(camera) {
    camera.position.set(this.pos.x, this.pos.y + EYE + Math.sin(this.bob) * 0.04, this.pos.z);
    euler.set(-this.pitch, this.yaw + Math.PI, 0); // positive pitch looks down
    camera.quaternion.setFromEuler(euler);
  }

  serialize() { return { pos: [this.pos.x, this.pos.y, this.pos.z], yaw: this.yaw }; }
  restore(d) { if (d) { this.pos.fromArray(d.pos); this.yaw = d.yaw; } }
}
