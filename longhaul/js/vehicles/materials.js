// Long Haul – procedural materials and canvas textures for vehicles. Nothing here touches the DOM at import:
// call prepareMaterials() (from vehicles/index.js prepare()) before building any vehicle visual.
import * as THREE from "three";
import { mulberry } from "./ground.js";

export const M = {};            // shared materials, filled by prepareMaterials()
const paintCache = new Map();
let ready = false;
export const materialsReady = () => ready;

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
function tex(c, { srgb = true, repeat = null, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = aniso;
  return t;
}
const css = (hex, a = 1) => `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;
function mix(a, b, t) {
  const ch = (s) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
// Soft irregular blotch made of overlapping radial gradients
function blotch(g, R, x, y, r, color, alpha, n = 7) {
  for (let i = 0; i < n; i++) {
    const a = R() * 6.283, d = R() * r * 0.7, rr = r * (0.35 + R() * 0.6);
    const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d * 0.6;
    const gr = g.createRadialGradient(px, py, 0, px, py, rr);
    gr.addColorStop(0, css(color, alpha)); gr.addColorStop(0.6, css(color, alpha * 0.55)); gr.addColorStop(1, css(color, 0));
    g.fillStyle = gr; g.fillRect(px - rr, py - rr, rr * 2, rr * 2);
  }
}
function speckle(g, R, w, h, n, colors, amin, amax, smin = 1, smax = 2) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = css(colors[(R() * colors.length) | 0], amin + R() * (amax - amin));
    const s = smin + R() * (smax - smin);
    g.fillRect(R() * w, R() * h, s, s);
  }
}

// ── Body paint ────────────────────────────────────────────────────────────────────────────────
// UV layout (see loft.js): u runs nose → tail, v runs up the profile from the rocker (0) over the shoulder (~0.3)
// to the centre line of the hood / roof (~0.6+). So low v collects dust and rust, high v is sun-bleached.
function paintTextures(color, wear, seed) {
  const W = 1024, H = 512, R = mulberry(seed);
  const c = canvas(W, H), g = c.getContext("2d");
  const rc = canvas(W, H), rg = rc.getContext("2d");        // roughness (G) / metalness (B)
  const Y = (v) => (1 - v) * H;
  g.fillStyle = css(color); g.fillRect(0, 0, W, H);
  rg.fillStyle = "rgb(0,105,0)"; rg.fillRect(0, 0, W, H);
  // Sun fade on upward-facing panels: chalky, lighter, patchy
  const faded = mix(color, 0xd9d2c4, 0.38 + wear * 0.3);
  const fg = g.createLinearGradient(0, Y(0.27), 0, Y(0.42));
  fg.addColorStop(0, css(faded, 0)); fg.addColorStop(1, css(faded, 0.55 + wear * 0.35));
  g.fillStyle = fg; g.fillRect(0, 0, W, Y(0.27));
  for (let i = 0; i < 26 + wear * 40; i++) {
    const x = R() * W, y = R() * Y(0.3);
    blotch(g, R, x, y, 30 + R() * 90, mix(faded, 0xe6e0d4, R() * 0.6), 0.1 + R() * 0.2 * wear, 5);
    blotch(rg, R, x, y, 40 + R() * 80, 0x00d000, 0.3, 4);
  }
  // Tonal variation everywhere
  for (let i = 0; i < 60; i++) blotch(g, R, R() * W, R() * H, 40 + R() * 120, R() < 0.5 ? mix(color, 0x000000, 0.35) : mix(color, 0xffffff, 0.3), 0.06 + R() * 0.07, 4);
  // Primer / old repair patches
  for (let i = 0; i < wear * 5; i++) {
    const x = R() * W, y = Y(0.03 + R() * 0.25), w = 40 + R() * 110, h = 20 + R() * 50;
    g.fillStyle = css(R() < 0.5 ? 0x8d8f8c : mix(color, 0x777777, 0.5), 0.5); g.fillRect(x, y - h, w, h);
  }
  // Rust: along the rocker, wheel-arch height band, seams, and scattered scabs
  const rust = [0x6a3418, 0x8a4a22, 0x4f260f, 0x9c5a2c];
  const rustAt = (x, y, r, a) => {
    blotch(g, R, x, y, r, rust[(R() * 4) | 0], a, 6);
    blotch(g, R, x, y, r * 0.5, 0x3a1c0c, a * 0.8, 3);
    blotch(rg, R, x, y, r, 0x00ff00, 0.9, 4);
  };
  for (let i = 0; i < 30 + wear * 110; i++) rustAt(R() * W, Y(R() * R() * 0.14), 6 + R() * (10 + 26 * wear), 0.25 + 0.5 * wear);
  for (let i = 0; i < wear * 46; i++) rustAt(R() * W, Y(0.05 + R() * 0.6), 4 + R() * 22 * wear, 0.2 + 0.45 * wear);
  for (let i = 0; i < 8 + wear * 16; i++) {                 // streaks running down from scabs
    const x = R() * W, y = Y(0.1 + R() * 0.18), len = 20 + R() * 70;
    const sg = g.createLinearGradient(0, y, 0, y + len);
    sg.addColorStop(0, css(0x7a4424, 0.35 * (0.4 + wear))); sg.addColorStop(1, css(0x7a4424, 0));
    g.fillStyle = sg; g.fillRect(x, y, 2 + R() * 5, len);
  }
  // Scratches and stone chips
  g.lineWidth = 1;
  for (let i = 0; i < 70 + wear * 120; i++) {
    const x = R() * W, y = R() * H, a = (R() - 0.5) * 0.5, l = 6 + R() * 50;
    g.strokeStyle = css(R() < 0.6 ? 0xd8d4cc : 0x3b2a20, 0.12 + R() * 0.25);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  speckle(g, R, W, H, 2500, [0xe8e2d6, 0x2b211a, 0x7a4424], 0.08, 0.3);
  // Dust: thick along the bottom, thin film and drips higher up
  const dust = 0xb39a74;
  const dg = g.createLinearGradient(0, Y(0), 0, Y(0.3));
  dg.addColorStop(0, css(dust, 0.75)); dg.addColorStop(0.35, css(dust, 0.38)); dg.addColorStop(1, css(dust, 0.06));
  g.fillStyle = dg; g.fillRect(0, Y(0.3), W, H - Y(0.3));
  const dr = rg.createLinearGradient(0, Y(0), 0, Y(0.3));
  dr.addColorStop(0, "rgba(0,245,0,0.9)"); dr.addColorStop(1, "rgba(0,245,0,0)");
  rg.fillStyle = dr; rg.fillRect(0, Y(0.3), W, H - Y(0.3));
  for (let i = 0; i < 70; i++) blotch(g, R, R() * W, Y(R() * 0.75), 30 + R() * 80, dust, 0.05 + R() * 0.09, 4);
  g.fillStyle = css(dust, 0.14); g.fillRect(0, 0, W, Y(0.3));       // settled film on top surfaces
  rg.fillStyle = "rgba(0,200,0,0.35)"; rg.fillRect(0, 0, W, Y(0.3));
  return { map: tex(c, { aniso: 8 }), roughnessMap: tex(rc, { srgb: false }) };
}

// Per colour / wear level paint material (cached). wear 0..1 is bucketed to 3 looks.
export function paintMaterial(color, wear = 0.5) {
  const lvl = wear < 0.34 ? 0 : wear < 0.67 ? 1 : 2;
  const key = color + ":" + lvl;
  let m = paintCache.get(key);
  if (!m) {
    const t = paintTextures(color, [0.2, 0.55, 0.95][lvl], (color ^ (lvl * 7919)) >>> 0);
    m = new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.roughnessMap, roughness: 1, metalness: 0.12, side: THREE.DoubleSide, envMapIntensity: 0.9 });
    m.name = "paint";
    paintCache.set(key, m);
  }
  return m;
}

// ── Glass ─────────────────────────────────────────────────────────────────────────────────────
function glassTexture(kind, seed) {
  const S = 512, R = mulberry(seed), c = canvas(S, S), g = c.getContext("2d");
  g.clearRect(0, 0, S, S);
  g.fillStyle = "rgba(150,172,160,0.16)"; g.fillRect(0, 0, S, S);            // tint
  const dust = 0xc4ad85;
  for (let i = 0; i < 90; i++) blotch(g, R, R() * S, R() * S, 30 + R() * 90, dust, 0.03 + R() * 0.05, 4);
  const eg = g.createLinearGradient(0, S, 0, S * 0.55);                       // dust banked along the bottom
  eg.addColorStop(0, css(dust, 0.5)); eg.addColorStop(1, css(dust, 0));
  g.fillStyle = eg; g.fillRect(0, S * 0.55, S, S * 0.45);
  if (kind === "windshield") {
    // Wiper-swept fans are cleaner: cut dust back to the plain tint. The texture covers one half (u 0 = edge … 1 = centre).
    g.save();
    g.globalCompositeOperation = "destination-out";
    g.fillStyle = "rgba(0,0,0,0.72)";
    g.beginPath(); g.moveTo(S * 0.62, S * 0.99); g.arc(S * 0.62, S * 0.99, S * 0.74, Math.PI * 1.08, Math.PI * 1.9); g.closePath(); g.fill();
    g.restore();
    g.fillStyle = "rgba(150,172,160,0.1)"; g.fillRect(0, 0, S, S);
    g.strokeStyle = css(dust, 0.3); g.lineWidth = 3;
    g.beginPath(); g.arc(S * 0.62, S * 0.99, S * 0.74, Math.PI * 1.08, Math.PI * 1.9); g.stroke();
    speckle(g, R, S, S, 260, [0xd8c8a6, 0x6a5a40], 0.2, 0.55, 1, 3);         // bug splats / chips
  } else speckle(g, R, S, S, 200, [0xd8c8a6], 0.1, 0.4, 1, 3);
  // Rubber gasket border
  g.strokeStyle = "rgba(14,14,14,1)"; g.lineWidth = kind === "windshield" ? 16 : 22;
  if (kind === "windshield") { g.beginPath(); g.moveTo(0, 0); g.lineTo(S, 0); g.moveTo(0, 0); g.lineTo(0, S); g.moveTo(0, S); g.lineTo(S, S); g.stroke(); }
  else g.strokeRect(0, 0, S, S);
  return tex(c);
}
const glassMat = (map) => new THREE.MeshStandardMaterial({
  map, color: 0xffffff, transparent: true, opacity: 1, roughness: 0.06, metalness: 0.0, envMapIntensity: 1.6,
  side: THREE.DoubleSide, depthWrite: false,
});

// ── Small textures ────────────────────────────────────────────────────────────────────────────
function tyreTextures() {
  const W = 256, H = 256, c = canvas(W, H), g = c.getContext("2d"), b = canvas(W, H), bg = b.getContext("2d");
  const R = mulberry(77);
  g.fillStyle = "#1b1b1c"; g.fillRect(0, 0, W, H);
  bg.fillStyle = "#808080"; bg.fillRect(0, 0, W, H);
  // v: 0..0.3 sidewall, 0.3..0.7 tread, 0.7..1 sidewall (lathe profile order)
  const t0 = H * 0.3, t1 = H * 0.7;
  bg.fillStyle = "#b0b0b0"; bg.fillRect(0, t0, W, t1 - t0);
  bg.fillStyle = "#202020";
  for (let i = 0; i < 4; i++) bg.fillRect(0, t0 + (t1 - t0) * (0.14 + i * 0.24) - 3, W, 6);     // circumferential grooves
  for (let x = 0; x < W; x += 32) {                                                              // lateral sipes / lugs
    bg.fillRect(x, t0, 7, (t1 - t0) * 0.2); bg.fillRect(x + 16, t1 - (t1 - t0) * 0.2, 7, (t1 - t0) * 0.2);
    bg.fillRect(x + 8, t0 + (t1 - t0) * 0.3, 4, (t1 - t0) * 0.4);
  }
  g.fillStyle = "rgba(0,0,0,0.5)";
  for (let i = 0; i < 4; i++) g.fillRect(0, t0 + (t1 - t0) * (0.14 + i * 0.24) - 3, W, 6);
  // sidewall rings + dust
  g.strokeStyle = "rgba(70,70,70,0.6)"; g.lineWidth = 2;
  for (const y of [H * 0.08, H * 0.22, H * 0.78, H * 0.92]) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.fillStyle = "rgba(160,160,150,0.35)"; g.font = "bold 20px sans-serif";
  g.fillText("DUSTER A/T  LT235", 6, H * 0.18); g.fillText("DUSTER A/T  LT235", 6, H * 0.9);
  for (let i = 0; i < 50; i++) blotch(g, R, R() * W, R() * H, 10 + R() * 40, 0x8f7a5c, 0.05 + R() * 0.12, 3);
  return { map: tex(c, { repeat: [4, 1] }), bump: tex(b, { srgb: false, repeat: [4, 1] }) };
}

function fabricTexture() {
  // 70s "saddle blanket" bench upholstery: vinyl bolsters with a woven striped insert, worn
  const S = 256, c = canvas(S, S), g = c.getContext("2d"), R = mulberry(31);
  g.fillStyle = "#6b4a33"; g.fillRect(0, 0, S, S);
  const cols = ["#8a6a48", "#3d2b20", "#a98b62", "#5b3a2a", "#b7a17a", "#2f2520"];
  for (let x = 0; x < S; x += 8) { g.fillStyle = cols[((x / 8) * 5 + ((x / 8) % 3)) % cols.length | 0]; g.fillRect(x, 0, 8, S); }
  g.globalAlpha = 0.25;
  for (let y = 0; y < S; y += 3) { g.fillStyle = y % 6 ? "#000" : "#fff"; g.fillRect(0, y, S, 1); }
  g.globalAlpha = 1;
  for (let i = 0; i < 26; i++) blotch(g, R, R() * S, R() * S, 20 + R() * 50, R() < 0.5 ? 0x2a1d14 : 0xb9a888, 0.1 + R() * 0.12, 4);
  speckle(g, R, S, S, 900, [0x1a120c, 0xc9b99a], 0.1, 0.3);
  return tex(c, { repeat: [3, 2] });
}

function decalAtlas() {
  // 512×256: plates top-left, tailgate lettering, badges
  const c = canvas(512, 256), g = c.getContext("2d"), R = mulberry(5);
  g.clearRect(0, 0, 512, 256);
  // Licence plate (0,0)-(192,96)
  g.fillStyle = "#d9d2b8"; g.fillRect(2, 2, 188, 92);
  g.strokeStyle = "#2c4a66"; g.lineWidth = 4; g.strokeRect(6, 6, 180, 84);
  g.fillStyle = "#2c4a66"; g.font = "bold 16px sans-serif"; g.textAlign = "center"; g.fillText("DUST  COUNTY", 96, 24);
  g.font = "bold 46px monospace"; g.fillText("LH·1978", 96, 72);
  for (let i = 0; i < 16; i++) blotch(g, R, R() * 192, R() * 96, 8 + R() * 22, R() < 0.5 ? 0x6a3418 : 0x9d8a66, 0.2, 3);
  // Tailgate lettering (0,112)-(512,176): pressed letters
  g.textAlign = "center"; g.font = "bold 56px sans-serif";
  g.fillStyle = "rgba(20,16,12,0.55)"; g.fillText("B R A Z O S", 258, 168);
  g.fillStyle = "rgba(235,228,214,0.85)"; g.fillText("B R A Z O S", 256, 165);
  // Fender badge (200,0)-(392,48)
  g.font = "italic bold 30px serif"; g.fillStyle = "rgba(225,225,220,0.95)"; g.fillText("Corvina", 296, 34);
  g.strokeStyle = "rgba(225,225,220,0.9)"; g.lineWidth = 2; g.beginPath(); g.moveTo(214, 42); g.lineTo(380, 42); g.stroke();
  // "150" badge (400,0)-(512,48)
  g.font = "bold 32px sans-serif"; g.fillText("150", 456, 36);
  // sedan plate variant (200,56)-(392,104) unused strip of dirt
  return tex(c);
}

// Instrument faces. 512×256. Layout (px): speedo centre (132,128) r 104; tach centre (380,128) r 104 for the pickup-style
// twin dial; small fuel (256,62) and temp (256,194) gauges sit between them.
export const GAUGE = {
  w: 512, h: 256,
  speedo: { cx: 122, cy: 132, r: 96, a0: -2.2, a1: 2.2, max: 180 },      // angles from 12 o'clock, clockwise positive
  tach: { cx: 390, cy: 132, r: 96, a0: -2.2, a1: 2.2, max: 6000 },
  fuel: { cx: 256, cy: 84, r: 38, a0: -1.0, a1: 1.0 },
  temp: { cx: 256, cy: 196, r: 38, a0: -1.0, a1: 1.0 },
};
function gaugeTexture() {
  const c = canvas(GAUGE.w, GAUGE.h), g = c.getContext("2d");
  g.fillStyle = "#0b0b0b"; g.fillRect(0, 0, GAUGE.w, GAUGE.h);
  const ink = "#e9e2cf", red = "#d2452c";
  const dial = (d, major, minorPer, label, fmt, redFrom) => {
    g.fillStyle = "#151515"; g.beginPath(); g.arc(d.cx, d.cy, d.r, 0, 6.283); g.fill();
    g.strokeStyle = "#3a3a38"; g.lineWidth = 3; g.beginPath(); g.arc(d.cx, d.cy, d.r, 0, 6.283); g.stroke();
    const n = major * minorPer;
    for (let i = 0; i <= n; i++) {
      const f = i / n, a = d.a0 + (d.a1 - d.a0) * f, s = Math.sin(a), co = -Math.cos(a);
      const big = i % minorPer === 0;
      g.strokeStyle = redFrom !== undefined && f >= redFrom ? red : ink; g.lineWidth = big ? 3 : 1.5;
      g.beginPath(); g.moveTo(d.cx + s * d.r * 0.93, d.cy + co * d.r * 0.93); g.lineTo(d.cx + s * d.r * (big ? 0.78 : 0.85), d.cy + co * d.r * (big ? 0.78 : 0.85)); g.stroke();
      if (big && fmt) {
        g.fillStyle = redFrom !== undefined && f >= redFrom ? red : ink; g.font = `bold ${Math.round(d.r * 0.17)}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(fmt(f), d.cx + s * d.r * 0.62, d.cy + co * d.r * 0.62);
      }
    }
    g.fillStyle = "#b9b29f"; g.font = `${Math.round(d.r * 0.14)}px sans-serif`; g.textAlign = "center";
    g.fillText(label, d.cx, d.cy + d.r * 0.42);
  };
  dial(GAUGE.speedo, 9, 4, "km/h", (f) => String(Math.round(f * GAUGE.speedo.max)));
  dial(GAUGE.tach, 6, 5, "RPM ×1000", (f) => String(Math.round(f * 6)), 0.72);
  const small = (d, l0, l1, title) => {
    g.fillStyle = "#151515"; g.beginPath(); g.arc(d.cx, d.cy, d.r, 0, 6.283); g.fill();
    g.strokeStyle = "#3a3a38"; g.lineWidth = 2; g.beginPath(); g.arc(d.cx, d.cy, d.r, 0, 6.283); g.stroke();
    for (let i = 0; i <= 4; i++) {
      const a = d.a0 + (d.a1 - d.a0) * (i / 4), s = Math.sin(a), co = -Math.cos(a);
      g.strokeStyle = (title === "TEMP" && i === 4) || (title === "FUEL" && i === 0) ? red : ink; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(d.cx + s * d.r * 0.9, d.cy + co * d.r * 0.9); g.lineTo(d.cx + s * d.r * 0.7, d.cy + co * d.r * 0.7); g.stroke();
    }
    g.fillStyle = ink; g.font = "bold 11px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(l0, d.cx - d.r * 0.5, d.cy - d.r * 0.08); g.fillText(l1, d.cx + d.r * 0.5, d.cy - d.r * 0.08);
    g.fillStyle = "#b9b29f"; g.font = "9px sans-serif"; g.fillText(title, d.cx, d.cy + d.r * 0.55);
  };
  g.fillStyle = "#b9b29f"; g.font = "bold 8px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  [["OIL", 226], ["BATT", 256], ["TEMP", 286]].forEach(([t, x]) => g.fillText(t, x, 129));
  small(GAUGE.fuel, "E", "F", "FUEL");
  small(GAUGE.temp, "C", "H", "TEMP");
  return tex(c, { aniso: 8 });
}

