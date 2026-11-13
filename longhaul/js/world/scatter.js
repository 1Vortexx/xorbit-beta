// Long Haul – deterministic scenery placement for one chunk. Pure (no THREE): positions, colliders and the line
// work (wires, rails, signs). Quality options never change what this returns; they only change how much is drawn.
import { CHUNK, ROAD_HALF, getSeed, rng, roadX, roadDir, roadSlope, regionWeights, hash01 } from "./base.js";
import { heightAt, featureClear } from "./terrain.js";
import { sitesBetween } from "./sites.js";

// type → [candidates per chunk, min offset, max offset, density per region (scrub, dunes, flats, rocky), collider radius factor]
export const TYPES = {
  grass:   { n: 260, min: 7.5, max: 260, dens: [1, 0.3, 0.1, 0.5], deco: true },
  bush:    { n: 110, min: 8, max: 320, dens: [1, 0.12, 0.06, 0.5], deco: true },
  pebble:  { n: 70, min: 7.5, max: 260, dens: [0.5, 0.1, 0.2, 1], deco: true },
  boulder: { n: 22, min: 11, max: 420, dens: [0.35, 0.06, 0.05, 1], coll: 0.8 },
  saguaro: { n: 12, min: 12, max: 380, dens: [0.7, 0.05, 0, 0.5], coll: 0.3 },
  pear:    { n: 16, min: 10, max: 300, dens: [0.8, 0.05, 0, 0.4], coll: 0.55 },
  joshua:  { n: 7, min: 13, max: 380, dens: [0.75, 0, 0, 0.15], coll: 0.28 },
  spire:   { n: 5, min: 45, max: 520, dens: [0.03, 0, 0, 1], coll: 0.7 },
};
const curvature = (z) => (roadSlope(z + 6) - roadSlope(z - 6)) / 12;
const _w = [0, 0, 0, 0];

