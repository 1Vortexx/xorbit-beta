// Long Haul – site plans. Pure data (runs in Node): for a site this produces the merged static geometry batches,
// colliders, seeded loot, vehicle spawns, hinged parts (doors, container lids), interaction targets and sign texts.
// buildings.js turns a plan into meshes; nothing here depends on quality options.
import { Batch, lin } from "./geo.js";
import { rng, hashStr } from "./base.js";
import { KINDS } from "./sites.js";

const H = Math.PI / 2;
// Sun-bleached palette (sRGB hex → linear)
const C = {
  white: lin(0xd9d2c0), cream: lin(0xcdbb96), tan: lin(0xb59a73), adobe: lin(0xb98562), teal: lin(0x7fa39b), blue: lin(0x7d95a8),
  red: lin(0xa5463a), rust: lin(0x8a4b2c), rust2: lin(0x6b3a24), yellow: lin(0xc9a53f), green: lin(0x6f8660), pink: lin(0xc79a8c),
  wood: lin(0x8a6a4a), woodDark: lin(0x5a4330), woodPale: lin(0xa58c6a), conc: lin(0xa39d92), concDark: lin(0x77736b),
  steel: lin(0x9a9993), dark: lin(0x2e2c2a), black: lin(0x1b1b1c), chrome: lin(0xb8bcc2), fabric: lin(0x7c6f8a), sheet: lin(0xc8c1b2),
  inWall: lin(0xb3ab98), inDark: lin(0x8a8376), glass: lin(0x9fb4b8), tyre: lin(0x222224), canvas: lin(0x8c8462), ash: lin(0x3a3632),
  orange: lin(0xc8642a), glowWarm: lin(0xfff0c8), glowRed: lin(0xff5a3c), glowBlue: lin(0x7fd8ff),
};
const PAINTS = [C.white, C.cream, C.tan, C.adobe, C.teal, C.blue, C.pink, C.green];
const CAR_COLS = [C.rust, C.rust2, lin(0x7d8a8f), lin(0x9a8d6a), lin(0x5d6b5a), lin(0x8a8a86)];
const CAPS = { fuelcan: 10, jerrycan: 20, oil: 1, oiljug: 4, coolant: 4, waterjug: 4 };
const PART = { engine_i6: 1, engine_v8: 1, engine_i4: 1, battery: 1, radiator: 1, wheel_16: 1, wheel_14: 1 };
const TABLES = {
  food: [["water", 5], ["beans", 4], ["jerky", 3], ["chips", 3], ["soda", 3], ["coffee", 2], ["waterjug", 1]],
  drink: [["water", 5], ["soda", 4], ["coffee", 3]],
  snack: [["chips", 4], ["jerky", 3], ["beans", 2], ["soda", 2]],
  med: [["bandage", 5], ["medkit", 2]],
  fluid: [["oil", 5], ["oiljug", 2], ["coolant", 3], ["fuelcan", 3], ["jerrycan", 1]],
  tool: [["wrench", 3], ["jack", 2], ["repairkit", 2], ["flashlight", 2], ["oil", 2]],
  part: [["battery", 3], ["radiator", 3], ["wheel_14", 3], ["wheel_16", 3]],
  bigpart: [["engine_i6", 3], ["engine_i4", 2], ["engine_v8", 1], ["wheel_14", 2], ["wheel_16", 2], ["radiator", 1], ["battery", 1]],
  misc: [["water", 3], ["bandage", 2], ["flashlight", 2], ["beans", 2], ["oil", 1], ["jerky", 2]],
};

export class Plan {
  constructor(site) {
    this.site = site;
    this.batches = {};            // material id → Batch (site-local coordinates, pad level = 0)
    this.occ = new Batch();       // invisible proxy that blocks the interaction ray (walls, big furniture)
    this.colliders = [];          // absolute world colliders
    this.spawns = []; this.vehicleSpawns = [];
    this.dyn = [];                // hinged parts
    this.targets = [];            // static interaction targets (pumps, shop counter, beds)
    this.signs = [];              // { text, style, rect:[x,y,w,h] px in the site atlas }
    this.rand = rng(site.seed ^ 0x5bd1e995);
    this.n = 0; this.dn = 0;
    this.fx = 0; this.fz = 0; this.fyaw = 0;
    this._ax = 2; this._ay = 2; this._ah = 0;   // sign atlas shelf packer (1024²)
    this.sc = Math.cos(site.yaw); this.ss = Math.sin(site.yaw);
  }
  b(m) { return this.batches[m] || (this.batches[m] = new Batch()); }
  // frame → site-local
  X(lx, lz) { return this.fx + lx * Math.cos(this.fyaw) + lz * Math.sin(this.fyaw); }
  Z(lx, lz) { return this.fz - lx * Math.sin(this.fyaw) + lz * Math.cos(this.fyaw); }
  at(x, z, yaw, fn) {
    const sx = this.fx, sz = this.fz, sy = this.fyaw;
    const nx = this.X(x, z), nz = this.Z(x, z);
    this.fx = nx; this.fz = nz; this.fyaw = sy + yaw;
    const r = fn();
    this.fx = sx; this.fz = sz; this.fyaw = sy;
    return r;
  }
  // site-local → world
  wx(X, Z) { return this.site.x + X * this.sc + Z * this.ss; }
  wz(X, Z) { return this.site.z - X * this.ss + Z * this.sc; }

  box(m, x, y, z, sx, sy, sz, col, o) {
    const yaw = this.fyaw + ((o && o.yaw) || 0), X = this.X(x, z), Z = this.Z(x, z);
    this.b(m).box(X, y, Z, sx, sy, sz, yaw, col, (o && o.uv) || 0.4);
    if (o && o.occ) this.occ.box(X, y, Z, sx, sy, sz, yaw);
    if (o && o.solid) this.collide(x, z, sx, sz, y, y + sy, o.yaw || 0).soundMaterial = m;
  }
  cyl(m, x, y, z, r, h, col, o = {}) {
    this.b(m).cyl(this.X(x, z), y, this.Z(x, z), r, h, o.seg || 10, col, { ...o, yaw: this.fyaw + (o.yaw || 0) });
    if (o.solid) this.circle(x, z, r, y, y + (o.axis && o.axis !== "y" ? 2 * r : h)).soundMaterial = m;
  }
  collide(x, z, sx, sz, y0, y1, yaw = 0) {
    const X = this.X(x, z), Z = this.Z(x, z);
    const c = { kind: "box", x: this.wx(X, Z), z: this.wz(X, Z), hx: sx / 2, hz: sz / 2, yaw: this.site.yaw + this.fyaw + yaw, y0: this.site.y + y0, y1: this.site.y + y1 };
    this.colliders.push(c);
    return c;
  }
  circle(x, z, r, y0, y1) {
    const X = this.X(x, z), Z = this.Z(x, z);
    const c = { kind: "circle", x: this.wx(X, Z), z: this.wz(X, Z), r, y0: this.site.y + y0, y1: this.site.y + y1 };
    this.colliders.push(c);
    return c;
  }
  spawn(type, x, y, z, o = {}) {
    const X = this.X(x, z), Z = this.Z(x, z);
    const s = { id: this.site.id + ":" + this.n++, type, pos: [this.wx(X, Z), this.site.y + y, this.wz(X, Z)], yaw: this.site.yaw + this.fyaw + (o.yaw === undefined ? (this.rand() - 0.5) * 1.2 : o.yaw) };
    if (CAPS[type]) s.qty = o.qty !== undefined ? o.qty : Math.round(CAPS[type] * (0.15 + this.rand() * 0.8) * 10) / 10;
    if (PART[type]) s.cond = o.cond !== undefined ? o.cond : Math.round(18 + this.rand() * 70);
    this.spawns.push(s);
    return s;
  }
  pick(table) {
    const t = TABLES[table];
    let tot = 0; for (const e of t) tot += e[1];
    let r = this.rand() * tot;
    for (const e of t) if ((r -= e[1]) <= 0) return e[0];
    return t[0][0];
  }
  // Scatter up to n items of a table over a row of slots starting at (x, y, z) stepping (dx, dz); p = chance per slot
  row(table, n, p, x, y, z, dx, dz) {
    for (let i = 0; i < n; i++) { const r = this.rand(), type = this.pick(table); if (r < p) this.spawn(type, x + dx * i, y, z + dz * i); }
  }
  vehicle(type, x, z, yaw) {
    const X = this.X(x, z), Z = this.Z(x, z), id = this.site.id + ":v" + this.vehicleSpawns.length;
    this.vehicleSpawns.push({ id, type, pos: [this.wx(X, Z), this.site.y, this.wz(X, Z)], yaw: this.site.yaw + this.fyaw + yaw, seed: hashStr(id + ":" + this.site.seed) });
  }
  target(type, name, x, y, z, sx, sy, sz, extra) {
    this.targets.push({ type, id: this.site.id + ":t" + this.targets.length, name, x: this.X(x, z), y, z: this.Z(x, z), sx, sy, sz, yaw: this.fyaw, ...extra });
  }
  // Hinged part. Pivot at frame (x, y, z); geometry is authored in pivot-local coords by fn(batchOf).
  hinge(kind, name, x, y, z, yaw, o, fn) {
    const d = {
      kind, name, id: this.site.id + ":" + (kind === "door" ? "d" : "c") + this.dn++, x: this.X(x, z), y, z: this.Z(x, z), yaw: this.fyaw + yaw,
      axis: o.axis || "y", angle: o.angle, open0: !!o.open0, batches: {}, collider: null, pick: o.pick || null,
    };
    d.flag = (kind === "door" ? "door:" : "cont:") + d.id;
    fn((m) => d.batches[m] || (d.batches[m] = new Batch()));
    this.dyn.push(d);
    return d;
  }
  sign(text, style, x, y, z, w, h, yaw = 0, twoSided = false) {
    const ph = h / w > 0.6 ? 192 : 96, pw = Math.min(1020, Math.round(ph * w / h));
    if (this._ax + pw > 1022) { this._ax = 2; this._ay += this._ah + 4; this._ah = 0; }
    const rect = [this._ax, this._ay, pw, ph];
    this._ax += pw + 4; this._ah = Math.max(this._ah, ph);
    this.signs.push({ text, style, rect });
    const u0 = rect[0] / 1024, u1 = (rect[0] + pw) / 1024, v1 = 1 - rect[1] / 1024, v0 = 1 - (rect[1] + ph) / 1024;
    const ty = this.fyaw + yaw, c = Math.cos(ty), s = Math.sin(ty), X = this.X(x, z), Z = this.Z(x, z);
    const P = (lx, yy, lz) => [X + lx * c + lz * s, yy, Z - lx * s + lz * c];
    const b = this.b("sign");
    b.quad(P(-w / 2, y, 0), P(w / 2, y, 0), P(w / 2, y + h, 0), P(-w / 2, y + h, 0), [1, 1, 1], [u0, v0, u1, v1]);
    if (twoSided) b.quad(P(w / 2, y, -0.02), P(-w / 2, y, -0.02), P(-w / 2, y + h, -0.02), P(w / 2, y + h, -0.02), [1, 1, 1], [u0, v0, u1, v1]);
  }

