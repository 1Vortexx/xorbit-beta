// Long Haul – deterministic points of interest along the road (pure: no rendering, runs in Node).
// A site owns a levelled pad (registered here so terrain, buildings and collision agree) and sometimes a dirt
// side track that leaves the highway and ends at the pad.
import {
  CHUNK, ROAD_HALF, getSeed, seedEpoch, rng, hashStr, roadX, roadY, roadDir, roadSlope, naturalHeight, smooth,
} from "./base.js";

// Site-local frame: origin = pad centre, +z = "front" (towards the highway), +x along the frontage.
// world = site + R(yaw)·(lx, lz) with Object3D.rotation.y = yaw.
export const KINDS = {
  // pad half extents (hx along frontage, hz depth), ground surface, building floors (local rects)
  start:    { hx: 21, hz: 16, surface: "dirt",     floors: [{ x: -9, z: -5, hx: 5.5, hz: 4.5, surface: "wood" }, { x: 8, z: -6, hx: 4.5, hz: 5.5, surface: "concrete" }] },
  station:  { hx: 30, hz: 20, surface: "concrete", floors: [{ x: 0, z: -11, hx: 9, hz: 5, surface: "concrete" }] },
  home:     { hx: 17, hz: 15, surface: "dirt",     floors: [{ x: -2, z: -4, hx: 6, hz: 4.5, surface: "wood" }] },
  garage:   { hx: 19, hz: 16, surface: "gravel",   floors: [{ x: 0, z: -5, hx: 8, hz: 6, surface: "concrete" }] },
  diner:    { hx: 21, hz: 16, surface: "asphalt",  floors: [{ x: 0, z: -6, hx: 9, hz: 4.5, surface: "concrete" }] },
  motel:    { hx: 33, hz: 16, surface: "asphalt",  floors: [{ x: 0, z: -9, hx: 21, hz: 4, surface: "concrete" }] },
  junkyard: { hx: 28, hz: 24, surface: "dirt",     floors: [{ x: -19, z: -15, hx: 5, hz: 4, surface: "concrete" }] },
  wreck:    { hx: 10, hz: 6,  surface: "dirt",     floors: [] },
};
const PAD_MARGIN = 14;       // metres over which the ground blends from pad level to natural terrain
const FRONT_GAP = 7;         // pad front edge to the road centreline (roadside sites)
const TRACK_HALF = 2.3;

const NAMES = {
  station: ["Last Chance Gas", "Dusty's Fuel", "Mesa Petrol", "Route Stop", "Sunset Fuel", "Coyote Gas", "Halfway Fuel", "Red Rock Gas"],
  home: ["Abandoned home", "Old homestead", "Empty ranch house", "Sun-bleached shack"],
  garage: ["Roadside garage", "Hank's Auto Repair", "Old workshop", "Desert Auto"],
  diner: ["Roadrunner Diner", "Sally's Diner", "The Lonely Spoon", "Atomic Cafe"],
  motel: ["Starlite Motel", "Desert Rest Motel", "Cactus Inn", "Sleepy Lizard Motel"],
  junkyard: ["Junkyard", "Salvage yard", "Scrap yard"],
  wreck: ["Roadside wreck", "Breakdown", "Abandoned camp"],
};

let epoch = -1, seed = 0, sites = [], stationZ = 0, doneTo = -1, buckets = new Map(), start = null;
function reset() {
  epoch = seedEpoch(); seed = getSeed();
  sites = []; buckets = new Map(); doneTo = -1; stationZ = 0; start = null;
}

export function siteToWorld(s, lx, lz, out = {}) {
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  out.x = s.x + lx * c + lz * sn; out.z = s.z - lx * sn + lz * c;
  return out;
}

