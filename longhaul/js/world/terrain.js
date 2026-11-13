// Long Haul – terrain: the one ground function for wheels, feet, props and meshes.
// Pure math (no DOM, no THREE objects) – importable in Node. Built from base.js (noise, road, regions, natural
// ground) plus the pad / side-track registry of sites.js, so roads, terrain, floors and collision always agree.
import {
  CHUNK, ROAD_HALF, SHOULDER, setSeed, getSeed, rng, hashStr, roadX, roadY, roadDir, roadFrame, terrainField,
  regionAt, regionWeights, smooth,
} from "./base.js";
import { featuresAt, padFactor, routeDistance } from "./sites.js";

export { CHUNK, ROAD_HALF, SHOULDER, setSeed, getSeed, rng, hashStr, roadX, roadY, roadDir, regionAt };

const EDGE = ROAD_HALF + SHOULDER;
const _f = { off: 0, d: 0, zc: 0 }, _r = { y: 0 }, _l = { x: 0, z: 0 };

export function heightAt(x, z) {
  const f = roadFrame(x, z, _f);
  const ry = roadY(f.zc);
  if (f.d <= EDGE) return ry;
  const d = f.d;
  let h = ry + terrainField(x, z, d), padF = 0;
  const feats = featuresAt(z);
  if (feats) for (let i = 0; i < feats.length; i++) {
    const ft = feats[i];
    if (ft.type === "route") {
      const dist = routeDistance(ft, x, z, _r);
      if (dist < ft.half + 10) h += (_r.y - h) * (1 - smooth(ft.half + 0.8, ft.half + 10, dist));
    } else {
      const pf = padFactor(ft, x, z, null);
      if (pf > 0) { h += (ft.y - h) * pf; if (pf > padF) padF = pf; }
    }
  }
  return ry + (h - ry) * smooth(EDGE, EDGE + 30 - 25 * padF, d);
}

export function normalAt(x, z, out) {
  const e = 0.4;
  const nx = (heightAt(x - e, z) - heightAt(x + e, z)) / (2 * e), nz = (heightAt(x, z - e) - heightAt(x, z + e)) / (2 * e);
  const l = Math.hypot(nx, 1, nz);
  out.x = nx / l; out.y = 1 / l; out.z = nz / l;
  return out;
}

export function onRoad(x, z) { return roadFrame(x, z, _f).d < ROAD_HALF + 0.3; }

const _w = [0, 0, 0, 0];
export function surfaceAt(x, z) {
  const d = roadFrame(x, z, _f).d;
  if (d < ROAD_HALF + 0.3) return "asphalt";
  if (d < EDGE) return "gravel";
  const feats = featuresAt(z);
  let track = null;
  if (feats) for (let i = feats.length - 1; i >= 0; i--) {
    const ft = feats[i];
    if (ft.type === "pad") {
      if (padFactor(ft, x, z, _l) === 1) {
        for (const fl of ft.floors) if (Math.abs(_l.x - fl.x) <= fl.hx && Math.abs(_l.z - fl.z) <= fl.hz) return fl.surface;
        return ft.surface;
      }
    } else if (!track && routeDistance(ft, x, z, null) < ft.half) track = ft.surface;
  }
  if (track) return track;
  const w = regionWeights(x, z, _w);
  let b = 0;
  for (let i = 1; i < 4; i++) if (w[i] > w[b]) b = i;
  if (b === 1) return "sand";
  if (b === 3) {
    const e = 1.5, sx = heightAt(x + e, z) - heightAt(x - e, z), sz = heightAt(x, z + e) - heightAt(x, z - e);
    return sx * sx + sz * sz > 1.2 ? "rock" : "gravel";
  }
  return "dirt";
}

// True when (x, z) is at least `m` metres clear of every site pad and side track (scenery placement).
export function featureClear(x, z, m) {
  const feats = featuresAt(z);
  if (!feats) return true;
  for (let i = 0; i < feats.length; i++) {
    const ft = feats[i];
    if (ft.type === "pad") {
      padFactor(ft, x, z, _l);
      if (Math.abs(_l.x) < ft.hx + m && Math.abs(_l.z) < ft.hz + m) return false;
    } else if (routeDistance(ft, x, z, null) < ft.half + m) return false;
  }
  return true;
}
// Building floor under (x, z), or null: { surface } – used for "indoors" checks.
export function floorAt(x, z) {
  const feats = featuresAt(z);
  if (feats) for (let i = 0; i < feats.length; i++) {
    const ft = feats[i];
    if (ft.type !== "pad" || padFactor(ft, x, z, _l) !== 1) continue;
    for (const fl of ft.floors) if (Math.abs(_l.x - fl.x) <= fl.hx && Math.abs(_l.z - fl.z) <= fl.hz) return fl;
  }
  return null;
}
// Strength 0..1 of pad / track influence at a point (ground tinting)
export function featureTint(x, z) {
  const feats = featuresAt(z);
  let t = 0;
  if (feats) for (let i = 0; i < feats.length; i++) {
    const ft = feats[i];
    if (ft.type === "pad") t = Math.max(t, padFactor(ft, x, z, null));
    else { const d = routeDistance(ft, x, z, null); if (d < ft.half + 4) t = Math.max(t, 1 - smooth(ft.half, ft.half + 4, d)); }
  }
  return t;
}