  // ── Walls ────────────────────────────────────────────
  // Runs along frame +x from 0 to L; outside is +z. openings: [{ a (centre), w, y0, y1, kind: "door"|"window"|"gap", ... }]
  wallRun(L, h, o) {
    const t = o.t || 0.2, mo = o.mat || "plaster", mi = o.matIn || "plaster";
    const seg = (a0, a1, y0, y1) => {
      if (a1 - a0 < 0.01 || y1 - y0 < 0.01) return;
      this.box(mo, (a0 + a1) / 2, y0, t / 4, a1 - a0, y1 - y0, t / 2, o.out);
      this.box(mi, (a0 + a1) / 2, y0, -t / 4, a1 - a0, y1 - y0, t / 2, o.inn);
      this.occ.box(this.X((a0 + a1) / 2, 0), y0, this.Z((a0 + a1) / 2, 0), a1 - a0, y1 - y0, t, this.fyaw);
    };
    const ops = (o.openings || []).slice().sort((p, q) => p.a - q.a);
    let cur = 0, solidFrom = 0;
    const trim = o.trim || C.white;
    for (const op of ops) {
      const a0 = op.a - op.w / 2, a1 = op.a + op.w / 2, y0 = op.y0 || 0, y1 = op.y1 === undefined ? 2.05 : op.y1;
      seg(cur, a0, 0, h); seg(a0, a1, 0, y0); seg(a0, a1, y1, h);
      cur = a1;
      if (op.kind === "window" || op.kind === "hatch") {
        if (op.kind === "window") {
          this.box("glass", op.a, y0, 0, op.w, y1 - y0, 0.02, C.glass);
          this.occ.box(this.X(op.a, 0), y0, this.Z(op.a, 0), op.w, y1 - y0, 0.04, this.fyaw);
        }
        this.box("smooth", op.a, y0 - 0.05, 0.03, op.w + 0.16, 0.06, t + 0.14, trim);
        this.box("smooth", op.a, y1, 0.02, op.w + 0.16, 0.07, t + 0.08, trim);
        for (const e of [a0 - 0.03, a1 + 0.03]) this.box("smooth", e, y0, 0.02, 0.06, y1 - y0, t + 0.08, trim);
        if (op.w > 1.5) for (let k = 1; k < Math.round(op.w / 1.1); k++) this.box("smooth", a0 + (op.w * k) / Math.round(op.w / 1.1), y0, 0, 0.04, y1 - y0, 0.05, trim);
        if (op.boards) for (let k = 0; k < 3; k++) this.box("wood", op.a + (this.rand() - 0.5) * 0.1, y0 + 0.12 + k * (y1 - y0 - 0.3) / 2.4, t / 2 + 0.02, op.w + 0.3, 0.16, 0.025, C.woodPale, { yaw: (this.rand() - 0.5) * 0.14 });
      } else {
        // frame
        this.box("smooth", op.a, y1, 0, op.w + 0.14, 0.07, t + 0.06, trim);
        for (const e of [a0 - 0.035, a1 + 0.035]) this.box("smooth", e, 0, 0, 0.07, y1, t + 0.06, trim);
        this.collide((solidFrom + a0) / 2, 0, a0 - solidFrom, t, 0, h);
        solidFrom = a1;
        if (op.kind === "door") this.door(a0, a1, y1, op);
      }
    }
    seg(cur, L, 0, h);
    this.collide((solidFrom + L) / 2, 0, L - solidFrom, t, 0, h);
  }
  door(a0, a1, h, op) {
    const w = a1 - a0 - 0.02, col = op.col || C.woodPale, right = op.hinge === "r";
    const d = this.hinge("door", op.name || "Door", right ? a1 - 0.01 : a0 + 0.01, 0, 0, 0, { angle: (right ? 1 : -1) * (op.inward ? -1 : 1) * 1.75, open0: op.open }, (bo) => {
      const sgn = right ? -1 : 1;
      bo("smooth").box(sgn * w / 2, 0.02, 0, w, h - 0.04, 0.045, 0, col);
      bo("smooth").box(sgn * w / 2, 0.9, 0, w - 0.25, h - 1.2, 0.055, 0, [col[0] * 0.85, col[1] * 0.85, col[2] * 0.85]);
      bo("smooth").box(sgn * (w - 0.1), 1.0, 0, 0.05, 0.05, 0.14, 0, C.chrome);
    });
    d.collider = this.collide((a0 + a1) / 2, 0, a1 - a0, 0.1, 0, h);
    d.collider.solid = !d.open0;
  }
  // Rectangular room centred on (cx, cz). openings per side: front (+z), back, left (−x), right, positions in room coords.
  room(cx, cz, hx, hz, h, o) {
    const t = o.t || 0.2, base = { t, out: o.out, inn: o.inn || C.inWall, mat: o.mat, matIn: o.matIn, trim: o.trim };
    const conv = (list, f) => (list || []).map((op) => ({ ...op, a: f(op.at) }));
    this.at(cx - hx - t / 2, cz + hz, 0, () => this.wallRun(2 * hx + t, h, { ...base, openings: conv(o.front, (v) => v + hx + t / 2) }));
    this.at(cx + hx + t / 2, cz - hz, Math.PI, () => this.wallRun(2 * hx + t, h, { ...base, openings: conv(o.back, (v) => hx + t / 2 - v) }));
    this.at(cx + hx, cz + hz - t / 2, H, () => this.wallRun(2 * hz - t, h, { ...base, openings: conv(o.right, (v) => hz - t / 2 - v) }));
    this.at(cx - hx, cz - hz + t / 2, -H, () => this.wallRun(2 * hz - t, h, { ...base, openings: conv(o.left, (v) => v + hz - t / 2) }));
    if (o.floor !== false) this.box(o.floor || "concrete", cx, -0.25, cz, 2 * hx + t, 0.28, 2 * hz + t, o.floorCol || C.conc, { uv: 0.5 });
  }
  // Interior partition along x (dir "x") or z, with optional doorway(s)
  partition(x0, z0, len, dir, h, openings, col) {
    this.at(x0, z0, dir === "x" ? 0 : -H, () => this.wallRun(len, h, { t: 0.12, out: col || C.inWall, inn: col || C.inWall, openings }));
  }
  flatRoof(cx, cz, hx, hz, h, o = {}) {
    const ov = o.over === undefined ? 0.35 : o.over;
    this.box(o.mat || "concrete", cx, h, cz, 2 * (hx + ov) + 0.2, 0.22, 2 * (hz + ov) + 0.2, o.col || C.conc, { occ: true });
    this.box("plaster", cx, h - 0.03, cz, 2 * hx, 0.03, 2 * hz, o.ceil || C.inWall);
    if (o.parapet) {
      const p = o.parapet, pc = o.pcol || o.col || C.conc, X = hx + ov + 0.1, Zz = hz + ov + 0.1;
      this.box("plaster", cx, h + 0.22, cz + Zz - 0.08, 2 * X, p, 0.16, pc); this.box("plaster", cx, h + 0.22, cz - Zz + 0.08, 2 * X, p, 0.16, pc);
      this.box("plaster", cx + X - 0.08, h + 0.22, cz, 0.16, p, 2 * Zz - 0.32, pc); this.box("plaster", cx - X + 0.08, h + 0.22, cz, 0.16, p, 2 * Zz - 0.32, pc);
    }
  }
  gableRoof(cx, cz, hx, hz, h, rise, o = {}) {
    const ov = o.over === undefined ? 0.5 : o.over;
    this.box("plaster", cx, h - 0.03, cz, 2 * hx, 0.03, 2 * hz, o.ceil || C.inWall, { occ: true });
    const X = this.X(cx, cz), Z = this.Z(cx, cz);
    const g = this.b(o.mat || "roof").gable(X, h, Z, 2 * (hx + ov), rise * (1 + ov / hz), 2 * (hz + ov), this.fyaw, o.col || C.rust, o.wall || C.white);
    // gable-end walls, aligned with the wall planes
    const k = rise * (1 + ov / hz);
    for (const e of [-1, 1]) {
      const c = Math.cos(this.fyaw), s = Math.sin(this.fyaw), P = (lx, y, lz) => [X + lx * c + lz * s, y, Z - lx * s + lz * c];
      const x = e * (hx + 0.1), yb = h + k * (1 - (hz + 0.1) / (hz + ov));
      const A = P(x, h, hz + 0.1), B = P(x, h, -hz - 0.1), A2 = P(x, yb, hz + 0.1), B2 = P(x, yb, -hz - 0.1), R = P(x, h + k, 0);
      const wb = this.b(o.wallMat || "plaster"), wc = o.wall || C.white;
      if (e > 0) { wb.quad(A, B, B2, A2, wc); wb.tri(A2, B2, R, wc); } else { wb.quad(B, A, A2, B2, wc); wb.tri(B2, A2, R, wc); }
    }
    void g;
  }

