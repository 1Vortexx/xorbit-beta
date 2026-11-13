// Long Haul – item definitions (ItemDef, ARCHITECTURE.md §4), procedural item meshes and item helpers.
// Pure data + lazily built geometry: nothing touches the DOM at import, so this loads in Node.
import * as THREE from "three";
import { ws } from "./core/worldstate.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const up = (needs, k, n) => { needs[k] = clamp((needs[k] ?? 0) + n, 0, 100); };

// ───────────────────────────── mesh helpers ─────────────────────────────
const mats = new Map();
function M(color, o = {}) {
  const key = color + "|" + (o.r ?? 0.6) + "|" + (o.m ?? 0) + "|" + (o.a ?? 1) + "|" + (o.e ?? 0);
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: o.r ?? 0.6, metalness: o.m ?? 0 });
    if (o.a !== undefined && o.a < 1) { m.transparent = true; m.opacity = o.a; m.depthWrite = false; }
    if (o.e) { m.emissive = new THREE.Color(o.e); m.emissiveIntensity = 0.6; }
    mats.set(key, m);
  }
  return m;
}
// Small canvas label, built on first use. In Node (no document) falls back to a flat colour.
function L(key, bg, draw, o = {}) {
  const k = "label:" + key;
  let m = mats.get(k);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: o.r ?? 0.55, metalness: o.m ?? 0 });
  if (typeof document === "undefined") m.color.set(bg);
  else {
    const w = o.w || 128, h = o.h || 64;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.textAlign = "center"; g.textBaseline = "middle";
    draw(g, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    m.map = t;
  }
  mats.set(k, m);
  return m;
}
const text = (g, s, x, y, px, col, font = "bold") => { g.fillStyle = col; g.font = `${font} ${px}px Arial, Helvetica, sans-serif`; g.fillText(s, x, y); };
// A label that repeats its artwork twice around a can / bottle
function wrapLabel(key, bg, title, sub, fg = "#fff", accent = null) {
  return L(key, bg, (g, w, h) => {
    if (accent) { g.fillStyle = accent; g.fillRect(0, 0, w, h * 0.16); g.fillRect(0, h * 0.84, w, h * 0.16); }
    for (const x of [w * 0.25, w * 0.75]) {
      text(g, title, x, h * (sub ? 0.42 : 0.5), title.length > 5 ? 20 : 26, fg);
      if (sub) text(g, sub, x, h * 0.7, 12, fg, "normal");
    }
  }, { w: 256, h: 64 });
}
function flatLabel(key, bg, title, sub, fg = "#fff", accent = null) {
  return L(key, bg, (g, w, h) => {
    if (accent) { g.fillStyle = accent; g.fillRect(0, h * 0.78, w, h * 0.22); }
    text(g, title, w / 2, h * (sub ? 0.38 : 0.5), title.length > 6 ? 22 : 30, fg);
    if (sub) text(g, sub, w / 2, h * 0.66, 14, fg, "normal");
  }, { w: 128, h: 96 });
}

function add(g, mesh, x = 0, y = 0, z = 0) {
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  g.add(mesh);
  return mesh;
}
const box = (g, w, h, d, mat, x, y, z) => add(g, new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat), x, y, z);
const cyl = (g, rt, rb, h, mat, x, y, z, seg = 16) => add(g, new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat), x, y, z);
// Box with a label on its ±z faces (and optionally the top)
function labelBox(g, w, h, d, mat, label, x, y, z, top = null) {
  return add(g, new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [mat, mat, top || mat, mat, label, label]), x, y, z);
}
// Cylinder with a wrapped label on the side
function labelCyl(g, r, h, label, cap, x, y, z) {
  return add(g, new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), [label, cap, cap]), x, y, z);
}
// Liquid column whose height follows the fill fraction (base at y0)
function liquid(g, geo, mat, x, y0, z, fullH) {
  geo.translate(0, fullH / 2, 0);
  const m = add(g, new THREE.Mesh(geo, mat), x, y0, z);
  m.castShadow = false;
  return (f) => { m.visible = f > 0.01; m.scale.y = Math.max(0.01, f); };
}
// Sight strip on the side of an opaque container
function gauge(g, x, y0, z, h, color, alongX = false) {
  const w = 0.016, t = 0.004;
  box(g, alongX ? t : w, h + 0.008, alongX ? w : t, M(0x1b1b1b, { r: 0.4 }), x, y0 + h / 2, z).castShadow = false;
  const geo = new THREE.BoxGeometry(alongX ? t * 1.6 : w * 0.7, h, alongX ? w * 0.7 : t * 1.6);
  return liquid(g, geo, M(color, { r: 0.3, e: color }), x, y0, z, h);
}
const frac = (item, def) => (def.cap ? clamp((item?.qty ?? def.cap) / def.cap, 0, 1) : 1);
function withFill(g, item, def, setters) {
  g.userData.setFill = (f) => setters.forEach((s) => s(f));
  g.userData.setFill(frac(item, def));
  return g;
}

// ───────────────────────────── meshes ─────────────────────────────
const CHROME = () => M(0xc9ced4, { r: 0.25, m: 0.9 });
const TIN = () => M(0xb4b8bc, { r: 0.35, m: 0.8 });
const BLACK = () => M(0x16171a, { r: 0.7 });