// ── Placement of one site ──────────────────────────────
function tryPlace(kind, zs, side, L, along) {
  const K = KINDS[kind];
  const dir = roadDir(zs), px = dir.z * side, pz = -dir.x * side;      // unit vector pointing away from the road on `side`
  const cx = roadX(zs), setback = L > 0 ? L + K.hz : FRONT_GAP + K.hz;
  const x = cx + px * setback + dir.x * along, z = zs + pz * setback + dir.z * along;
  const yaw = Math.atan2(-px, -pz);
  const r = Math.hypot(K.hx, K.hz) + 1;
  if (Math.floor((z - r) / CHUNK) !== Math.floor((z + r) / CHUNK)) return null;
  // the pad must stay clear of the asphalt
  let score = 0;
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  for (let i = -2; i <= 2; i++) {
    const lx = (i / 2) * K.hx, wx = x + lx * c + K.hz * sn, wz = z - lx * sn + K.hz * c;
    const gap = Math.abs(wx - roadX(wz)) / Math.hypot(1, roadSlope(wz));
    if (gap < ROAD_HALF + 1.5) return null;
    if (!L) score += Math.abs(gap - FRONT_GAP) * 0.5;
  }
  const grade = Math.abs(roadY(zs + 30) - roadY(zs - 30)) / 60;
  score += grade * 220;
  let y = roadY(zs), route = null;
  if (L > 0) {
    // level of the pad = the natural ground there; the track is graded between the road and the pad
    y = 0;
    for (const [ax, az] of [[0, 0], [0.6, 0.6], [-0.6, 0.6], [0.6, -0.6], [-0.6, -0.6]]) {
      y += naturalHeight(x + (ax * K.hx) * c + (az * K.hz) * sn, z - (ax * K.hx) * sn + (az * K.hz) * c) / 5;
    }
    const fx = x + (K.hz - 1) * sn, fz = z + (K.hz - 1) * c;           // just inside the pad's front edge
    const p0 = { x: cx, z: zs }, p3 = { x: fx, z: fz };
    const p1 = { x: cx + px * L * 0.5, z: zs + pz * L * 0.5 }, p2 = { x: fx + sn * L * 0.45, z: fz + c * L * 0.45 };
    const N = 28, pts = [];
    let len = 0, maxGrade = 0;
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      const bx = u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x;
      const bz = u * u * u * p0.z + 3 * u * u * t * p1.z + 3 * u * t * t * p2.z + t * t * t * p3.z;
      if (i) len += Math.hypot(bx - pts[i - 1].x, bz - pts[i - 1].z);
      pts.push({ x: bx, z: bz, y: naturalHeight(bx, bz), s: len });
    }
    pts[0].y = roadY(zs); pts[N].y = y;
    for (let pass = 0; pass < 6; pass++) {
      let prev = pts[0].y;
      for (let i = 1; i < N; i++) { const cur = pts[i].y; pts[i].y = (prev + cur * 2 + pts[i + 1].y) / 4; prev = cur; }
    }
    for (let i = 1; i <= N; i++) maxGrade = Math.max(maxGrade, Math.abs(pts[i].y - pts[i - 1].y) / Math.max(0.5, pts[i].s - pts[i - 1].s));
    if (maxGrade > 0.16) return null;
    score += maxGrade * 120;
    let zmin = Infinity, zmax = -Infinity, xmin = Infinity, xmax = -Infinity;
    for (const p of pts) { zmin = Math.min(zmin, p.z); zmax = Math.max(zmax, p.z); xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x); }
    route = { pts, half: TRACK_HALF, surface: "dirt", len, zmin, zmax, xmin, xmax };
  }
  return { kind, x, z, yaw, side, zRoad: zs, y, route, score, hx: K.hx, hz: K.hz, r };
}