  // ── Furniture (frame coords; yaw via at()) ───────────
  // Counter / bench: body with a top. Items rest at the returned height.
  counter(x, z, w, d, h, col, top, yaw = 0) {
    this.at(x, z, yaw, () => {
      this.box("smooth", 0, 0, 0, w, h - 0.04, d, col, { occ: true });
      this.box("smooth", 0, h - 0.04, 0, w + 0.06, 0.04, d + 0.06, top || C.steel);
      this.collide(0, 0, w, d, 0, h);
    });
    return h;
  }
  table(x, z, w, d, h = 0.74, col = C.wood, yaw = 0) {
    this.at(x, z, yaw, () => {
      this.box("wood", 0, h - 0.05, 0, w, 0.05, d, col);
      for (const ex of [-1, 1]) for (const ez of [-1, 1]) this.box("wood", ex * (w / 2 - 0.06), 0, ez * (d / 2 - 0.06), 0.06, h - 0.05, 0.06, col);
      this.collide(0, 0, w, d, 0, h);
    });
    return h;
  }
  chair(x, z, yaw, col = C.wood, fallen = false) {
    this.at(x, z, yaw, () => {
      if (fallen) { this.box("wood", 0, 0, 0.2, 0.42, 0.42, 0.05, col); this.box("wood", 0, 0, -0.25, 0.42, 0.05, 0.86, col); return; }
      this.box("wood", 0, 0.42, 0, 0.42, 0.05, 0.42, col);
      this.box("wood", 0, 0.47, -0.19, 0.42, 0.45, 0.04, col);
      for (const ex of [-1, 1]) for (const ez of [-1, 1]) this.box("wood", ex * 0.18, 0, ez * 0.18, 0.04, 0.42, 0.04, col);
      this.collide(0, 0, 0.42, 0.42, 0, 0.9);
    });
  }
  // Open shelving, back against frame −z. Returns nothing; fills its shelves from a loot table.
  shelf(x, z, w, yaw, o = {}) {
    const d = o.d || 0.4, hgt = o.h || 1.8, n = o.n || 4, col = o.col || C.steel;
    this.at(x, z, yaw, () => {
      for (const e of [-1, 1]) this.box("smooth", e * (w / 2 - 0.02), 0, 0, 0.04, hgt, d, col);
      this.box("smooth", 0, 0, -d / 2 + 0.01, w, hgt, 0.02, col, { occ: true });
      for (let i = 0; i < n; i++) {
        const y = 0.12 + (i * (hgt - 0.3)) / (n - 1 || 1);
        this.box("smooth", 0, y, 0, w - 0.04, 0.03, d, col);
        if (o.table) this.row(o.table, Math.floor((w - 0.3) / 0.36), o.p === undefined ? 0.3 : o.p, -w / 2 + 0.3, y + 0.03, 0.02, 0.36, 0);
      }
      this.collide(0, 0, w, d, 0, hgt);
    });
  }
  bed(x, z, yaw, o = {}) {
    this.at(x, z, yaw, () => {
      this.box("wood", 0, 0, 0, 1.0, 0.3, 2.0, o.frame || C.woodDark, { occ: true });
      this.box("fabric", 0, 0.3, 0.02, 0.94, 0.16, 1.9, C.sheet);
      this.box("fabric", 0, 0.46, 0.35, 0.96, 0.05, 1.2, o.col || C.fabric);
      this.box("fabric", 0, 0.46, -0.72, 0.6, 0.1, 0.36, C.white);
      this.box("wood", 0, 0, -1.02, 1.04, 0.85, 0.05, o.frame || C.woodDark);
      this.collide(0, 0, 1.0, 2.0, 0, 0.5);
      this.target("bed", o.name || "Bed", 0, 0.3, 0, 1.0, 0.3, 2.0);
    });
  }
  booth(x, z, yaw, col = C.red) {
    this.at(x, z, yaw, () => {
      for (const e of [-1, 1]) {
        this.box("fabric", 0, 0, e * 0.75, 1.2, 0.45, 0.5, col, { occ: true });
        this.box("fabric", 0, 0.45, e * 0.95, 1.2, 0.55, 0.1, col);
        this.collide(0, e * 0.8, 1.2, 0.6, 0, 1.0);
      }
      this.box("smooth", 0, 0.7, 0, 1.1, 0.04, 0.7, C.white);
      this.box("smooth", 0, 0, 0, 0.1, 0.7, 0.1, C.chrome);
      this.collide(0, 0, 1.1, 0.7, 0, 0.74);
    });
    return 0.74;
  }
  // Containers. Each has a hinged lid/door (target, E) and loot inside.
  fridge(x, z, yaw, o = {}) {
    const col = o.col || C.white, w = 0.75, d = 0.7, h = 1.75;
    this.at(x, z, yaw, () => {
      this.box("smooth", 0, 0, -d / 2 + 0.02, w, h, 0.04, col, { occ: true });
      for (const e of [-1, 1]) this.box("smooth", e * (w / 2 - 0.02), 0, 0, 0.04, h, d - 0.06, col, { occ: true });
      this.box("smooth", 0, h - 0.04, 0, w, 0.04, d - 0.06, col, { occ: true });
      this.box("smooth", 0, 0, 0, w, 0.1, d - 0.06, col);
      const ys = [0.1, 0.55, 0.95, 1.32];
      for (const y of ys) { if (y > 0.1) this.box("smooth", 0, y - 0.02, -0.02, w - 0.08, 0.02, d - 0.14, C.chrome); this.row(o.table || "food", 2, o.p === undefined ? 0.45 : o.p, -0.16, y, -0.03, 0.32, 0); }
      this.collide(0, 0, w, d, 0, h);
      this.hinge("lid", o.name || "Fridge", -w / 2, 0, d / 2 - 0.03, 0, { angle: -1.9, open0: o.open }, (bo) => {
        bo("smooth").box(w / 2, 0.02, 0.02, w, h - 0.04, 0.05, 0, col);
        bo("smooth").box(w - 0.07, 0.9, 0.06, 0.03, 0.4, 0.04, 0, C.chrome);
      });
    });
  }
  locker(x, z, yaw, o = {}) {
    const col = o.col || C.teal, w = o.w || 0.5, d = 0.5, h = o.h || 1.8;
    this.at(x, z, yaw, () => {
      this.box("smooth", 0, 0, -d / 2 + 0.015, w, h, 0.03, col, { occ: true });
      for (const e of [-1, 1]) this.box("smooth", e * (w / 2 - 0.015), 0, 0, 0.03, h, d - 0.04, col, { occ: true });
      this.box("smooth", 0, h - 0.03, 0, w, 0.03, d - 0.04, col, { occ: true });
      const n = h > 1.2 ? 3 : 2;
      for (let i = 0; i < n; i++) { const y = 0.03 + (i * (h - 0.2)) / n; this.box("smooth", 0, y - 0.03, 0, w - 0.06, 0.03, d - 0.06, col); this.row(o.table || "misc", 1, o.p === undefined ? 0.55 : o.p, 0, y, 0, 0, 0); }
      this.collide(0, 0, w, d, 0, h);
      this.hinge("lid", o.name || "Locker", -w / 2, 0, d / 2 - 0.02, 0, { angle: -1.8, open0: o.open }, (bo) => {
        bo("smooth").box(w / 2, 0.02, 0.01, w - 0.01, h - 0.04, 0.025, 0, col);
        bo("smooth").box(w - 0.06, h * 0.55, 0.035, 0.025, 0.12, 0.03, 0, C.chrome);
      });
    });
  }
  crate(x, z, yaw, o = {}) {
    const col = o.col || C.woodPale, w = o.w || 0.9, d = o.d || 0.6, h = o.h || 0.5, m = o.mat || "wood", y = o.y || 0;
    this.at(x, z, yaw, () => {
      this.box(m, 0, y, 0, w, 0.04, d, col);
      for (const e of [-1, 1]) { this.box(m, e * (w / 2 - 0.015), y, 0, 0.03, h, d, col, { occ: true }); this.box(m, 0, y, e * (d / 2 - 0.015), w, h, 0.03, col, { occ: true }); }
      const n = Math.max(1, Math.floor(w / 0.42));
      this.row(o.table || "misc", n, o.p === undefined ? 0.6 : o.p, -((n - 1) * 0.4) / 2, y + 0.04, 0, 0.4, 0);
      if (!y) this.collide(0, 0, w, d, 0, h).soundMaterial = m;
      this.hinge("lid", o.name || "Crate", 0, y + h, -d / 2, 0, { axis: "x", angle: -1.9, open0: o.open }, (bo) => {
        bo(m).box(0, 0, d / 2, w + 0.02, 0.035, d + 0.02, 0, col);
        if (m === "smooth") bo("smooth").box(0, 0.035, d - 0.03, 0.14, 0.02, 0.03, 0, C.chrome);
      });
    });
  }
  barrel(x, z, col = C.rust, fallen = false) {
    if (fallen) this.cyl("metal", x, 0, z, 0.29, 0.88, col, { axis: "x", yaw: this.rand() * 3, solid: true });
    else this.cyl("metal", x, 0, z, 0.29, 0.88, col, { solid: true });
  }
  tyreStack(x, z, n, r = 0.33) {
    for (let i = 0; i < n; i++) this.cyl("rubber", x + (this.rand() - 0.5) * 0.08, i * 0.22, z + (this.rand() - 0.5) * 0.08, r, 0.21, C.tyre, { seg: 12 });
    this.circle(x, z, r, 0, n * 0.22).soundMaterial = "rubber";
  }
  // Decorative car hulk (scenery, not recoverable)
  hulk(x, z, yaw, o = {}) {
    const col = o.col || CAR_COLS[Math.floor(this.rand() * CAR_COLS.length)], y = o.y || 0, crush = o.crush || 1, burnt = o.burnt;
    const c2 = burnt ? C.ash : [col[0] * 0.8, col[1] * 0.8, col[2] * 0.8], m = "metal";
    const c1 = burnt ? [C.ash[0] * 1.6, C.ash[1] * 1.3, C.ash[2] * 1.2] : col;
    this.at(x, z, yaw, () => {
      const up = o.wheels === false ? 0.12 : 0.3;
      this.box(m, 0, y + up, 0, 1.75, 0.5 * crush, 4.3, c1, { occ: true });
      this.box(m, 0, y + up + 0.5 * crush, -0.25, 1.55, 0.5 * crush, 2.0, c2, { occ: true });
      this.box("smooth", 0, y + up + 0.52 * crush, -0.25, 1.57, 0.34 * crush, 1.7, C.black);
      this.box(m, 0, y + up + 0.5 * crush, 1.5, 1.6, 0.06, 1.25, c2, { yaw: 0 });
      this.box(m, 0, y + up - 0.02, 2.2, 1.8, 0.2, 0.12, C.steel);
      this.box(m, 0, y + up - 0.02, -2.2, 1.8, 0.2, 0.12, C.steel);
      if (o.wheels !== false) for (const ex of [-1, 1]) for (const ez of [-1, 1]) if (this.rand() < 0.7) this.cyl("rubber", ex * 0.86, y, ez * 1.35, 0.32, 0.2, C.tyre, { axis: "x", seg: 10 });
      if (o.collide !== false) this.collide(0, 0, 1.8, 4.4, y, y + up + crush);
    });
  }
  post(x, z, h, s = 0.12, col = C.white, m = "smooth") { this.box(m, x, 0, z, s, h, s, col); this.circle(x, z, s * 0.7, 0, h); }
  fence(x0, z0, x1, z1, h, col, gap) {
    // corrugated panel fence between two points (axis aligned in frame); gap = [a0, a1] along the run left open
    const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(-(z1 - z0), x1 - x0);
    this.at(x0, z0, yaw, () => {
      const runs = gap ? [[0, gap[0]], [gap[1], len]] : [[0, len]];
      for (const [a, b] of runs) {
        if (b - a < 0.1) continue;
        const n = Math.max(1, Math.round((b - a) / 2.4));
        for (let i = 0; i < n; i++) {
          const w = (b - a) / n, cx = a + w * (i + 0.5), hh = h + (this.rand() - 0.5) * 0.25;
          this.box("metal", cx, 0, 0, w - 0.02, hh, 0.05, [col[0] * (0.8 + this.rand() * 0.4), col[1] * (0.8 + this.rand() * 0.4), col[2] * (0.8 + this.rand() * 0.3)], { occ: true, yaw: (this.rand() - 0.5) * 0.03 });
          this.box("wood", a + w * i, 0, -0.07, 0.1, h + 0.1, 0.1, C.woodDark);
        }
        this.collide((a + b) / 2, 0, b - a, 0.16, 0, h);
      }
    });
  }
}

