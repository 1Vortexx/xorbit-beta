// Long Haul – the streamed world: terrain + road chunks, sites, scenery, far terrain, colliders.
import * as THREE from "three";
import { CHUNK, ROAD_HALF, roadX, roadDir, heightAt, regionAt, floorAt, featureTint } from "./terrain.js";
import { regionWeights, n2, smooth, roadFrame } from "./base.js";
import { sitesBetween } from "./sites.js";
import { scatter } from "./scatter.js";
import { buildScenery, buildPrototypes } from "./scenery.js";
import { buildSite, animateHinges, tickPumps, setVehicleLookup } from "./buildings.js";
import { prepareTextures, texturesReady, M } from "./tex.js";
import { lin } from "./geo.js";
import { emit } from "../core/bus.js";
import { removeAllUnder } from "../core/targets.js";

export { setVehicleLookup };

export async function prepare(report) {
  await prepareTextures((p, label) => report && report(p * 0.9, label));
  buildPrototypes();
  report && report(1, "World ready");
}

// ── Ground colour ──────────────────────────────────────
const PAL = [lin(0xb9946a), lin(0xd9b47c), lin(0xd3c8b0), lin(0xb0704c)];      // scrub, dunes, flats, rocky
const PAL2 = [lin(0xa5805a), lin(0xe3c590), lin(0xbfb39a), lin(0x8f5a40)];     // variation partner
const ROCKC = lin(0x8a5f48), GRAVEL = lin(0x9a8a74), PACKED = lin(0xa08462);
const _w = [0, 0, 0, 0], _fr = { off: 0, d: 0, zc: 0 };
function groundColor(x, z, y, slope, out, o) {
  const w = regionWeights(x, z, _w);
  const v = 0.5 + 0.5 * n2(x / 46, z / 46, 70), f = n2(x / 9, z / 9, 71) * 0.06;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < 4; i++) { if (!w[i]) continue; r += w[i] * (PAL[i][0] + (PAL2[i][0] - PAL[i][0]) * v); g += w[i] * (PAL[i][1] + (PAL2[i][1] - PAL[i][1]) * v); b += w[i] * (PAL[i][2] + (PAL2[i][2] - PAL[i][2]) * v); }
  // exposed rock on steep ground, with strata on mesa walls
  const st = smooth(0.32, 0.75, slope);
  if (st > 0) { const band = 0.86 + 0.14 * Math.sin(y * 1.1 + n2(x / 60, z / 60, 72) * 3); r += (ROCKC[0] * band - r) * st; g += (ROCKC[1] * band - g) * st; b += (ROCKC[2] * band - b) * st; }
  const d = roadFrame(x, z, _fr).d;
  const sh = 1 - smooth(ROAD_HALF + 1.5, ROAD_HALF + 5.5, d);
  if (sh > 0) { r += (GRAVEL[0] - r) * sh; g += (GRAVEL[1] - g) * sh; b += (GRAVEL[2] - b) * sh; }
  const ft = d < 700 ? featureTint(x, z) * 0.7 : 0;
  if (ft > 0) { r += (PACKED[0] - r) * ft; g += (PACKED[1] - g) * ft; b += (PACKED[2] - b) * ft; }
  const k = 1 + f;
  out[o] = r * k; out[o + 1] = g * k; out[o + 2] = b * k;
}

