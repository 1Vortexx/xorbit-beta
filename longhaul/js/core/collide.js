// Long Haul – shared 2.5D collision used by the player, loose props and vehicles.
// Colliders live in absolute world coordinates:
//   { kind: "circle", x, z, r,              y0?, y1?, solid? }
//   { kind: "box",    x, z, hx, hz, yaw,    y0?, y1?, solid? }   hx/hz = half extents along the box's local x/z,
//                                                              yaw = rotation about +y (same as Object3D.rotation.y)
// y0/y1 are absolute heights (default: unbounded). solid === false disables a collider (open door).
// A collider without `kind` is treated as a circle.

const overlapY = (o, y0, y1) => (o.y0 === undefined || y1 >= o.y0) && (o.y1 === undefined || y0 <= o.y1);

// Push circle (p.x, p.z, r) out of one collider. Returns penetration depth (0 = no contact) and writes the
// contact normal (pointing from the collider to the circle) into n.
export function pushOut(p, r, o, n) {
  if (o.kind === "box") {
    const s = Math.sin(o.yaw), c = Math.cos(o.yaw);
    const dx = p.x - o.x, dz = p.z - o.z;
    // world → box local (rotation.y = yaw maps local x to (c, 0, -s) and local z to (s, 0, c))
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const cx = Math.max(-o.hx, Math.min(o.hx, lx)), cz = Math.max(-o.hz, Math.min(o.hz, lz));
    let nx = lx - cx, nz = lz - cz, depth;
    const d2 = nx * nx + nz * nz;
    if (d2 > 1e-10) {
      const d = Math.sqrt(d2);
      if (d >= r) return 0;
      nx /= d; nz /= d; depth = r - d;
    } else {
      // Centre is inside the box: leave through the nearest face
      const ex = o.hx - Math.abs(lx), ez = o.hz - Math.abs(lz);
      if (ex < ez) { nx = lx < 0 ? -1 : 1; nz = 0; depth = ex + r; }
      else { nx = 0; nz = lz < 0 ? -1 : 1; depth = ez + r; }
    }
    const wx = nx * c + nz * s, wz = -nx * s + nz * c;
    p.x += wx * depth; p.z += wz * depth;
    if (n) { n.x = wx; n.z = wz; }
    return depth;
  }
  const dx = p.x - o.x, dz = p.z - o.z, rr = r + o.r;
  const d2 = dx * dx + dz * dz;
  if (d2 >= rr * rr) return 0;
  const d = Math.sqrt(d2);
  const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
  p.x += nx * (rr - d); p.z += nz * (rr - d);
  if (n) { n.x = nx; n.z = nz; }
  return rr - d;
}

const _n = { x: 0, z: 0 };
// Resolve a circle against a list. Mutates p ({x, z}). y0/y1 = the mover's absolute vertical extent.
// Returns null, or the deepest contact { nx, nz, depth, collider }.
export function resolveCircle(p, r, colliders, y0 = -Infinity, y1 = Infinity, out = null) {
  let best = null;
  for (let pass = 0; pass < 3; pass++) {
    let any = false;
    for (const o of colliders) {
      if (o.solid === false || !overlapY(o, y0, y1)) continue;
      const d = pushOut(p, r, o, _n);
      if (d > 0) {
        any = true;
        if (!best || d > best.depth) { best = out || best || {}; best.nx = _n.x; best.nz = _n.z; best.depth = d; best.collider = o; }
      }
    }
    if (!any) break;
  }
  return best;
}

// True when a circle at (x, z) touches nothing (used for safe exit / drop spots)
export function circleFree(x, z, r, colliders, y0 = -Infinity, y1 = Infinity) {
  const p = { x, z };
  for (const o of colliders) {
    if (o.solid === false || !overlapY(o, y0, y1)) continue;
    p.x = x; p.z = z;
    if (pushOut(p, r, o, null) > 0) return false;
  }
  return true;
}

// True when the straight walk from a to b (circle radius r) is blocked – sampled, good enough for reach checks
export function pathBlocked(ax, az, bx, bz, r, colliders, y0, y1) {
  const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / Math.max(0.15, r)));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (!circleFree(ax + (bx - ax) * t, az + (bz - az) * t, r, colliders, y0, y1)) return true;
  }
  return false;
}