// ═══ Site kinds ═════════════════════════════════════════
function porch(p, cx, z0, w, d, h, col) {
  p.box("wood", cx, -0.2, z0 + d / 2, w, 0.24, d, C.woodPale);
  p.box("roof", cx, h, z0 + d / 2 + 0.1, w + 0.4, 0.08, d + 0.3, col);
  for (const e of [-1, 1]) p.post(cx + e * (w / 2 - 0.15), z0 + d - 0.15, h, 0.11, C.white, "wood");
}
function waterTank(p, x, z) {
  for (const ex of [-1, 1]) for (const ez of [-1, 1]) p.box("wood", x + ex * 0.8, 0, z + ez * 0.8, 0.14, 2.2, 0.14, C.woodDark);
  p.box("wood", x, 2.2, z, 2.0, 0.12, 2.0, C.woodDark);
  p.cyl("metal", x, 2.32, z, 1.0, 1.5, C.steel, { seg: 14 });
  p.cyl("metal", x, 3.82, z, 1.05, 0.35, C.rust, { seg: 14, r1: 0.1 });
  p.collide(x, z, 1.9, 1.9, 0, 2.3);
}
function mailbox(p, x, z) { p.box("wood", x, 0, z, 0.09, 1.05, 0.09, C.woodDark); p.box("smooth", x, 1.05, z, 0.2, 0.22, 0.45, C.steel); p.circle(x, z, 0.1, 0, 1.2); }
function polesign(p, x, z, h, text, style, w, sh) {
  p.box("smooth", x, 0, z, 0.22, h, 0.22, C.steel); p.circle(x, z, 0.2, 0, h);
  p.box("smooth", x, h - sh - 0.1, z, 0.16, sh + 0.2, w + 0.2, C.dark);
  p.sign(text, style, x + 0.09, h - sh, z, w, sh, H, false);
  p.sign(text, style, x - 0.09, h - sh, z, w, sh, -H, false);
}

