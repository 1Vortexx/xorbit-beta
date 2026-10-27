// Long Haul – endless world: noise, road curve, terrain height, and chunk meshes
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { stationFlatten } from "./stations.js";

export const CHUNK = 200;        // metres of road per chunk
export const ROAD_HALF = 4;      // half the asphalt width

let SEED = 1;
export function setSeed(s) { SEED = s >>> 0 || 1; }
export function getSeed() { return SEED; }

// ── Noise ──────────────────────────────────────────────
function hash1(i) {
  let h = (i | 0) * 374761393 + SEED * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}
function hash2(i, j) { return hash1((i | 0) * 73856093 ^ (j | 0) * 19349663); }
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

function n1(x) {
  const i = Math.floor(x), f = x - i;
  return hash1(i) + (hash1(i + 1) - hash1(i)) * fade(f);
}
function n2(x, z) {
  const i = Math.floor(x), j = Math.floor(z);
  const fx = fade(x - i), fz = fade(z - j);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

// Seeded RNG for scenery placement
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

// ── Road and terrain ───────────────────────────────────
// The road is x = roadX(z), so it always heads towards +z
export function roadX(z) {
  return 140 * n1(z / 1400) + 45 * n1(z / 430 + 50) + 10 * n1(z / 150 + 90);
}
export function roadY(z) {
  return 10 * n1(z / 700 + 20) + 3 * n1(z / 230 + 70);
}
export function roadDir(z) {
  const dx = (roadX(z + 1) - roadX(z - 1)) / 2;
  const len = Math.hypot(dx, 1);
  return { x: dx / len, z: 1 / len };
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function heightAt(x, z) {
  const ry = roadY(z);
  const off = x - roadX(z);
  const d = Math.abs(off);
  const dunes = 9 * n2(x / 180, z / 180) + 3 * n2(x / 60 + 5, z / 60 + 5);
  const terrain = ry + dunes + Math.min(d, 400) * 0.03;
  const w = smooth(ROAD_HALF + 2, ROAD_HALF + 30, d);
  let h = ry + (terrain - ry) * w;
  const sf = stationFlatten(z, off);
  if (sf > 0) h += (ry - h) * sf;
  return h;
}

export function normalAt(x, z, out) {
  const e = 0.5;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  return out.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
}

export function onRoad(x, z) { return Math.abs(x - roadX(z)) < ROAD_HALF + 0.4; }

// ── Shared materials and geometries ────────────────────
const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const roadMat = new THREE.MeshLambertMaterial({ map: makeRoadTexture(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const rockMat = new THREE.MeshLambertMaterial({ color: 0x8a6f58, flatShading: true });
const cactusMat = new THREE.MeshLambertMaterial({ color: 0x5d7a3e, flatShading: true });
const poleMat = new THREE.MeshLambertMaterial({ color: 0x5a4433 });
const wreckMat = new THREE.MeshLambertMaterial({ color: 0x7b4a2e, flatShading: true });
const bushMat = new THREE.MeshLambertMaterial({ color: 0x8b7a4f, flatShading: true });

const rockGeo = new THREE.DodecahedronGeometry(1, 0);
const bushGeo = new THREE.IcosahedronGeometry(0.7, 0);
const cactusGeo = (() => {
  const trunk = new THREE.CylinderGeometry(0.28, 0.32, 4, 6); trunk.translate(0, 2, 0);
  const a1 = new THREE.CylinderGeometry(0.2, 0.2, 1.4, 6); a1.translate(0.6, 2.4, 0);
  const a1b = new THREE.CylinderGeometry(0.2, 0.2, 0.7, 6); a1b.rotateZ(Math.PI / 2); a1b.translate(0.3, 1.8, 0);
  const a2 = new THREE.CylinderGeometry(0.18, 0.18, 1.1, 6); a2.translate(-0.55, 2.9, 0);
  const a2b = new THREE.CylinderGeometry(0.18, 0.18, 0.6, 6); a2b.rotateZ(Math.PI / 2); a2b.translate(-0.28, 2.4, 0);
  return mergeGeometries([trunk, a1, a1b, a2, a2b]);
})();
const poleGeo = (() => {
  const p = new THREE.BoxGeometry(0.22, 7, 0.22); p.translate(0, 3.5, 0);
  const bar = new THREE.BoxGeometry(1.8, 0.14, 0.14); bar.translate(0, 6.5, 0);
  return mergeGeometries([p, bar]);
})();
const wreckGeo = (() => {
  const body = new THREE.BoxGeometry(1.8, 0.8, 4.2); body.translate(0, 0.5, 0);
  const cab = new THREE.BoxGeometry(1.6, 0.6, 1.8); cab.translate(0, 1.2, -0.2);
  return mergeGeometries([body, cab]);
})();

function makeRoadTexture() {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#3b3b40"; g.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 900; i++) {
    const v = 50 + Math.random() * 30;
    g.fillStyle = `rgb(${v},${v},${v + 4})`;
    g.fillRect(Math.random() * 64, Math.random() * 256, 1, 1);
  }
  g.fillStyle = "#d9d4c4"; g.fillRect(3, 0, 2, 256); g.fillRect(59, 0, 2, 256);
  g.fillStyle = "#e0b43a"; g.fillRect(31, 0, 2, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Columns run across the road (offsets from the centreline); dense near the road
const OFFS = [0, 4.5, 7, 11, 16, 23, 32, 44, 60, 80, 105, 135, 175, 225, 290, 370];
const COLS = [...OFFS.slice(1).map((o) => -o).reverse(), ...OFFS];

const sand = new THREE.Color(0xd8b07a), dirt = new THREE.Color(0x9c8166), rust = new THREE.Color(0xb7825a);
const tmpC = new THREE.Color();

// ── Chunk ──────────────────────────────────────────────
export function buildChunk(k, opts) {
  const z0 = k * CHUNK;
  const ox = roadX(z0);
  const group = new THREE.Group();
  group.position.set(ox, 0, z0);
  const owned = []; // geometries to dispose with this chunk
  const colliders = []; // { x, z, r } in world space, for the truck and the player
  const wrecks = [];    // searchable abandoned cars

  const rowStep = opts.lite ? 10 : 5;
  const rows = CHUNK / rowStep + 1;
  const cols = COLS.length;

  // Terrain
  const pos = new Float32Array(rows * cols * 3);
  const col = new Float32Array(rows * cols * 3);
  for (let r = 0; r < rows; r++) {
    const z = z0 + r * rowStep;
    const rx = roadX(z);
    for (let c = 0; c < cols; c++) {
      const x = rx + COLS[c];
      const y = heightAt(x, z);
      const i = (r * cols + c) * 3;
      pos[i] = x - ox; pos[i + 1] = y; pos[i + 2] = z - z0;
      const d = Math.abs(COLS[c]);
      const v = n2(x / 25, z / 25) * 0.05 + n2(x / 7, z / 7) * 0.03;
      if (d < 8) tmpC.copy(dirt);
      else tmpC.copy(sand).lerp(rust, Math.max(0, Math.min(1, (y - roadY(z)) / 18)));
      col[i] = tmpC.r + v; col[i + 1] = tmpC.g + v; col[i + 2] = tmpC.b + v * 0.6;
    }
  }
  const idx = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  tg.setAttribute("color", new THREE.BufferAttribute(col, 3));
  tg.setIndex(idx);
  tg.computeVertexNormals();
  owned.push(tg);
  const terrain = new THREE.Mesh(tg, terrainMat);
  terrain.receiveShadow = !opts.lite;
  group.add(terrain);

  // Road strip
  const rp = new Float32Array(rows * 2 * 3), ruv = new Float32Array(rows * 2 * 2);
  for (let r = 0; r < rows; r++) {
    const z = z0 + r * rowStep;
    const rx = roadX(z), ry = roadY(z) + 0.03;
    const dir = roadDir(z);
    // Perpendicular to the road direction so the asphalt keeps its width on bends
    const px = dir.z * ROAD_HALF, pz = -dir.x * ROAD_HALF;
    rp.set([rx - px - ox, ry, z - pz - z0, rx + px - ox, ry, z + pz - z0], r * 6);
    const v = z / 10;
    ruv.set([1, v, 0, v], r * 4);
  }
  const ridx = [];
  for (let r = 0; r < rows - 1; r++) { const a = r * 2; ridx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute("position", new THREE.BufferAttribute(rp, 3));
  rg.setAttribute("uv", new THREE.BufferAttribute(ruv, 2));
  rg.setIndex(ridx);
  rg.computeVertexNormals();
  owned.push(rg);
  const road = new THREE.Mesh(rg, roadMat);
  road.receiveShadow = !opts.lite;
  group.add(road);

  // Scenery
  const rand = rng(k * 7919 + SEED * 31);
  const density = opts.lite ? 0.5 : 1;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const place = (geo, mat, count, minOff, maxOff, scaleFn, shadow, collR) => {
    const n = Math.round(count * density);
    if (!n) return;
    const im = new THREE.InstancedMesh(geo, mat, n);
    for (let i = 0; i < n; i++) {
      const z = z0 + rand() * CHUNK;
      const side = rand() < 0.5 ? -1 : 1;
      const x = roadX(z) + side * (minOff + rand() * (maxOff - minOff));
      const sc = scaleFn();
      p.set(x - ox, heightAt(x, z) - 0.1 * sc, z - z0);
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      s.set(sc, sc * (0.7 + rand() * 0.5), sc);
      im.setMatrixAt(i, m4.compose(p, q, s));
      const cr = collR ? collR(sc) : 0;
      if (cr > 0) colliders.push({ x, z, r: cr });
    }
    im.castShadow = shadow && !opts.lite;
    im.computeBoundingSphere();
    group.add(im);
  };
  place(rockGeo, rockMat, 36, 12, 300, () => 0.4 + rand() * rand() * 3.5, true, (sc) => (sc > 0.9 ? sc * 0.85 : 0));
  place(bushGeo, bushMat, 40, 9, 200, () => 0.5 + rand() * 0.7, false);
  place(cactusGeo, cactusMat, 24, 10, 220, () => 0.7 + rand() * 0.6, true, (sc) => 0.35 * sc);

  // Telephone poles along the left side
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, CHUNK / 40);
  for (let i = 0; i < CHUNK / 40; i++) {
    const z = z0 + i * 40 + 20;
    const x = roadX(z) - 10;
    const dir = roadDir(z);
    p.set(x - ox, heightAt(x, z) - 0.2, z - z0);
    q.setFromAxisAngle(up, Math.atan2(dir.x, dir.z));
    poles.setMatrixAt(i, m4.compose(p, q, s.set(1, 1, 1)));
    colliders.push({ x, z, r: 0.25 });
  }
  poles.castShadow = !opts.lite;
  poles.computeBoundingSphere();
  group.add(poles);

  // The odd abandoned car
  if (rand() < 0.3) {
    const z = z0 + rand() * CHUNK;
    const x = roadX(z) + (rand() < 0.5 ? -1 : 1) * (14 + rand() * 40);
    const w = new THREE.Mesh(wreckGeo, wreckMat);
    const yaw = rand() * Math.PI * 2;
    w.position.set(x - ox, heightAt(x, z) - 0.15, z - z0);
    w.rotation.set((rand() - 0.5) * 0.15, yaw, (rand() - 0.5) * 0.2);
    w.castShadow = !opts.lite;
    group.add(w);
    // Two circles along the wreck's length
    const fx = Math.sin(yaw) * 1.1, fz = Math.cos(yaw) * 1.1;
    colliders.push({ x: x + fx, z: z + fz, r: 1.1 }, { x: x - fx, z: z - fz, r: 1.1 });
    wrecks.push({ id: "w" + k, x, z });
  }

  return {
    k, group, colliders, wrecks,
    dispose() {
      group.traverse((o) => {
        if (o.isInstancedMesh) o.dispose();
        else if (o.userData.ownGeo) o.geometry.dispose();
      });
      owned.forEach((g) => g.dispose());
    },
  };
}

// ── Chunk manager ──────────────────────────────────────
export class World {
  constructor(scene, extras) {
    this.scene = scene;
    this.extras = extras || [];   // other per-chunk builders (stations, signs)
    this.chunks = new Map();
    this.opts = { lite: false, ahead: 3, behind: 1 };
  }
  setOptions(o) {
    const relite = o.lite !== this.opts.lite;
    Object.assign(this.opts, o);
    if (relite) this.clear();
  }
  clear() {
    for (const c of this.chunks.values()) this.drop(c);
    this.chunks.clear();
  }
  drop(c) {
    this.scene.remove(c.group);
    c.dispose();
  }
  // Colliders from the chunks around z
  collidersNear(z) {
    const kc = Math.floor(z / CHUNK), out = [];
    for (let k = kc - 1; k <= kc + 1; k++) { const c = this.chunks.get(k); if (c) out.push(...c.colliders); }
    return out;
  }
  wrecksNear(x, z, range) {
    const kc = Math.floor(z / CHUNK);
    for (let k = kc - 1; k <= kc + 1; k++) {
      const c = this.chunks.get(k);
      if (!c) continue;
      for (const w of c.wrecks) if (Math.hypot(w.x - x, w.z - z) < range) return w;
    }
    return null;
  }
  // Builds at most one missing chunk per call (except when forced) to avoid hitches
  update(z, force) {
    const kc = Math.floor(z / CHUNK);
    const lo = kc - this.opts.behind, hi = kc + this.opts.ahead;
    for (const [k, c] of this.chunks) {
      if (k < lo || k > hi) { this.drop(c); this.chunks.delete(k); }
    }
    const order = [kc];
    for (let i = 1; i <= Math.max(this.opts.ahead, this.opts.behind); i++) { order.push(kc + i, kc - i); }
    for (const k of order) {
      if (k < lo || k > hi || this.chunks.has(k)) continue;
      const c = buildChunk(k, this.opts);
      for (const fn of this.extras) fn(k, c, this.opts);
      this.scene.add(c.group);
      this.chunks.set(k, c);
      if (!force) break;
    }
  }
}
