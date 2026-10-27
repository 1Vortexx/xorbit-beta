// Long Haul – gas stations: seeded placement, models, roadside signs, and the pump check
import * as THREE from "three";
import { CHUNK, roadX, roadY, roadDir, heightAt, getSeed, rng } from "./world.js";

const SIDE = -1;            // stations sit on the right-hand side (−x when facing +z)
const PUMP_OFF = 11;        // pumps are this far from the centreline
const SIGN_BEFORE = 1000;   // a "fuel ahead" sign this far before each station

// ── Placement ──────────────────────────────────────────
let list = [];
let rand = null;
export function resetStations() {
  list = [];
  rand = rng(getSeed() * 2654435761);
}
function ensure(z) {
  if (!rand) resetStations();
  while (!list.length || list[list.length - 1].z < z + 2 * CHUNK) {
    const prev = list.length ? list[list.length - 1].z : 300;
    const zs = list.length ? prev + 5000 + rand() * 7000 : 900;
    list.push(makeStation(zs));
  }
}
function makeStation(zs) {
  const dir = roadDir(zs);
  const perp = { x: dir.z, z: -dir.x };
  const rx = roadX(zs);
  const at = (lx, lz) => ({ x: rx + perp.x * lx + dir.x * lz, z: zs + perp.z * lx + dir.z * lz });
  return {
    z: zs,
    yaw: Math.atan2(dir.x, dir.z),
    at,
    pumps: [at(SIDE * PUMP_OFF, -4), at(SIDE * PUMP_OFF, 4)],
    shop: at(SIDE * 20.6, 0),   // standing spot just outside the shop window
  };
}
function nearest(z) {
  ensure(z);
  let lo = 0, hi = list.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].z < z) lo = m + 1; else hi = m; }
  let best = list[lo];
  if (lo > 0 && Math.abs(list[lo - 1].z - z) < Math.abs(best.z - z)) best = list[lo - 1];
  return best;
}
export function stationsIn(z0, z1) {
  ensure(z1);
  return list.filter((s) => s.z >= z0 && s.z < z1);
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 0..1: how much the terrain is levelled for a station forecourt
export function stationFlatten(z, off) {
  if (z < 600) return 0;
  const s = nearest(z);
  const dz = Math.abs(z - s.z);
  if (dz > 34) return 0;
  const o = off * SIDE;
  return (1 - smooth(24, 34, dz)) * smooth(2, 6, o) * (1 - smooth(30, 40, o));
}

// Is (x, z) close enough to a pump to refuel?
export function nearPump(x, z) {
  if (z < 600) return false;
  const s = nearest(z);
  return s.pumps.some((p) => Math.hypot(p.x - x, p.z - z) < 4.5);
}

// Is (x, z) at a station shop counter? Returns the station or null
export function shopNear(x, z) {
  if (z < 600) return null;
  const s = nearest(z);
  return Math.hypot(s.shop.x - x, s.shop.z - z) < 3 ? s : null;
}

// ── Models ─────────────────────────────────────────────
const mats = {
  pad: new THREE.MeshLambertMaterial({ color: 0x9a948a }),
  post: new THREE.MeshLambertMaterial({ color: 0xe8e2d6 }),
  roof: new THREE.MeshLambertMaterial({ color: 0xc23b2e, flatShading: true }),
  glow: new THREE.MeshBasicMaterial({ color: 0xfff1c8 }),
  pump: new THREE.MeshLambertMaterial({ color: 0xd9452f }),
  wall: new THREE.MeshLambertMaterial({ color: 0xcdb48e }),
  glass: new THREE.MeshLambertMaterial({ color: 0x2b3a44, emissive: 0x1a1408 }),
  pole: new THREE.MeshLambertMaterial({ color: 0x4d4d52 }),
  sign: new THREE.MeshBasicMaterial({ map: textTexture("FUEL", "#c23b2e") }),
  ahead: new THREE.MeshLambertMaterial({ map: textTexture("FUEL  1 KM", "#2f5d3a"), emissive: 0x111111 }),
};
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const geos = {
  post: box(0.35, 5.6, 0.35), roof: box(9, 0.5, 20), glow: box(8.4, 0.05, 19.4),
  pump: box(0.9, 1.7, 0.6), island: box(1.6, 0.25, 3), wall: box(7, 3.6, 11), glass: box(0.05, 1.6, 6),
  pole: box(0.3, 8, 0.3), sign: box(3.2, 1.4, 0.2), signPost: box(0.15, 2.6, 0.15), aheadBoard: box(2.6, 1.2, 0.08),
};

function textTexture(text, bg) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 112;
  const g = c.getContext("2d");
  g.fillStyle = bg; g.fillRect(0, 0, 256, 112);
  g.strokeStyle = "#f4ecd8"; g.lineWidth = 6; g.strokeRect(6, 6, 244, 100);
  g.fillStyle = "#f4ecd8";
  g.font = "bold 46px 'Arial Black', Arial, sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, 128, 58);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function add(parent, geo, mat, x, y, z, shadow) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = !!shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// Forecourt slab that follows the ground
function padMesh(s, origin) {
  const nx = 6, nz = 10, x0 = SIDE * 6, x1 = SIDE * 30, z0 = -24, z1 = 24;
  const pos = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const p = s.at(x0 + (x1 - x0) * (i / nx), z0 + (z1 - z0) * (j / nz));
      pos.push(p.x - origin.x, heightAt(p.x, p.z) + 0.05, p.z - origin.z);
    }
  }
  const idx = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Winding depends on the side, so render both faces
  const m = new THREE.Mesh(g, mats.pad);
  m.material = mats.pad;
  m.userData.ownGeo = true;
  m.receiveShadow = true;
  return m;
}
mats.pad.side = THREE.DoubleSide;