function planStart(p) {
  const [fh, fg] = KINDS.start.floors;
  // House: one room, porch facing the road
  p.room(fh.x, fh.z, fh.hx, fh.hz, 2.6, {
    out: C.cream, mat: "wood", trim: C.white, floor: "wood", floorCol: C.wood,
    front: [{ at: 2.5, w: 1.0, kind: "door", open: true, col: C.teal, name: "Front door" }, { at: -1.8, w: 1.6, y0: 0.9, y1: 2.0, kind: "window" }],
    left: [{ at: 0, w: 1.4, y0: 0.9, y1: 2.0, kind: "window" }], back: [{ at: -2, w: 1.2, y0: 1.0, y1: 2.0, kind: "window" }],
    right: [{ at: 1.5, w: 1.2, y0: 0.9, y1: 2.0, kind: "window" }],
  });
  p.gableRoof(fh.x, fh.z, fh.hx, fh.hz, 2.6, 1.5, { col: C.rust, wall: C.cream, wallMat: "wood" });
  porch(p, fh.x, fh.z + fh.hz + 0.1, 9, 1.9, 2.5, C.rust);
  p.at(fh.x, fh.z, 0, () => {
    p.bed(-4.3, -2.6, 0, { col: C.blue });
    p.table(-3.3, -3.8, 0.6, 0.5, 0.55, C.woodDark);
    p.spawn("flashlight", -3.3, 0.55, -3.8);
    const kh = p.counter(3.2, -3.9, 3.6, 0.6, 0.92, C.woodPale, C.conc);
    p.spawn("coffee", 2.4, kh, -3.9); p.spawn("chips", 4.2, kh, -3.9);
    p.fridge(0.6, -3.85, 0, { table: "food", p: 0.3 });
    p.table(1.5, 0.6, 1.3, 0.85); p.chair(1.5, -0.25, 0); p.chair(0.5, 0.6, H);
    p.spawn("bandage", 1.3, 0.74, 0.6);
    p.shelf(-5.25, 1.6, 1.6, H, { col: C.woodDark, table: "misc", p: 0.12, n: 3, h: 1.5, d: 0.3 });
  });
  // Porch table: the first things a new player sees
  const th = p.table(-12, 1.0, 1.4, 0.7, 0.74, C.woodPale);
  p.spawn("water", -12.45, th, 0.95, { yaw: 0 }); p.spawn("water", -12.2, th, 1.1, { yaw: 0.4 });
  p.spawn("beans", -11.85, th, 0.95, { yaw: 0 }); p.spawn("jerky", -11.5, th, 1.05, { yaw: 0.3 });
  p.chair(-10.9, 0.9, -H);
  // Garage: open bay towards the road, the truck stands on the driveway in front of it
  p.room(fg.x, fg.z, fg.hx, fg.hz, 2.9, {
    out: C.steel, inn: C.inDark, mat: "metal", matIn: "metal", floor: "concrete",
    front: [{ at: 0, w: 5.6, y1: 2.6, kind: "gap" }], left: [{ at: 1, w: 1.2, y0: 1.1, y1: 2.0, kind: "window" }],
  });
  p.gableRoof(fg.x, fg.z, fg.hx, fg.hz, 2.9, 1.1, { col: C.steel, wall: C.steel, wallMat: "metal", over: 0.35 });
  p.at(fg.x, fg.z, 0, () => {
    const bh = p.counter(-0.6, -4.95, 4.2, 0.7, 0.9, C.woodDark, C.wood);
    p.spawn("wrench", -1.9, bh, -4.95, { yaw: 0.5 }); p.spawn("oil", -0.9, bh, -5.05, { qty: 1 });
    p.box("smooth", 0.6, bh, -5.1, 0.5, 0.26, 0.3, C.red);
    p.spawn("coolant", 3.6, 0, -4.7, { qty: 2.6, yaw: 0.3 });
    p.spawn("fuelcan", 3.7, 0, -3.9, { qty: 6, yaw: -0.2 });
    p.spawn("jack", -3.4, 0, -3.2, { yaw: 1.2 });
    p.spawn("wheel_16", 3.5, 0, -1.6, { cond: 78, yaw: 0 });
    p.shelf(-4.25, -1.2, 2.2, H, { table: "fluid", p: 0.1, d: 0.45 });
    p.tyreStack(3.6, 1.2, 2, 0.36);
    p.barrel(-3.7, 3.6, C.blue);
  });
  // Yard
  waterTank(p, -17, -10);
  mailbox(p, 15.5, 14.5);
  p.barrel(1.8, -1.2); p.barrel(2.5, -1.5, C.rust2, true);
  p.hulk(16.5, -9, 0.5, { wheels: false, crush: 0.8 });
  p.box("wood", -0.5, 0, 9.5, 0.1, 1.3, 0.1, C.woodDark); p.box("wood", -3.5, 0, 9.5, 0.1, 1.3, 0.1, C.woodDark);
  p.box("wood", -2, 0.95, 9.5, 3.4, 0.5, 0.05, C.woodPale); p.sign("HOME", "wood", -2, 0.97, 9.53, 3.2, 0.46, 0, true);
}

function planStation(p) {
  const s = p.site, f = KINDS.station.floors[0], v = s.seed % 3;
  const paint = [C.white, C.cream, C.teal][v], accent = [C.red, C.blue, C.orange][v];
  p.room(f.x, f.z, f.hx, f.hz, 3.2, {
    out: paint, mat: "plaster", trim: accent, floorCol: C.conc,
    front: [{ at: -4.5, w: 1.1, kind: "door", col: accent, name: "Store door", y1: 2.1 }, { at: -0.6, w: 4.6, y0: 0.6, y1: 2.4, kind: "window" }, { at: 5, w: 3.6, y0: 0.6, y1: 2.4, kind: "window" }],
    left: [{ at: 0, w: 2.0, y0: 0.9, y1: 2.2, kind: "window" }], back: [{ at: 7.3, w: 0.95, kind: "door", col: C.steel, name: "Back door" }],
  });
  p.flatRoof(f.x, f.z, f.hx, f.hz, 3.2, { parapet: 0.5, col: paint, pcol: accent });
  p.box("smooth", f.x, 2.75, f.z + f.hz + 0.6, 2 * f.hx + 0.6, 0.12, 1.3, accent);          // awning
  p.sign(s.name.toUpperCase(), "store" + v, f.x, 3.3, f.z + f.hz + 0.45, 9, 1.0, 0);
  p.at(f.x, f.z, 0, () => {
    // counter by the door with the register (shop target)
    const ch = p.counter(-6.9, 1.4, 1.0, 3.6, 1.0, C.woodDark, C.conc);
    p.box("smooth", -6.9, ch, 2.0, 0.42, 0.34, 0.4, C.dark);
    p.target("shop", "Cash register", -6.9, ch, 2.0, 0.5, 0.4, 0.5);
    p.row("snack", 3, 0.5, -6.9, ch, 0.2, 0, 0.45);
    // aisles
    for (const ax of [-2.2, 1.6]) { p.shelf(ax - 0.21, 0.6, 4.4, -H, { table: "snack", p: 0.13 }); p.shelf(ax + 0.21, 0.6, 4.4, H, { table: "food", p: 0.13 }); }
    p.fridge(-0.2, -4.55, 0, { table: "drink", p: 0.5, col: C.steel, name: "Drinks cooler" });
    p.fridge(0.65, -4.55, 0, { table: "drink", p: 0.4, col: C.steel, name: "Drinks cooler" });
    p.shelf(3.2, -4.75, 2.6, 0, { table: "fluid", p: 0.16 });
    // washroom in the back corner
    p.partition(5.4, -5, 4.2, "z", 3.2, [{ a: 3.0, w: 0.9, kind: "door", col: C.white, name: "Washroom door", hinge: "r" }]);
    p.partition(5.4, -0.8, 3.6, "x", 3.2, []);
    p.box("smooth", 8.4, 0, -4.3, 0.45, 0.42, 0.65, C.white, { solid: true });
    p.box("smooth", 6.3, 0.75, -4.7, 0.6, 0.14, 0.42, C.white);
    p.locker(8.55, -1.5, -H, { w: 0.6, h: 0.7, table: "med", p: 0.75, col: C.white, name: "Medicine cabinet" });
    p.crate(7.6, 3.2, 0.2, { table: "food", p: 0.4 });
  });
  // Canopy and pumps
  const cz = 7, ch = 4.7;
  for (const ex of [-1, 1]) for (const ez of [-1, 1]) { p.box("smooth", ex * 7, 0, cz + ez * 3.2, 0.3, ch, 0.3, C.white); p.circle(ex * 7, cz + ez * 3.2, 0.25, 0, ch); p.box("concrete", ex * 7, 0, cz + ez * 3.2, 0.6, 0.5, 0.6, C.concDark); }
  p.box("smooth", 0, ch, cz, 17, 0.5, 9.4, C.white, { occ: true });
  p.box("smooth", 0, ch + 0.1, cz, 17.1, 0.3, 9.5, accent);
  for (const ex of [-4, 4]) p.box("glow", ex, ch - 0.04, cz, 2.4, 0.04, 0.5, C.glowWarm);
  for (const ex of [-4.5, 4.5]) {
    p.box("concrete", ex, 0, cz, 1.3, 0.16, 5.2, C.conc);
    for (const ez of [-1.3, 1.3]) {
      p.at(ex, cz + ez, 0, () => {
        p.box("smooth", 0, 0.16, 0, 0.75, 1.25, 0.5, paint, { occ: true });
        p.box("smooth", 0, 1.41, 0, 0.8, 0.32, 0.54, accent);
        p.box("smooth", 0.38, 0.95, 0, 0.02, 0.3, 0.34, C.dark); p.box("smooth", -0.38, 0.95, 0, 0.02, 0.3, 0.34, C.dark);
        p.box("smooth", 0.42, 0.5, 0.12, 0.06, 0.34, 0.08, C.dark);
        p.collide(0, 0, 0.75, 0.5, 0, 1.75);
        p.target("pump", "Fuel pump", 0, 0.16, 0, 0.9, 1.6, 0.6);
      });
    }
    p.post(ex, cz - 2.45, 0.9, 0.1, C.yellow); p.post(ex, cz + 2.45, 0.9, 0.1, C.yellow);
  }
  polesign(p, -25, 16, 8.5, s.name.toUpperCase() + "|GAS 1.60", "pole" + v, 4.2, 2.6);
  // forecourt clutter
  p.crate(11.5, f.z + f.hz + 0.55, 0, { mat: "smooth", col: C.white, w: 1.4, d: 0.7, h: 0.9, table: "drink", p: 0.35, name: "Ice chest" });
  p.box("smooth", -8, 0, f.z + f.hz + 0.5, 0.6, 0.9, 0.6, C.green, { solid: true });
  p.tyreStack(13.5, f.z + f.hz + 0.6, 3);
  p.barrel(-11, f.z + 2); p.barrel(-11.7, f.z + 2.5, C.blue);
  p.box("metal", 15, 0, f.z - 1, 2.2, 1.3, 1.4, C.green, { solid: true, occ: true });   // dumpster
  if (p.rand() < 0.5) p.hulk(22, -12, 0.3 + p.rand(), { wheels: false });
  if (p.rand() < 0.45) p.spawn(p.pick("fluid"), 13, 0, f.z - 1.2);
}

