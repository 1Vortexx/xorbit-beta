// Long Haul – geometry helpers for procedural vehicles: a batching builder (merges by material), primitive
// shortcuts, a station/row grid lofter with hard edges, inner skins and panel splitting, caps and seam strips.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _c = new THREE.Color();

// Collects geometry per material and builds one mesh per material.
export class Batch {
  constructor() { this.by = new Map(); this.tris = 0; }
  // o: { p: [x,y,z], r: [rx,ry,rz], s: number|[x,y,z], c: hex colour (vertex colour) }
  add(geo, mat, o = {}) {
    if (!mat) throw new Error("Batch.add: missing material");
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (o.p || o.r || o.s !== undefined) {
      _p.set(...(o.p || [0, 0, 0]));
      _q.setFromEuler(_e.set(...(o.r || [0, 0, 0])));
      if (typeof o.s === "number") _s.setScalar(o.s); else _s.set(...(o.s || [1, 1, 1]));
      g.applyMatrix4(_m.compose(_p, _q, _s));
    }
    const n = g.attributes.position.count;
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    _c.setHex(o.c ?? 0xffffff);                       // sRGB hex → linear working space
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color"].includes(k)) g.deleteAttribute(k);
    g.morphAttributes = {};
    if (!this.by.has(mat)) this.by.set(mat, []);
    this.by.get(mat).push(g);
    this.tris += n / 3;
    return this;
  }
  raw(pos, nor, uv, mat, c) {
    if (!pos.length) return this;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    return this.add(g, mat, { c });
  }
  // Build meshes under `parent`. origin: subtract this point from all vertices (pivoted parts).
  build(parent, { shadow = true, origin = null, name = "" } = {}) {
    const out = [];
    for (const [mat, list] of this.by) {
      const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
      for (const l of list) if (l !== g) l.dispose();
      if (origin) g.translate(-origin[0], -origin[1], -origin[2]);
      g.computeBoundingSphere(); g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = name;
      mesh.castShadow = shadow && !mat.transparent; mesh.receiveShadow = !mat.transparent;
      if (mat.transparent) mesh.renderOrder = 2;
      parent.add(mesh); out.push(mesh);
    }
    this.by.clear();
    return out;
  }
}

// ── Primitive shortcuts (all return fresh geometries centred on the origin) ──
export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const rbox = (w, h, d, r = 0.02, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
// Cylinder along `axis` ("x" | "y" | "z")
export function cyl(r0, r1, len, seg = 14, axis = "y", open = false) {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, open);
  if (axis === "x") g.rotateZ(-Math.PI / 2); else if (axis === "z") g.rotateX(Math.PI / 2);
  return g;
}
export const sphere = (r, w = 12, h = 8) => new THREE.SphereGeometry(r, w, h);
export function torus(R, r, seg = 24, tube = 8, axis = "z") {
  const g = new THREE.TorusGeometry(R, r, tube, seg);
  if (axis === "x") g.rotateY(Math.PI / 2); else if (axis === "y") g.rotateX(Math.PI / 2);
  return g;
}
export function tube(points, r, seg = 12, radial = 6, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed, "catmullrom", 0.3);
  return new THREE.TubeGeometry(curve, seg, r, radial, closed);
}
// Lathe about +y; profile = [[radius, y], …] listed bottom → top for outward-facing surfaces
export function lathe(profile, seg = 24) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  return g;
}
// Profile [[z, y], …] (counter-clockwise when looking from +x … either works, sides are fixed up) extruded along x
export function extrudeX(profile, width, bevel = 0, curveSeg = 4) {
  const sh = new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(-z, y)));
  const g = new THREE.ExtrudeGeometry(sh, {
    depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: curveSeg, steps: 1,
  });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(Math.PI / 2);
  return g;
}
// Flat polygon in the plane z = const facing ±z. contour/holes are [[x, y], …]
export function capXY(contour, z, facing = 1, holes = []) {
  const c2 = contour.map(([x, y]) => new THREE.Vector2(x, y));
  const h2 = holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y)));
  if (THREE.ShapeUtils.isClockWise(c2)) c2.reverse();
  for (const h of h2) if (!THREE.ShapeUtils.isClockWise(h)) h.reverse();
  const tris = THREE.ShapeUtils.triangulateShape(c2, h2);
  const all = c2.concat(...h2);
  const pos = [], nor = [], uv = [];
  for (const t of tris) {
    const order = facing > 0 ? t : [t[0], t[2], t[1]];
    for (const i of order) { pos.push(all[i].x, all[i].y, z); nor.push(0, 0, facing); uv.push(all[i].x * 0.5 + 0.5, all[i].y * 0.5); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
export function roundedRect(cx, cy, w, h, r, seg = 4) {
  const pts = [];
  const corner = (x, y, a0) => { for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * Math.PI / 2; pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); } };
  corner(cx + w / 2 - r, cy + h / 2 - r, 0); corner(cx - w / 2 + r, cy + h / 2 - r, Math.PI / 2);
  corner(cx - w / 2 + r, cy - h / 2 + r, Math.PI); corner(cx + w / 2 - r, cy - h / 2 + r, Math.PI * 1.5);
  return pts;
}