function meshWater() {
  const g = new THREE.Group(), clear = M(0x9fd4f2, { r: 0.1, a: 0.55 });
  cyl(g, 0.033, 0.033, 0.15, clear, 0, -0.035, 0);
  cyl(g, 0.013, 0.033, 0.04, clear, 0, 0.06, 0);
  cyl(g, 0.015, 0.015, 0.03, M(0x2f7fd0, { r: 0.5 }), 0, 0.095, 0);
  labelCyl(g, 0.0338, 0.055, wrapLabel("water", "#1f6fc4", "WATER", "0.5 L", "#fff", "#8fd0ff"), clear, 0, -0.03, 0).castShadow = false;
  return g;
}
function meshWaterJug(item) {
  const g = new THREE.Group(), clear = M(0xa9d8f0, { r: 0.15, a: 0.4 });
  cyl(g, 0.078, 0.078, 0.22, clear, 0, -0.04, 0, 20);
  cyl(g, 0.03, 0.078, 0.04, clear, 0, 0.09, 0, 20);
  cyl(g, 0.026, 0.026, 0.035, M(0x1f6fc4, { r: 0.5 }), 0, 0.1275, 0);
  const h = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 6, 12, Math.PI), M(0xbfe3f5, { r: 0.3 }));
  h.rotation.z = -Math.PI / 2; add(g, h, 0.07, 0.03, 0);
  labelCyl(g, 0.0788, 0.07, wrapLabel("waterjug", "#e9f4fb", "WATER", "4 L", "#1f6fc4", "#1f6fc4"), clear, 0, -0.03, 0).castShadow = false;
  const fill = liquid(g, new THREE.CylinderGeometry(0.072, 0.072, 0.21, 16), M(0x3d9be0, { r: 0.1, a: 0.75 }), 0, -0.146, 0, 0.21);
  return withFill(g, item, ITEMS.waterjug, [fill]);
}
function meshBeans() {
  const g = new THREE.Group();
  labelCyl(g, 0.0375, 0.104, wrapLabel("beans", "#b8321e", "BEANS", "in tomato sauce", "#ffe9b0", "#f0a030"), TIN(), 0, 0, 0);
  cyl(g, 0.0385, 0.0385, 0.004, TIN(), 0, 0.053, 0, 20);
  cyl(g, 0.0385, 0.0385, 0.004, TIN(), 0, -0.053, 0, 20);
  return g;
}
function meshJerky() {
  const g = new THREE.Group();
  labelBox(g, 0.12, 0.14, 0.022, M(0x3a1410, { r: 0.45 }), flatLabel("jerky", "#5a1a12", "JERKY", "smoked beef", "#f6d98a", "#221010"), 0, -0.012, 0);
  box(g, 0.12, 0.024, 0.006, M(0x2a0e0b, { r: 0.4 }), 0, 0.071, 0);
  box(g, 0.03, 0.006, 0.007, M(0xe8e0d0), 0, 0.076, 0);
  return g;
}
function meshChips() {
  const g = new THREE.Group(), foil = M(0xe2b21c, { r: 0.3, m: 0.3 });
  const body = labelBox(g, 0.15, 0.17, 0.06, foil, flatLabel("chips", "#e8b21a", "CHIPS", "salted", "#b3261e", "#b3261e"), 0, 0, 0);
  body.geometry.dispose();
  // pillow shape: pinch the top and bottom edges
  const geo = new THREE.BoxGeometry(0.15, 0.17, 0.06, 1, 4, 1), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const t = Math.abs(p.getY(i)) / 0.085; p.setZ(i, p.getZ(i) * (1 - 0.8 * t * t)); }
  geo.computeVertexNormals();
  body.geometry = geo;
  box(g, 0.16, 0.025, 0.004, M(0xc8c8c8, { r: 0.3, m: 0.6 }), 0, 0.0975, 0);
  box(g, 0.16, 0.025, 0.004, M(0xc8c8c8, { r: 0.3, m: 0.6 }), 0, -0.0975, 0);
  return g;
}
function meshSoda() {
  const g = new THREE.Group(), al = M(0xd4d7da, { r: 0.25, m: 0.9 });
  labelCyl(g, 0.033, 0.1, wrapLabel("soda", "#c4161c", "COLA", null, "#fff", "#ffffff"), al, 0, -0.004, 0);
  cyl(g, 0.027, 0.033, 0.012, al, 0, 0.052, 0, 20);
  cyl(g, 0.033, 0.028, 0.008, al, 0, -0.057, 0, 20);
  box(g, 0.012, 0.003, 0.02, M(0x9a9da0, { r: 0.3, m: 0.9 }), 0, 0.0595, 0.004);
  return g;
}
function meshCoffee() {
  const g = new THREE.Group(), glass = M(0x5a3518, { r: 0.12, a: 0.85 });
  cyl(g, 0.034, 0.034, 0.095, glass, 0, -0.0225, 0);
  cyl(g, 0.018, 0.034, 0.025, glass, 0, 0.0375, 0);
  cyl(g, 0.019, 0.019, 0.02, M(0xd8c27a, { r: 0.3, m: 0.7 }), 0, 0.06, 0);
  labelCyl(g, 0.0347, 0.055, wrapLabel("coffee", "#efe2c4", "COFFEE", "iced", "#4a2a12", "#4a2a12"), glass, 0, -0.022, 0).castShadow = false;
  return g;
}
function crossLabel(key, bg, fg) {
  return L(key, bg, (g, w, h) => { g.fillStyle = fg; g.fillRect(w / 2 - 10, h / 2 - 28, 20, 56); g.fillRect(w / 2 - 28, h / 2 - 10, 56, 20); }, { w: 128, h: 96, r: 0.5 });
}
function meshMedkit() {
  const g = new THREE.Group(), white = M(0xeeeeea, { r: 0.5 }), cross = crossLabel("medkit", "#eeeeea", "#d0201c");
  labelBox(g, 0.28, 0.09, 0.2, white, cross, 0, -0.005, 0, cross);
  box(g, 0.285, 0.012, 0.205, M(0xd0201c, { r: 0.5 }), 0, 0.0, 0);
  box(g, 0.09, 0.012, 0.02, M(0x333333), 0, 0.044, 0);
  box(g, 0.03, 0.03, 0.006, TIN(), 0.08, 0.0, 0.103);
  box(g, 0.03, 0.03, 0.006, TIN(), -0.08, 0.0, 0.103);
  return g;
}
function meshBandage() {
  const g = new THREE.Group();
  cyl(g, 0.034, 0.034, 0.05, M(0xf2efe6, { r: 0.95 }), 0, 0, 0, 18);
  cyl(g, 0.012, 0.012, 0.052, M(0x8a8478, { r: 0.9 }), 0, 0, 0, 10);
  box(g, 0.004, 0.044, 0.014, M(0xd0201c, { r: 0.7 }), 0.034, 0, 0);
  return g;
}
function meshFuelCan(item) {
  const g = new THREE.Group(), red = M(0xc8231a, { r: 0.45 });
  labelBox(g, 0.28, 0.23, 0.18, red, flatLabel("fuelcan", "#c8231a", "FUEL", "10 L", "#ffe24a", "#8f1410"), 0, -0.045, 0);
  box(g, 0.2, 0.03, 0.14, red, -0.03, 0.085, 0);
  // handle
  box(g, 0.14, 0.02, 0.035, red, -0.05, 0.145, 0);
  box(g, 0.02, 0.05, 0.035, red, -0.11, 0.122, 0);
  box(g, 0.02, 0.05, 0.035, red, 0.01, 0.122, 0);
  // spout
  const sp = cyl(g, 0.011, 0.018, 0.1, M(0xe8c21a, { r: 0.5 }), 0.105, 0.115, 0, 10);
  sp.rotation.z = -0.6;
  cyl(g, 0.024, 0.024, 0.02, BLACK(), 0.075, 0.08, 0, 12);
  const fill = gauge(g, -0.142, -0.15, 0, 0.2, 0xffc02a, true);
  return withFill(g, item, ITEMS.fuelcan, [fill]);
}
function meshJerryCan(item) {
  const g = new THREE.Group(), green = M(0x4a5a2c, { r: 0.55, m: 0.35 }), dk = M(0x3b4823, { r: 0.55, m: 0.35 });
  labelBox(g, 0.34, 0.37, 0.17, green, flatLabel("jerrycan", "#4a5a2c", "20 L", "FUEL", "#e8e2b0"), 0, -0.045, 0);
  // pressed X ribs on both faces
  for (const s of [1, -1]) for (const r of [0.75, -0.75]) {
    const rib = box(g, 0.36, 0.022, 0.008, dk, 0, -0.1, s * 0.087);
    rib.rotation.z = r;
  }
  box(g, 0.22, 0.045, 0.15, green, -0.04, 0.16, 0);
  for (const z of [-0.05, 0, 0.05]) box(g, 0.16, 0.016, 0.018, dk, -0.05, 0.215, z);
  box(g, 0.016, 0.04, 0.12, dk, -0.13, 0.2, 0);
  box(g, 0.016, 0.04, 0.12, dk, 0.03, 0.2, 0);
  const sp = cyl(g, 0.026, 0.026, 0.05, dk, 0.125, 0.165, 0, 12);
  sp.rotation.z = -0.5;
  box(g, 0.05, 0.012, 0.03, TIN(), 0.14, 0.195, 0).rotation.z = -0.5;
  const fill = gauge(g, -0.172, -0.21, 0, 0.3, 0xffc02a, true);
  return withFill(g, item, ITEMS.jerrycan, [fill]);
}
function meshOil(item) {
  const g = new THREE.Group(), body = M(0x23262b, { r: 0.4 });
  labelBox(g, 0.09, 0.16, 0.06, body, flatLabel("oil", "#e2a81a", "OIL", "10W-40  1 L", "#1b1b1b", "#1b1b1b"), 0, -0.03, 0);
  box(g, 0.05, 0.03, 0.05, body, -0.015, 0.065, 0);
  cyl(g, 0.014, 0.014, 0.03, M(0xc8231a, { r: 0.5 }), -0.02, 0.095, 0, 10);
  const fill = gauge(g, 0.046, -0.1, 0, 0.14, 0xd9a13a, true);
  return withFill(g, item, ITEMS.oil, [fill]);
}
function meshOilJug(item) {
  const g = new THREE.Group(), body = M(0x2a2d33, { r: 0.4 });
  labelBox(g, 0.19, 0.2, 0.11, body, flatLabel("oiljug", "#d99a12", "MOTOR OIL", "4 L", "#1b1b1b", "#1b1b1b"), 0, -0.04, 0);
  box(g, 0.1, 0.05, 0.1, body, -0.045, 0.085, 0);
  box(g, 0.085, 0.018, 0.03, body, 0.05, 0.1, 0);
  box(g, 0.018, 0.045, 0.03, body, 0.086, 0.08, 0);
  cyl(g, 0.02, 0.02, 0.03, M(0xd99a12, { r: 0.5 }), -0.05, 0.125, 0, 12);
  const fill = gauge(g, -0.096, -0.13, 0, 0.18, 0xd9a13a, true);
  return withFill(g, item, ITEMS.oiljug, [fill]);
}
function meshCoolant(item) {
  const g = new THREE.Group(), body = M(0xe6ecea, { r: 0.3, a: 0.45 });
  const fill = liquid(g, new THREE.BoxGeometry(0.176, 0.2, 0.106), M(0x2fd06a, { r: 0.2, a: 0.85, e: 0x0c5a28 }), 0, -0.143, 0, 0.2);
  box(g, 0.19, 0.21, 0.12, body, 0, -0.04, 0);
  labelBox(g, 0.192, 0.09, 0.122, body, flatLabel("coolant", "#0f7a3c", "COOLANT", "antifreeze 4 L", "#fff", "#0a4f27"), 0, -0.02, 0).castShadow = false;
  box(g, 0.1, 0.045, 0.1, body, -0.045, 0.0875, 0);
  box(g, 0.085, 0.018, 0.03, body, 0.05, 0.1, 0);
  box(g, 0.018, 0.04, 0.03, body, 0.086, 0.085, 0);
  cyl(g, 0.022, 0.022, 0.035, M(0x0f7a3c, { r: 0.5 }), -0.05, 0.1275, 0, 12);
  return withFill(g, item, ITEMS.coolant, [fill]);
}
function meshWrench() {
  const g = new THREE.Group(), ch = CHROME();
  box(g, 0.25, 0.012, 0.026, ch, 0, 0, 0);
  // ring end
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.011, 8, 18), ch);
  ring.rotation.x = Math.PI / 2; add(g, ring, -0.15, 0, 0);
  // open jaw
  box(g, 0.04, 0.014, 0.07, ch, 0.135, 0, 0);
  box(g, 0.045, 0.014, 0.02, ch, 0.168, 0, 0.03).rotation.y = -0.25;
  box(g, 0.045, 0.014, 0.02, ch, 0.168, 0, -0.03).rotation.y = 0.25;
  box(g, 0.1, 0.014, 0.03, M(0xb3261e, { r: 0.6 }), -0.03, 0, 0);
  return g;
}
function meshJack() {
  const g = new THREE.Group(), red = M(0xb3261e, { r: 0.5, m: 0.3 }), steel = M(0x4a4d52, { r: 0.4, m: 0.8 });
  box(g, 0.2, 0.012, 0.11, steel, 0, -0.064, 0);
  box(g, 0.1, 0.014, 0.08, steel, 0, 0.063, 0);
  for (const z of [-0.04, 0.04]) for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const arm = box(g, 0.185, 0.02, 0.012, red, sx * 0.08, sy * 0.03, z);
    arm.rotation.z = -sx * sy * 0.36;
  }
  const rod = cyl(g, 0.007, 0.007, 0.4, steel, 0, 0, 0, 8);
  rod.rotation.z = Math.PI / 2;
  for (const x of [-0.165, 0.165]) box(g, 0.02, 0.03, 0.1, steel, x, 0, 0);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.004, 6, 10), steel);
  ring.rotation.y = Math.PI / 2; add(g, ring, 0.2, 0, 0);
  // lug wrench lying on the base
  const lug = cyl(g, 0.007, 0.007, 0.3, CHROME(), 0, -0.05, 0.05, 8);
  lug.rotation.z = Math.PI / 2;
  return g;
}
function meshRepairKit() {
  const g = new THREE.Group(), red = M(0xb3261e, { r: 0.4, m: 0.5 });
  labelBox(g, 0.4, 0.13, 0.19, red, flatLabel("repairkit", "#b3261e", "REPAIR", "KIT", "#f2f2f2"), 0, -0.035, 0);
  box(g, 0.4, 0.035, 0.15, M(0x9c2019, { r: 0.4, m: 0.5 }), 0, 0.0475, 0);
  box(g, 0.405, 0.008, 0.195, BLACK(), 0, 0.03, 0);
  box(g, 0.16, 0.012, 0.022, BLACK(), 0, 0.094, 0);
  box(g, 0.014, 0.03, 0.022, BLACK(), -0.08, 0.08, 0);
  box(g, 0.014, 0.03, 0.022, BLACK(), 0.08, 0.08, 0);
  for (const x of [-0.12, 0.12]) box(g, 0.035, 0.04, 0.008, TIN(), x, 0.028, 0.097);
  return g;
}
function meshFlashlight() {
  const g = new THREE.Group(), body = M(0x1d1f23, { r: 0.45, m: 0.5 });
  const b = cyl(g, 0.016, 0.016, 0.13, body, 0, 0, -0.025, 12); b.rotation.x = Math.PI / 2;
  const h = cyl(g, 0.025, 0.017, 0.045, body, 0, 0, 0.0625, 14); h.rotation.x = Math.PI / 2;
  const l = cyl(g, 0.021, 0.021, 0.004, M(0xfff3c0, { r: 0.2, e: 0xffe9a0 }), 0, 0, 0.0865, 14); l.rotation.x = Math.PI / 2;
  l.castShadow = false;
  box(g, 0.008, 0.005, 0.018, M(0xd9a13a), 0, 0.017, 0.0);
  return g;
}
// Placeholder part meshes – the real defs from js/vehicles/components.js override these when they bring a makeMesh.
function meshEngine(cyls, vee) {
  return () => {
    const g = new THREE.Group(), iron = M(0x4b4f55, { r: 0.6, m: 0.6 }), cover = M(vee ? 0xb3541e : 0x2f5d8a, { r: 0.45, m: 0.4 });
    const len = vee ? 0.62 : 0.2 + cyls * 0.1, w = vee ? 0.56 : 0.42;
    box(g, w * 0.7, 0.3, len, iron, 0, -0.08, 0);
    box(g, w * 0.5, 0.1, len * 0.9, M(0x2b2d31, { r: 0.6, m: 0.5 }), 0, -0.27, 0);
    if (vee) for (const s of [-1, 1]) {
      box(g, 0.2, 0.16, len * 0.92, iron, s * 0.17, 0.1, 0).rotation.z = -s * 0.7;
      box(g, 0.15, 0.05, len * 0.88, cover, s * 0.23, 0.19, 0).rotation.z = -s * 0.7;
    } else {
      box(g, w * 0.55, 0.14, len * 0.96, iron, 0, 0.14, 0);
      box(g, w * 0.45, 0.06, len * 0.9, cover, 0, 0.24, 0);
      for (let i = 0; i < cyls; i++) cyl(g, 0.018, 0.018, 0.14, M(0x8a5a3a, { r: 0.5, m: 0.7 }), w * 0.36, 0.1, (i - (cyls - 1) / 2) * (len * 0.86 / cyls), 8).rotation.z = Math.PI / 2;
    }
    const air = cyl(g, 0.11, 0.11, 0.06, M(0x1c1d20, { r: 0.5 }), 0, vee ? 0.27 : 0.29, 0, 16);
    air.castShadow = true;
    const pul = cyl(g, 0.09, 0.09, 0.03, M(0x1c1d20, { r: 0.4, m: 0.6 }), 0, -0.1, len / 2 + 0.02, 16); pul.rotation.x = Math.PI / 2;
    const fan = cyl(g, 0.05, 0.05, 0.03, TIN(), 0.12, 0.08, len / 2 + 0.02, 12); fan.rotation.x = Math.PI / 2;
    box(g, w * 0.5, 0.26, 0.1, M(0x6a6e74, { r: 0.5, m: 0.6 }), 0, -0.1, -len / 2 - 0.05);
    return g;
  };
}
function meshBattery() {
  const g = new THREE.Group();
  labelBox(g, 0.26, 0.15, 0.17, BLACK(), flatLabel("battery", "#1b1d22", "12V", "BATTERY", "#f0c020", "#b3261e"), 0, -0.02, 0);
  box(g, 0.265, 0.03, 0.175, M(0x2a2d33, { r: 0.6 }), 0, 0.065, 0);
  cyl(g, 0.012, 0.012, 0.02, M(0xb3261e, { r: 0.4, m: 0.6 }), -0.085, 0.09, 0.04, 10);
  cyl(g, 0.012, 0.012, 0.02, M(0x7d8288, { r: 0.4, m: 0.8 }), 0.085, 0.09, 0.04, 10);
  for (let i = -2; i <= 2; i++) cyl(g, 0.012, 0.012, 0.006, M(0xd9a13a), i * 0.035, 0.082, -0.04, 8);
  return g;
}
function meshRadiator() {
  const g = new THREE.Group(), fin = L("radfins", "#2a2c30", (c, w, h) => {
    c.strokeStyle = "#5c6066"; c.lineWidth = 1;
    for (let x = 1; x < w; x += 4) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
    c.strokeStyle = "#17181a"; c.lineWidth = 2;
    for (let y = 8; y < h; y += 12) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
  }, { w: 128, h: 96, r: 0.5, m: 0.6 });
  const tank = M(0x1c1d20, { r: 0.5, m: 0.4 });
  labelBox(g, 0.58, 0.33, 0.045, tank, fin, 0, -0.01, 0);
  box(g, 0.62, 0.05, 0.07, tank, 0, 0.18, 0);
  box(g, 0.62, 0.05, 0.07, tank, 0, -0.2, 0);
  cyl(g, 0.028, 0.028, 0.02, TIN(), -0.18, 0.215, 0, 12);
  const o = cyl(g, 0.018, 0.018, 0.05, tank, 0.24, 0.18, 0.05, 10); o.rotation.x = Math.PI / 2;
  const o2 = cyl(g, 0.018, 0.018, 0.05, tank, -0.24, -0.2, 0.05, 10); o2.rotation.x = Math.PI / 2;
  return g;
}
function meshWheel(d, w) {
  return (item) => {
    const g = new THREE.Group(), r = d / 2;
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(r - w * 0.42, w * 0.42, 10, 24), M(0x15161a, { r: 0.92 }));
    tyre.rotation.x = Math.PI / 2; tyre.scale.z = 1.15; add(g, tyre, 0, 0, 0);
    cyl(g, r * 0.62, r * 0.62, w * 0.55, M(0x8d9298, { r: 0.4, m: 0.8 }), 0, 0, 0, 20);
    cyl(g, r * 0.5, r * 0.56, w * 0.2, M(0x5b5f65, { r: 0.4, m: 0.8 }), 0, w * 0.3, 0, 20);
    cyl(g, r * 0.16, r * 0.16, w * 0.12, CHROME(), 0, w * 0.42, 0, 12);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; cyl(g, 0.012, 0.012, 0.02, CHROME(), Math.cos(a) * r * 0.3, w * 0.41, Math.sin(a) * r * 0.3, 6); }
    if (item && item.flat) g.scale.y = 0.85;
    return g;
  };
}