function planHome(p) {
  const s = p.site, f = KINDS.home.floors[0], v = (s.seed >> 3) % 4;
  const paint = PAINTS[(s.seed >> 5) % PAINTS.length], roofC = [C.rust, C.steel, C.rust2, C.green][v], mat = v % 2 ? "wood" : "plaster";
  const boards = v === 2;
  p.room(f.x, f.z, f.hx, f.hz, 2.6, {
    out: paint, mat, floor: "wood", floorCol: C.wood, trim: C.white,
    front: [{ at: -1.2, w: 1.0, kind: "door", col: C.woodPale, name: "Front door", open: v === 1 }, { at: -4, w: 1.5, y0: 0.9, y1: 2.0, kind: "window", boards }, { at: 3.3, w: 1.5, y0: 0.9, y1: 2.0, kind: "window", boards }],
    back: [{ at: -3.5, w: 1.2, y0: 1.0, y1: 2.0, kind: "window" }, { at: 3.5, w: 1.0, y0: 1.0, y1: 2.0, kind: "window", boards }],
    left: [{ at: 0, w: 1.3, y0: 0.9, y1: 2.0, kind: "window" }], right: [{ at: 0.2, w: 0.95, kind: "door", col: C.woodDark, name: "Side door" }],
  });
  p.gableRoof(f.x, f.z, f.hx, f.hz, 2.6, 1.6, { col: roofC, wall: paint, wallMat: mat });
  porch(p, f.x - 1, f.z + f.hz + 0.1, 7, 1.8, 2.45, roofC);
  p.at(f.x, f.z, 0, () => {
    p.partition(1.2, -4.5, 9, "z", 2.6, [{ a: 6.3, w: 0.95, kind: v === 3 ? "gap" : "door", col: C.woodPale, name: "Bedroom door", open: v !== 0 }]);
    // kitchen / living room
    const kh = p.counter(-3.6, -3.95, 3.4, 0.6, 0.92, C.woodPale, C.conc);
    p.row("food", 5, 0.3, -4.9, kh, -3.95, 0.6, 0);
    p.fridge(-0.6, -3.85, 0, { table: "food", p: 0.4, open: v === 2 });
    p.table(-3.4, 0.2, 1.4, 0.9); p.row("food", 3, 0.35, -3.8, 0.74, 0.2, 0.4, 0);
    p.chair(-3.4, -0.7, 0, C.wood, v === 2); p.chair(-3.4, 1.1, Math.PI); p.chair(-4.5, 0.2, H);
    p.locker(-5.7, 2.6, H, { w: 0.9, h: 1.1, col: C.woodDark, table: "misc", p: 0.5, name: "Cabinet" });
    // bedroom
    p.bed(4.9, -2.9, 0, { col: PAINTS[(s.seed >> 9) % PAINTS.length] });
    p.table(3.8, -3.9, 0.5, 0.45, 0.5, C.woodDark); p.row("med", 1, 0.45, 3.8, 0.5, -3.9, 0, 0);
    p.locker(5.65, 1.5, -H, { w: 1.0, h: 1.9, col: C.woodDark, table: "misc", p: 0.45, name: "Wardrobe" });
    p.crate(2.2, 3.6, 0.1, { table: "misc", p: 0.5, name: "Trunk", col: C.woodDark });
  });
  // yard
  if (v !== 1) waterTank(p, 11, -9);
  p.barrel(-9.5, -7); if (v > 1) p.barrel(-10.3, -6.6, C.blue, true);
  mailbox(p, 13, 13.5);
  if (v === 0) { p.hulk(10.5, 4, 2.9, { wheels: false }); p.row("part", 2, 0.5, 8.6, 0, 3, 0.9, 0.6); }
  if (v === 3) { p.tyreStack(-11, 3, 3); p.crate(-12, 5, 0.6, { table: "tool", p: 0.5 }); }
  if (p.rand() < 0.16) p.vehicle(p.rand() < 0.6 ? "sedan" : "pickup", 9.5, -1 + p.rand() * 2, p.rand() * 0.6 - 0.3);
  // sagging wire fence posts along the front
  for (let x = -15; x <= 15; x += 3.75) if (Math.abs(x - 6) > 3) p.box("wood", x, 0, 13.6, 0.09, 1.0 + p.rand() * 0.15, 0.09, C.woodDark, { yaw: p.rand() * 0.2 });
}

function planGarage(p) {
  const s = p.site, f = KINDS.garage.floors[0], v = (s.seed >> 4) % 3;
  const paint = [C.cream, C.blue, C.adobe][v], accent = [C.red, C.yellow, C.teal][v];
  p.room(f.x, f.z, f.hx, f.hz, 3.6, {
    out: paint, inn: C.inDark, mat: "concrete", floorCol: C.concDark, trim: accent,
    front: [{ at: -5.6, w: 3.6, y1: 3.0, kind: "gap" }, { at: -1.2, w: 3.6, y1: 3.0, kind: "gap" }, { at: 3.4, w: 1.0, kind: "door", col: accent, name: "Office door" }, { at: 6, w: 2.2, y0: 0.9, y1: 2.2, kind: "window" }],
    back: [{ at: -4, w: 2, y0: 1.6, y1: 2.6, kind: "window" }], right: [{ at: 0, w: 1.6, y0: 1.0, y1: 2.2, kind: "window" }],
  });
  p.flatRoof(f.x, f.z, f.hx, f.hz, 3.6, { parapet: 0.6, col: paint, pcol: paint });
  p.sign(v === 1 ? "TIRES · LUBE · REPAIR" : "AUTO REPAIR", "garage" + v, f.x - 2, 3.72, f.z + f.hz + 0.46, 8, 0.75, 0);
  p.at(f.x, f.z, 0, () => {
    p.partition(1.4, -6, 12, "z", 3.6, [{ a: 9, w: 1.0, kind: "door", col: C.steel, name: "Workshop door", open: true }]);
    // workshop
    const bh = p.counter(-4.4, -5.5, 5.6, 0.75, 0.92, C.woodDark, C.wood);
    p.row("tool", 6, 0.4, -6.6, bh, -5.5, 0.85, 0);
    p.crate(-2.1, -5.5 + 0.02, 0, { y: bh, mat: "smooth", col: C.red, w: 0.56, d: 0.3, h: 0.28, table: "tool", p: 0.8, name: "Toolbox" });
    p.shelf(-7.7, -1.5, 3.4, H, { table: "fluid", p: 0.22, d: 0.5 });
    p.locker(-7.7, 2.4, H, { table: "tool", p: 0.6, name: "Tool locker", col: C.red });
    p.locker(-7.7, 3.0, H, { table: "part", p: 0.5, name: "Parts locker", col: C.red });
    p.tyreStack(0.6, -5.2, 4); p.tyreStack(0.7, -4.3, 2);
    p.row("part", 3, 0.5, -0.6, 0, -2.6, 0, 1.0);
    p.barrel(0.7, 4.8, C.blue); p.barrel(0.75, 4.1);
    if (p.rand() < 0.6) p.spawn(p.pick("bigpart"), -3.4, 0, -3.4);
    // engine hoist
    p.box("smooth", -3.4, 0, -4.2, 0.1, 2.1, 0.1, C.yellow); p.box("smooth", -3.4, 2.0, -3.6, 0.08, 0.08, 1.3, C.yellow); p.box("smooth", -3.4, 0, -3.8, 1.2, 0.08, 0.1, C.yellow);
    // office
    const dh = p.table(5.2, -2.8, 1.6, 0.8, 0.76, C.woodDark); p.chair(5.2, -3.7, 0);
    p.row("misc", 3, 0.4, 4.7, dh, -2.8, 0.45, 0);
    p.locker(7.55, -5.2, -H, { w: 0.9, h: 1.3, col: C.steel, table: "misc", p: 0.6, name: "Filing cabinet" });
    p.fridge(2.0, -5.4, H, { table: "drink", p: 0.4, col: C.cream, name: "Old fridge" });
    p.shelf(7.65, 2.5, 2.4, -H, { table: "fluid", p: 0.2 });
  });
  // yard
  if (s.sedan) p.vehicle("sedan", f.x - 5.6, f.z + 2.8, 0);
  else if (p.rand() < 0.35) p.vehicle(p.rand() < 0.55 ? "sedan" : "pickup", -13, 6, 0.3);
  p.hulk(14.5, -6, 0.2, { wheels: false }); if (v) p.hulk(14.3, -1, -0.15, { crush: 0.8 });
  p.tyreStack(11, 2.6, 4); p.tyreStack(11.7, 3.2, 3);
  p.barrel(-10.5, f.z + 6.6); p.barrel(-11.2, f.z + 6.4, C.rust2);
  polesign(p, 16, 14, 6, "GARAGE", "pole1", 3.2, 1.3);
  p.row("part", 3, 0.35, 11.5, 0, -3.5, 0.2, 1.1);
}

