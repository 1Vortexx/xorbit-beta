// Long Haul – tiny geometry batcher. Pure arrays (runs in Node); toGeometry() turns a batch into a BufferGeometry.
// Everything a site draws with one material goes into one Batch → one draw call.
export function lin(hex) {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
}
const WHITE = [1, 1, 1];

export class Batch {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; this.count = 0; }
  vert(x, y, z, nx, ny, nz, u, v, col) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.u.push(u, v); this.c.push(col[0], col[1], col[2]);
    return this.count++;
  }
  // Quad a,b,c,d counter-clockwise seen from the normal side. uv = [u0,v0,u1,v1] (a=u0v0, b=u1v0, c=u1v1, d=u0v1)
  quad(a, b, c, d, col = WHITE, uv = null) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    let q = uv;
    if (!q) { const lu = Math.hypot(ux, uy, uz), lv = Math.hypot(vx, vy, vz); q = [0, 0, lu * 0.4, lv * 0.4]; }
    const i0 = this.vert(a[0], a[1], a[2], nx, ny, nz, q[0], q[1], col);
    this.vert(b[0], b[1], b[2], nx, ny, nz, q[2], q[1], col);
    this.vert(c[0], c[1], c[2], nx, ny, nz, q[2], q[3], col);
    this.vert(d[0], d[1], d[2], nx, ny, nz, q[0], q[3], col);
    this.i.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  }
  tri(a, b, c, col = WHITE) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const i0 = this.vert(a[0], a[1], a[2], nx, ny, nz, 0, 0, col);
    this.vert(b[0], b[1], b[2], nx, ny, nz, Math.hypot(ux, uy, uz) * 0.4, 0, col);
    this.vert(c[0], c[1], c[2], nx, ny, nz, 0, Math.hypot(vx, vy, vz) * 0.4, col);
    this.i.push(i0, i0 + 1, i0 + 2);
  }
  // Box centred on (cx, cz), from y0 up by sy, rotated by yaw about its vertical axis. uvs are in metres × s.
  box(cx, y0, cz, sx, sy, sz, yaw = 0, col = WHITE, s = 0.4) {
    const hx = sx / 2, hz = sz / 2, y1 = y0 + sy, c = Math.cos(yaw), sn = Math.sin(yaw);
    const P = (lx, y, lz) => [cx + lx * c + lz * sn, y, cz - lx * sn + lz * c];
    const uo = (cx + cz) * s, vo = y0 * s;
    const q = (a, b, cc, d, w, h, uoff) => this.quad(a, b, cc, d, col, [uoff, vo, uoff + w * s, vo + h * s]);
    q(P(-hx, y0, hz), P(hx, y0, hz), P(hx, y1, hz), P(-hx, y1, hz), sx, sy, uo);            // +z
    q(P(hx, y0, -hz), P(-hx, y0, -hz), P(-hx, y1, -hz), P(hx, y1, -hz), sx, sy, uo + 0.37); // −z
    q(P(hx, y0, hz), P(hx, y0, -hz), P(hx, y1, -hz), P(hx, y1, hz), sz, sy, uo + 0.71);     // +x
    q(P(-hx, y0, -hz), P(-hx, y0, hz), P(-hx, y1, hz), P(-hx, y1, -hz), sz, sy, uo + 0.13); // −x
    this.quad(P(-hx, y1, hz), P(hx, y1, hz), P(hx, y1, -hz), P(-hx, y1, -hz), col, [uo, cz * s, uo + sx * s, cz * s + sz * s]);  // top
    this.quad(P(-hx, y0, -hz), P(hx, y0, -hz), P(hx, y0, hz), P(-hx, y0, hz), col, [uo, cz * s, uo + sx * s, cz * s + sz * s]);  // bottom
  }
  // Cylinder along an axis ("y" default, "x" or "z" lying down) from the base centre. r1 = top radius.
  cyl(cx, y0, cz, r, h, seg = 10, col = WHITE, opts = {}) {
    const r1 = opts.r1 === undefined ? r : opts.r1, axis = opts.axis || "y", yaw = opts.yaw || 0;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const P = (a, t, rr) => {
      const u = Math.cos(a) * rr, v = Math.sin(a) * rr;
      let lx, ly, lz;
      if (axis === "y") { lx = u; ly = t; lz = v; } else if (axis === "x") { lx = t - h / 2; ly = r + u; lz = -v; } else { lx = v; ly = r + u; lz = t - h / 2; }
      return [cx + lx * c + lz * sn, y0 + ly, cz - lx * sn + lz * c];
    };
    const base = this.count;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const p0 = P(a, 0, r), p1 = P(a, h, r1), m = P(a, 0, 0), q = P(a, 0, 1);
      // normal = radial direction (ignoring taper)
      const ctr = m;
      const nx = q[0] - ctr[0], ny = q[1] - ctr[1], nz = q[2] - ctr[2];
      this.vert(p0[0], p0[1], p0[2], nx, ny, nz, (i / seg) * r * 2.5, 0, col);
      this.vert(p1[0], p1[1], p1[2], nx, ny, nz, (i / seg) * r * 2.5, h * 0.4, col);
    }
    for (let i = 0; i < seg; i++) { const a = base + i * 2; this.i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    if (!opts.open) {
      for (const [t, rr, flip] of [[h, r1, false], [0, r, true]]) {
        if (rr <= 0) continue;
        const ctr = P(0, t, 0), up = P(0, t + 1, 0);
        let nx = up[0] - ctr[0], ny = up[1] - ctr[1], nz = up[2] - ctr[2];
        if (flip) { nx = -nx; ny = -ny; nz = -nz; }
        const i0 = this.vert(ctr[0], ctr[1], ctr[2], nx, ny, nz, 0.5, 0.5, col);
        for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2, p = P(a, t, rr); this.vert(p[0], p[1], p[2], nx, ny, nz, 0.5 + Math.cos(a) * 0.3, 0.5 + Math.sin(a) * 0.3, col); }
        for (let i = 0; i < seg; i++) { if (flip) this.i.push(i0, i0 + 1 + i, i0 + 2 + i); else this.i.push(i0, i0 + 2 + i, i0 + 1 + i); }
      }
    }
  }
  // Gable roof: ridge along local x. Covers sx × sz (overhang included), eaves at y0, ridge at y0 + rise.
  gable(cx, y0, cz, sx, rise, sz, yaw = 0, col = WHITE, wallCol = null, thick = 0.12) {
    const hx = sx / 2, hz = sz / 2, c = Math.cos(yaw), sn = Math.sin(yaw);
    const P = (lx, y, lz) => [cx + lx * c + lz * sn, y, cz - lx * sn + lz * c];
    const sl = Math.hypot(hz, rise);
    const t = thick;
    this.quad(P(-hx, y0 + t, hz), P(hx, y0 + t, hz), P(hx, y0 + rise + t, 0), P(-hx, y0 + rise + t, 0), col, [0, 0, sx * 0.4, sl * 0.4]);
    this.quad(P(hx, y0 + t, -hz), P(-hx, y0 + t, -hz), P(-hx, y0 + rise + t, 0), P(hx, y0 + rise + t, 0), col, [0, 0, sx * 0.4, sl * 0.4]);
    // underside
    this.quad(P(hx, y0, hz), P(-hx, y0, hz), P(-hx, y0 + rise, 0), P(hx, y0 + rise, 0), col, [0, 0, sx * 0.4, sl * 0.4]);
    this.quad(P(-hx, y0, -hz), P(hx, y0, -hz), P(hx, y0 + rise, 0), P(-hx, y0 + rise, 0), col, [0, 0, sx * 0.4, sl * 0.4]);
    // fascia edges
    this.quad(P(-hx, y0, hz), P(hx, y0, hz), P(hx, y0 + t, hz), P(-hx, y0 + t, hz), col);
    this.quad(P(hx, y0, -hz), P(-hx, y0, -hz), P(-hx, y0 + t, -hz), P(hx, y0 + t, -hz), col);
    for (const e of [-1, 1]) {
      const x = e * hx;
      const a = P(x, y0, hz), b = P(x, y0 + t, hz), r0 = P(x, y0 + rise, 0), r1 = P(x, y0 + rise + t, 0), d = P(x, y0, -hz), f = P(x, y0 + t, -hz);
      if (e > 0) { this.quad(a, r0, r1, b, col); this.quad(r0, d, f, r1, col); } else { this.quad(r0, a, b, r1, col); this.quad(d, r0, r1, f, col); }
    }
    if (wallCol) return { tri: (b, inset, wz) => {
      // gable end walls (triangles) in batch b, inset from the roof ends, half-depth wz
      for (const e of [-1, 1]) {
        const x = e * (hx - inset), k = rise * (wz / hz), yb = y0 + rise - k;
        const A = P(x, yb, wz), B = P(x, yb, -wz), R = P(x, y0 + rise, 0);
        if (e > 0) { b.tri(A, B, R, wallCol); b.tri(B, A, R, wallCol); } else { b.tri(B, A, R, wallCol); b.tri(A, B, R, wallCol); }
      }
    } };
    return null;
  }
}

export function toGeometry(THREE, b) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(b.p, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(b.n, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(b.u, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(b.c, 3));
  g.setIndex(b.count > 65535 ? new THREE.Uint32BufferAttribute(b.i, 1) : new THREE.Uint16BufferAttribute(b.i, 1));
  g.computeBoundingSphere();
  return g;
}