// ───────────────────────────── definitions ─────────────────────────────
const food = (need, amount, side = {}) => (ctx) => {
  const n = ctx.needs;
  if (need === "hunger" && n.hunger >= 98) throw "You're not hungry";
  if (need === "thirst" && n.thirst >= 98) throw "You're not thirsty";
  up(n, need, amount);
  const parts = [`${need[0].toUpperCase() + need.slice(1)} +${amount}`];
  for (const [k, v] of Object.entries(side)) { up(n, k, v); parts.push(`${k} ${v > 0 ? "+" : "−"}${Math.abs(v)}`); }
  return parts.join(", ");
};
const heal = (amount, msg) => (ctx) => {
  if (ctx.needs.health >= 100) throw "You're not hurt";
  up(ctx.needs, "health", amount);
  return `${msg} Health +${amount}`;
};

export const ITEMS = {
  // Supplies
  water: { name: "Water bottle", icon: "💧", kind: "drink", mass: 0.55, size: [0.07, 0.22, 0.07], price: 4, pocket: true, stack: 4,
    desc: "Thirst +35", use: food("thirst", 35), makeMesh: meshWater },
  waterjug: { name: "Water jug", icon: "🫙", kind: "drink", mass: 0.25, size: [0.19, 0.3, 0.16], price: 14, pocket: false,
    cap: 4, unit: "L", fluid: "water", keep: true, desc: "4 L of water. Thirst +35 per 0.5 L",
    use(ctx, item) {
      if (!(item.qty > 0.01)) throw "The jug is empty";
      if (ctx.needs.thirst >= 98) throw "You're not thirsty";
      const d = Math.min(0.5, item.qty);
      item.qty = Math.max(0, +(item.qty - d).toFixed(3));
      const gain = Math.round(35 * d / 0.5);
      up(ctx.needs, "thirst", gain);
      return `Thirst +${gain} (${item.qty.toFixed(1)} L left)`;
    }, makeMesh: meshWaterJug },
  beans: { name: "Canned beans", icon: "🥫", kind: "food", mass: 0.45, size: [0.078, 0.112, 0.078], price: 6, pocket: true, stack: 4,
    desc: "Hunger +40", use: food("hunger", 40, { thirst: -4 }), makeMesh: meshBeans },
  jerky: { name: "Beef jerky", icon: "🥩", kind: "food", mass: 0.1, size: [0.12, 0.17, 0.024], price: 4, pocket: true, stack: 6,
    desc: "Hunger +22, salty", use: food("hunger", 22, { thirst: -8 }), makeMesh: meshJerky },
  chips: { name: "Chips", icon: "🍟", kind: "food", mass: 0.08, size: [0.16, 0.22, 0.06], price: 3, pocket: true, stack: 3,
    desc: "Hunger +15", use: food("hunger", 15, { thirst: -5 }), makeMesh: meshChips },
  soda: { name: "Cola", icon: "🥤", kind: "drink", mass: 0.37, size: [0.067, 0.124, 0.067], price: 3, pocket: true, stack: 6,
    desc: "Thirst +22, energy +6", use: food("thirst", 22, { energy: 6 }), makeMesh: meshSoda },
  coffee: { name: "Iced coffee", icon: "☕", kind: "drink", mass: 0.35, size: [0.07, 0.14, 0.07], price: 4, pocket: true, stack: 4,
    desc: "Energy +22", use(ctx) { if (ctx.needs.energy >= 98) throw "You're wide awake already"; up(ctx.needs, "energy", 22); up(ctx.needs, "thirst", 8); return "Wide awake. Energy +22"; },
    makeMesh: meshCoffee },
  medkit: { name: "First aid kit", icon: "⛑️", kind: "med", mass: 0.8, size: [0.286, 0.1, 0.206], price: 25, pocket: true, stack: 1,
    desc: "Health +50", use: heal(50, "Patched up."), makeMesh: meshMedkit },
  bandage: { name: "Bandage", icon: "🩹", kind: "med", mass: 0.05, size: [0.072, 0.052, 0.068], price: 8, pocket: true, stack: 6,
    desc: "Health +18", use: heal(18, "Bandaged."), makeMesh: meshBandage },

  // Fluids – containers stay in the world when empty and are refilled at pumps
  fuelcan: { name: "Fuel can", icon: "⛽", kind: "fluid", mass: 1.2, size: [0.3, 0.32, 0.18], price: 22, pocket: false,
    cap: 10, unit: "L", fluid: "fuel", desc: "10 L of fuel. Pour it into a filler neck.", makeMesh: meshFuelCan },
  jerrycan: { name: "Jerry can", icon: "🛢️", kind: "fluid", mass: 4, size: [0.36, 0.46, 0.18], price: 44, pocket: false,
    cap: 20, unit: "L", fluid: "fuel", desc: "20 L of fuel. Heavy when full.", makeMesh: meshJerryCan },
  oil: { name: "Oil bottle", icon: "🧴", kind: "fluid", mass: 0.1, size: [0.1, 0.22, 0.06], price: 9, pocket: true,
    cap: 1, unit: "L", fluid: "oil", desc: "1 L of engine oil.", makeMesh: meshOil },
  oiljug: { name: "Oil jug", icon: "🧴", kind: "fluid", mass: 0.25, size: [0.2, 0.28, 0.11], price: 30, pocket: false,
    cap: 4, unit: "L", fluid: "oil", desc: "4 L of engine oil.", makeMesh: meshOilJug },
  coolant: { name: "Coolant", icon: "🧪", kind: "fluid", mass: 0.25, size: [0.2, 0.29, 0.122], price: 16, pocket: false,
    cap: 4, unit: "L", fluid: "coolant", desc: "4 L of coolant for the radiator.", makeMesh: meshCoolant },

  // Tools
  wrench: { name: "Wrench", icon: "🔧", kind: "tool", mass: 1.1, size: [0.38, 0.03, 0.09], price: 28, pocket: true, stack: 1,
    desc: "Needed to remove or fit an engine, battery or radiator.", makeMesh: meshWrench },
  jack: { name: "Jack & lug wrench", icon: "🛠️", kind: "tool", mass: 4.5, size: [0.42, 0.14, 0.12], price: 38, pocket: false,
    desc: "Needed to change wheels.", makeMesh: meshJack },
  repairkit: { name: "Repair kit", icon: "🧰", kind: "tool", mass: 5, size: [0.405, 0.2, 0.195], price: 45, pocket: false,
    desc: "Used up restoring body or engine condition.", makeMesh: meshRepairKit },
  flashlight: { name: "Flashlight", icon: "🔦", kind: "tool", mass: 0.25, size: [0.05, 0.05, 0.18], price: 12, pocket: true, stack: 1,
    desc: "T switches it on while you carry it.", makeMesh: meshFlashlight },

  // Parts – placeholders, overridden by COMPONENT_ITEMS from js/vehicles/components.js
  engine_i6: { name: "Inline-six engine", icon: "⚙️", kind: "part", mass: 190, size: [0.5, 0.66, 0.9], price: 0, pocket: false, slot: "engine", fits: ["pickup", "sedan"], makeMesh: meshEngine(6, false) },
  engine_v8: { name: "V8 engine", icon: "⚙️", kind: "part", mass: 240, size: [0.62, 0.66, 0.78], price: 0, pocket: false, slot: "engine", fits: ["pickup"], makeMesh: meshEngine(8, true) },
  engine_i4: { name: "Four-cylinder engine", icon: "⚙️", kind: "part", mass: 130, size: [0.5, 0.66, 0.7], price: 0, pocket: false, slot: "engine", fits: ["sedan"], makeMesh: meshEngine(4, false) },
  battery: { name: "Battery", icon: "🔋", kind: "part", mass: 16, size: [0.265, 0.2, 0.175], price: 60, pocket: false, slot: "battery", fits: ["pickup", "sedan"], makeMesh: meshBattery },
  radiator: { name: "Radiator", icon: "♨️", kind: "part", mass: 9, size: [0.62, 0.46, 0.1], price: 80, pocket: false, slot: "radiator", fits: ["pickup", "sedan"], makeMesh: meshRadiator },
  wheel_16: { name: "Wheel 16\"", icon: "🛞", kind: "part", mass: 24, size: [0.74, 0.26, 0.74], price: 70, pocket: false, slot: "wheel", fits: ["pickup"], makeMesh: meshWheel(0.74, 0.24) },
  wheel_14: { name: "Wheel 14\"", icon: "🛞", kind: "part", mass: 17, size: [0.62, 0.2, 0.62], price: 55, pocket: false, slot: "wheel", fits: ["sedan"], makeMesh: meshWheel(0.62, 0.19) },
};

