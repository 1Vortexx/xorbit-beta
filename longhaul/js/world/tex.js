// Long Haul – procedural textures and shared materials. Everything is created lazily by prepareTextures()
// (called from World prepare()); nothing touches the DOM at import.
import * as THREE from "three";

export const M = {};        // shared materials by id
export const TEX = {};      // shared textures
let ready = false;

// ── tileable noise for texture synthesis ───────────────
function h2(i, j, s) {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(s, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function tn(x, y, per, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const m = (a) => ((a % per) + per) % per;
  const a = h2(m(xi), m(yi), s), b = h2(m(xi + 1), m(yi), s), c = h2(m(xi), m(yi + 1), s), d = h2(m(xi + 1), m(yi + 1), s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// fbm over the unit square, tileable. f = base lattice frequency
function fbm(u, v, f, oct, s) {
  let a = 0, amp = 0.5, tot = 0;
  for (let o = 0; o < oct; o++) { a += amp * tn(u * f, v * f, f, s + o * 17); tot += amp; f *= 2; amp *= 0.5; }
  return a / tot;
}

function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
// fn(u, v) → [r, g, b, height] (0..1). Returns { map, normalMap }
function gen(size, fn, o = {}) {
  const w = size, h = o.h || size, c = canvas(w, h), g = c.getContext("2d"), img = g.createImageData(w, h), d = img.data;
  const hgt = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = fn(x / w, y / h), i = (y * w + x) * 4;
    d[i] = p[0] * 255; d[i + 1] = p[1] * 255; d[i + 2] = p[2] * 255; d[i + 3] = p.length > 4 ? p[4] * 255 : 255;
    hgt[y * w + x] = p[3];
  }
  g.putImageData(img, 0, 0);
  if (o.draw) o.draw(g, w, h);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = o.aniso || 4;
  let normalMap = null;
  if (o.normal) {
    const nc = canvas(w, h), ng = nc.getContext("2d"), nimg = ng.createImageData(w, h), nd = nimg.data, k = o.normal * (w / 256);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const l = hgt[y * w + ((x + w - 1) % w)], r = hgt[y * w + ((x + 1) % w)], up = hgt[((y + h - 1) % h) * w + x], dn = hgt[((y + 1) % h) * w + x];
      let nx = (l - r) * k, ny = (dn - up) * k; const il = 1 / Math.hypot(nx, ny, 1);
      const i = (y * w + x) * 4;
      nd[i] = (nx * il * 0.5 + 0.5) * 255; nd[i + 1] = (ny * il * 0.5 + 0.5) * 255; nd[i + 2] = (il * 0.5 + 0.5) * 255; nd[i + 3] = 255;
    }
    ng.putImageData(nimg, 0, 0);
    normalMap = new THREE.CanvasTexture(nc);
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping; normalMap.anisotropy = o.aniso || 4;
  }
  return { map, normalMap };
}
const g3 = (v, h) => [v, v, v, h === undefined ? v : h];
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// soft crack mask: 1 away from the iso-line of a noise field, dipping to `depth` on it
const crack = (n, w, depth) => 1 - (1 - depth) * (1 - ss(0, w, Math.abs(n - 0.5)));
// hairline cracks drawn as short branching random walks (kept away from the tile edges so the texture still tiles)
function strokeCracks(g, w, h, n, seed, alpha, lw = 1.1) {
  let s = seed;
  const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  g.lineCap = "round";
  const walk = (x, y, a, len, width) => {
    g.strokeStyle = `rgba(20,18,16,${alpha * (0.6 + r() * 0.4)})`; g.lineWidth = width;
    g.beginPath(); g.moveTo(x, y);
    for (let i = 0; i < len; i++) {
      a += (r() - 0.5) * 1.1; x += Math.cos(a) * (w / 60); y += Math.sin(a) * (w / 60);
      if (x < w * 0.04 || x > w * 0.96 || y < h * 0.04 || y > h * 0.96) break;
      g.lineTo(x, y);
      if (width > 0.7 && r() < 0.06) { g.stroke(); walk(x, y, a + (r() < 0.5 ? 1 : -1) * (0.6 + r() * 0.6), len * 0.4, width * 0.6); g.beginPath(); g.moveTo(x, y); g.strokeStyle = `rgba(20,18,16,${alpha})`; g.lineWidth = width; }
    }
    g.stroke();
  };
  for (let i = 0; i < n; i++) walk(w * (0.1 + r() * 0.8), h * (0.1 + r() * 0.8), r() * 6.283, 14 + r() * 26, lw);
}

const RECIPES = [
  ["sand", () => gen(256, (u, v) => {
    const n = fbm(u, v, 4, 5, 1), gr = h2((u * 256) | 0, (v * 256) | 0, 9);
    const rip = 0.5 + 0.5 * Math.sin((v * 14 + n * 1.6 + u * 2) * 6.283);
    return g3(0.8 + n * 0.16 + (gr - 0.5) * 0.1, n * 0.6 + rip * 0.25 + gr * 0.25);
  }, { normal: 2.2, aniso: 8 })],
  ["rock", () => gen(256, (u, v) => {
    const n = fbm(u, v, 3, 6, 2), s = fbm(u, v * 3, 6, 4, 3), cr = crack(fbm(u, v, 5, 4, 4), 0.02, 0.6);
    return g3((0.62 + n * 0.3 + s * 0.14) * cr, n * 0.7 + s * 0.3 - (1 - cr));
  }, { normal: 3.5 })],
  ["plaster", () => gen(256, (u, v) => {
    const n = fbm(u, v, 3, 5, 5), f = fbm(u, v, 24, 2, 6), streak = fbm(u, v * 0.25, 16, 3, 7);
    const grime = 1 - 0.28 * Math.pow(1 - v, 3) * (0.5 + streak) - 0.1 * Math.pow(v, 6);
    const chip = 1 - 0.07 * ss(0.58, 0.72, n);
    return g3((0.84 + n * 0.12 + (f - 0.5) * 0.06) * grime * chip, f * 0.5 + chip * 0.5);
  }, { normal: 1.6 })],
  ["wood", () => gen(256, (u, v) => {
    const pl = (v * 8) % 1, id = Math.floor(v * 8), gap = pl < 0.06 ? 0.45 : 1;
    const grain = fbm(u * 0.25 + id * 0.37, v * 6, 8, 4, 8 + id), tone = 0.82 + 0.16 * h2(id, 3, 10);
    return g3((0.74 + grain * 0.26) * tone * gap, grain * 0.4 + (gap < 1 ? -0.6 : 0.3) + pl * 0.2);
  }, { normal: 2.6 })],
  ["metal", () => gen(256, (u, v) => {
    const rid = 0.5 + 0.5 * Math.sin(u * 6.283 * 16), n = fbm(u, v, 4, 5, 11), r2 = fbm(u, v, 9, 3, 12);
    const rust = 1 - 0.4 * ss(0.5, 0.8, n), streak = 1 - 0.2 * fbm(u * 3, v * 0.3, 8, 3, 13);
    return g3((0.72 + rid * 0.2 + r2 * 0.08) * rust * streak, rid * 0.8 + r2 * 0.1);
  }, { normal: 3.0 })],
  ["concrete", () => gen(256, (u, v) => {
    const n = fbm(u, v, 4, 5, 14), f = h2((u * 256) | 0, (v * 256) | 0, 15), cr = 1;
    const stain = 1 - 0.1 * ss(0.5, 0.75, fbm(u, v, 2, 3, 17));
    return g3((0.74 + n * 0.2 + (f - 0.5) * 0.08) * cr * stain, n * 0.4 + f * 0.2 - (1 - cr) * 0.8);
  }, { normal: 1.8, draw: (g, w, h) => strokeCracks(g, w, h, 5, 77, 0.5) })],
  ["smooth", () => gen(128, (u, v) => { const n = fbm(u, v, 3, 4, 18), s = fbm(u * 2, v * 0.3, 8, 3, 19); return g3(0.86 + n * 0.1 - 0.08 * s * (1 - v), n); }, { normal: 0.5 })],
  ["fabric", () => gen(128, (u, v) => { const w = 0.5 + 0.25 * Math.sin(u * 6.283 * 40) + 0.25 * Math.sin(v * 6.283 * 40), n = fbm(u, v, 4, 3, 20); return g3(0.74 + w * 0.12 + n * 0.14, w); }, { normal: 1.2 })],
  ["tile", () => gen(256, (u, v) => {
    const cx = Math.floor(u * 8), cy = Math.floor(v * 8), fx = (u * 8) % 1, fy = (v * 8) % 1, grout = fx < 0.04 || fy < 0.04;
    const n = fbm(u, v, 6, 3, 21), ch = (cx + cy) % 2 ? 0.92 : 0.5;
    return g3(grout ? 0.4 : ch * (0.85 + n * 0.15), grout ? 0 : 0.6);
  }, { normal: 1.2 })],
  ["dirt", () => gen(256, (u, v) => {
    const n = fbm(u, v, 4, 5, 22), p = fbm(u, v, 20, 2, 23), peb = 0.9 + 0.2 * p + (h2((u * 256) | 0, (v * 256) | 0, 33) - 0.5) * 0.1;
    const rut = 1;
    return g3((0.74 + n * 0.2) * peb * rut, n * 0.5 + p * 0.5);
  }, { normal: 2.4 })],
  ["gravel", () => gen(256, (u, v) => {
    const p = fbm(u, v, 28, 2, 24), n = fbm(u, v, 4, 4, 25), st = h2((u * 90) | 0, (v * 90) | 0, 26);
    return g3(0.6 + p * 0.3 + n * 0.1 + (st > 0.8 ? 0.1 : 0), p);
  }, { normal: 3.2 })],
  ["lot", () => gen(256, (u, v) => {
    const n = fbm(u, v, 4, 5, 27), f = h2((u * 256) | 0, (v * 256) | 0, 28), cr = 1;
    const oil = 1 - 0.25 * ss(0.6, 0.8, fbm(u, v, 2, 3, 30));
    return g3((0.46 + n * 0.18 + (f - 0.5) * 0.12) * cr * oil, f * 0.5 + n * 0.3 - (1 - cr));
  }, { normal: 2.0, draw: (g, w, h) => strokeCracks(g, w, h, 7, 91, 0.6) })],
  ["bark", () => gen(128, (u, v) => { const n = fbm(u * 2, v * 0.5, 8, 4, 31); return g3(0.6 + n * 0.4, n); }, { normal: 3 })],
  ["cactus", () => gen(128, (u, v) => {
    const rib = Math.abs(Math.sin(u * 3.14159 * 10)), n = fbm(u, v, 4, 3, 32), sp = rib < 0.14 && ((v * 40) % 1) < 0.25 ? 1.35 : 1;
    return g3((0.62 + rib * 0.3 + n * 0.1) * sp, rib);
  }, { normal: 3 })],
];

function roadTexture() {
  const W = 512, Hh = 1024;
  // u spans 14.6 m (asphalt = middle 8 m), v spans 24 m
  const t = gen(W, (u, v) => {
    const x = (u - 0.5) * 14.6, ax = Math.abs(x);
    const n = fbm(u * 2, v * 4, 4, 5, 40), f = h2((u * W) | 0, (v * Hh) | 0, 41), agg = h2((u * W / 2) | 0, (v * Hh / 2) | 0, 42);
    if (ax < 4) {
      const wear = 1 + 0.1 * Math.exp(-Math.pow((ax - 1.9) / 0.55, 2));      // tyre-polished wheel paths
      const cr = 1, seal = 1;
      const edge = ax > 3.6 ? 1 - (ax - 3.6) * 0.5 * n : 1;
      const b = (0.2 + n * 0.1 + (f - 0.5) * 0.07 + (agg > 0.86 ? 0.07 : 0)) * wear * cr * seal * edge;
      return [b * 1.03, b, b * 0.98, f * 0.5 + agg * 0.3 - (1 - cr) - (1 - seal) * 0.5, 1];
    }
    const p = fbm(u * 2, v * 4, 40, 2, 45), a = ax < 6.3 ? 1 : Math.max(0, 1 - (ax - 6.3) / 0.95) * (0.6 + p * 0.8);
    const fadeIn = Math.min(1, (ax - 4) / 0.5), sh = 0.5 + p * 0.3 + n * 0.1;
    return [sh * 0.92, sh * 0.84, sh * 0.72, p, Math.min(1, a) * (0.75 + 0.25 * fadeIn)];
  }, {
    h: Hh, normal: 1.6, aniso: 8,
    draw(g, w, h) {
      const X = (m) => (0.5 + m / 14.6) * w, Y = (m) => (m / 24) * h;
      const r = (s) => h2(s, 77, 5);
      // patched repair
      g.fillStyle = "rgba(18,18,20,0.55)"; g.fillRect(X(0.6), Y(13), X(2.9) - X(0.6), Y(4.2));
      g.strokeStyle = "rgba(10,10,10,0.7)"; g.lineWidth = 2; g.strokeRect(X(0.6), Y(13), X(2.9) - X(0.6), Y(4.2));
      // faded paint: worn by drawing many short strokes with gaps
      const paint = (x, y0, y1, col, wpx) => {
        for (let y = Y(y0); y < Y(y1); y += 3) {
          const k = r((x * 31 + y) | 0);
          if (k < 0.16) continue;
          g.fillStyle = col.replace("A", (0.45 + k * 0.4).toFixed(2));
          g.fillRect(X(x) - wpx / 2 + (r(y | 0) - 0.5) * 1.2, y, wpx * (0.75 + k * 0.25), 3.2);
        }
      };
      paint(-3.72, 0, 24, "rgba(214,208,190,A)", 4.6); paint(3.72, 0, 24, "rgba(214,208,190,A)", 4.6);
      paint(0, 1.5, 4.5, "rgba(214,168,58,A)", 4.6); paint(0, 13.5, 16.5, "rgba(214,168,58,A)", 4.6);
      strokeCracks(g, w, h, 16, 4242, 0.75, 1.5);
      // tar snakes
      g.strokeStyle = "rgba(8,8,9,0.75)"; g.lineWidth = 2.2;
      for (let i = 0; i < 5; i++) {
        let x = X(-3.5 + r(i) * 7), y = Y(r(i + 9) * 24);
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 14; k++) { x += (r(i * 40 + k) - 0.5) * 26; y += 10 + r(i * 50 + k) * 12; g.lineTo(x, y); }
        g.stroke();
      }
    },
  });
  return t;
}

// Alpha-tested plant cards
function cardTexture(kind) {
  const c = canvas(128, 128), g = c.getContext("2d");
  const r = (i) => h2(i, 5, kind === "grass" ? 61 : 62);
  if (kind === "grass") {
    for (let i = 0; i < 46; i++) {
      const x = 64 + (r(i) - 0.5) * 70, lean = (r(i + 100) - 0.5) * 70, hgt = 50 + r(i + 200) * 70, v = 150 + r(i + 300) * 80;
      g.strokeStyle = `rgb(${v},${v * 0.86},${v * 0.52})`; g.lineWidth = 1.6 + r(i + 400) * 1.6;
      g.beginPath(); g.moveTo(x, 128); g.quadraticCurveTo(x + lean * 0.3, 128 - hgt * 0.6, x + lean, 128 - hgt); g.stroke();
    }
  } else {
    // twiggy bush: branching strokes with small leaves
    const branch = (x, y, a, len, w, d) => {
      const x2 = x + Math.cos(a) * len, y2 = y - Math.sin(a) * len;
      g.strokeStyle = d > 1 ? "rgb(150,140,110)" : "rgb(120,105,85)"; g.lineWidth = w;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
      if (d >= 3) {
        for (let k = 0; k < 5; k++) { const v = 120 + r(k + x2) * 60; g.fillStyle = `rgb(${v * 0.86},${v * 0.92},${v * 0.66})`; g.beginPath(); g.ellipse(x2 + (r(k * 3 + y2) - 0.5) * 16, y2 + (r(k * 7 + x) - 0.5) * 14, 4.5, 2.6, r(k) * 3, 0, 6.3); g.fill(); }
      }
      if (d < 4) for (let k = 0; k < 3; k++) branch(x2, y2, a + (r(d * 10 + k + x) - 0.5) * 1.5, len * 0.72, w * 0.7, d + 1);
    };
    for (let i = 0; i < 5; i++) branch(64 + (r(i) - 0.5) * 16, 128, 1.57 + (r(i + 20) - 0.5) * 1.7, 30, 3, 0);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;   // mipmapped alpha cards grow dark halos and thin out
  return t;
}

// Sign painting (shared by site atlases, road signs and billboards)
const SIGN_STYLES = {
  store0: ["#b93c2e", "#f3ead2"], store1: ["#2f5f86", "#f3ead2"], store2: ["#e8dcc0", "#b3541e"],
  pole0: ["#f3ead2", "#b93c2e"], pole1: ["#f1d36b", "#2a2a2a"], pole2: ["#b93c2e", "#fff3d0"], motel: ["#1f4f5c", "#ffd9a0"],
  garage0: ["#e8dcc0", "#8f2f22"], garage1: ["#f1d36b", "#1e1e1e"], garage2: ["#2c5a58", "#f0e6c8"],
  diner: ["#1b1b1e", "#ff7a5a"], junk: ["#5e3521", "#e8d8b0"], wood: ["#a58c6a", "#3a2a1c"],
  green: ["#2c6a45", "#f4f1e4"], yellow: ["#e3b52a", "#161616"], white: ["#eeeade", "#161616"], blue: ["#2b4f8c", "#f4f1e4"], brown: ["#6b4a2c", "#f4f1e4"],
};
export function paintSign(g, text, style, x, y, w, h) {
  const [bg, fg] = SIGN_STYLES[style] || SIGN_STYLES.white;
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = bg; g.fillRect(x, y, w, h);
  g.strokeStyle = fg; g.lineWidth = Math.max(2, h * 0.035); g.strokeRect(x + h * 0.05, y + h * 0.05, w - h * 0.1, h - h * 0.1);
  const lines = text.split("|");
  g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle";
  lines.forEach((ln, i) => {
    let fs = (h / lines.length) * 0.62;
    g.font = `bold ${fs}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
    const tw = g.measureText(ln).width;
    if (tw > w * 0.86) { fs *= (w * 0.86) / tw; g.font = `bold ${fs}px "Arial Black", "Helvetica Neue", Arial, sans-serif`; }
    g.fillText(ln, x + w / 2, y + (h * (i + 0.5)) / lines.length + fs * 0.04);
  });
  // weathering: sun-bleach, rust runs, chips
  let s = (text.length * 131 + w) | 0;
  const r = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
  g.fillStyle = "rgba(235,225,200,0.16)"; g.fillRect(x, y, w, h);
  for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(110,62,30,${0.08 + r() * 0.16})`; const rx = x + r() * w; g.fillRect(rx, y + r() * h * 0.3, 1 + r() * 3, h * (0.3 + r() * 0.7)); }
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${90 + r() * 60},${70 + r() * 40},${50 + r() * 30},${0.25 + r() * 0.4})`; g.fillRect(x + r() * w, y + r() * h, 1 + r() * 4, 1 + r() * 3); }
  g.restore();
}
export function signAtlasTexture(signs, size = 1024) {
  const c = canvas(size, size), g = c.getContext("2d"), k = size / 1024;
  g.fillStyle = "#777"; g.fillRect(0, 0, size, size);
  for (const s of signs) paintSign(g, s.text, s.style, s.rect[0] * k, s.rect[1] * k, s.rect[2] * k, s.rect[3] * k);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
function buildMaterials() {
  const T = TEX, ns = (v) => new THREE.Vector2(v, v);
  M.plaster = std({ map: T.plaster.map, normalMap: T.plaster.normalMap, normalScale: ns(0.7), roughness: 0.93 });
  M.wood = std({ map: T.wood.map, normalMap: T.wood.normalMap, normalScale: ns(0.9), roughness: 0.88 });
  M.metal = std({ map: T.metal.map, normalMap: T.metal.normalMap, normalScale: ns(0.9), roughness: 0.62, metalness: 0.45 });
  M.roof = std({ map: T.metal.map, normalMap: T.metal.normalMap, normalScale: ns(1), roughness: 0.66, metalness: 0.35, side: THREE.DoubleSide });
  M.concrete = std({ map: T.concrete.map, normalMap: T.concrete.normalMap, normalScale: ns(0.8), roughness: 0.95 });
  M.smooth = std({ map: T.smooth.map, normalMap: T.smooth.normalMap, normalScale: ns(0.3), roughness: 0.55, metalness: 0.1 });
  M.fabric = std({ map: T.fabric.map, normalMap: T.fabric.normalMap, roughness: 1, side: THREE.DoubleSide });
  M.rubber = std({ roughness: 0.95 });
  M.rock = std({ map: T.rock.map, normalMap: T.rock.normalMap, normalScale: ns(1.2), roughness: 0.96 });
  M.tile = std({ map: T.tile.map, normalMap: T.tile.normalMap, normalScale: ns(0.4), roughness: 0.5 });
  M.glass = std({ color: 0xffffff, roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
  M.glow = new THREE.MeshBasicMaterial({ vertexColors: true });
  M.sign = std({ roughness: 0.75, metalness: 0.1 });     // cloned per site with its own atlas
  M.occ = new THREE.MeshBasicMaterial({ visible: false });
  M.pick = new THREE.MeshBasicMaterial({ visible: false });
  // ground
  M.terrain = std({ map: T.sand.map, normalMap: T.sand.normalMap, normalScale: ns(0.9), roughness: 0.97 });
  M.far = std({ roughness: 1 });
  const po = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
  M.road = new THREE.MeshStandardMaterial({ map: T.road.map, normalMap: T.road.normalMap, normalScale: ns(0.8), roughness: 0.86, transparent: true, depthWrite: false, ...po });
  M.farRoad = new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.9, ...po });
  const patch = (t, col) => new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, color: col, roughness: 0.93, vertexColors: true, transparent: true, depthWrite: false, ...po, polygonOffsetFactor: -1.5, polygonOffsetUnits: -3 });
  M.patch = { concrete: patch(T.concrete, 0xb9b2a4), asphalt: patch(T.lot, 0x9a9690), gravel: patch(T.gravel, 0xa89a82), dirt: patch(T.dirt, 0x9c8363), track: patch(T.dirt, 0x937a5c) };
  // vegetation / scenery
  M.cactus = std({ map: T.cactus.map, normalMap: T.cactus.normalMap, roughness: 0.85 });
  M.bark = std({ map: T.bark.map, normalMap: T.bark.normalMap, roughness: 0.95 });
  M.bush = new THREE.MeshStandardMaterial({ map: T.bush, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1, vertexColors: true });
  M.grass = new THREE.MeshStandardMaterial({ map: T.grass, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1, vertexColors: true });
  M.wire = new THREE.LineBasicMaterial({ color: 0x151515 });
  M.board = std({ map: T.boards, roughness: 0.8 });
}

function boardsTexture() {
  // road sign + billboard atlas, 1024²: cells addressed by BOARD_UV
  const c = canvas(1024, 1024), g = c.getContext("2d");
  g.fillStyle = "#666"; g.fillRect(0, 0, 1024, 1024);
  for (const [k, b] of Object.entries(BOARDS)) { void k; paintSign(g, b.text, b.style, b.r[0], b.r[1], b.r[2], b.r[3]); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
// Fixed cells of the shared board atlas (px). Digits are used for distance boards and mile markers.
export const BOARDS = {
  fuel2: { text: "FUEL|2 KM", style: "blue", r: [0, 0, 256, 192] }, fuel500: { text: "FUEL|500 M", style: "blue", r: [256, 0, 256, 192] },
  curveL: { text: "‹‹‹", style: "yellow", r: [512, 0, 256, 128] }, curveR: { text: "›››", style: "yellow", r: [768, 0, 256, 128] },
  speed: { text: "SPEED|LIMIT|90", style: "white", r: [512, 128, 160, 192] }, food: { text: "FOOD|NEXT RIGHT", style: "blue", r: [672, 128, 256, 128] },
  lodging: { text: "LODGING|AHEAD", style: "blue", r: [0, 192, 256, 128] }, dirt: { text: "PRIVATE|ROAD", style: "white", r: [256, 192, 256, 128] },
  bb0: { text: "LAST GAS|FOR 9 KM", style: "pole2", r: [0, 320, 512, 224] }, bb1: { text: "COLD DRINKS|ROADRUNNER DINER", style: "motel", r: [512, 320, 512, 224] },
  bb2: { text: "SEE THE|MYSTERY MESA", style: "garage1", r: [0, 544, 512, 224] }, bb3: { text: "STARLITE MOTEL|AIR COOLED ROOMS", style: "store1", r: [512, 544, 512, 224] },
  bb4: { text: "HANK'S AUTO|WE FIX ANYTHING", style: "garage0", r: [0, 768, 512, 224] }, bb5: { text: "REPENT|THE ROAD IS LONG", style: "wood", r: [512, 768, 512, 224] },
};
for (let i = 0; i < 10; i++) BOARDS["d" + i] = { text: String(i), style: "green", r: [928 + (i % 2) * 48, 128 + Math.floor(i / 2) * 38, 48, 38] };
export function boardUV(key) { const r = BOARDS[key].r; return [r[0] / 1024, 1 - (r[1] + r[3]) / 1024, (r[0] + r[2]) / 1024, 1 - r[1] / 1024]; }

export async function prepareTextures(report) {
  if (ready) return;
  const total = RECIPES.length + 4;
  let i = 0;
  const tick = async (label) => { report && report(++i / total, label); await new Promise((r) => setTimeout(r, 0)); };
  for (const [name, fn] of RECIPES) { TEX[name] = fn(); await tick("Weathering " + name); }
  TEX.road = roadTexture(); await tick("Laying asphalt");
  TEX.road.map.wrapS = THREE.ClampToEdgeWrapping; TEX.road.normalMap.wrapS = THREE.ClampToEdgeWrapping;
  TEX.grass = cardTexture("grass"); TEX.bush = cardTexture("bush"); await tick("Growing scrub");
  TEX.boards = boardsTexture(); await tick("Painting signs");
  buildMaterials(); await tick("Mixing paint");
  ready = true;
}
export function texturesReady() { return ready; }