// ── Chunk terrain ──────────────────────────────────────
const BASE_OFFS = [0, 4, 6.5, 9, 12, 16, 21, 27, 34, 42, 52, 64, 78, 95, 115, 140, 170, 205, 245, 290, 340, 400, 470, 550, 640];
export const STRIP = 640;      // half-width of the detailed strip
function columnsFor(k) {
  const z0 = k * CHUNK, cols = [];
  for (const o of BASE_OFFS) { cols.push(o); if (o) cols.push(-o); }
  // dense columns over pads and side tracks so the mesh follows the graded ground
  for (const s of sitesBetween(z0 - 500, z0 + CHUNK + 500)) {
    const add = (xmin, xmax, zmin, zmax) => {
      const za = Math.max(z0, zmin), zb = Math.min(z0 + CHUNK, zmax);
      if (za > zb) return;
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i <= 6; i++) { const z = za + ((zb - za) * i) / 6, rx = roadX(z); lo = Math.min(lo, xmin - rx); hi = Math.max(hi, xmax - rx); }
      lo = Math.max(lo, -STRIP + 4); hi = Math.min(hi, STRIP - 4);
      for (let o = Math.ceil(lo / 4) * 4; o <= hi; o += 4) if (Math.abs(o) > 9.5) cols.push(o + 0.37);
    };
    const r = Math.hypot(s.pad.hx, s.pad.hz) + 8;
    add(s.x - r, s.x + r, s.z - r, s.z + r);
    if (s.route) add(s.route.xmin - 8, s.route.xmax + 8, s.route.zmin - 8, s.route.zmax + 8);
  }
  cols.sort((a, b) => a - b);
  const out = [];
  for (const c of cols) if (!out.length || c - out[out.length - 1] > 1.6) out.push(c);
  return out;
}

const _c3 = [0, 0, 0];
function buildTerrain(k, chunk, opts) {
  const z0 = k * CHUNK, gp = chunk.group.position, step = opts.lite ? 10 : 5, rows = CHUNK / step + 1;
  const cols = columnsFor(k), nc = cols.length;
  const nv = rows * nc, pos = new Float32Array((nv + 2 * (rows + nc)) * 3), col = new Float32Array((nv + 2 * (rows + nc)) * 3), nrm = new Float32Array((nv + 2 * (rows + nc)) * 3), uv = new Float32Array((nv + 2 * (rows + nc)) * 2);
  // uv origin snapped to the texture period so the sand detail continues across chunk borders
  const US = 0.25, ux0 = Math.round(gp.x * US) / US;
  for (let r = 0; r < rows; r++) {
    const z = z0 + r * step, cx = roadX(z), d = roadDir(z);
    for (let c = 0; c < nc; c++) {
      const off = cols[c], w = 1 - smooth(12, 40, Math.abs(off));
      const x = cx + off * (w * d.z + 1 - w), zz = z - w * off * d.x, y = heightAt(x, zz), i = (r * nc + c) * 3;
      pos[i] = x - gp.x; pos[i + 1] = y; pos[i + 2] = zz - gp.z;
      const e = 1.2, hx = heightAt(x + e, zz) - heightAt(x - e, zz), hz = heightAt(x, zz + e) - heightAt(x, zz - e);
      const nx = -hx / (2 * e), nz = -hz / (2 * e), l = Math.hypot(nx, 1, nz);
      nrm[i] = nx / l; nrm[i + 1] = 1 / l; nrm[i + 2] = nz / l;
      groundColor(x, zz, y, Math.hypot(nx, nz), col, i);
      uv[(r * nc + c) * 2] = (x - ux0) * US; uv[(r * nc + c) * 2 + 1] = (zz - gp.z) * US;
    }
  }
  const idx = [];
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < nc - 1; c++) { const a = r * nc + c, b = a + 1, d = a + nc, e = d + 1; idx.push(a, d, b, b, d, e); }
  // skirts: hide T-junction cracks against neighbours and the far mesh
  let v = nv;
  const skirt = (list, flip) => {
    const start = v;
    for (const a of list) { for (let q = 0; q < 3; q++) { pos[v * 3 + q] = pos[a * 3 + q]; col[v * 3 + q] = col[a * 3 + q]; nrm[v * 3 + q] = nrm[a * 3 + q]; } pos[v * 3 + 1] -= 14; uv[v * 2] = uv[a * 2]; uv[v * 2 + 1] = uv[a * 2 + 1]; v++; }
    for (let i = 0; i < list.length - 1; i++) { const a = list[i], b = list[i + 1], c = start + i, d = c + 1; idx.push(a, b, c, b, d, c, a, c, b, b, c, d); }
  };
  const rowIdx = (r) => Array.from({ length: nc }, (_, c) => r * nc + c), colIdx = (c) => Array.from({ length: rows }, (_, r) => r * nc + c);
  skirt(rowIdx(0), false); skirt(rowIdx(rows - 1), true); skirt(colIdx(0), true); skirt(colIdx(nc - 1), false);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(nv + 2 * (rows + nc) > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, M.terrain);
  mesh.receiveShadow = true;
  chunk.owned.push(g); chunk.group.add(mesh);
  chunk.terrain = mesh;

  // Asphalt + gravel shoulders
  const RO = [-7.3, -6.5, -4, 0, 4, 6.5, 7.3], rp = new Float32Array(rows * 7 * 3), ruv = new Float32Array(rows * 7 * 2), rn = new Float32Array(rows * 7 * 3), ri = [];
  const vb = (z0 % 24) / 24;
  for (let r = 0; r < rows; r++) {
    const z = z0 + r * step, cx = roadX(z), d = roadDir(z);
    for (let c = 0; c < 7; c++) {
      const x = cx + RO[c] * d.z, zz = z - RO[c] * d.x, i = (r * 7 + c) * 3;
      rp[i] = x - gp.x; rp[i + 1] = heightAt(x, zz) + 0.012; rp[i + 2] = zz - gp.z;
      rn[i + 1] = 1;
      ruv[(r * 7 + c) * 2] = 0.5 - RO[c] / 14.6; ruv[(r * 7 + c) * 2 + 1] = vb + (r * step) / 24;
    }
    if (r < rows - 1) for (let c = 0; c < 6; c++) { const a = r * 7 + c, b = a + 1, dd = a + 7, e = dd + 1; ri.push(a, dd, b, b, dd, e); }
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute("position", new THREE.BufferAttribute(rp, 3)); rg.setAttribute("normal", new THREE.BufferAttribute(rn, 3)); rg.setAttribute("uv", new THREE.BufferAttribute(ruv, 2));
  rg.setIndex(ri); rg.computeVertexNormals();
  const road = new THREE.Mesh(rg, M.road);
  road.receiveShadow = true; road.renderOrder = 1;
  chunk.owned.push(rg); chunk.group.add(road);
}