function buildStation(s, chunk, lite) {
  const group = chunk.group;
  const o = group.position;
  const col = (lx, lz, r) => { const p = s.at(lx, lz); chunk.colliders.push({ x: p.x, z: p.z, r }); };
  for (const px of [7, 15]) for (const pz of [-8, 8]) col(SIDE * px, pz, 0.3);
  for (const pz of [-4, 4]) col(SIDE * (PUMP_OFF + 1.4), pz, 0.9);
  for (const pz of [-3.7, 0, 3.7]) col(SIDE * 25, pz, 3.6);
  col(SIDE * 7, 20, 0.25);
  group.add(padMesh(s, o));
  const base = s.at(0, 0);
  const st = new THREE.Group();
  st.position.set(base.x - o.x, roadY(s.z), base.z - o.z);
  st.rotation.y = s.yaw;
  group.add(st);
  const sh = !lite;
  const X = (v) => SIDE * v;
  // Canopy over the pumps
  for (const px of [7, 15]) for (const pz of [-8, 8]) add(st, geos.post, mats.post, X(px), 2.8, pz, sh);
  add(st, geos.roof, mats.roof, X(11), 5.85, 0, sh);
  add(st, geos.glow, mats.glow, X(11), 5.57, 0);
  // Pumps
  for (const pz of [-4, 4]) {
    add(st, geos.island, mats.post, X(PUMP_OFF + 1.4), 0.12, pz);
    add(st, geos.pump, mats.pump, X(PUMP_OFF + 1.4), 1.05, pz, sh);
  }
  // Shop
  add(st, geos.wall, mats.wall, X(25), 1.8, 0, sh);
  add(st, geos.glass, mats.glass, X(21.47), 1.6, 0);
  // Tall sign
  add(st, geos.pole, mats.pole, X(7), 4, 20, sh);
  const sign = add(st, geos.sign, mats.sign, X(7), 8.4, 20, sh);
  sign.rotation.y = Math.PI / 2;
}

function buildAheadSign(zs, group) {
  const z = zs - SIGN_BEFORE;
  const dir = roadDir(z);
  const x = roadX(z) + dir.z * SIDE * 6.5;
  const zz = z - dir.x * SIDE * 6.5;
  const g = new THREE.Group();
  g.position.set(x - group.position.x, heightAt(x, zz), zz - group.position.z);
  g.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI; // face oncoming traffic
  add(g, geos.signPost, mats.pole, -0.9, 1.3, 0);
  add(g, geos.signPost, mats.pole, 0.9, 1.3, 0);
  add(g, geos.aheadBoard, mats.ahead, 0, 2.6, 0);
  group.add(g);
}

// Per-chunk builder for World
export function stationExtras(k, chunk, opts) {
  const z0 = k * CHUNK, z1 = z0 + CHUNK;
  for (const s of stationsIn(z0, z1)) buildStation(s, chunk, opts.lite);
  for (const s of stationsIn(z0 + SIGN_BEFORE, z1 + SIGN_BEFORE)) buildAheadSign(s.z, chunk.group);
}