export function scatter(k) {
  const z0 = k * CHUNK, rand = rng((Math.imul(k, 7919) ^ Math.imul(getSeed(), 31337)) >>> 0);
  const inst = {}, colliders = [];
  for (const [type, T] of Object.entries(TYPES)) {
    const a = inst[type] = [];
    for (let i = 0; i < T.n; i++) {
      const z = z0 + rand() * CHUNK, side = rand() < 0.5 ? -1 : 1, t = rand(), u = rand(), sc = rand(), yaw = rand() * 6.283, tint = rand();
      const x = roadX(z) + side * (T.min + (T.max - T.min) * Math.pow(t, 1.7));
      const w = regionWeights(x, z, _w);
      if (u > w[0] * T.dens[0] + w[1] * T.dens[1] + w[2] * T.dens[2] + w[3] * T.dens[3]) continue;
      let s;
      if (type === "boulder") s = 0.7 + sc * sc * 2.6; else if (type === "spire") s = 0.8 + sc * 1.6; else if (type === "pebble") s = 0.25 + sc * 0.45; else s = 0.75 + sc * 0.6;
      const r = T.coll ? T.coll * s : 0;
      if (!featureClear(x, z, 1.5 + r)) continue;
      a.push(x, heightAt(x, z), z, s, yaw, tint);
      if (r) colliders.push({ kind: "circle", x, z, r });
    }
  }

  // Telephone poles every 50 m on the +x side; wires run to the next standing pole.
  const poleAt = (n) => {
    const z = n * 50 + 25, d = roadDir(z), x = roadX(z) + d.z * 11.5, pz = z - d.x * 11.5;
    if (!featureClear(x, pz, 2.5)) return null;
    return { x, y: heightAt(x, pz), z: pz, yaw: Math.atan2(d.x, d.z) };
  };
  const poles = [], wires = [];
  for (let n = Math.floor(z0 / 50); n * 50 + 25 < z0 + CHUNK; n++) {
    if (n * 50 + 25 < z0) continue;
    const p = poleAt(n);
    if (!p) continue;
    poles.push(p);
    colliders.push({ kind: "circle", x: p.x, z: p.z, r: 0.2 });
    for (let m = n + 1; m <= n + 4; m++) { const q = poleAt(m); if (q) { wires.push([p, q]); break; } }
  }

  // Guard rails on the outside of sharp bends (4 m segments)
  const rails = [];
  for (let z = z0; z < z0 + CHUNK; z += 4) {
    const c = curvature(z + 2);
    if (Math.abs(c) < 0.0021) continue;
    const side = c > 0 ? -1 : 1;                  // road bends towards +x → outside is −x
    const pt = (zz) => { const d = roadDir(zz), o = side * (ROAD_HALF + 1.7); return { x: roadX(zz) + d.z * o, z: zz - d.x * o }; };
    const a = pt(z), b = pt(z + 4);
    if (!featureClear(a.x, a.z, 6) || !featureClear(b.x, b.z, 6)) continue;
    a.y = heightAt(a.x, a.z); b.y = heightAt(b.x, b.z);
    rails.push([a, b]);
    colliders.push({ kind: "box", x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, hx: 0.12, hz: Math.hypot(b.x - a.x, b.z - a.z) / 2, yaw: Math.atan2(b.x - a.x, b.z - a.z), y0: Math.min(a.y, b.y) - 1, y1: Math.max(a.y, b.y) + 0.85 });
  }

  // Signs: { key (board atlas cell) | km, x, y, z, yaw (facing), w, h, post }
  const signs = [];
  const roadside = (z, side, off, key, w, h, base = 1.5, extra = {}) => {
    const d = roadDir(z), x = roadX(z) + d.z * side * off, pz = z - d.x * side * off;
    if (!featureClear(x, pz, 2)) return;
    signs.push({ key, x, y: heightAt(x, pz), z: pz, yaw: Math.atan2(d.x, d.z) + Math.PI, w, h, base, ...extra });
    colliders.push({ kind: "circle", x, z: pz, r: 0.12 });
  };
  for (const s of sitesBetween(z0 + 1900, z0 + CHUNK + 2100)) {
    if (s.kind !== "station") continue;
    for (const [dist, key] of [[2000, "fuel2"], [500, "fuel500"]]) { const z = s.zRoad - dist; if (z >= z0 && z < z0 + CHUNK) roadside(z, -1, 7.6, key, 1.5, 1.1); }
  }
  for (const s of sitesBetween(z0 + 300, z0 + CHUNK + 700)) {
    const z = s.zRoad - 450;
    if (z < z0 || z >= z0 + CHUNK) continue;
    if (s.kind === "diner") roadside(z, -1, 7.6, "food", 1.7, 0.85); else if (s.kind === "motel") roadside(z, -1, 7.6, "lodging", 1.7, 0.85);
  }
  for (const s of sitesBetween(z0 - 400, z0 + CHUNK + 400)) {
    if (s.route && s.zRoad >= z0 && s.zRoad < z0 + CHUNK && s.kind !== "wreck") roadside(s.zRoad - 9, s.side, 8.5, "dirt", 0.9, 0.45, 1.0);
  }
  // kilometre boards, speed limit, curve chevrons
  for (let z = Math.ceil(z0 / 1000) * 1000; z < z0 + CHUNK; z += 1000) if (z > 0) roadside(z + 3, -1, 7.2, null, 0.62, 0.34, 1.0, { km: Math.round(z / 1000) });
  if (((k % 25) + 25) % 25 === 3) roadside(z0 + 90, -1, 7.4, "speed", 0.7, 0.84);
  for (let z = z0; z < z0 + CHUNK; z += 40) {
    const c0 = Math.abs(curvature(z)), c1 = curvature(z + 110);
    if (c0 < 0.0014 && Math.abs(c1) > 0.0024) roadside(z, -1, 7.4, c1 > 0 ? "curveL" : "curveR", 1.3, 0.65);
  }
  // Billboards
  const billboards = [];
  if (hash01(k, 301) < 0.07) {
    const z = z0 + 40 + hash01(k, 302) * 120, side = hash01(k, 303) < 0.5 ? -1 : 1, off = 20 + hash01(k, 304) * 14, d = roadDir(z);
    const x = roadX(z) + d.z * side * off, pz = z - d.x * side * off;
    if (featureClear(x, pz, 8)) {
      const yaw = Math.atan2(d.x, d.z) + Math.PI + side * 0.35;
      billboards.push({ x, y: heightAt(x, pz), z: pz, yaw, key: "bb" + Math.floor(hash01(k, 305) * 6) });
      for (const e of [-3, 3]) colliders.push({ kind: "circle", x: x + Math.cos(yaw) * e, z: pz - Math.sin(yaw) * e, r: 0.2 });
    }
  }
  // Ranch fence stretches in the scrub (posts + wire), 17 m off the road
  const fence = [];
  const fside = hash01(Math.floor(k / 6), 310) < 0.5 ? -1 : 1;
  if (hash01(Math.floor(k / 6), 311) < 0.45) {
    for (let z = z0; z < z0 + CHUNK; z += 5) {
      const d = roadDir(z), x = roadX(z) + d.z * fside * 17, pz = z - d.x * fside * 17;
      const w = regionWeights(x, pz, _w);
      if (w[0] < 0.6 || !featureClear(x, pz, 3) || hash01(Math.floor(z / 5), 312) < 0.06) { fence.push(null); continue; }
      fence.push({ x, y: heightAt(x, pz), z: pz, lean: (hash01(Math.floor(z / 5), 313) - 0.5) * 0.25 });
    }
    // closing post so the wire reaches the next chunk
    const z = z0 + CHUNK, d = roadDir(z), x = roadX(z) + d.z * fside * 17, pz = z - d.x * fside * 17;
    fence.push(featureClear(x, pz, 3) && regionWeights(x, pz, _w)[0] >= 0.6 ? { x, y: heightAt(x, pz), z: pz, lean: 0, ghost: true } : null);
  }
  return { inst, colliders, poles, wires, rails, signs, billboards, fence };
}