function finTexture() {
  const c = canvas(64, 64), g = c.getContext("2d");
  g.fillStyle = "#17150f"; g.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 4) { g.fillStyle = "#5c5136"; g.fillRect(0, y, 64, 1); }
  for (let x = 0; x < 64; x += 16) { g.fillStyle = "#3a3324"; g.fillRect(x, 0, 5, 64); }
  return tex(c, { repeat: [10, 10] });
}

function lensTexture() {
  const c = canvas(64, 64), g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, 64, 64);
  for (let x = 0; x < 64; x += 8) { g.fillStyle = "rgba(0,0,0,0.22)"; g.fillRect(x, 0, 2, 64); g.fillStyle = "rgba(0,0,0,0.08)"; g.fillRect(x + 4, 0, 1, 64); }
  for (let y = 0; y < 64; y += 16) { g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(0, y, 64, 1); }
  return tex(c, { repeat: [2, 2] });
}

function grimeTexture() {
  // Tiling dirt/grain used on vertex-coloured parts so they do not look like flat plastic
  const S = 256, c = canvas(S, S), g = c.getContext("2d"), R = mulberry(911);
  g.fillStyle = "#d8d8d8"; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) blotch(g, R, R() * S, R() * S, 10 + R() * 50, R() < 0.6 ? 0x777777 : 0xffffff, 0.08 + R() * 0.1, 4);
  speckle(g, R, S, S, 2500, [0x666666, 0xffffff, 0x8a7a66], 0.08, 0.3);
  return tex(c, { repeat: [2, 2] });
}

