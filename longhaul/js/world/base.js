// Long Haul – world base: seed, noise, the road centreline, regions and the natural (feature-less) ground.
// Pure math: no DOM, no THREE. terrain.js re-exports the public parts; sites.js builds the site layout on top of this.
export const CHUNK = 200;        // metres of road (z) per chunk
export const ROAD_HALF = 4;      // half the asphalt width
export const SHOULDER = 2.5;     // gravel shoulder width outside the asphalt

let SEED = 1, EPOCH = 0;
export function setSeed(s) { s = s >>> 0 || 1; if (s !== SEED) { SEED = s; EPOCH++; } }
export function getSeed() { return SEED; }
export function seedEpoch() { return EPOCH; }

// ── Hashing / RNG ──────────────────────────────────────
export function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13; h = Math.imul(h, 3266489909); h ^= h >>> 16;
  return h >>> 0;
}
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(i, j, salt) {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul((salt | 0) + SEED, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
// uniform 0..1 from integers (seeded)
export function hash01(i, salt) { return hash2(i, 7919, salt) / 4294967296; }

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;

// 1-D value noise, −1..1, C2 continuous
export function n1(x, salt) {
  const i = Math.floor(x), f = x - i;
  const a = hash2(i, 0, salt) / 2147483648 - 1, b = hash2(i + 1, 0, salt) / 2147483648 - 1;
  return a + (b - a) * fade(f);
}
// 2-D gradient noise, roughly −1..1
const GX = [1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071], GZ = [0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071];
export function n2(x, z, salt) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fade(fx), v = fade(fz);
  let g = hash2(ix, iz, salt) & 7; const a = GX[g] * fx + GZ[g] * fz;
  g = hash2(ix + 1, iz, salt) & 7; const b = GX[g] * (fx - 1) + GZ[g] * fz;
  g = hash2(ix, iz + 1, salt) & 7; const c = GX[g] * fx + GZ[g] * (fz - 1);
  g = hash2(ix + 1, iz + 1, salt) & 7; const d = GX[g] * (fx - 1) + GZ[g] * (fz - 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.5;
}

// ── Regions ────────────────────────────────────────────
// The country changes every ~13 km along the road. Each block of four cells is a seeded permutation of the four
// regions; neighbouring cells blend over ±1.5 km and the boundary is warped sideways so it is not a straight line.
export const REGIONS = [
  { id: "scrub", name: "Scrub Plains" },
  { id: "dunes", name: "Dune Sea" },
  { id: "flats", name: "Dry Lake Flats" },
  { id: "rocky", name: "Mesa Badlands" },
];
const RLEN = 13000, RBLEND = 1500;
function blockPerm(b) {
  const p = [0, 1, 2, 3];
  let h = hash2(b, 3, 101);
  for (let i = 3; i > 0; i--) { const j = h % (i + 1); h = Math.floor(h / (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  return p;
}
function cellRegion(i) {
  const b = Math.floor(i / 4), j = i - b * 4;
  const p = blockPerm(b);
  if (b === 0) { const at = p.indexOf(0); if (at) { p[at] = p[0]; p[0] = 0; } }   // the journey starts in the scrub plains
  else {
    const prev = blockPerm(b - 1);
    if (b - 1 === 0) { const at = prev.indexOf(0); if (at) { prev[at] = prev[0]; prev[0] = 0; } }
    if (p[0] === prev[3]) { const t = p[0]; p[0] = p[1]; p[1] = t; }
  }
  return p[j];
}
const boundary = (i) => i * RLEN + (hash01(i, 102) - 0.5) * 5000;
const _w = [0, 0, 0, 0];
// Region weights (sum 1) for a warped z. Writes into out[4] (scrub, dunes, flats, rocky).
export function regionWeights1(zw, out = _w) {
  let c = Math.floor(zw / RLEN);
  if (zw < boundary(c)) c--; else if (zw >= boundary(c + 1)) c++;
  out[0] = out[1] = out[2] = out[3] = 0;
  const b0 = boundary(c), b1 = boundary(c + 1), r = cellRegion(c);
  if (zw - b0 < RBLEND) {
    const t = smooth(0, 1, (zw - b0 + RBLEND) / (2 * RBLEND));
    out[r] += t; out[cellRegion(c - 1)] += 1 - t;
  } else if (b1 - zw < RBLEND) {
    const t = smooth(0, 1, (b1 - zw + RBLEND) / (2 * RBLEND));
    out[r] += t; out[cellRegion(c + 1)] += 1 - t;
  } else out[r] = 1;
  return out;
}
export function regionWeights(x, z, out = _w) {
  return regionWeights1(z + 700 * n2(x / 1900, z / 1900, 31), out);
}
export function regionAt(x, z) {
  const w = regionWeights(x, z, _w);
  let b = 0;
  for (let i = 1; i < 4; i++) if (w[i] > w[b]) b = i;
  return REGIONS[b];
}

// ── Road centreline ────────────────────────────────────
// x = roadX(z): the road always progresses towards +z, so streaming is 1-D.
export function roadX(z) {
  return 230 * n1(z / 2300, 11) + 80 * n1(z / 760, 12) + 16 * n1(z / 240, 13);
}
const RELIEF = [0.8, 0.7, 0.22, 1.45];
const _wr = [0, 0, 0, 0];
export function roadY(z) {
  const w = regionWeights1(z, _wr);
  const relief = w[0] * RELIEF[0] + w[1] * RELIEF[1] + w[2] * RELIEF[2] + w[3] * RELIEF[3];
  return (30 * n1(z / 2600, 21) + 9 * n1(z / 640, 22)) * relief + 1.6 * n1(z / 210, 23) * Math.min(1, relief);
}
export function roadSlope(z) { return (roadX(z + 1) - roadX(z - 1)) * 0.5; }
export function roadDir(z) {
  const dx = roadSlope(z), len = Math.hypot(dx, 1);
  return { x: dx / len, z: 1 / len };
}
// Road frame of a point: off = x − roadX(z); d ≈ perpendicular distance from the centreline;
// zc = z of the nearest centreline point (only used close to the road, fades out by 60 m so far ground is not sheared).
const _f = { off: 0, d: 0, zc: 0 };
export function roadFrame(x, z, out = _f) {
  const off = x - roadX(z), s = roadSlope(z), c2 = 1 / (1 + s * s), a = Math.abs(off);
  out.off = off;
  out.d = a * Math.sqrt(c2);
  out.zc = a < 60 ? z + off * s * c2 * (1 - smooth(12, 60, a)) : z;
  return out;
}

// ── Natural ground (no pads, no tracks) ────────────────
const _wt = [0, 0, 0, 0];
// Height of the open desert relative to road level, before the road shoulder blend.
export function terrainField(x, z, d) {
  const w = regionWeights(x, z, _wt);
  const df = 1 - 0.8 * smooth(170, 520, d);          // fine detail fades with distance (the far mesh is coarse)
  let t = 0;
  if (w[0] > 0) t += w[0] * (6 * n2(x / 300, z / 300, 40) + 2.2 * n2(x / 90, z / 90, 41) * df + 0.45 * n2(x / 23, z / 23, 42) * df);
  if (w[1] > 0) {
    const r = 1 - Math.abs(n2(x / 150 + z / 600, z / 250, 43));
    t += w[1] * (11 * r * r - 5 + 6 * n2(x / 540, z / 540, 44) + (0.8 * n2(x / 34, z / 20, 45) + 2.4 * n2(x / 75, z / 60, 46)) * df);
  }
  if (w[2] > 0) t += w[2] * (0.7 * n2(x / 320, z / 320, 47) + 0.12 * n2(x / 40, z / 40, 48) * df);
  if (w[3] > 0) {
    const m = n2(x / 470 + 7.3, z / 470 + 2.1, 49);
    const mesa = (34 * smooth(0.12, 0.5, m) + 16 * smooth(0.52, 0.8, m)) * smooth(70, 240, d);
    t += w[3] * (13 * n2(x / 260, z / 260, 50) + 5.5 * n2(x / 85, z / 85, 51) * df + 1.3 * n2(x / 24, z / 24, 52) * df + mesa);
  }
  // Ground rises away from the road into ranges on both sides: the world has no edge, only distance.
  const far = smooth(650, 3200, d);
  t += 0.012 * Math.min(d, 650)
    + far * (60 + 120 * (0.5 + 0.5 * n2(x / 1900, z / 1900, 53)) + 38 * n2(x / 640, z / 640, 54))
    + 150 * smooth(3000, 9000, d);
  return t;
}
const _fn = { off: 0, d: 0, zc: 0 };
export function naturalHeight(x, z) {
  const f = roadFrame(x, z, _fn);
  const ry = roadY(f.zc);
  if (f.d <= ROAD_HALF + SHOULDER) return ry;
  return ry + terrainField(x, z, f.d) * smooth(ROAD_HALF + SHOULDER, ROAD_HALF + SHOULDER + 30, f.d);
}