function place(kind, zNominal, rand, opts = {}) {
  let best = null;
  const wantRoute = opts.route;
  for (let pass = 0; pass < 2 && !best; pass++) {
    const routed = wantRoute && pass === 0;
    for (let i = 0; i < 14; i++) {
      const zs = zNominal + (rand() - 0.5) * (opts.spread || 260);
      const side = opts.side || (rand() < 0.5 ? -1 : 1);
      const L = routed ? 80 + rand() * rand() * 320 : 0;
      const along = routed ? (rand() - 0.5) * 0.5 * L : 0;
      const c = tryPlace(kind, zs, side, L, along);
      if (c && (!best || c.score < best.score)) best = c;
    }
  }
  if (!best) {
    // deterministic fallback: scan forward until a legal spot appears (a roadside spot always exists within a chunk)
    for (let dz = 0; dz < 600 && !best; dz += 7) best = tryPlace(kind, zNominal + dz, opts.side || -1, 0, 0) || tryPlace(kind, zNominal - dz, opts.side || -1, 0, 0);
  }
  return best;
}

function finish(c, extra) {
  const K = KINDS[extra && extra.start ? "start" : c.kind];
  const id = "s" + Math.floor(c.zRoad / 10);
  const h = hashStr(seed + ":" + id);
  const names = NAMES[c.kind];
  const site = {
    id, kind: c.kind, x: c.x, z: c.z, yaw: c.yaw, name: names[h % names.length],
    side: c.side, zRoad: c.zRoad, y: c.y, seed: h, route: c.route, spec: K,
    pad: { x: c.x, z: c.z, yaw: c.yaw, c: Math.cos(c.yaw), s: Math.sin(c.yaw), hx: K.hx, hz: K.hz, y: c.y, margin: PAD_MARGIN, surface: K.surface, floors: K.floors },
    ...extra,
  };
  sites.push(site);
  // spatial buckets (100 m of z) for heightAt / surfaceAt
  const r = Math.hypot(K.hx, K.hz) + PAD_MARGIN + 2;
  addBucket(site.pad, c.z - r, c.z + r, "pad");
  if (c.route) addBucket(c.route, c.route.zmin - 14, c.route.zmax + 14, "route");
  return site;
}
function addBucket(f, z0, z1, type) {
  f.type = type;
  for (let b = Math.floor(z0 / 100); b <= Math.floor(z1 / 100); b++) {
    let a = buckets.get(b);
    if (!a) buckets.set(b, a = []);
    if (type === "route") a.unshift(f); else a.push(f);     // routes first, pads on top
  }
}

// ── Sequence ───────────────────────────────────────────
const FILL = [["wreck", 0.26], ["home", 0.27], ["garage", 0.13], ["diner", 0.12], ["motel", 0.1], ["junkyard", 0.12]];
const ROUTE_P = { home: 0.5, junkyard: 0.6, garage: 0.2, wreck: 0.25, diner: 0, motel: 0, station: 0 };
let segIndex = 0, haveSedan = false;

function genStart() {
  const rand = rng(hashStr(seed + ":start"));
  const c = place("home", 62, rand, { side: -1, spread: 30 }) ;
  // "start" pad is larger than a plain home: re-place with the start spec
  let best = null;
  for (let dz = 0; dz < 80 && !best; dz += 4) best = tryPlaceStart(60 + dz) || tryPlaceStart(60 - dz);
  const s = finish(best || c, { start: true, name: "Home" });
  const sp = (lx, lz, yaw) => { const p = siteToWorld(s, lx, lz); return { x: p.x, z: p.z, yaw }; };
  s.vehicleSpawn = sp(8, 6.5, s.yaw);                         // on the driveway in front of the garage, nose to the road
  s.playerSpawn = sp(-6.5, 2.2, s.yaw - Math.PI / 2 + 0.35);   // on the porch step, looking across the yard at the truck
  start = s;
  // First station: an easy first destination
  const r2 = rng(hashStr(seed + ":st0"));
  const st = finish(place("station", 1350 + r2() * 300, r2, { spread: 200 }), {});
  stationZ = st.zRoad;
  doneTo = stationZ;
}
function tryPlaceStart(zs) {
  const K = KINDS.start, save = KINDS.home;
  KINDS.home = K;
  const c = tryPlace("home", zs, -1, 0, 0);
  KINDS.home = save;
  return c;
}

