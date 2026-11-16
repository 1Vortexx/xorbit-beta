// Long Haul – maps: the minimap in the HUD and the full map (M). They only show what this player has found: the
// stretches of road they have driven, their own off-road tracks and the places they have discovered. A Digimap in the
// pockets or hands adds the road ahead and the next open fuel and services (main.js decides what it reveals).
// Convoy members are drawn too. Forward along the road (+z) is up; the road's left (+x) is screen-left.
import { roadX, getSeed } from "./world/terrain.js";
import { groundColorAt } from "./world/index.js";

// ── What this player has seen (saved with the journey) ──
const NEAR_ROAD = 120;     // closer than this to the road counts as driving it…
const SEE = 250;           // …and reveals this far along it either way
const TRAIL_STEP = 25;     // metres between remembered off-road points
const TRAIL_MAX = 20000;

export class MapMemory {
  constructor() { this.road = []; this.trail = []; }      // road: sorted, merged [z0, z1]; trail: [x, z] points
  reset() { this.road = []; this.trail = []; }
  serialize() { return { road: this.road.map(([a, b]) => [Math.round(a), Math.round(b)]), trail: this.trail }; }
  restore(d) {
    this.reset();
    if (!d || typeof d !== "object") return;
    if (Array.isArray(d.road)) for (const r of d.road) if (Array.isArray(r) && isFinite(r[0]) && isFinite(r[1])) this.addRoad(r[0], r[1]);
    if (Array.isArray(d.trail)) this.trail = d.trail.filter((p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1])).slice(-TRAIL_MAX);
  }
  addRoad(a, b) {
    const R = this.road;
    let i = 0;
    while (i < R.length && R[i][1] < a) i++;
    let j = i;
    while (j < R.length && R[j][0] <= b) { a = Math.min(a, R[j][0]); b = Math.max(b, R[j][1]); j++; }
    R.splice(i, j - i, [a, b]);
  }
  covered(z) { return this.road.some(([a, b]) => z >= a && z <= b); }
  record(x, z) {
    if (Math.abs(x - roadX(z)) < NEAR_ROAD) {
      const R = this.road;
      if (!R.some(([a, b]) => z - SEE >= a && z + SEE <= b)) this.addRoad(z - SEE, z + SEE);
      return;
    }
    const l = this.trail[this.trail.length - 1];
    if (!l || Math.hypot(l[0] - x, l[1] - z) > TRAIL_STEP) {
      this.trail.push([Math.round(x), Math.round(z)]);
      if (this.trail.length > TRAIL_MAX) this.trail.shift();
    }
  }
  get extent() { return this.road.length ? [this.road[0][0], this.road[this.road.length - 1][1]] : null; }
}

