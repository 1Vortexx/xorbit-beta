// Long Haul – body shell generator. Builds the station/row grid of a vehicle body from its definition and lofts it
// into named panels (body, hood, doors, glass, bed, trunk …). MODEL coordinates: y from the ground at rest.
// Rows (16 per station, left half): 0–5 lower body side (rocker tuck → shoulder), 6–15 depend on the section:
//   hood / deck: fender top (6,7) then the lid surface to the centre line
//   cab:        6 window sill, 7 window top, 8 drip rail, 9 roof edge, 10–15 roof
//   cowl:       6,7 fender top, 8 pillar foot, 9–15 windshield base
//   bed:        6,7 rail top, 8–10 inner wall, 11–15 floor
import { loft } from "./loft.js";

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const K8 = [1, 0.88, 0.74, 0.58, 0.42, 0.27, 0.13, 0];      // lid rows 8..15 (fraction of half width)
const KG = [1, 0.84, 0.67, 0.5, 0.33, 0.16, 0];            // glass rows 9..15
const KR = [0.8, 0.62, 0.45, 0.3, 0.15, 0];                // roof rows 10..15
export const ROWS = 16;

export function makeGrid(def) {
  const b = def.body, sedan = b.style === "sedan";
  const hw0 = b.hw, taperN = sedan ? 0.055 : 0.035, taperT = sedan ? 0.045 : 0.02;
  const hwAt = (z) => {
    const tn = clamp((z - (b.zNose - 0.7)) / 0.7, 0, 1), tt = clamp(((b.zTail + 0.6) - z) / 0.6, 0, 1);
    return hw0 - taperN * tn * tn - taperT * tt * tt;
  };
  const archTop = (z) => {
    let a = -1;
    for (const az of [def.axleF, def.axleR]) {
      const dz = z - az;
      if (Math.abs(dz) < b.archR) a = Math.max(a, def.wheelR + 0.02 + Math.sqrt(b.archR * b.archR - dz * dz));
    }
    return a;
  };
  const lower = (z, inset = 0) => {
    const hw = hwAt(z) - inset;
    const ys = [b.rockerY - 0.03, b.rockerY + 0.04, lerp(b.rockerY, b.creaseY, 0.52), b.creaseY, lerp(b.creaseY, b.beltY, 0.6), b.beltY];
    const xs = [hw - 0.07, hw - 0.012, hw - 0.004, hw, hw - 0.008, hw - 0.035];
    const a = Math.min(archTop(z), b.creaseY - 0.035);
    if (a > ys[0]) {
      for (let j = 0; j < 3; j++) {
        const t = (ys[j] - ys[0]) / (ys[3] - ys[0]);
        ys[j] = a + t * (ys[3] - a);
        xs[j] = hw - 0.004 + 0.02 * (1 - t) - (j === 0 ? 0.012 : 0);       // flared lip around the opening
      }
    }
    return xs.map((x, j) => [x, ys[j], z]);
  };
  const hoodY = (z) => lerp(b.hoodYFront, b.hoodYRear, Math.pow(clamp((b.zNose - z) / (b.zNose - b.zHoodRear), 0, 1), 0.65));
  const lid = (z, y, crown, seam, inset = 0) => {
    const hw = hwAt(z) - inset, out = [[hw - 0.05, y + 0.012 - inset * 0.6, z], [hw - seam + 0.02, y + 0.022 - inset * 0.6, z]];
    for (const k of K8) out.push([k * (hw - seam), y + 0.024 + crown * (1 - k * k) - inset * 0.6, z]);
    return out;
  };
  const hood = (z, inset) => lid(z, hoodY(z), 0.035, 0.18, inset);
  const deck = (z, inset) => lid(z, b.deckY, 0.022, 0.16, inset);
  // Glass base line across the body (front cowl: dir +1 bulges forward, rear cowl: −1)
  const cowl = (z, y, dir) => {
    const hw = hwAt(z), out = [[hw - 0.05, y + 0.012, z], [hw - 0.062, y + 0.02, z], [hw - 0.078, y + 0.03, z]];
    for (const k of KG) out.push([k * (hw - 0.135), y + 0.036, z + dir * 0.055 * (1 - k * k)]);
    return out;
  };
  const roofY = (z) => b.roofY - 0.03 * Math.pow((z - (b.zRoofFront + b.zRoofRear) / 2) / ((b.zRoofFront - b.zRoofRear) / 2 + 0.2), 2);
  // Top edge of the glass + pillar (rows 8..15), dir as above
  const header = (cw, z, dir) => {
    const ry = roofY(z), out = [cw[0], cw[1], [b.roofHw + 0.02, ry - 0.075, z + dir * 0.02]];
    for (const k of KG) out.push([k * (b.roofHw - 0.045), ry - 0.032 + 0.02 * (1 - k * k), z + dir * 0.035 * (1 - k * k)]);
    return out;
  };
  const cab = (zSill, zTop) => {
    const ry = roofY(zTop);
    const out = [[hwAt(zSill) - 0.05, b.beltY + 0.03, zSill], [b.roofHw + 0.035, ry - 0.11, zTop], [b.roofHw + 0.02, ry - 0.075, zTop], [b.roofHw - 0.05, ry - 0.02, zTop]];
    for (const k of KR) out.push([k * (b.roofHw - 0.05), ry - 0.02 + 0.024 * (1 - k * k), zTop]);
    return out;
  };
  const bed = (z, inset = 0) => {
    const hw = hwAt(z) - inset, top = b.beltY + 0.015, fl = b.bedFloorY;
    const dz = Math.abs(z - def.axleR), t = dz < 0.56 ? Math.sqrt(1 - (dz / 0.56) * (dz / 0.56)) : 0, t3 = Math.min(1, t * 3);
    const tubY = fl + 0.25 * t, tubX = 0.27 * t3, wall = hw - 0.115;
    return [
      [hw - 0.045, top, z], [hw - 0.105, top, z], [wall, top - 0.025, z],
      [wall, lerp(lerp(top, fl, 0.5), tubY + 0.012, t3), z],
      [wall - tubX * 0.12, lerp(fl + 0.012, tubY, t3), z],
      [wall - 0.012 - tubX, lerp(fl, tubY - 0.03 * t3, t3), z],
      [wall - 0.03 - tubX * 1.04, fl, z],
      [(wall - 0.03 - tubX) * 0.66, fl, z], [(wall - 0.03 - tubX) * 0.33, fl, z], [0, fl, z],
    ];
  };

  // ── Key stations, nose → tail ──
  const keys = [];
  const key = (name, zl, up, seg, o = {}) => keys.push({ name, zl, up, seg, fill: !!o.fill, inset: o.inset || 0 });
  key("N0", b.zNose + 0.02, hood(b.zNose + 0.02, 0.03), "nose", { inset: 0.03 });
  key("N1", b.zNose - 0.03, hood(b.zNose - 0.03), "hood", { fill: true });
  key("H", b.zHoodRear, hood(b.zHoodRear), "cowl");
  const cw = cowl(b.zCowl, b.hoodYRear, 1);
  key("C", b.zCowl, cw, "wsh");
  key("A", b.zCowl, header(cw, b.zRoofFront, 1), "apil");
  key("Sa", b.zDoorFront, cab(b.zDoorFront, b.zRoofFront - 0.06), "dframeF");
  key("Sa2", b.zDoorFront, cab(b.zDoorFront - 0.05, b.zRoofFront - 0.11), "door", { fill: true });
  key("Sb", b.zDoorRear + 0.045, cab(b.zDoorRear + 0.045, b.zDoorRear + 0.045), "dframeR");
  key("Sb2", b.zDoorRear, cab(b.zDoorRear, b.zDoorRear), "bpil");
  if (!sedan) {
    key("Sc", b.zCabBack, cab(b.zCabBack, b.zCabBack), null);
    key("B0", b.zBedFront, bed(b.zBedFront), "bed", { fill: true });
    key("B1", b.zTail + 0.03, bed(b.zTail + 0.03), "tail");
    key("B2", b.zTail, bed(b.zTail, 0.012), null, { inset: 0.012 });
  } else {
    const z1 = b.zDoorRear - 0.06;
    key("Sd", z1, cab(z1, z1), "d2frameF");
    key("Sd2", z1 - 0.045, cab(z1 - 0.045, z1 - 0.045), "door2", { fill: true });
    key("Se", b.zDoor2Rear + 0.045, cab(b.zDoor2Rear + 0.045, b.zDoor2Rear + 0.045), "d2frameR");
    key("Se2", b.zDoor2Rear, cab(b.zDoor2Rear, b.zDoor2Rear), "cpil", { fill: true });
    const rc = cowl(b.zDeckFront, b.deckY - 0.012, -1);
    key("A2", b.zDeckFront, header(rc, b.zRoofRear - 0.07, -1), "rwin");
    key("C2", b.zDeckFront, rc, "rcowl");
    key("D0", b.zDeckFront - 0.07, deck(b.zDeckFront - 0.07), "deck", { fill: true });
    key("D1", b.zTail + 0.03, deck(b.zTail + 0.03), "tail");
    key("D2", b.zTail, deck(b.zTail, 0.025), null, { inset: 0.025 });
  }

  // ── Expand: fill long intervals, keep arch edges crisp ──
  const breaks = [];
  for (const az of [def.axleF, def.axleR]) breaks.push(az + b.archR + 0.004, az + b.archR - 0.002, az - b.archR + 0.002, az - b.archR - 0.004);
  const P = [], segs = [], at = {};
  for (let k = 0; k < keys.length; k++) {
    const a = keys[k], n = keys[k + 1];
    at[a.name] = P.length;
    P.push(lower(a.zl, a.inset).concat(a.up));
    if (!n) break;
    if (a.fill) {
      const zs = [];
      const inArch = (z) => [def.axleF, def.axleR].some((az) => Math.abs(z - az) < b.archR + 0.01);
      let z = a.zl;
      while (true) {
        const step = inArch(z - 0.05) || inArch(z) ? 0.065 : 0.22;
        z -= step;
        if (z <= n.zl + 0.03) break;
        zs.push(z);
      }
      for (const bz of breaks) if (bz < a.zl - 0.004 && bz > n.zl + 0.004) zs.push(bz);
      zs.sort((p, q) => q - p);
      let last = a.zl;
      for (const zz of zs) {
        if (last - zz < 0.0035) continue;
        last = zz;
        const t = (a.zl - zz) / (a.zl - n.zl);
        // Regular sections are re-evaluated at z; slanted ones are interpolated between their key stations
        let up;
        if (a.seg === "hood") up = hood(zz);
        else if (a.seg === "bed") up = bed(zz);
        else if (a.seg === "deck") up = deck(zz);
        else up = a.up.map((p, j) => [lerp(p[0], n.up[j][0], t), lerp(p[1], n.up[j][1], t), lerp(p[2], n.up[j][2], t)]);
        if (a.seg === "door" || a.seg === "door2") { const c = cab(zz, lerp(a.up[1][2], n.up[1][2], t)); up = c; up[0][2] = lerp(a.up[0][2], n.up[0][2], t); }
        segs.push(a.seg); P.push(lower(zz).concat(up));
      }
    }
    segs.push(a.seg);
  }
  return { P, segs, at, hwAt, hoodY, roofY, lower };
}

