// Long Haul – a player's body: the same person model as everyone else on the road (js/npc/model.js), at the wheel
// or on foot. Used for the local player (seen in chase view, photos and as a headless driver from the cab) and for
// convoy members (js/convoy.js), so nobody drives an empty truck.
import { buildPerson, pose } from "./npc/model.js";
import { hashStr } from "./world/terrain.js";

// Seated with both hands on the wheel, turning it with the steering
function drivePose(rig, steer) {
  pose(rig, "sit", 0, false, "walker");
  const s = Math.max(-1, Math.min(1, steer / 0.6));
  rig.arms[0].rotation.x = -1.12 - s * 0.22; rig.arms[1].rotation.x = -1.12 + s * 0.22;
  rig.arms[0].rotation.z = 0.32; rig.arms[1].rotation.z = -0.32;
}

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
  // s: { vehicle?, seat?, pos?, yaw?, speed?, steer? } – in a vehicle seat, or standing/walking at pos
  update(dt, s) {
    const v = s.vehicle;
    if (v) {
      const seat = v.def.seats[s.seat] ? s.seat : "driver";
      if (this.mesh.parent !== v.mesh) v.mesh.add(this.mesh);
      this.mesh.position.fromArray(v.def.seats[seat].pos);
      this.mesh.rotation.set(0, 0, 0);
      if (seat === "driver") drivePose(this.rig, s.steer ?? v.steer ?? 0);
      else pose(this.rig, "sit", 0, false, "walker");
    } else {
      if (this.mesh.parent !== this.root) this.root.add(this.mesh);
      const speed = s.speed || 0, moving = speed > 0.3;
      if (moving) this.phase += dt * (speed > 4 ? 10 : 6.5);
      this.mesh.position.copy(s.pos);
      this.mesh.rotation.set(0, s.yaw || 0, 0);
      pose(this.rig, moving ? "walk" : "idle", this.phase, moving, "walker");
    }
  }
  // full | headless (the camera sits in the head) | hidden
  show(mode) {
    this.mesh.visible = mode !== "hidden";
    this.rig.head.visible = mode === "full";
  }
  dispose() { this.mesh.parent?.remove(this.mesh); }
}
