import * as THREE from "three";
import { heightAt, roadX } from "../world/terrain.js";
import { coords } from "./rules.js";

// Local meshes and absolute colliders refer to the same anchors, including after an origin shift.
export class Barrier {
  constructor(ctx, rec) {
    this.ctx = ctx;
    this.rec = rec;
    this.group = new THREE.Group();
    this.group.position.set(rec.x, 0, rec.z);
    this.solids = [];
    this.geos = [];
    this.mats = new Map();
    this.box = this.geom(new THREE.BoxGeometry(1, 1, 1));
    this.drum = this.geom(new THREE.CylinderGeometry(1, 1, 1, 12));
    for (const dist of [-220, 220]) {
      const z = rec.z + dist, x = roadX(z) + (dist < 0 ? -5 : 5);
      const sign = this.anchor(x, z);
      this.mesh(sign, this.box, 0x706652, 0, 0.78, 0, .12, 1.56, .12);
      this.mesh(sign, this.box, 0xdf9e35, 0, 1.6, 0, 1.45, .56, .08);
      for (const px of [-.42, 0, .42]) this.mesh(sign, this.box, 0x3b3128, px, 1.6, 0, .17, .49, .09).rotation.z = -.42;
    }
    for (const [i, across] of [-3.9, -1.95, 0, 1.95, 3.9].entries()) {
      if (rec.broken.includes(i)) continue;
      const barrel = i % 2 === 0;
      const { x, z } = coords(rec, across, 0);
      const base = this.anchor(x, z);
      if (barrel) {
        this.mesh(base, this.drum, 0x985535, 0, .48, 0, .34, .96, .34);
        for (const y of [.22, .7]) this.mesh(base, this.drum, 0xe1bc72, 0, y, 0, .348, .09, .348);
      } else {
        this.mesh(base, this.box, 0xe0b26a, 0, .75, 0, 2.65, .32, .12);
        for (const px of [-1, 1]) this.mesh(base, this.box, 0x805836, px, .4, 0, .11, .8, .34);
        for (const px of [-.9, -.3, .3, .9]) this.mesh(base, this.box, 0x9e4629, px, .75, 0, .2, .32, .13).rotation.z = -.4;
      }
      const col = { kind: barrel ? "circle" : "box", x, z, r: .34, hx: 1.33, hz: .17, yaw: rec.yaw,
        soundMaterial: barrel ? "metal" : "wood", y0: base.position.y, y1: base.position.y + 1, solid: true };
      col.hit = (v, speed) => {
        if (!col.solid) return 0;
        if (speed < (barrel ? 2.5 : 4)) return 1;
        col.solid = false; base.visible = false; rec.broken.push(i);
        ctx.sfx(barrel ? "barrel_hit" : "barricade_hit", { pos: v.pos, vol: Math.min(1, speed / 12) });
        return barrel ? .16 : .3;
      };
      this.solids.push(col);
    }
    ctx.root?.add(this.group);
  }
  geom(g) { this.geos.push(g); return g; }
  anchor(x, z) {
    const obj = new THREE.Group();
    obj.position.set(x - this.rec.x, heightAt(x, z), z - this.rec.z);
    obj.rotation.y = this.rec.yaw;
    this.group.add(obj);
    return obj;
  }
  mesh(base, geometry, color, x, y, z, sx, sy, sz) {
    if (!this.mats.has(color)) this.mats.set(color, new THREE.MeshStandardMaterial({ color, roughness: .82 }));
    const obj = new THREE.Mesh(geometry, this.mats.get(color));
    obj.position.set(x, y, z); obj.scale.set(sx, sy, sz);
    base.add(obj);
    return obj;
  }
  dispose() {
    this.group.removeFromParent();
    this.geos.forEach(g => g.dispose()); this.mats.forEach(m => m.dispose());
    this.solids.forEach(c => { c.solid = false; });
    this.solids.length = 0;
  }
}
