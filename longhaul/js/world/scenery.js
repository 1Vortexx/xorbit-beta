// Long Haul – scenery rendering: instanced rocks and plants, poles and wires, rails, signs, billboards, fences.
// Placement comes from scatter.js (pure); this file only draws it.
import * as THREE from "three";
import { Batch, toGeometry, lin } from "./geo.js";
import { M, boardUV } from "./tex.js";
import { TYPES } from "./scatter.js";

const G = {};     // prototype geometries by type
let built = false;

// Append a THREE geometry (transformed) to a Batch
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3();
function addGeo(b, geo, mat, col, uvs = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  _nm.getNormalMatrix(mat);
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i).applyMatrix4(mat); _n.fromBufferAttribute(n, i).applyMatrix3(_nm).normalize();
    const c = typeof col === "function" ? col(_v) : col;
    b.vert(_v.x, _v.y, _v.z, _n.x, _n.y, _n.z, uv ? uv.getX(i) * uvs : 0, uv ? uv.getY(i) * uvs : 0, c);
    if (i % 3 === 2) b.i.push(b.count - 3, b.count - 2, b.count - 1);
  }
  if (g !== geo) g.dispose();
  geo.dispose();
}
const mat4 = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, "YXZ")), new THREE.Vector3(sx, sy, sz));

function rockGeo(seed, flat, detail = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position, uv = [];
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i);
    const d = 1 + 0.26 * Math.sin(_v.x * 2.3 + seed) * Math.sin(_v.y * 2.9 + seed * 1.7) + 0.22 * Math.sin(_v.z * 3.1 + seed * 0.6 + _v.x * 1.4) + 0.1 * Math.sin(_v.y * 7 + _v.z * 5 + seed);
    _v.multiplyScalar(d); _v.y *= flat; if (_v.y < -0.25) _v.y = -0.25;
    p.setXYZ(i, _v.x, _v.y, _v.z);
    uv.push((_v.x + _v.z) * 0.45, _v.y * 0.45 + (_v.x - _v.z) * 0.2);
  }
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const sh = 0.75 + 0.25 * Math.min(1, Math.max(0, (p.getY(i) + 0.25) / 0.7)); col[i * 3] = sh; col[i * 3 + 1] = sh; col[i * 3 + 2] = sh; }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