// ── Ground colour tiles ──
// 256 m squares sampled every 8 m with the terrain's own colours, built a few at a time and kept (per seed).
const TILE = 256, TPX = 32, CORRIDOR = 300, TRAIL_SEE = 150;
const tiles = new Map();
let tileSeed = null;
const _rgb = [0, 0, 0];
const toS = (c) => Math.round(255 * Math.min(1, Math.pow(Math.max(0, c), 1 / 2.2)));
function buildTile(tx, tz) {
  const c = document.createElement("canvas");
  c.width = c.height = TPX;
  const g = c.getContext("2d"), img = g.createImageData(TPX, TPX), step = TILE / TPX;
  for (let j = 0; j < TPX; j++) for (let i = 0; i < TPX; i++) {
    // canvas x grows to the road's right (−x), canvas y grows backwards (−z)
    groundColorAt((tx + 1) * TILE - (i + 0.5) * step, (tz + 1) * TILE - (j + 0.5) * step, _rgb);
    const o = (j * TPX + i) * 4;
    img.data[o] = toS(_rgb[0]); img.data[o + 1] = toS(_rgb[1]); img.data[o + 2] = toS(_rgb[2]); img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
// Is this tile anywhere near what the player can see on the map?
function tileWanted(tx, tz, d) {
  const z0 = tz * TILE - CORRIDOR, z1 = (tz + 1) * TILE + CORRIDOR, zc = (tz + 0.5) * TILE, xc = (tx + 0.5) * TILE;
  const nearRoad = Math.abs(xc - roadX(zc)) < CORRIDOR + TILE;
  if (nearRoad && (d.memory.road.some(([a, b]) => a < z1 && b > z0) || (d.reveal && d.reveal[0] < z1 && d.reveal[1] > z0))) return true;
  const x0 = tx * TILE - TRAIL_SEE, x1 = (tx + 1) * TILE + TRAIL_SEE;
  return d.memory.trail.some((p) => p[0] > x0 && p[0] < x1 && p[1] > z0 && p[1] < z1);
}

// ── Drawing ──
export const KIND_STYLE = {
  start:    { letter: "⌂", color: "#f1e9d8", label: "Home" },
  station:  { letter: "F", color: "#f2aa2e", label: "Fuel" },
  garage:   { letter: "G", color: "#7fc3b5", label: "Garage" },
  diner:    { letter: "D", color: "#e98b6d", label: "Diner" },
  motel:    { letter: "M", color: "#c7a0e0", label: "Motel" },
  home:     { letter: "H", color: "#c9bfae", label: "House" },
  junkyard: { letter: "J", color: "#a9a18f", label: "Junkyard" },
  wreck:    { letter: "×", color: "#a9a18f", label: "Wreck" },
};
const MEMBER = "#5fc4d6", ME = "#f2aa2e", ROAD = "#3a3631", ROAD_EDGE = "rgba(241,233,216,0.75)", INTEL = "#f2aa2e";
const FOG = "rgb(17,14,11)";

// view: { cx, cz (world point at the centre), scale (px per metre) }
// d: { memory, sites: [{ x, z, kind, name, start?, state: "found" | "ruin" | "intel", route? }], reveal: [z0, z1] | null,
//      me: { x, z, yaw }, members: [{ name, x, z, paused }], labels, edge (clamp members to the border), dpr,
//      tileMs: time allowed for building ground tiles this draw }
// → true when ground tiles are still waiting to be built (draw again soon)
export function drawMap(ctx, w, h, view, d) {
  const { cx, cz, scale } = view, k = d.dpr || 1;
  const sx = (x) => w / 2 - (x - cx) * scale, sy = (z) => h / 2 - (z - cz) * scale;
  const zLo = cz - h / 2 / scale - 50, zHi = cz + h / 2 / scale + 50;
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgb(17,14,11)"; ctx.fillRect(0, 0, w, h);

  // The ground, in its own colours…
  if (getSeed() !== tileSeed) { tiles.clear(); tileSeed = getSeed(); }
  if (tiles.size > 900) tiles.clear();
  const xHalfV = w / 2 / scale, tpx = TILE * scale;
  const until = performance.now() + (d.tileMs || 4);
  let pending = false;
  ctx.imageSmoothingEnabled = true;
  for (let tz = Math.floor(zLo / TILE); tz <= Math.floor(zHi / TILE); tz++) {
    for (let tx = Math.floor((cx - xHalfV) / TILE); tx <= Math.floor((cx + xHalfV) / TILE); tx++) {
      const key = tx + "," + tz;
      let t = tiles.get(key);
      if (t === undefined) {
        if (!tileWanted(tx, tz, d)) continue;
        if (performance.now() > until) { pending = true; continue; }
        tiles.set(key, t = buildTile(tx, tz));
      }
      if (t) ctx.drawImage(t, sx((tx + 1) * TILE), sy((tz + 1) * TILE), tpx + 0.5, tpx + 0.5);
    }
  }
  // …under darkness everywhere this player hasn't been (the Digimap thins it along the road ahead)
  const fog = fogFor(ctx.canvas);
  const f = fog.getContext("2d");
  f.globalCompositeOperation = "source-over"; f.clearRect(0, 0, w, h); f.fillStyle = FOG; f.fillRect(0, 0, w, h);
  f.globalCompositeOperation = "destination-out"; f.lineCap = "round"; f.lineJoin = "round";
  const corridor = (a, b, width, alpha) => {
    a = Math.max(a, zLo - CORRIDOR); b = Math.min(b, zHi + CORRIDOR);
    if (a >= b) return;
    f.globalAlpha = alpha; f.strokeStyle = "#000"; f.lineWidth = width;
    f.beginPath();
    const st = Math.max(8, 5 * k / scale);
    for (let z = a; ; z += st) { const zz = Math.min(z, b); const X = sx(roadX(zz)), Y = sy(zz); z === a ? f.moveTo(X, Y) : f.lineTo(X, Y); if (zz >= b) break; }
    f.stroke();
  };
  if (d.reveal) corridor(d.reveal[0], d.reveal[1], 2 * CORRIDOR * scale, 0.5);
  for (const [a, b] of d.memory.road) corridor(a, b, 2 * CORRIDOR * scale, 1);
  f.globalAlpha = 1; f.lineWidth = 2 * TRAIL_SEE * scale; f.beginPath();
  let pt = null;
  for (const p of d.memory.trail) {
    if (p[1] < zLo - 500 || p[1] > zHi + 500) { pt = null; continue; }
    if (pt && Math.hypot(p[0] - pt[0], p[1] - pt[1]) < 120) f.lineTo(sx(p[0]), sy(p[1])); else { f.moveTo(sx(p[0]), sy(p[1])); f.lineTo(sx(p[0]) + 0.01, sy(p[1])); }
    pt = p;
  }
  f.stroke();
  f.globalCompositeOperation = "source-over"; f.globalAlpha = 1;
  ctx.drawImage(fog, 0, 0);

  // 1 km grid
  const grid = scale > 0.004 ? 1000 : 10000;
  ctx.strokeStyle = "rgba(241,233,216,0.07)"; ctx.lineWidth = 1 * k;
  ctx.beginPath();
  for (let z = Math.ceil(zLo / grid) * grid; z < zHi; z += grid) { ctx.moveTo(0, sy(z)); ctx.lineTo(w, sy(z)); }
  const xHalf = w / 2 / scale;
  for (let x = Math.ceil((cx - xHalf) / grid) * grid; x < cx + xHalf; x += grid) { ctx.moveTo(sx(x), 0); ctx.lineTo(sx(x), h); }
  ctx.stroke();

  const step = Math.max(8, 5 * k / scale);
  const roadPath = (a, b) => {
    a = Math.max(a, zLo); b = Math.min(b, zHi);
    if (a >= b) return;
    ctx.beginPath();
    for (let z = a; ; z += step) { const zz = Math.min(z, b); const X = sx(roadX(zz)), Y = sy(zz); z === a ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); if (zz >= b) break; }
    ctx.stroke();
  };
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  // Digimap: the road ahead, dashed
  if (d.reveal) {
    ctx.strokeStyle = "rgba(242,170,46,0.55)"; ctx.lineWidth = Math.max(1.5 * k, 6 * scale); ctx.setLineDash([5 * k, 5 * k]);
    roadPath(d.reveal[0], d.reveal[1]);
    ctx.setLineDash([]);
  }
  // Side tracks to places found
  ctx.strokeStyle = "rgba(90,70,48,0.85)"; ctx.lineWidth = Math.max(1.5 * k, 4 * scale);
  for (const s of d.sites) if (s.route && s.state !== "intel") {
    ctx.beginPath(); s.route.pts.forEach((p, i) => (i ? ctx.lineTo(sx(p.x), sy(p.z)) : ctx.moveTo(sx(p.x), sy(p.z)))); ctx.stroke();
  }
  // Road driven: asphalt with pale edges
  ctx.strokeStyle = ROAD_EDGE; ctx.lineWidth = Math.max(4 * k, 11 * scale);
  for (const [a, b] of d.memory.road) roadPath(a, b);
  ctx.strokeStyle = ROAD; ctx.lineWidth = Math.max(2.5 * k, 8 * scale);
  for (const [a, b] of d.memory.road) roadPath(a, b);
  // Off-road tracks
  ctx.strokeStyle = "rgba(60,44,30,0.8)"; ctx.lineWidth = 1.5 * k; ctx.setLineDash([2 * k, 3 * k]);
  ctx.beginPath();
  let prev = null;
  for (const p of d.memory.trail) {
    if (p[1] < zLo - 500 || p[1] > zHi + 500) { prev = null; continue; }
    if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) < 120) ctx.lineTo(sx(p[0]), sy(p[1])); else ctx.moveTo(sx(p[0]), sy(p[1]));
    prev = p;
  }
  ctx.stroke(); ctx.setLineDash([]);

  // Places
  const r = (d.labels ? 8 : 6) * k;
  ctx.font = `700 ${Math.round(r * 1.25)}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const s of d.sites) {
    if (s.z < zLo || s.z > zHi) continue;
    const st = KIND_STYLE[s.start ? "start" : s.kind] || KIND_STYLE.wreck, X = sx(s.x), Y = sy(s.z);
    if (X < -r || X > w + r) continue;
    const ruin = s.state === "ruin", intel = s.state === "intel";
    ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2);
    ctx.fillStyle = intel ? "rgba(17,14,11,0.9)" : ruin ? "#4a443c" : st.color; ctx.fill();
    ctx.lineWidth = 1.5 * k; ctx.strokeStyle = intel ? INTEL : "rgba(0,0,0,0.6)";
    if (intel) ctx.setLineDash([2 * k, 2 * k]);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = intel ? INTEL : ruin ? "#a9a18f" : "#16120d";
    ctx.fillText(st.letter, X, Y + 0.5 * k);
    if (ruin) { ctx.strokeStyle = "#c9bfae"; ctx.lineWidth = 1.5 * k; ctx.beginPath(); ctx.moveTo(X - r * 0.8, Y + r * 0.8); ctx.lineTo(X + r * 0.8, Y - r * 0.8); ctx.stroke(); }
    if (d.labels && scale > 0.012 && s.name) label(ctx, s.name + (ruin ? " (closed down)" : ""), X + r + 4 * k, Y, k, intel ? INTEL : "#e7dcc6", "left");
  }

  // Convoy members (clamped to the edge on the minimap when out of view)
  for (const m of d.members || []) {
    let X = sx(m.x), Y = sy(m.z), off = false;
    if (d.edge) {
      const pad = 8 * k, cX = Math.min(w - pad, Math.max(pad, X)), cY = Math.min(h - pad, Math.max(pad, Y));
      off = cX !== X || cY !== Y; X = cX; Y = cY;
    }
    ctx.beginPath(); ctx.arc(X, Y, (off ? 4 : 6) * k, 0, Math.PI * 2);
    ctx.fillStyle = m.paused ? "#8a8274" : MEMBER; ctx.fill();
    ctx.lineWidth = 1.5 * k; ctx.strokeStyle = "#0d0a07"; ctx.stroke();
    if (m.paused && !off) { ctx.fillStyle = "#0d0a07"; ctx.fillRect(X - 2.5 * k, Y - 3 * k, 1.8 * k, 6 * k); ctx.fillRect(X + 0.7 * k, Y - 3 * k, 1.8 * k, 6 * k); }
    if (d.labels) label(ctx, "@" + m.name + (m.paused ? " (paused)" : ""), X + 9 * k, Y, k, m.paused ? "#c9bfae" : MEMBER, "left");
  }

  // You
  if (d.me) {
    const X = sx(d.me.x), Y = sy(d.me.z), fx = -Math.sin(d.me.yaw), fy = -Math.cos(d.me.yaw), s = 9 * k;
    ctx.beginPath();
    ctx.moveTo(X + fx * s, Y + fy * s);
    ctx.lineTo(X - fx * s * 0.6 + fy * s * 0.6, Y - fy * s * 0.6 - fx * s * 0.6);
    ctx.lineTo(X - fx * s * 0.25, Y - fy * s * 0.25);
    ctx.lineTo(X - fx * s * 0.6 - fy * s * 0.6, Y - fy * s * 0.6 + fx * s * 0.6);
    ctx.closePath();
    ctx.fillStyle = ME; ctx.fill(); ctx.lineWidth = 1.5 * k; ctx.strokeStyle = "#0d0a07"; ctx.stroke();
  }
  ctx.restore();
  return pending;
}
// One darkness canvas per target canvas, matched to its size
const fogs = new WeakMap();
function fogFor(target) {
  let c = fogs.get(target);
  if (!c) { c = document.createElement("canvas"); fogs.set(target, c); }
  if (c.width !== target.width || c.height !== target.height) { c.width = target.width; c.height = target.height; }
  return c;
}
function label(ctx, text, x, y, k, color, align) {
  ctx.save();
  ctx.font = `600 ${Math.round(11 * k)}px system-ui, sans-serif`; ctx.textAlign = align; ctx.textBaseline = "middle";
  ctx.lineWidth = 3 * k; ctx.strokeStyle = "rgba(13,10,7,0.9)"; ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
  ctx.restore();
}

function fit(canvas) {
  const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  return dpr;
}

// ── HUD minimap: centred on you, ~2 km across ──
export class Minimap {
  constructor() { this.el = null; this.cv = null; this.t = 0; }
  mount() {
    if (this.el && this.el.isConnected) return true;
    const host = document.querySelector("#hud .hud-tl");
    if (!host) return false;
    this.el = document.createElement("div");
    this.el.className = "plate lh-minimap"; this.el.setAttribute("aria-hidden", "true");
    this.el.innerHTML = `<canvas></canvas><span class="lh-minimap-key"><kbd>M</kbd> map</span>`;
    this.cv = this.el.querySelector("canvas");
    host.appendChild(this.el);
    return true;
  }
  // data(): the drawMap data; drawn ~8×/s
  update(dt, visible, data) {
    if (!this.mount()) return;
    this.el.hidden = !visible;
    if (!visible || (this.t -= dt) > 0) return;
    this.t = 0.12;
    const dpr = fit(this.cv), d = data();
    if (!d.me) return;
    const w = this.cv.width, h = this.cv.height;
    drawMap(this.cv.getContext("2d"), w, h, { cx: d.me.x, cz: d.me.z + 0.18 * h / (w / 1900), scale: w / 1900 }, { ...d, dpr, edge: true, labels: false });
  }
}

// ── Full map: drag to move, wheel / +/- to zoom, C to centre ──
export class MapView {
  constructor() { this.cv = null; this.view = null; this.data = null; this.timer = null; this.drag = null; }
  attach(canvas, data) {
    this.detach();
    this.cv = canvas; this.data = data;
    const d = data();
    // Opens centred on you, at the zoom you left it at
    this.view = { cx: d.me ? d.me.x : 0, cz: d.me ? d.me.z : 0, scale: this.view ? this.view.scale : 0.1 };
    canvas.addEventListener("pointerdown", this._down = (e) => { this.drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cz: this.view.cz }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", this._move = (e) => {
      if (!this.drag) return;
      const s = this.view.scale;       // CSS px per metre, like the pointer
      this.view.cx = this.drag.cx + (e.clientX - this.drag.x) / s; this.view.cz = this.drag.cz + (e.clientY - this.drag.y) / s;
      this.draw();
    });
    canvas.addEventListener("pointerup", this._up = () => { this.drag = null; });
    canvas.addEventListener("wheel", this._wheel = (e) => { e.preventDefault(); this.zoom(e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });
    this.timer = setInterval(() => { if (!this.cv || !this.cv.isConnected) this.detach(); else this.draw(); }, 250);
    this.draw();
  }
  detach() {
    clearInterval(this.timer); this.timer = null;
    if (this.cv) {
      this.cv.removeEventListener("pointerdown", this._down); this.cv.removeEventListener("pointermove", this._move);
      this.cv.removeEventListener("pointerup", this._up); this.cv.removeEventListener("wheel", this._wheel);
    }
    this.cv = null;
  }
  zoom(f) { if (!this.view) return; this.view.scale = Math.min(0.5, Math.max(0.0015, this.view.scale * f)); this.draw(); }
  centre() { const d = this.data && this.data(); if (d && d.me && this.view) { this.view.cx = d.me.x; this.view.cz = d.me.z; this.draw(); } }
  draw() {
    if (!this.cv) return;
    const dpr = fit(this.cv), d = this.data();
    const more = drawMap(this.cv.getContext("2d"), this.cv.width, this.cv.height, { ...this.view, scale: this.view.scale * dpr }, { ...d, dpr, labels: true, edge: false, tileMs: 10 });
    // Ground still filling in: keep drawing every frame until it's done
    if (more && !this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); });
  }
}
