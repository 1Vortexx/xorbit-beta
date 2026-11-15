// Long Haul – where a roadblock stands and what it is made of. Pure (no THREE, no DOM): terrain math, the
// deterministic scenery colliders of scatter.js and collide.js only, so the same site is found on every machine,
// at any graphics quality, whether or not the chunk is streamed in yet.
import { CHUNK, ROAD_HALF, SHOULDER, heightAt, roadX, roadDir } from "../world/terrain.js";
import { scatter } from "../world/scatter.js";
import { circleFree, pathBlocked } from "../core/collide.js";

// Roadblock frame: `along` = distance down the road (towards +z), `across` = to the left of it.
export function coords(r, across, along) {
  const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
  return { x: r.x + c * across + s * along, z: r.z - s * across + c * along };
}
export function relative(r, p) {
  const c = Math.cos(r.yaw), s = Math.sin(r.yaw), dx = p.x - r.x, dz = p.z - r.z;
  return { across: dx * c - dz * s, along: dx * s + dz * c };
}

// Static scenery colliders (boulders, cacti, rails, sign posts, fences) near a point, straight from the seed.
const cache = new Map();
let cacheKey = null;
export function sceneryColliders(x, z, r, out = []) {
  const key = roadX(12345.6);                      // changes with the world seed
  if (key !== cacheKey) { cache.clear(); cacheKey = key; }
  for (let k = Math.floor((z - r) / CHUNK); k <= Math.floor((z + r) / CHUNK); k++) {
    if (!cache.has(k)) { if (cache.size > 24) cache.clear(); let list = []; try { list = scatter(k).colliders; } catch (e) { list = []; } cache.set(k, list); }
    for (const o of cache.get(k)) {
      const rr = r + (o.kind === "box" ? Math.hypot(o.hx, o.hz) : o.r);
      if ((o.x - x) ** 2 + (o.z - z) ** 2 <= rr * rr) out.push(o);
    }
  }
  return out;
}

const EDGE = ROAD_HALF + SHOULDER;                 // 6.5 m: outer edge of the gravel shoulder
export const SPAN = 8.2;                           // the barricade closes the road out to this far each side
const slopeOk = (x, z, max) => {
  const e = 1.5;
  return Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e) <= max;
};

// Can a vehicle leave the road before the line, pass it off-road on this side (±1) and rejoin? → lane offset or 0
export function sidePassable(site, side, colliders) {
  for (const lane of [12, 16, 20, 25, 30]) {
    let ok = true;
    for (let a = -32; a <= 32 && ok; a += 4) {
      const p = coords(site, side * lane, a);
      ok = slopeOk(p.x, p.z, 0.32) && circleFree(p.x, p.z, 1.7, colliders);
    }
    if (!ok) continue;
    // … and the way off the asphalt and back on is not fenced by a rail or rocks
    const a0 = coords(site, side * 2, -44), a1 = coords(site, side * lane, -30), b0 = coords(site, side * lane, 30), b1 = coords(site, side * 2, 44);
    if (pathBlocked(a0.x, a0.z, a1.x, a1.z, 1.3, colliders) || pathBlocked(b0.x, b0.z, b1.x, b1.z, 1.3, colliders)) continue;
    return lane;
  }
  return 0;
}

// How good is a stretch for a roadblock? Straight enough to see and stop, flat enough to park, clear of scenery
// on the road and shoulders, room to turn around, and open desert on at least one side.
export function checkSite(z, getColliders = sceneryColliders) {
  const d = roadDir(z), site = { x: roadX(z), z, yaw: Math.atan2(d.x, d.z) };
  let bend = 0;
  for (const a of [-90, -45, 45, 90]) bend = Math.max(bend, Math.abs(relative(site, { x: roadX(z + a), z: z + a }).across) / (Math.abs(a) / 45));
  const grade = Math.abs(heightAt(roadX(z + 25), z + 25) - heightAt(roadX(z - 25), z - 25)) / 50;
  const cols = getColliders(site.x, site.z, 70, []);
  let clear = true;
  for (let a = -30; a <= 30 && clear; a += 3) for (const x of [-6, -3, 0, 3, 6]) { const p = coords(site, x, a); if (!circleFree(p.x, p.z, 1.6, cols)) { clear = false; break; } }
  const left = sidePassable(site, 1, cols), right = sidePassable(site, -1, cols);
  const ok = bend < 2.6 && grade < 0.09 && clear && (left > 0 || right > 0);
  return { ...site, ok, bend, grade, clear, left, right };
}