export function buildPrototypes() {
  if (built) return;
  built = true;
  G.boulder = rockGeo(1.3, 0.72);
  G.pebble = rockGeo(4.1, 0.55, 0);
  // spire / hoodoo: stacked, banded
  {
    const b = new Batch(), prof = [[1.7, 0], [1.35, 1.6], [1.55, 2.4], [1.05, 4.0], [1.3, 4.8], [0.8, 6.6], [0.95, 7.2], [0.35, 8.6]];
    for (let i = 0; i < prof.length - 1; i++) {
      const band = i % 2 ? 0.78 : 1;
      b.cyl(Math.sin(i * 1.7) * 0.18, prof[i][1] - 0.3, Math.cos(i * 2.3) * 0.18, prof[i][0], prof[i + 1][1] - prof[i][1], 7, [band, band * 0.94, band * 0.9], { r1: prof[i + 1][0], yaw: i * 0.5, open: i < prof.length - 2 });
    }
    G.spire = toGeometry(THREE, b); G.spire.computeVertexNormals();
  }
  // saguaro
  {
    const b = new Batch(), gc = lin(0x7c9462), arm = (side, y, len, up, r) => {
      b.cyl(side * (0.2 + len / 2), y - r, 0, r, len + 0.1, 8, gc, { axis: "x" });
      b.cyl(side * (0.2 + len), y - r * 0.6, 0, r, up, 8, gc); b.cyl(side * (0.2 + len), y - r * 0.6 + up, 0, r, 0.22, 8, gc, { r1: r * 0.45 });
      addGeo(b, new THREE.SphereGeometry(r * 1.02, 8, 5), mat4(side * (0.2 + len), y, 0), gc);
    };
    b.cyl(0, -0.2, 0, 0.3, 4.6, 9, gc, { r1: 0.27 }); b.cyl(0, 4.4, 0, 0.27, 0.32, 9, gc, { r1: 0.12 });
    arm(1, 2.0, 0.55, 1.5, 0.17); arm(-1, 2.7, 0.45, 1.0, 0.15);
    G.saguaro = toGeometry(THREE, b);
  }
  // prickly pear: flat pads
  {
    const b = new Batch(), gc = lin(0x86a06a), pads = [[0, 0.35, 0, 0, 0.1, 0.42], [0.32, 0.75, 0.05, 0.6, 0.5, 0.36], [-0.3, 0.72, -0.04, -0.5, -0.45, 0.34], [0.5, 1.15, 0.1, 1.2, 0.3, 0.28], [-0.1, 1.2, -0.05, 0.2, -0.2, 0.3], [-0.55, 0.38, 0.2, 2.0, 0.2, 0.33], [0.6, 0.33, -0.25, -1.0, -0.15, 0.3]];
    for (const [x, y, z, ry, rz, s] of pads) addGeo(b, new THREE.IcosahedronGeometry(1, 1), mat4(x, y, z, 0, ry, rz, s, s * 1.25, s * 0.2), gc, 0.5);
    G.pear = toGeometry(THREE, b);
  }
  // joshua tree: trunk, crooked limbs, spiky tufts
  {
    const b = new Batch(), bk = lin(0x7a6652), lf = lin(0x66783e);
    const limb = (x, y, z, ry, rz, len, r) => {
      const m = mat4(x, y, z, 0, ry, rz);
      addGeo(b, new THREE.CylinderGeometry(r * 0.8, r, len, 6).translate(0, len / 2, 0), m, bk, 2);
      const tip = new THREE.Vector3(0, len, 0).applyMatrix4(m);
      for (let k = 0; k < 7; k++) addGeo(b, new THREE.ConeGeometry(0.07, 0.75, 4).translate(0, 0.3, 0), mat4(tip.x, tip.y, tip.z, 0, k * 0.9 + ry, 0.25 + (k % 3) * 0.45, 1), lf);
      return tip;
    };
    const t = limb(0, -0.2, 0, 0, 0.05, 2.3, 0.24);
    const a = limb(t.x, t.y - 0.1, t.z, 0.3, 0.7, 1.3, 0.16), c = limb(t.x, t.y - 0.1, t.z, 2.4, 0.6, 1.1, 0.16), d = limb(t.x, t.y - 0.15, t.z, 4.3, 0.75, 1.4, 0.15);
    limb(a.x, a.y - 0.05, a.z, 1.2, 0.5, 0.8, 0.12); limb(c.x, c.y - 0.05, c.z, 3.5, 0.55, 0.9, 0.12); limb(d.x, d.y - 0.05, d.z, 5.2, 0.3, 0.7, 0.12);
    G.joshua = toGeometry(THREE, b);
  }
  // cards
  const card = (w, h, n) => {
    const b = new Batch();
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI, c = Math.cos(a) * w / 2, s = Math.sin(a) * w / 2; b.quad([-c, 0, -s], [c, 0, s], [c, h, s], [-c, h, -s], [1, 1, 1], [0, 0, 1, 1]); }
    const g = toGeometry(THREE, b);
    // light them from above regardless of card facing
    const nn = g.attributes.normal; for (let i = 0; i < nn.count; i++) nn.setXYZ(i, nn.getX(i) * 0.3, 0.95, nn.getZ(i) * 0.3);
    return g;
  };
  G.bush = card(1.3, 0.9, 3); G.grass = card(0.8, 0.5, 2);
  // telephone pole
  {
    const b = new Batch(), c = lin(0x4f3d2e);
    b.cyl(0, -0.5, 0, 0.14, 8.5, 7, c, { r1: 0.1 });
    b.box(0, 7.25, 0, 2.2, 0.12, 0.12, 0, c); b.box(0, 6.5, 0, 1.5, 0.1, 0.1, 0, c);
    for (const x of [-1, -0.45, 0.45, 1]) b.cyl(x, 7.37, 0, 0.04, 0.12, 5, lin(0x9aa6a0));
    G.pole = toGeometry(THREE, b);
    const f = new Batch(); f.box(0, -0.3, 0, 0.1, 1.55, 0.1, 0, lin(0x6a5540));
    G.fencepost = toGeometry(THREE, f);
  }
}
const MAT = () => ({ boulder: M.rock, pebble: M.rock, spire: M.rock, saguaro: M.cactus, pear: M.cactus, joshua: M.bark, bush: M.bush, grass: M.grass });
const SINK = { boulder: 0.15, pebble: 0.05, spire: 0.2, saguaro: 0, pear: 0.05, joshua: 0, bush: 0.05, grass: 0.03 };
const CAST = { boulder: 1, spire: 1, saguaro: 1, joshua: 1, pear: 1 };

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();
const ROCK_TINT = [lin(0xb89878), lin(0xc9a878), lin(0xb5aa98), lin(0xa86a4c)];

