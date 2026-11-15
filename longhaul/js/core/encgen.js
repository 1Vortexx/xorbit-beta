// Long Haul – where strangers are: the deterministic schedule of roadside encounters (hitchhikers and roadblocks).
// Pure math, importable in Node. It draws from its own random stream ("enc:<seed>:…"), so adding or removing
// encounters never changes terrain, sites, loot or seeded vehicles. Graphics quality never touches it.
//
// The road is cut into slots of ENC_CELL metres. Every third slot (phase from the seed) may hold a roadblock, the
// others may hold a hitchhiker, so two encounters are never closer than ~1.2 km and roadblocks never closer than
// 3 slots. What an encounter *is* beyond its kind (toll or robbery, demands, people) is rolled by its owner from
// `seed` when the player first gets near, and persisted in ws.enc – see ARCHITECTURE.md §14.
import { getSeed, rng, hashStr, roadX, roadDir } from "../world/terrain.js";
import { sitesBetween } from "../world/sites.js";

export const ENC_CELL = 2500;
export const FIRST_HITCH_Z = 1800;        // nobody at the roadside until the player has left the start
export const FIRST_ROADBLOCK_Z = 9000;    // no roadblock before the player has driven, refuelled and scavenged
export const ROADBLOCK_CHANCE = 0.5;      // per roadblock slot (every third slot): one every ~15 km on average
export const HITCH_CHANCE = 0.42;         // per other slot: one every ~9 km on average
const SITE_CLEAR = 260;                   // keep this far (along the road) from any site pad centre

// A random stream that belongs to encounters only. key: any string, e.g. "rb12:type".
export function encRng(key) { return rng(hashStr("enc:" + getSeed() + ":" + key)); }
export function encSeed(key) { return hashStr("enc:" + getSeed() + ":" + key) >>> 0; }

const cache = new Map();
let cacheSeed = null;

function slot(i) {
  if (cacheSeed !== getSeed()) { cache.clear(); cacheSeed = getSeed(); }
  if (cache.has(i)) return cache.get(i);
  let e = null;
  if (i >= 0) {
    const R = encRng("slot" + i);
    const phase = encSeed("phase") % 3;
    const blockSlot = i % 3 === phase;
    const roll = R(), at = R(), side = R() < 0.5 ? -1 : 1;
    const kind = blockSlot ? (roll < ROADBLOCK_CHANCE ? "roadblock" : null) : (roll < HITCH_CHANCE ? "hitch" : null);
    if (kind) {
      let z = (i + 0.25 + 0.5 * at) * ENC_CELL;
      // Slide along the road until clear of site pads; give up (no encounter) rather than crowd a site.
      let ok = false;
      for (let n = 0; n < 4 && !ok; n++) {
        ok = !sitesBetween(z - SITE_CLEAR, z + SITE_CLEAR).length;
        if (!ok) z += SITE_CLEAR + 60;
      }
      const lo = (i + 0.2) * ENC_CELL, hi = (i + 0.8) * ENC_CELL;
      if (ok && z >= lo && z <= hi && z >= (kind === "roadblock" ? FIRST_ROADBLOCK_Z : FIRST_HITCH_Z)) {
        const id = (kind === "roadblock" ? "rb" : "hh") + i;
        const d = roadDir(z);
        e = { id, kind, slot: i, z, x: roadX(z), side, yaw: Math.atan2(d.x, d.z), seed: encSeed(id) };
      }
    }
  }
  cache.set(i, e);
  return e;
}

// Encounters whose road position lies in [z0, z1), ordered by z.
// → [{ id, kind: "roadblock" | "hitch", slot, z, x (road centre), side (±1: which side of the road, +1 = +x/left
//      when facing +z), yaw (road heading), seed }]
export function encountersBetween(z0, z1) {
  const out = [];
  for (let i = Math.max(0, Math.floor(z0 / ENC_CELL)); i <= Math.floor(z1 / ENC_CELL); i++) {
    const e = slot(i);
    if (e && e.z >= z0 && e.z < z1) out.push(e);
  }
  return out;
}
export function encounterById(id) {
  const m = /^(rb|hh)(\d+)$/.exec(id || "");
  if (!m) return null;
  const e = slot(Number(m[2]));
  return e && e.id === id ? e : null;
}