function buildChunk(k, opts) {
  const z0 = k * CHUNK, group = new THREE.Group();
  group.position.set(roadX(z0), 0, z0);
  const chunk = { k, z0, group, colliders: [], spawns: [], vehicleSpawns: [], owned: [], instanced: [], hinges: [], anim: new Set(), sites: [] };
  buildTerrain(k, chunk, opts);
  const sc = scatter(k);
  for (const c of sc.colliders) chunk.colliders.push(c);
  buildScenery(sc, chunk, opts, regionWeights(roadX(z0 + 100), z0 + 100, _w).slice());
  for (const s of sitesBetween(z0, z0 + CHUNK)) { buildSite(s, chunk, opts); chunk.sites.push(s); }
  group.updateMatrixWorld(true);
  return chunk;
}
function disposeChunk(c) {
  removeAllUnder(c.group);
  for (const o of c.owned) o.dispose();
  for (const im of c.instanced) im.dispose();
  c.owned.length = 0; c.instanced.length = 0; c.hinges.length = 0; c.anim.clear();
}

// ── Far terrain ────────────────────────────────────────
// Coarse segments (1 km of z each, rows every 50 m) reaching ±3.6 km sideways and several km ahead/behind. Cells under
// loaded chunks are left out of the index so the detailed strip shows instead. The same height function feeds both, so
// there is no edge to the world: beyond the strip the ground simply gets coarser and rises into distant ranges.
const FAR = 1000, FSTEP = 50;
const FOFF = [-3600, -2900, -2300, -1800, -1400, -1100, -850, -640, -400, -200, -60, -12, 0, 12, 60, 200, 400, 640, 850, 1100, 1400, 1800, 2300, 2900, 3600];
const F_IN0 = FOFF.indexOf(-640), F_IN1 = FOFF.indexOf(640);
function buildFar(j) {
  const z0 = j * FAR, rows = FAR / FSTEP + 1, nc = FOFF.length, group = new THREE.Group();
  group.position.set(roadX(z0), 0, z0);
  const gp = group.position, pos = new Float32Array(rows * nc * 3), col = new Float32Array(rows * nc * 3), nrm = new Float32Array(rows * nc * 3);
  for (let r = 0; r < rows; r++) {
    const z = z0 + r * FSTEP, cx = roadX(z);
    for (let c = 0; c < nc; c++) {
      const x = cx + FOFF[c], y = heightAt(x, z), i = (r * nc + c) * 3;
      pos[i] = x - gp.x; pos[i + 1] = y - (Math.abs(FOFF[c]) < 13 ? 0.35 : 0); pos[i + 2] = z - gp.z;
      const e = 12, hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e);
      const nx = -hx / (2 * e), nz = -hz / (2 * e), l = Math.hypot(nx, 1, nz);
      nrm[i] = nx / l; nrm[i + 1] = 1 / l; nrm[i + 2] = nz / l;
      groundColor(x, z, y, Math.hypot(nx, nz), col, i);
      // the detail map is not applied out here: darken to its average so near and far match
      col[i] *= 0.86; col[i + 1] *= 0.86; col[i + 2] *= 0.86;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const index = new THREE.BufferAttribute(new Uint16Array((rows - 1) * (nc - 1) * 6), 1);
  g.setIndex(index); g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, M.far);
  group.add(mesh);
  // far road ribbon
  const rp = [], ri = [];
  for (let r = 0; r < rows; r++) {
    const z = z0 + r * FSTEP, d = roadDir(z), cx = roadX(z), y = heightAt(cx, z) + 0.25;
    rp.push(cx - d.z * 4.4 - gp.x, y, z + d.x * 4.4 - gp.z, cx + d.z * 4.4 - gp.x, y, z - d.x * 4.4 - gp.z);
    if (r < rows - 1) ri.push(r * 2, r * 2 + 2, r * 2 + 1, r * 2 + 1, r * 2 + 2, r * 2 + 3);
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute("position", new THREE.Float32BufferAttribute(rp, 3));
  const rIndex = new THREE.BufferAttribute(new Uint16Array(ri.length), 1);
  rg.setIndex(rIndex); rg.computeVertexNormals();
  const na = rg.attributes.normal; for (let i = 0; i < na.count; i++) na.setXYZ(i, 0, 1, 0);
  const road = new THREE.Mesh(rg, M.farRoad);
  group.add(road);
  group.updateMatrixWorld(true);
  return { j, group, mesh, road, g, rg, key: "" };
}
function indexFar(f, loaded) {
  const rows = FAR / FSTEP + 1, nc = FOFF.length, perChunk = CHUNK / FSTEP;
  let key = "";
  for (let q = 0; q < FAR / CHUNK; q++) key += loaded.has(f.j * (FAR / CHUNK) + q) ? "1" : "0";
  if (key === f.key) return;
  f.key = key;
  const ia = f.g.index.array, ra = f.rg.index.array;
  let n = 0, m = 0;
  for (let r = 0; r < rows - 1; r++) {
    const near = key[Math.floor(r / perChunk)] === "1";
    for (let c = 0; c < nc - 1; c++) {
      if (near && c >= F_IN0 && c < F_IN1) continue;
      const a = r * nc + c, b = a + 1, d = a + nc, e = d + 1;
      ia[n++] = a; ia[n++] = d; ia[n++] = b; ia[n++] = b; ia[n++] = d; ia[n++] = e;
    }
    if (!near) { ra[m++] = r * 2; ra[m++] = r * 2 + 2; ra[m++] = r * 2 + 1; ra[m++] = r * 2 + 1; ra[m++] = r * 2 + 2; ra[m++] = r * 2 + 3; }
  }
  f.g.setDrawRange(0, n); f.g.index.needsUpdate = true;
  f.rg.setDrawRange(0, m); f.rg.index.needsUpdate = true;
  f.road.visible = m > 0;
}

// ── World ──────────────────────────────────────────────
export class World {
  constructor({ root }) {
    this.root = root;
    this.chunks = new Map();
    this.far = new Map();
    this.opts = { lite: false, ahead: 4, behind: 1 };
    this.last = 0;
    this.stats = { built: 0, lastMs: 0, maxMs: 0 };
    this._want = new Set();
  }
  setOptions(o) {
    const relite = o.lite !== undefined && !!o.lite !== this.opts.lite;
    if (o.lite !== undefined) this.opts.lite = !!o.lite;
    if (o.ahead !== undefined) this.opts.ahead = Math.max(1, o.ahead | 0);
    if (o.behind !== undefined) this.opts.behind = Math.max(1, o.behind | 0);
    if (relite) this.clear();
  }
  // focusPoints: Vector3[] (or one Vector3). Builds at most one chunk per call unless `force`.
  update(focusPoints, force) {
    if (!texturesReady()) return;
    const pts = Array.isArray(focusPoints) ? focusPoints : [focusPoints];
    const want = this._want; want.clear();
    const order = [];
    for (const p of pts) {
      if (!p) continue;
      const kc = Math.floor(p.z / CHUNK);
      for (let k = kc - this.opts.behind; k <= kc + this.opts.ahead; k++) { if (!want.has(k)) { want.add(k); if (!this.chunks.has(k)) order.push([Math.abs(k - kc - 0.3), k]); } }
    }
    let changed = false;
    for (const [k, c] of this.chunks) if (!want.has(k)) { this._drop(c); this.chunks.delete(k); changed = true; }
    order.sort((a, b) => a[0] - b[0]);
    for (const [, k] of order) {
      if (this.chunks.has(k)) continue;
      const t0 = performance.now();
      const c = buildChunk(k, this.opts);
      this.root.add(c.group);
      c.group.updateMatrixWorld(true);
      this.chunks.set(k, c);
      const ms = performance.now() - t0;
      this.stats.built++; this.stats.lastMs = ms; if (ms > this.stats.maxMs) this.stats.maxMs = ms;
      changed = true;
      emit("chunk:load", c);
      if (!force) break;
    }
    // far terrain around the first focus point
    const f0 = pts[0];
    if (f0) {
      const j0 = Math.floor((f0.z - (this.opts.lite ? 1000 : 2000)) / FAR), j1 = Math.floor((f0.z + (this.opts.lite ? 2600 : 3800)) / FAR);
      for (const [j, f] of this.far) if (j < j0 || j > j1) { this.root.remove(f.group); f.g.dispose(); f.rg.dispose(); this.far.delete(j); }
      for (let j = j0; j <= j1; j++) {
        if (this.far.has(j)) continue;
        const f = buildFar(j);
        this.root.add(f.group); this.far.set(j, f); changed = true;
        if (!force) break;
      }
    }
    if (changed || force) for (const f of this.far.values()) indexFar(f, this.chunks);
    // hinge animation and pump sounds run on wall-clock time
    const now = performance.now(), dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;
    for (const c of this.chunks.values()) if (c.anim.size) animateHinges(c, dt);
    tickPumps();
  }
  _drop(c) {
    emit("chunk:unload", c);
    this.root.remove(c.group);
    disposeChunk(c);
  }
  // Static + door colliders whose shape may touch the circle (x, z, radius)
  collidersNear(x, z, radius, out = []) {
    const k0 = Math.floor((z - radius - 2) / CHUNK), k1 = Math.floor((z + radius + 2) / CHUNK);
    for (let k = k0; k <= k1; k++) {
      const c = this.chunks.get(k);
      if (!c) continue;
      const list = c.colliders;
      for (let i = 0; i < list.length; i++) {
        const o = list[i], r = radius + (o.kind === "box" ? Math.hypot(o.hx, o.hz) : o.r);
        const dx = o.x - x, dz = o.z - z;
        if (dx * dx + dz * dz <= r * r) out.push(o);
      }
    }
    return out;
  }
  // true when (x, z) is under a roof (building floor)
  indoorsAt(x, z) { return !!floorAt(x, z); }
  regionAt(x, z) { return regionAt(x, z); }
  // wet 0..1 darkens and glosses the asphalt
  setWet(w) {
    if (!M.road) return;
    M.road.roughness = 0.86 - 0.5 * w; M.road.color.setScalar(1 - 0.35 * w);
    M.terrain.roughness = 0.97 - 0.2 * w;
  }
  clear() {
    for (const c of this.chunks.values()) this._drop(c);
    this.chunks.clear();
    for (const f of this.far.values()) { this.root.remove(f.group); f.g.dispose(); f.rg.dispose(); }
    this.far.clear();
  }
  dispose() { this.clear(); }
}