export const FIXED_IDS = ["water", "waterjug", "beans", "jerky", "chips", "soda", "coffee", "medkit", "bandage",
  "fuelcan", "jerrycan", "oil", "oiljug", "coolant", "wrench", "jack", "repairkit", "flashlight",
  "engine_i6", "engine_v8", "engine_i4", "battery", "radiator", "wheel_16", "wheel_14"];

// Merge definitions (same ItemDef shape). Missing fields fall back to the existing def, so a component def without
// a makeMesh keeps the placeholder mesh.
export function registerItems(defs) {
  if (!defs) return;
  for (const [id, def] of Object.entries(defs)) {
    const old = ITEMS[id] || {};
    ITEMS[id] = { ...old, ...def, fallbackMesh: old.fallbackMesh || old.makeMesh };
  }
}
// Mesh for an instance. Falls back to the built-in placeholder (or a plain box) when a def has no makeMesh or its
// makeMesh returns nothing drawable, so a prop is never invisible.
export function buildMesh(item) {
  const def = ITEMS[item.type];
  let mesh = null;
  try { mesh = def.makeMesh ? def.makeMesh(item) : null; } catch (e) { console.error(e); }
  let drawable = false;
  if (mesh) mesh.traverse((o) => { if (o.isMesh) drawable = true; });
  if (!drawable) {
    mesh = def.fallbackMesh ? def.fallbackMesh(item) : null;
    if (!mesh) { mesh = new THREE.Group(); box(mesh, def.size[0], def.size[1], def.size[2], M(0x8a8f96, { r: 0.7 }), 0, 0, 0); }
  }
  return mesh;
}
// components.js is written by the vehicle agent. Loaded without blocking so a missing / cyclic import cannot stall us;
// await `itemsReady` when you need the merged table (it never rejects).
export const itemsReady = import("./vehicles/components.js")
  .then((m) => { registerItems(m.COMPONENT_ITEMS); return true; })
  .catch(() => false);