// The schedule gives a position; slide along the road in a fixed order until the stretch is usable.
// Deterministic: no random numbers, only terrain and scenery. Falls back to the least bad candidate.
export const SITE_OFFSETS = [0, 40, -40, 80, -80, 120, -120, 160, -160, 200];
export function findSite(z, getColliders = sceneryColliders) {
  let best = null, bestScore = Infinity;
  for (const off of SITE_OFFSETS) {
    const s = checkSite(z + off, getColliders);
    s.moved = off;
    if (s.ok) return s;
    const score = (s.left || s.right ? 0 : 100) + (s.clear ? 0 : 30) + s.bend * 4 + s.grade * 200;
    if (score < bestScore) { bestScore = score; best = s; }
  }
  return best;
}

// Everything that stands at a roadblock. rec: { x, z, yaw, side (±1: which side the crew's cars are parked on) }
// → { pieces: [{ id, kind: "saw"|"barrel"|"fire", across, along, x, z, yaw, gate }],     breakable colliders
//     signs:  [{ id, x, z, yaw, text }],  flares: [{ id, x, z }],                         seen from 250 m, both ways
//     cars:   [{ x, z, yaw }, { x, z, yaw }],  posts: [{ x, z, yaw }]                     crew parking and standing spots
//     gateOpen: [{ id, across, along, turn }] }                                          where gate pieces go when opened
export function planLayout(rec) {
  const side = rec.side < 0 ? -1 : 1, pieces = [];
  const add = (id, kind, across, along, gate = false) => { const p = coords(rec, across, along); pieces.push({ id, kind, across, along, x: p.x, z: p.z, yaw: rec.yaw, gate }); };
  // Across the lanes: sawhorses with a barrel between them – the part that opens when the crew is satisfied
  add("g0", "saw", -1.95, 0, true); add("g1", "barrel", 0, 0, true); add("g2", "saw", 1.95, 0, true);
  // Lane edges and shoulders: barrels, then a burning barrel marking each end (visible at night from far away)
  add("b0", "barrel", -3.9, 0); add("b1", "barrel", 3.9, 0);
  add("b2", "barrel", -5.0, 0.5); add("b3", "barrel", 5.0, 0.5);
  add("b4", "barrel", -6.1, 0.2); add("b5", "barrel", 6.1, 0.2);
  add("f0", "fire", -(SPAN - 0.9), -0.4); add("f1", "fire", SPAN - 0.9, -0.4);

  const signs = [], flares = [];
  for (const dir of [-1, 1]) {                       // dir −1: seen by traffic heading +z, +1: by traffic heading −z
    for (const [dist, text] of [[250, "ROADBLOCK AHEAD"], [140, "STOP AHEAD"]]) {
      const z = rec.z + dir * dist, d = roadDir(z), off = dir * (EDGE + 2.1);   // the driver's right-hand side
      signs.push({ id: `s${dir < 0 ? "a" : "b"}${dist}`, x: roadX(z) + d.z * off, z: z - d.x * off, yaw: Math.atan2(d.x, d.z) + (dir < 0 ? Math.PI : 0), text });
    }
    for (const dist of [90, 45]) {
      const z = rec.z + dir * dist, d = roadDir(z);
      for (const e of [-1, 1]) flares.push({ id: `x${dir < 0 ? "a" : "b"}${dist}${e < 0 ? "r" : "l"}`, x: roadX(z) + d.z * e * (ROAD_HALF + 0.4), z: z - d.x * e * (ROAD_HALF + 0.4) });
    }
  }
  // Crew cars: beside the lanes just past the line, noses turned in towards the road
  const cars = [[7, 0.3], [16, 0.2]].map(([along, turn]) => ({ ...coords(rec, side * 6, along), yaw: rec.yaw - side * turn }));
  const back = rec.yaw + Math.PI;
  const posts = [
    { ...coords(rec, side * 5.0, -3), yaw: back },          // leader: at the roadside by the barricade
    { ...coords(rec, side * 8.0, 15), yaw: back },          // guard by the second car
    { ...coords(rec, -side * 5.4, -2.2), yaw: back },       // guard on the far shoulder
    { ...coords(rec, side * 8.0, 6), yaw: back },           // guard by the first car
  ];
  const gateOpen = [{ id: "g0", across: -3.2, along: -1.6, turn: 1.35 }, { id: "g1", across: -3.3, along: 1.3, turn: 0 }, { id: "g2", across: 3.2, along: -1.6, turn: -1.35 }];
  return { pieces, signs, flares, cars, posts, gateOpen };
}

// Where the leader steps out to stop traffic coming from `approach` (−1: from −z, +1: from +z)
export function stepOutSpot(rec, approach) { return coords(rec, (rec.side < 0 ? -1 : 1) * 1.6, approach * 4.5); }