// Which panel each cell belongs to. Returns the part() callback for loft().
function partFn(def, grid) {
  const sedan = def.body.style === "sedan", segs = grid.segs;
  return (i, j, side) => {
    const s = segs[i], L = side > 0 ? "L" : "R";
    switch (s) {
      case "nose": case "hood": return j <= 6 ? "body" : j === 7 ? "seam" : "hood";
      case "cowl": return j <= 6 ? "body" : "cowl";
      case "wsh": return j <= 8 ? "body" : "windshield";
      case "apil": return j >= 8 ? "roof" : "body";
      case "dframeF": case "dframeR": return j === 0 ? "body" : j <= 6 ? "door" + L : "roof";
      case "door": return j === 0 ? "body" : j <= 5 ? "door" + L : j === 6 ? "doorGlass" + L : "roof";
      case "bpil": return j >= 7 ? "roof" : "body";
      case "d2frameF": case "d2frameR": return j >= 7 ? "roof" : "body";
      case "door2": return j === 6 ? "glassFixed" : j >= 7 ? "roof" : "body";
      case "cpil": return j >= 8 ? "roof" : "body";
      case "rwin": return j <= 8 ? "body" : "rearGlass";
      case "rcowl": return j <= 6 ? "body" : "cowl";
      case "deck": case "tail": if (sedan) return j <= 6 ? "body" : j === 7 ? "seam" : "trunk"; return j <= 6 ? "body" : "bedInner";
      case "bed": return j <= 6 ? "body" : "bedInner";
      default: return null;
    }
  };
}