// What station shops sell
const STOCK = ["water", "waterjug", "soda", "coffee", "beans", "jerky", "chips", "bandage", "medkit",
  "fuelcan", "jerrycan", "oil", "oiljug", "coolant", "wrench", "jack", "repairkit", "flashlight", "battery", "wheel_16", "wheel_14"];
export const SHOP_STOCK = STOCK.map((type) => ({ type, get price() { return ITEMS[type].price; } }));

const LIQUID_KG = { fuel: 0.75, oil: 0.88, coolant: 1.07, water: 1 };

// New instance with defaults (containers full, parts at 100 %). overrides may carry id, qty, cond, flat…
export function makeItem(type, overrides = {}) {
  const def = ITEMS[type];
  if (!def) throw new Error("Unknown item type: " + type);
  const item = { id: overrides.id || ws.newId("I"), type };
  if (def.cap) item.qty = def.cap;
  if (def.kind === "part") item.cond = 100;
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined) item[k] = v;
  return item;
}
export const defOf = (item) => ITEMS[item.type];
export function itemMass(item) {
  const def = ITEMS[item.type];
  return def ? def.mass + (def.cap ? (item.qty || 0) * (LIQUID_KG[def.fluid] || 1) : 0) : 1;
}
const num = (v) => (Math.abs(v - Math.round(v)) < 0.05 && v >= 10 ? String(Math.round(v)) : v.toFixed(1));
// "6.0 / 10 L" for containers, null otherwise
export function qtyText(item) {
  const def = ITEMS[item.type];
  if (!def || !def.cap) return item.qty !== undefined ? String(item.qty) : null;
  return `${num(item.qty || 0)} / ${def.cap} ${def.unit || ""}`.trim();
}
// "Fuel can · 6.0 / 10 L", "Wheel 16" · 72%"
export function itemLabel(item) {
  const def = ITEMS[item.type];
  if (!def) return item.type;
  let s = def.name;
  const q = qtyText(item);
  if (q) s += " · " + q;
  if (item.cond !== undefined) s += ` · ${Math.round(item.cond)}%`;
  if (item.flat) s += " · flat";
  return s;
}
// True when instances of this kind are interchangeable (may share a pocket slot)
export function isStateless(item) {
  const def = ITEMS[item.type];
  if (!def || def.cap) return false;
  for (const k in item) if (k !== "id" && k !== "type") return false;
  return true;
}
export const useVerb = (def) => (def.kind === "food" ? "Eat" : def.kind === "drink" ? "Drink" : "Use");

// Run an item's use(). Returns { ok, msg, consumed } – consumed means the caller must remove the instance.
// Plays the sound and shows the message when ctx carries sfx / notify.
export function useItem(ctx, item) {
  const def = ITEMS[item.type];
  if (!def || !def.use) return { ok: false, msg: "You can't use that on its own", consumed: false };
  try {
    const msg = def.use(ctx, item) || "";
    if (ctx.sfx) ctx.sfx(def.kind === "food" ? "eat" : def.kind === "drink" ? "drink" : "pickup");
    if (ctx.notify && msg) ctx.notify(msg, { level: "good", icon: def.icon, key: "use" });
    return { ok: true, msg, consumed: !def.keep };
  } catch (e) {
    if (typeof e !== "string") throw e;
    if (ctx.sfx) ctx.sfx("error");
    if (ctx.notify) ctx.notify(e, { level: "warn", icon: def.icon, key: "use" });
    return { ok: false, msg: e, consumed: false };
  }
}