function planDiner(p) {
  const s = p.site, f = KINDS.diner.floors[0], v = (s.seed >> 4) % 3;
  const paint = [C.chrome, C.cream, C.teal][v], accent = [C.red, C.teal, C.red][v];
  p.room(f.x, f.z, f.hx, f.hz, 3.0, {
    out: paint, mat: v === 0 ? "smooth" : "plaster", floorCol: C.cream, trim: accent, floor: "tile",
    front: [{ at: 0, w: 1.2, kind: "door", col: accent, name: "Diner door", y1: 2.1 }, { at: -5, w: 6.2, y0: 0.8, y1: 2.3, kind: "window" }, { at: 5, w: 6.2, y0: 0.8, y1: 2.3, kind: "window" }],
    left: [{ at: 1.6, w: 2.2, y0: 0.8, y1: 2.3, kind: "window" }], right: [{ at: 1.6, w: 2.2, y0: 0.8, y1: 2.3, kind: "window" }],
    back: [{ at: 7.6, w: 0.95, kind: "door", col: C.steel, name: "Kitchen door" }],
  });
  p.flatRoof(f.x, f.z, f.hx, f.hz, 3.0, { over: 0.7, col: C.white, parapet: 0.25, pcol: accent });
  p.box("smooth", f.x, 0.45, f.z + f.hz + 0.11, 2 * f.hx, 0.2, 0.03, accent);
  p.box("smooth", f.x, 3.55, f.z + 1, 7.4, 1.5, 0.2, C.dark);
  p.sign(s.name.toUpperCase(), "diner", f.x, 3.6, f.z + 1.11, 7.2, 1.4, 0);
  p.at(f.x, f.z, 0, () => {
    // kitchen behind a partition
    p.partition(-9, -1.6, 18, "x", 3.0, [{ a: 15.6, w: 1.0, kind: "gap" }, { a: 7, w: 4, y0: 1.05, y1: 2.0, kind: "hatch" }]);
    // bar counter with stools
    const ch = p.counter(-1.5, -0.5, 11, 0.6, 1.05, C.white, accent);
    p.row("food", 9, 0.22, -6.3, ch, -0.5, 1.2, 0);
    for (let x = -6.2; x <= 3.6; x += 1.4) { p.cyl("smooth", x, 0, 0.35, 0.05, 0.65, C.chrome, { seg: 6 }); p.cyl("fabric", x, 0.65, 0.35, 0.19, 0.08, accent, { seg: 10 }); p.circle(x, 0.35, 0.18, 0, 0.75); }
    // booths along the front windows
    for (const bx of [-7.4, -4.6, 4.6, 7.4]) { const th = p.booth(bx, 3.5, H, accent); p.row("food", 2, 0.28, bx - 0.25, th, 3.5, 0.5, 0); }
    // kitchen
    const kh = p.counter(-4.5, -3.95, 7, 0.7, 0.92, C.steel, C.chrome);
    p.row("food", 7, 0.4, -7.4, kh, -3.95, 0.95, 0);
    p.box("smooth", 0.2, 0, -3.9, 1.1, 0.95, 0.75, C.dark, { solid: true, occ: true });      // stove
    p.fridge(2.2, -3.95, 0, { table: "food", p: 0.6, col: C.steel });
    p.fridge(3.0, -3.95, 0, { table: "drink", p: 0.55, col: C.steel });
    p.shelf(5.4, -4.25, 2.6, 0, { table: "food", p: 0.3 });
    p.crate(-8.2, -2.4, H, { table: "food", p: 0.6 });
    p.locker(8.6, -3.2, -H, { w: 0.5, h: 0.6, table: "med", p: 0.6, col: C.white, name: "First aid box" });
  });
  polesign(p, -18, 13, 7.5, "DINER|EAT", "pole2", 3.6, 2.2);
  p.box("metal", 13, 0, f.z - 0.5, 2.2, 1.3, 1.4, C.green, { solid: true, occ: true });
  if (p.rand() < 0.5) p.hulk(-15, 2 + p.rand() * 4, H + (p.rand() - 0.5) * 0.3, { wheels: p.rand() < 0.5 });
  if (p.rand() < 0.12) p.vehicle("sedan", 14, 5, H);
  p.barrel(11, f.z + 1);
}

function planMotel(p) {
  const s = p.site, f = KINDS.motel.floors[0], v = (s.seed >> 4) % 3;
  const paint = [C.pink, C.teal, C.cream][v], accent = [C.teal, C.orange, C.blue][v], doorC = [C.teal, C.orange, C.red][v];
  const n = 6, uw = (2 * f.hx) / n, h = 2.8;
  const front = [], back = [];
  for (let i = 0; i < n; i++) {
    const x0 = -f.hx + i * uw;
    front.push({ at: x0 + 1.3, w: 0.95, kind: "door", col: doorC, name: i ? "Room " + i : "Office door", open: i === 0 || p.rand() < 0.3 });
    front.push({ at: x0 + 4.2, w: i ? 2.0 : 3.0, y0: 0.9, y1: 2.1, kind: "window", boards: i > 0 && p.rand() < 0.25 });
    if (i) back.push({ at: x0 + 5.6, w: 0.7, y0: 1.5, y1: 2.1, kind: "window" });
  }
  p.room(f.x, f.z, f.hx, f.hz, h, { out: paint, mat: "plaster", floorCol: C.concDark, trim: C.white, front, back });
  p.flatRoof(f.x, f.z, f.hx, f.hz, h, { over: 0.3, col: C.white, parapet: 0.3, pcol: accent });
  // covered walkway
  p.box("concrete", f.x, -0.2, f.z + f.hz + 1.1, 2 * f.hx + 0.4, 0.23, 2.0, C.conc);
  p.box("roof", f.x, h - 0.15, f.z + f.hz + 1.2, 2 * f.hx + 0.8, 0.1, 2.3, accent);
  for (let i = 0; i <= n; i++) p.post(f.x - f.hx + i * uw, f.z + f.hz + 2.1, h - 0.15, 0.1, C.white);
  p.at(f.x, f.z, 0, () => {
    for (let i = 1; i < n; i++) p.partition(-f.hx + i * uw, -f.hz, 2 * f.hz, "z", h, []);
    // office
    const ox = -f.hx + uw / 2;
    const ch = p.counter(ox + 0.6, -0.6, 4.4, 0.6, 1.05, C.woodDark, C.wood);
    p.box("smooth", ox + 1.8, ch, -0.6, 0.3, 0.16, 0.2, C.chrome);
    p.row("misc", 3, 0.4, ox - 0.8, ch, -0.6, 0.6, 0);
    p.locker(ox + 3.0, -3.6, -H, { w: 0.8, h: 1.2, col: C.woodDark, table: "misc", p: 0.6, name: "Key cabinet" });
    p.fridge(ox - 2.9, -3.5, 0, { table: "drink", p: 0.5, col: C.red, name: "Vending fridge" });
    p.chair(ox, -2.2, 0);
    for (let i = 1; i < n; i++) {
      const x0 = -f.hx + i * uw, wrecked = p.rand() < 0.3;
      p.at(x0, 0, 0, () => {
        // bathroom nook at the back
        p.partition(4.6, -f.hz, 2.4, "z", h, []);
        p.partition(4.6, -f.hz + 2.4, uw - 4.6, "x", h, [{ a: 1.2, w: 0.8, kind: "door", col: C.white, name: "Bathroom door", open: p.rand() < 0.5, hinge: "r" }]);
        p.box("smooth", 6.4, 0, -3.5, 0.42, 0.42, 0.6, C.white, { solid: true });
        p.box("smooth", 5.2, 0.78, -3.72, 0.55, 0.14, 0.4, C.white);
        p.locker(5.2, -3.82, 0, { w: 0.5, h: 0.5, table: "med", p: 0.55, col: C.white, name: "Medicine cabinet" });
        p.bed(2.4, wrecked ? -1.6 : -2.9, wrecked ? 0.25 : 0, { col: PAINTS[(s.seed + i * 3) % PAINTS.length] });
        p.table(1.2, -3.7, 0.5, 0.45, 0.5, C.woodDark); p.row("misc", 1, 0.45, 1.2, 0.5, -3.7, 0, 0);
        p.table(3.6, 2.6, 0.8, 0.6, 0.72, C.wood); p.chair(3.6, 1.9, 0, C.wood, wrecked); p.row("food", 2, 0.3, 3.4, 0.72, 2.6, 0.4, 0);
        if (p.rand() < 0.4) p.crate(0.7, 0.6, H, { table: "misc", p: 0.6, name: "Suitcase", col: C.rust2, w: 0.7, d: 0.45, h: 0.25, mat: "smooth" });
      });
    }
  });
  polesign(p, 27, 13.5, 9, s.name.toUpperCase() + "|VACANCY", "motel", 4.6, 2.6);
  p.crate(f.x - f.hx - 1.2, f.z + f.hz + 1, 0, { mat: "smooth", col: C.white, w: 1.4, d: 0.7, h: 0.9, table: "drink", p: 0.3, name: "Ice chest" });
  if (p.rand() < 0.6) p.hulk(-8 + p.rand() * 20, 3.5, (p.rand() - 0.5) * 0.3, { wheels: p.rand() < 0.6 });
  if (p.rand() < 0.2) p.vehicle(p.rand() < 0.7 ? "sedan" : "pickup", -20, 3.2, 0);
  // empty pool
  p.box("concrete", 26, -0.02, -8, 7, 0.06, 4.4, C.conc); p.box("smooth", 26, 0.03, -8, 6, 0.02, 3.4, C.glowBlue.map((c) => c * 0.35));
}