// ── Grid loft ────────────────────────────────────────────────────────────────────────────────
// P[i][j] = [x, y, z]: stations i run nose → tail, rows j run from the rocker up and over to the centre line (x = 0).
// Only the left half (x ≥ 0) is given; the right half is mirrored. opts:
//   part(i, j, side) → bucket name | null     for the cell between stations i,i+1 and rows j,j+1 (side +1 left, −1 right)
//   hardRows / hardStations: Set of indices where shading normals break
//   inner(name) → { name, offset, edge? } | null   emit an offset inner skin (and closing edge walls) for that bucket
//   uv(name, i, j, p) → [u, v] | null              override the default (length along body, arc length up the profile)
//   zRange: [zMax, zMin], vScale
// Returns Map name → { pos, nor, uv }.
export function loft(P, opts) {
  const ns = P.length, nr = P[0].length;
  const hardRows = opts.hardRows || new Set(), hardSt = opts.hardStations || new Set();
  const [zMax, zMin] = opts.zRange, vScale = opts.vScale || 3.2;
  const out = new Map();
  const bucket = (name) => { let b = out.get(name); if (!b) out.set(name, (b = { pos: [], nor: [], uv: [] })); return b; };
  const arc = P.map((st) => { const a = [0]; for (let j = 1; j < nr; j++) a.push(a[j - 1] + Math.hypot(st[j][0] - st[j - 1][0], st[j][1] - st[j - 1][1], st[j][2] - st[j - 1][2])); return a; });
  const tmp = [0, 0, 0];
  for (const side of [1, -1]) {
    const Q = P.map((st) => st.map((p) => [p[0] * side, p[1], p[2]]));
    const names = [], N = [];
    for (let i = 0; i < ns - 1; i++) {
      names.push([]); N.push([]);
      for (let j = 0; j < nr - 1; j++) {
        const A = Q[i][j], B = Q[i + 1][j], C = Q[i + 1][j + 1], D = Q[i][j + 1];
        const ux = C[0] - A[0], uy = C[1] - A[1], uz = C[2] - A[2], vx = D[0] - B[0], vy = D[1] - B[1], vz = D[2] - B[2];
        const n = [(uy * vz - uz * vy) * side, (uz * vx - ux * vz) * side, (ux * vy - uy * vx) * side];
        const area = Math.hypot(n[0], n[1], n[2]);
        N[i].push(n);
        names[i].push(area < 2e-7 ? null : opts.part(i, j, side));
      }
    }
    const cellOk = (i, j) => i >= 0 && j >= 0 && i < ns - 1 && j < nr - 1 && names[i][j];
    // Shading normal of grid vertex (vi, vj) as seen from cell (ci, cj)
    const vnorm = (vi, vj, ci, cj, soft) => {
      let x = 0, y = 0, z = 0;
      for (let a = vi - 1; a <= vi; a++) for (let b = vj - 1; b <= vj; b++) {
        if (!cellOk(a, b)) continue;
        if (!soft && ((a !== ci && hardSt.has(vi)) || (b !== cj && hardRows.has(vj)))) continue;
        const n = N[a][b]; x += n[0]; y += n[1]; z += n[2];
      }
      if (vj === nr - 1) x = 0;
      const l = Math.hypot(x, y, z) || 1;
      return [x / l, y / l, z / l];
    };
    const uvOf = (name, i, j) => {
      const p = Q[i][j];
      const c = opts.uv && opts.uv(name, i, j, p);
      return c || [(zMax - p[2]) / (zMax - zMin), arc[i][j] / vScale];
    };
    for (let i = 0; i < ns - 1; i++) for (let j = 0; j < nr - 1; j++) {
      const name = names[i][j];
      if (!name) continue;
      const idx = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      const V = idx.map(([a, b]) => Q[a][b]);
      const NN = idx.map(([a, b]) => vnorm(a, b, i, j, false));
      const UV = idx.map(([a, b]) => uvOf(name, a, b));
      const b = bucket(name);
      const order = side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      for (const k of order) { b.pos.push(...V[k]); b.nor.push(...NN[k]); b.uv.push(...UV[k]); }
      const inn = opts.inner && opts.inner(name);
      if (!inn) continue;
      const SN = idx.map(([a, bb]) => vnorm(a, bb, i, j, true));
      const W = V.map((p, k) => [p[0] - SN[k][0] * inn.offset, p[1] - SN[k][1] * inn.offset, p[2] - SN[k][2] * inn.offset]);
      const ib = bucket(inn.name);
      const rev = side > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
      for (const k of rev) { ib.pos.push(...W[k]); ib.nor.push(-SN[k][0], -SN[k][1], -SN[k][2]); ib.uv.push(...UV[k]); }
      // Close the open edges of the panel
      const eb = bucket(inn.edge || inn.name);
      const cx = (V[0][0] + V[2][0]) / 2, cy = (V[0][1] + V[2][1]) / 2, cz = (V[0][2] + V[2][2]) / 2;
      const nb = [[i, j - 1], [i + 1, j], [i, j + 1], [i - 1, j]];          // neighbour across edge k → k+1
      for (let k = 0; k < 4; k++) {
        const [a, bb] = nb[k];
        if (k === 2 && j + 1 === nr - 1) continue;                            // centre line
        const other = cellOk(a, bb) && opts.inner(names[a][bb]);
        if (other && other.name === inn.name) continue;
        const p = V[k], q = V[(k + 1) % 4], p2 = W[k], q2 = W[(k + 1) % 4];
        let nx = (q[1] - p[1]) * (p2[2] - p[2]) - (q[2] - p[2]) * (p2[1] - p[1]);
        let ny = (q[2] - p[2]) * (p2[0] - p[0]) - (q[0] - p[0]) * (p2[2] - p[2]);
        let nz = (q[0] - p[0]) * (p2[1] - p[1]) - (q[1] - p[1]) * (p2[0] - p[0]);
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        tmp[0] = (p[0] + q[0]) / 2 - cx; tmp[1] = (p[1] + q[1]) / 2 - cy; tmp[2] = (p[2] + q[2]) / 2 - cz;
        const flip = nx * tmp[0] + ny * tmp[1] + nz * tmp[2] < 0;
        if (flip) { nx = -nx; ny = -ny; nz = -nz; }
        const quad = flip ? [p, p2, q2, p, q2, q] : [p, q, q2, p, q2, p2];
        for (const v of quad) { eb.pos.push(...v); eb.nor.push(nx, ny, nz); eb.uv.push(0.5, 0.02); }
      }
    }
  }
  return out;
}

// Thin strip lying on a surface along a polyline (door seams, trim). pts/nors: [[x,y,z], …]; lifted `lift` off the surface.
export function seamStrip(pts, nors, width, lift = 0.002) {
  const pos = [], nor = [], uv = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), n = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < pts.length - 1; i++) {
    a.set(...pts[i]); b.set(...pts[i + 1]);
    d.subVectors(b, a); if (d.lengthSq() < 1e-10) continue;
    n.set(...nors[i]).add(s.set(...nors[i + 1])).normalize();
    s.crossVectors(n, d).normalize().multiplyScalar(width / 2);
    const lift3 = n.clone().multiplyScalar(lift);
    const p0 = a.clone().add(lift3).sub(s), p1 = a.clone().add(lift3).add(s), p2 = b.clone().add(lift3).add(s), p3 = b.clone().add(lift3).sub(s);
    for (const p of [p0, p3, p2, p0, p2, p1, p0, p2, p3, p0, p1, p2]) { pos.push(p.x, p.y, p.z); uv.push(0.5, 0.5); }
    for (let k = 0; k < 6; k++) nor.push(n.x, n.y, n.z);
    for (let k = 0; k < 6; k++) nor.push(n.x, n.y, n.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