// Loft the whole shell. Returns { grid, panels: Map name → {pos, nor, uv} }
export function buildShell(def) {
  const grid = makeGrid(def), b = def.body, at = grid.at;
  const span = (i, i0, i1) => (i - i0) / Math.max(1, i1 - i0);
  const panels = loft(grid.P, {
    part: partFn(def, grid),
    hardRows: new Set([0, 6, 7, 8]),
    hardStations: new Set([at.N1, at.C, at.A, at.Sa2, at.Sb, at.Sc ?? -1, at.B0 ?? -1, at.B1 ?? -1, at.Sd2 ?? -1, at.Se ?? -1, at.A2 ?? -1, at.C2 ?? -1, at.D0 ?? -1, at.D1 ?? -1]),
    zRange: [def.zFront, def.zRear], vScale: 3.2,
    inner: (name) => {
      if (name === "doorL" || name === "doorR") return { name: name.replace("door", "doorCard"), offset: 0.07 };
      if (name === "hood") return { name: "hoodInner", offset: 0.028 };
      if (name === "trunk") return { name: "trunkInner", offset: 0.028 };
      if (name === "roof") return { name: "headliner", offset: 0.028 };
      return null;
    },
    uv: (name, i, j) => {
      if (name === "windshield") return [(j - 9) / 6, i === at.C ? 0 : 1];
      if (name === "rearGlass") return [(j - 9) / 6, i === at.C2 ? 0 : 1];
      if (name === "doorGlassL" || name === "doorGlassR") return [span(i, at.Sa2, at.Sb), j === 6 ? 0 : 1];
      if (name === "glassFixed") return [span(i, at.Sd2, at.Se), j === 6 ? 0 : 1];
      return null;
    },
  });
  return { grid, panels };
}

// Closed outline (both sides) of a station's rows j0..j1 for end caps: [[x, y], …]
export function stationOutline(grid, i, j0 = 0, j1 = ROWS - 1, closeBottom = true) {
  const st = grid.P[i], pts = [];
  for (let j = j0; j <= j1; j++) pts.push([st[j][0], st[j][1]]);
  const out = pts.slice();
  for (let k = pts.length - 1; k >= 0; k--) if (pts[k][0] > 1e-6) out.push([-pts[k][0], pts[k][1]]);
  return out;
}
// One-sided ring (e.g. a bed side's end): rows j0..j1 on the given side
export function ringOutline(grid, i, j0, j1, side) {
  const st = grid.P[i], pts = [];
  for (let j = j0; j <= j1; j++) pts.push([st[j][0] * side, st[j][1]]);
  return pts;
}