function planJunkyard(p) {
  const s = p.site, K = KINDS.junkyard, f = K.floors[0], hx = K.hx - 1, hz = K.hz - 1, fc = C.rust;
  // fence with a gate gap at the front
  p.fence(-hx, hz, hx, hz, 2.3, fc, [hx - 4, hx + 4]);
  p.fence(hx, hz, hx, -hz, 2.3, fc); p.fence(hx, -hz, -hx, -hz, 2.3, fc); p.fence(-hx, -hz, -hx, hz, 2.3, fc);
  p.box("wood", -4.3, 0, hz, 0.2, 3.4, 0.2, C.woodDark); p.box("wood", 4.3, 0, hz, 0.2, 3.4, 0.2, C.woodDark);
  p.box("metal", 0, 2.9, hz, 8.8, 0.9, 0.08, C.rust2);
  p.sign(s.name.toUpperCase() + " — PARTS", "junk", 0, 2.95, hz + 0.05, 8.4, 0.8, 0);
  // shed
  p.room(f.x, f.z, f.hx, f.hz, 2.6, {
    out: C.steel, inn: C.inDark, mat: "metal", matIn: "metal", floorCol: C.concDark,
    front: [{ at: -2, w: 1.0, kind: "door", col: C.rust2, name: "Shed door" }, { at: 2, w: 1.6, y0: 1.0, y1: 2.0, kind: "window" }],
    right: [{ at: 0, w: 1.4, y0: 1.0, y1: 2.0, kind: "window" }],
  });
  p.gableRoof(f.x, f.z, f.hx, f.hz, 2.6, 1.0, { col: C.rust, wall: C.steel, wallMat: "metal", over: 0.3 });
  p.at(f.x, f.z, 0, () => {
    const bh = p.counter(1.4, -3.5, 5.6, 0.7, 0.92, C.woodDark, C.wood);
    p.row("tool", 5, 0.55, -0.8, bh, -3.5, 1.0, 0);
    p.shelf(-4.7, -0.5, 4.0, H, { table: "fluid", p: 0.3, d: 0.5 });
    p.locker(4.7, -1.5, -H, { table: "part", p: 0.75, name: "Parts locker", col: C.green });
    p.locker(4.7, -0.9, -H, { table: "tool", p: 0.7, name: "Tool locker", col: C.green });
    p.crate(3.2, 2.6, 0.2, { table: "part", p: 0.7, w: 1.3, d: 0.8, h: 0.6 });
    p.spawn(p.pick("bigpart"), 0.5, 0, 0.8);
    p.bed(-3.2, 2.6, H, { name: "Cot", col: C.canvas, frame: C.steel });
  });
  // rows of stacked hulks
  for (let r = 0; r < 3; r++) {
    const z = -19 + r * 9.5;
    for (let i = 0; i < 6; i++) {
      const x = -7 + i * 5.6 + (p.rand() - 0.5) * 0.6;
      if (x < -11 && z < -8) continue;
      if (r === 2 && Math.abs(x - 6) < 5) continue;       // keep the recoverable car's slot clear
      const yaw = (p.rand() - 0.5) * 0.25, layers = 1 + Math.floor(p.rand() * 2.6);
      for (let l = 0; l < layers; l++) p.hulk(x, z + (p.rand() - 0.5) * 0.5, yaw + (p.rand() - 0.5) * 0.2, { y: l * 1.02, wheels: false, crush: l ? 0.7 : 0.9, collide: l === 0 });
      if (p.rand() < 0.5) p.spawn(p.pick(p.rand() < 0.35 ? "bigpart" : "part"), x + 1.9, 0, z + (p.rand() - 0.5) * 3);
    }
  }
  // the one that might still run
  p.vehicle(p.rand() < 0.65 ? "sedan" : "pickup", 6, 2, 0.15);
  if (p.rand() < 0.4) p.vehicle("sedan", -6, 12, -H + 0.2);
  for (let i = 0; i < 4; i++) p.tyreStack(-22 + i * 0.9 + p.rand() * 0.3, 4 + p.rand() * 6, 2 + Math.floor(p.rand() * 4));
  p.row("part", 4, 0.6, 16, 0, 10, 1.3, 0.8);
  p.barrel(-13, -9); p.barrel(-12.3, -9.3, C.blue); p.barrel(20, 16, C.rust2, true);
  // crane-ish gantry
  p.box("smooth", 22, 0, -4, 0.3, 6, 0.3, C.yellow, { solid: true }); p.box("smooth", 19.5, 5.7, -4, 5.5, 0.3, 0.3, C.yellow); p.box("smooth", 17.2, 3.7, -4, 0.06, 2, 0.06, C.dark);
}

function planWreck(p) {
  const s = p.site, v = s.first ? 0 : (s.seed >> 4) % 3;
  if (v === 0) {
    // breakdown: hood up, warning triangle, someone's luggage
    if (!s.first && p.rand() < 0.3) p.vehicle(p.rand() < 0.6 ? "sedan" : "pickup", 0, 0.5, H + (p.rand() - 0.5) * 0.3);
    else { p.hulk(0, 0.5, H + 0.1, { wheels: true }); p.at(0, 0.5, H + 0.1, () => p.box("metal", 0, 1.3, 1.3, 1.5, 0.05, 1.2, C.rust, { yaw: 0 })); }
    p.crate(-3.6, -1.2, 0.4, { table: "misc", p: 0.75, name: "Suitcase", col: C.rust2, w: 0.75, d: 0.5, h: 0.28, mat: "smooth" });
    p.spawn("water", -3.0, 0, -0.4); p.spawn(p.pick("fluid"), 2.9, 0, -1.3);
    p.spawn(s.first ? "bandage" : p.pick("tool"), 3.3, 0, 1.6);
    p.box("smooth", 6.5, 0, 3.5, 0.4, 0.4, 0.04, C.orange, { yaw: 0.3 });
  } else if (v === 1) {
    // camp: tent, fire ring, cot
    p.b("fabric").gable(p.X(-3, -1), 0, p.Z(-3, -1), 3.2, 1.5, 2.6, p.fyaw + 0.3, C.canvas, null, 0.03);
    p.collide(-3, -1, 3.0, 2.2, 0, 1.4, 0.3);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.283; p.box("rock", 2 + Math.cos(a) * 0.6, 0, 1 + Math.sin(a) * 0.6, 0.3, 0.2, 0.26, C.concDark, { yaw: a }); }
    p.cyl("smooth", 2, 0, 1, 0.5, 0.04, C.ash, { seg: 10 });
    p.box("wood", 2, 0.03, 1, 0.7, 0.08, 0.1, C.black, { yaw: 0.5 }); p.box("wood", 2, 0.05, 1, 0.6, 0.08, 0.1, C.black, { yaw: -0.8 });
    p.bed(4.6, -1.6, 0.4, { name: "Camp cot", col: C.canvas, frame: C.steel });
    p.crate(0.2, -2.4, -0.2, { table: "food", p: 0.75 });
    p.chair(1.2, 2.3, 2.8, C.steel); p.row("food", 3, 0.5, 2.9, 0, 2.2, 0.4, 0.15);
    p.spawn("waterjug", -0.9, 0, 0.6);
  } else {
    // old crash, burnt out
    p.hulk(0.5, 0, 0.7, { burnt: true, wheels: false, crush: 0.8 });
    p.hulk(-5, 1.5, 2.2, { wheels: false });
    p.row("part", 3, 0.55, 2.8, 0, -1.5, 0.9, 0.7);
    p.crate(4.6, 1.8, 1.1, { mat: "smooth", col: C.red, w: 0.56, d: 0.3, h: 0.28, table: "tool", p: 0.8, name: "Toolbox" });
    p.spawn(p.pick("med"), -2.6, 0, -1.8);
  }
}

const KIND_FN = { station: planStation, home: planHome, garage: planGarage, diner: planDiner, motel: planMotel, junkyard: planJunkyard, wreck: planWreck };

export function planSite(site) {
  const p = new Plan(site);
  (site.start ? planStart : KIND_FN[site.kind])(p);
  return p;
}
export const ITEM_TYPES = ["water", "waterjug", "beans", "jerky", "chips", "soda", "coffee", "medkit", "bandage", "fuelcan", "jerrycan", "oil", "oiljug", "coolant",
  "wrench", "jack", "repairkit", "flashlight", "engine_i6", "engine_v8", "engine_i4", "battery", "radiator", "wheel_16", "wheel_14"];