// One segment = the stretch from the last station to the next one, with fillers in between.
function genSegment() {
  const rand = rng(hashStr(seed + ":seg" + segIndex++));
  const from = stationZ, nextStation = from + 5200 + rand() * 3200;
  // fillers between the start/first station are handled in the first call (from = first station; also fill 0..from)
  const spans = segIndex === 1 ? [[330, from - 380], [from + 420, nextStation - 420]] : [[from + 420, nextStation - 420]];
  for (const [a, b] of spans) {
    let z = a + rand() * 250;
    let first = segIndex === 1 && a < 1000;
    while (z < b) {
      let kind = "wreck";
      let t = rand();
      for (const [k, w] of FILL) { if ((t -= w) <= 0) { kind = k; break; } }
      let extra = {};
      if (first) { kind = "wreck"; first = false; extra = { first: true }; }
      else if (!haveSedan && z > 2600) { kind = "garage"; extra = { sedan: true }; haveSedan = true; }
      const c = place(kind, z, rand, { route: rand() < ROUTE_P[kind] && !extra.sedan && !extra.first, spread: 160 });
      if (c) finish(c, extra);
      z += 650 + rand() * 1050;
    }
  }
  const st = finish(place("station", nextStation, rand, { spread: 240 }), {});
  stationZ = st.zRoad;
  sites.sort((p, q) => p.zRoad - q.zRoad);
  doneTo = stationZ;
}

function ensure(z) {
  if (epoch !== seedEpoch()) reset();
  if (z <= doneTo) return;
  if (doneTo < 0) { segIndex = 0; haveSedan = false; genStart(); }
  while (doneTo < z) genSegment();
}

// ── Public API ─────────────────────────────────────────
export function startSite() { ensure(0); return start; }
// Sites whose pad centre lies in [z0, z1)
export function sitesBetween(z0, z1) {
  ensure(z1 + 900);
  const out = [];
  for (const s of sites) if (s.z >= z0 && s.z < z1) out.push(s);
  return out;
}
// First site whose highway turn-off is beyond z (optionally of one kind)
export function nextSiteAfter(z, kind) {
  for (let reach = z + 2000; ; reach += 6000) {
    ensure(reach);
    for (const s of sites) if (s.zRoad > z && (!kind || s.kind === kind)) return s;
  }
}
// Pads and routes that may influence the ground at this z (terrain.js)
export function featuresAt(z) {
  if (z > doneTo - 700 || epoch !== seedEpoch()) ensure(z + 700);
  return buckets.get(Math.floor(z / 100));
}
// Flatten factor of a pad at a world point: 1 on the pad, 0 beyond its margin. Returns local coords through `loc`.
export function padFactor(p, x, z, loc) {
  const dx = x - p.x, dz = z - p.z;
  const lx = dx * p.c - dz * p.s, lz = dx * p.s + dz * p.c;
  if (loc) { loc.x = lx; loc.z = lz; }
  const ox = Math.abs(lx) - p.hx, oz = Math.abs(lz) - p.hz;
  if (ox <= 0 && oz <= 0) return 1;
  const d = Math.hypot(Math.max(ox, 0), Math.max(oz, 0));
  return d >= p.margin ? 0 : 1 - smooth(0, p.margin, d);
}
// Distance from a point to a route's centreline; writes the graded height into res.y. Returns Infinity when far.
export function routeDistance(r, x, z, res) {
  if (x < r.xmin - 14 || x > r.xmax + 14 || z < r.zmin - 14 || z > r.zmax + 14) return Infinity;
  const pts = r.pts;
  let best = Infinity, by = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const ex = b.x - a.x, ez = b.z - a.z;
    let t = ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = a.x + ex * t - x, qz = a.z + ez * t - z, d = qx * qx + qz * qz;
    if (d < best) { best = d; by = a.y + (b.y - a.y) * t; }
  }
  if (res) res.y = by;
  return Math.sqrt(best);
}