export function prepareMaterials() {
  if (ready) return M;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const grime = grimeTexture();
  // Vertex-coloured families: one draw call per family per object, colours come from the geometry
  M.vc = std({ vertexColors: true, roughness: 0.82, metalness: 0.0, map: grime });                     // plastics, vinyl, rubber, paint chips
  M.vcMetal = std({ vertexColors: true, roughness: 0.34, metalness: 1.0, envMapIntensity: 1.1 });       // chrome, steel, aluminium, brass
  M.vcRough = std({ vertexColors: true, roughness: 0.95, metalness: 0.25, map: grime, side: THREE.DoubleSide });  // cast iron, rusty underside, inner panels
  M.vcGlow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });                    // needles
  const tyre = tyreTextures();
  M.tyre = std({ map: tyre.map, bumpMap: tyre.bump, bumpScale: 2.5, roughness: 0.93, metalness: 0 });
  M.fabric = std({ map: fabricTexture(), roughness: 0.95, metalness: 0 });
  M.glassSide = glassMat(glassTexture("side", 11));
  M.glassFront = glassMat(glassTexture("windshield", 12));
  M.mirror = std({ color: 0x8c99a6, roughness: 0.04, metalness: 1, envMapIntensity: 0.75 });
  M.decal = std({ map: decalAtlas(), transparent: true, roughness: 0.7, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  M.gaugeFace = gaugeTexture();
  M.fins = std({ map: finTexture(), roughness: 0.8, metalness: 0.5 });
  M.lensTex = lensTexture();
  M.proxy = new THREE.MeshBasicMaterial({ visible: false });      // invisible but still hit by raycasts
  ready = true;
  return M;
}

// Per-vehicle lamp and instrument materials (their emissive state differs between vehicles)
export function lampMaterials() {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  return {
    head: std({ color: 0xf2efe6, map: M.lensTex, roughness: 0.15, metalness: 0.1, emissive: 0xfff0cf, emissiveIntensity: 0, envMapIntensity: 1.4 }),
    tail: std({ color: 0x9c1512, map: M.lensTex, roughness: 0.3, metalness: 0, emissive: 0xff1a10, emissiveIntensity: 0 }),
    amber: std({ color: 0xc8761a, map: M.lensTex, roughness: 0.3, metalness: 0, emissive: 0xff8a1c, emissiveIntensity: 0 }),
    gauges: std({ map: M.gaugeFace, roughness: 0.55, metalness: 0, emissive: 0xffffff, emissiveMap: M.gaugeFace, emissiveIntensity: 0.0 }),
    lampOil: std({ color: 0x2a0d0a, roughness: 0.4, emissive: 0xff2a14, emissiveIntensity: 0 }),
    lampBat: std({ color: 0x2a0d0a, roughness: 0.4, emissive: 0xff2a14, emissiveIntensity: 0 }),
    lampTemp: std({ color: 0x2a1c0a, roughness: 0.4, emissive: 0xffa21c, emissiveIntensity: 0 }),
  };
}

export function disposeMaterials() {
  for (const m of paintCache.values()) { m.map?.dispose(); m.roughnessMap?.dispose(); m.dispose(); }
  paintCache.clear();
}