// Draw the scatter result of a chunk into chunk.group
export function buildScenery(sc, chunk, opts, regionW) {
  const gp = chunk.group.position, lite = !!opts.lite, mats = MAT();
  for (const [type, a] of Object.entries(sc.inst)) {
    const n = a.length / 6;
    if (!n) continue;
    const im = new THREE.InstancedMesh(G[type], mats[type], n);
    for (let i = 0; i < n; i++) {
      const o = i * 6, s = a[o + 3], tint = a[o + 5];
      _p.set(a[o] - gp.x, a[o + 1] - SINK[type] * s, a[o + 2] - gp.z);
      _e.set(type === "boulder" || type === "pebble" ? (tint - 0.5) * 0.5 : 0, a[o + 4], type === "saguaro" || type === "joshua" ? (tint - 0.5) * 0.08 : 0);
      _q.setFromEuler(_e);
      const sy = type === "boulder" ? s * (0.7 + tint * 0.6) : type === "grass" || type === "bush" ? s * (0.7 + tint * 0.7) : s;
      im.setMatrixAt(i, _m.compose(_p, _q, _s.set(s, sy, s)));
      if (type === "boulder" || type === "pebble" || type === "spire") {
        const t = ROCK_TINT, w = regionW, k = 0.8 + tint * 0.35;
        _c.setRGB((t[0][0] * w[0] + t[1][0] * w[1] + t[2][0] * w[2] + t[3][0] * w[3]) * k, (t[0][1] * w[0] + t[1][1] * w[1] + t[2][1] * w[2] + t[3][1] * w[3]) * k, (t[0][2] * w[0] + t[1][2] * w[1] + t[2][2] * w[2] + t[3][2] * w[3]) * k);
      } else if (type === "bush") _c.setRGB(0.6 + tint * 0.4, 0.6 + tint * 0.3, 0.45 + tint * 0.25);
      else if (type === "grass") _c.setRGB(0.85 + tint * 0.15, 0.8 + tint * 0.15, 0.6 + tint * 0.2);
      else _c.setRGB(0.8 + tint * 0.3, 0.85 + tint * 0.25, 0.8 + tint * 0.2);
      im.setColorAt(i, _c);
    }
    if (lite && TYPES[type].deco) im.count = Math.ceil(n * 0.4);
    im.castShadow = !lite && !!CAST[type]; im.receiveShadow = !TYPES[type].deco;
    im.computeBoundingSphere();
    chunk.group.add(im); chunk.instanced.push(im);
  }
  // poles + fence posts
  const instSimple = (geo, mat, list, shadow, fn) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => { _p.set(p.x - gp.x, p.y, p.z - gp.z); _e.set(0, p.yaw || 0, p.lean || 0); _q.setFromEuler(_e); im.setMatrixAt(i, _m.compose(_p, _q, _s.set(1, 1, 1))); });
    im.castShadow = shadow && !lite; im.computeBoundingSphere();
    chunk.group.add(im); chunk.instanced.push(im);
    void fn;
  };
  instSimple(G.pole, M.wood, sc.poles, true);
  const posts = sc.fence.filter((p) => p && !p.ghost);
  instSimple(G.fencepost, M.wood, posts, false);

  // wires (telephone + fence)
  const lp = [];
  const L = (ax, ay, az, bx, by, bz) => lp.push(ax - gp.x, ay, az - gp.z, bx - gp.x, by, bz - gp.z);
  for (const [a, b] of sc.wires) {
    const span = Math.hypot(b.x - a.x, b.z - a.z), sag = span * span * 0.00045 + 0.25, N = lite ? 4 : 7;
    for (const [off, hh] of [[-1, 7.45], [0.45, 7.45], [1, 7.45], [-0.6, 6.6]]) {
      if (lite && Math.abs(off) < 0.9) continue;
      const ax = a.x + Math.cos(a.yaw) * off, az = a.z - Math.sin(a.yaw) * off, bx = b.x + Math.cos(b.yaw) * off, bz = b.z - Math.sin(b.yaw) * off;
      let px = ax, py = a.y + hh, pz = az;
      for (let i = 1; i <= N; i++) { const t = i / N, x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = a.y + hh + (b.y - a.y) * t - sag * 4 * t * (1 - t); L(px, py, pz, x, y, z); px = x; py = y; pz = z; }
    }
  }
  for (let i = 0; i < sc.fence.length - 1; i++) { const a = sc.fence[i], b = sc.fence[i + 1]; if (a && b) for (const hh of [0.35, 0.7, 1.05]) L(a.x, a.y + hh, a.z, b.x, b.y + hh - 0.02, b.z); }
  if (lp.length) {
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3));
    chunk.owned.push(g); chunk.group.add(new THREE.LineSegments(g, M.wire));
  }

  // rails, signs, billboards → two batches
  const sm = new Batch(), bd = new Batch(), steel = lin(0xa8adb0), post = lin(0x6f7375), X = (x) => x - gp.x, Z = (z) => z - gp.z;
  for (const [a, b] of sc.rails) {
    const len = Math.hypot(b.x - a.x, b.z - a.z), yaw = Math.atan2(b.x - a.x, b.z - a.z), y = (a.y + b.y) / 2;
    sm.box(X(a.x), a.y - 0.2, Z(a.z), 0.1, 0.9, 0.12, yaw, post);
    sm.box(X((a.x + b.x) / 2), y + 0.38, Z((a.z + b.z) / 2), 0.05, 0.3, len + 0.05, yaw, steel);
  }
  const face = (b, x, y, z, w, h, yaw, uv, col = [1, 1, 1]) => {
    const c = Math.cos(yaw), s = Math.sin(yaw), P = (lx, yy, lz = 0) => [X(x) + lx * c + lz * s, yy, Z(z) - lx * s + lz * c];
    b.quad(P(-w / 2, y), P(w / 2, y), P(w / 2, y + h), P(-w / 2, y + h), col, uv);
    sm.quad(P(w / 2, y, -0.03), P(-w / 2, y, -0.03), P(-w / 2, y + h, -0.03), P(w / 2, y + h, -0.03), post);
  };
  for (const s of sc.signs) {
    sm.box(X(s.x), s.y - 0.3, Z(s.z), 0.07, s.base + s.h + 0.3, 0.07, s.yaw, post);
    const fx = s.x + Math.sin(s.yaw) * 0.045, fz = s.z + Math.cos(s.yaw) * 0.045;
    if (s.km !== undefined) {
      const str = String(s.km), dw = s.w / Math.max(2, str.length);
      for (let i = 0; i < str.length; i++) {
        const lx = (i - (str.length - 1) / 2) * dw;
        face(bd, fx + Math.cos(s.yaw) * lx, s.y + s.base, fz - Math.sin(s.yaw) * lx, dw, s.h, s.yaw, boardUV("d" + str[i]));
      }
    } else face(bd, fx, s.y + s.base, fz, s.w, s.h, s.yaw, boardUV(s.key));
  }
  for (const b of sc.billboards) {
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    for (const e of [-3, 3]) { sm.box(X(b.x + c * e), b.y - 0.5, Z(b.z - s * e), 0.22, 7.2, 0.22, b.yaw, lin(0x5a4636)); sm.box(X(b.x + c * e - s * 1.2), b.y - 0.5, Z(b.z - s * e - c * 1.2), 0.12, 3.6, 0.12, b.yaw, lin(0x5a4636)); }
    sm.box(X(b.x - s * 0.1), b.y + 2.9, Z(b.z - c * 0.1), 8.6, 3.8, 0.12, b.yaw, lin(0x7a6a55));
    face(bd, b.x + s * 0.0, b.y + 3.0, b.z + c * 0.0, 8.4, 3.6, b.yaw, boardUV(b.key));
  }
  for (const [b, mat, cast] of [[sm, M.smooth, true], [bd, M.board, false]]) {
    if (!b.count) continue;
    const mesh = new THREE.Mesh(toGeometry(THREE, b), mat);
    mesh.castShadow = cast && !lite; mesh.receiveShadow = true;
    chunk.owned.push(mesh.geometry); chunk.group.add(mesh);
  }
}
