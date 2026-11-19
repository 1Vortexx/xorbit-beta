// Long Haul – a player's body: the same person model as everyone else on the road (js/npc/model.js), at the wheel
// or on foot. Used for the local player (seen in chase view, photos and as a headless driver from the cab) and for
// convoy members (js/convoy.js), so nobody drives an empty truck.
import * as THREE from "three";
import { buildPerson, pose } from "./npc/model.js";
import { hashStr } from "./world/terrain.js";

// Seated with both hands on the wheel, turning it with the steering
function drivePose(rig, steer) {
  pose(rig, "sit", 0, false, "walker");
  const s = Math.max(-1, Math.min(1, steer / 0.6));
  rig.arms[0].rotation.x = -1.12 - s * 0.22; rig.arms[1].rotation.x = -1.12 + s * 0.22;
  rig.arms[0].rotation.z = 0.32; rig.arms[1].rotation.z = -0.32;
}

const WAIST = 0.95, _waist = new THREE.Vector3();

export class Body {
  // root: the world root; name: picks the look, so a player looks the same on every screen
  constructor(root, name) {
    this.root = root;
    this.rig = buildPerson(hashStr(String(name || "driver")) || 1, "walker");
    this.mesh = this.rig.mesh;
    this.mesh.name = "body:" + name;
    this.phase = 0;
    root.add(this.mesh);
  }
  // s: { vehicle?, seat?, pos?, yaw?, speed?, steer?, crawl?, thrown? } – in a vehicle seat, standing/walking (or
  // crawling) at pos, or thrown from a crash: thrown = { spin, settled } with pos the body's middle
  update(dt, s) {
    const v = s.vehicle;
    if (s.thrown) {
      if (this.mesh.parent !== this.root) this.root.add(this.mesh);
      const t = s.thrown;
      if (t.settled) {
        // Lying still, face down, arms and legs where they fell
        pose(this.rig, "down", 0, false, "walker");
        this.mesh.rotation.set(0, s.yaw || 0, 0);
        this.mesh.position.set(s.pos.x, s.pos.y - 0.16, s.pos.z);
        this.rig.arms[0].rotation.set(-2.2, 0, -0.5); this.rig.arms[1].rotation.set(-2.9, 0, 0.35);
        this.rig.legs[0].rotation.x = 0.15; this.rig.legs[1].rotation.x = -0.25; this.rig.knees[1].rotation.x = 0.6;
        return;
      }
      // Head over heels about the waist, limbs flung out
      pose(this.rig, "idle", 0, false, "walker");
      this.rig.arms[0].rotation.set(-1.1, 0, -1.3); this.rig.arms[1].rotation.set(-1.6, 0, 1.2);
      this.rig.legs[0].rotation.x = 0.5; this.rig.legs[1].rotation.x = -0.4; this.rig.knees[0].rotation.x = 0.7;
      this.mesh.rotation.set(t.spin, s.yaw || 0, 0, "YXZ");
      _waist.set(0, WAIST, 0).applyEuler(this.mesh.rotation);
      this.mesh.position.set(s.pos.x - _waist.x, s.pos.y - _waist.y, s.pos.z - _waist.z);
      return;
    }
    this.mesh.rotation.order = "XYZ";
    if (v) {
      const seat = v.def.seats[s.seat] ? s.seat : "driver";
      if (this.mesh.parent !== v.mesh) v.mesh.add(this.mesh);
      this.mesh.position.fromArray(v.def.seats[seat].pos);
      this.mesh.rotation.set(0, 0, 0);
      if (seat === "driver") drivePose(this.rig, s.steer ?? v.steer ?? 0);
      else pose(this.rig, "sit", 0, false, "walker");
    } else {
      if (this.mesh.parent !== this.root) this.root.add(this.mesh);
      const speed = s.speed || 0, moving = speed > (s.crawl ? 0.15 : 0.3);
      if (moving) this.phase += dt * (s.crawl ? 4 : speed > 4 ? 10 : 6.5);
      this.mesh.position.copy(s.pos);
      this.mesh.rotation.set(0, s.yaw || 0, 0);
      pose(this.rig, s.crawl ? "down" : moving ? "walk" : "idle", this.phase, moving, "walker");
      if (s.crawl) for (let i = 0; i < 2; i++) {             // dragging along on the forearms
        const a = moving ? Math.sin(this.phase + i * Math.PI) : 0;
        this.rig.arms[i].rotation.x = -2.6 + a * 0.45;
      }
    }
  }
  // full | headless (the camera sits in the head) | hidden
  show(mode) {
    this.mesh.visible = mode !== "hidden";
    this.rig.head.visible = mode === "full";
  }
  dispose() { this.mesh.parent?.remove(this.mesh); }
}
