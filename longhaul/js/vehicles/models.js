// Long Haul – procedural vehicle visuals: shell panels, exterior detail, underside, engine bay, interior with
// working instruments, wheels, and the per-frame animation rig. MODEL coordinates (y from the ground at rest);
// the model root sits at −comH under vehicle.mesh.
import * as THREE from "three";
import { M, paintMaterial, glossPaint, skinMaterials, lampMaterials, GAUGE, prepareMaterials, materialsReady, crackedGlass } from "./materials.js";
import { Batch, box, rbox, cyl, sphere, torus, tube, extrudeX, capXY, roundedRect, seamStrip } from "./loft.js";
import { buildShell, stationOutline, ringOutline } from "./body.js";
import { makePartMesh, drumMesh } from "./partmeshes.js";
import { WHEEL_SLOTS } from "./defs.js";
import { COMPONENT_ITEMS } from "./components.js";
import { batteryCharge } from "./powertrain.js";
import { sfx } from "../core/bus.js";

const CHROME = 0xdadad6, BLACK = 0x111111, DARK = 0x1d1a18, STEEL = 0x8f8f8a, RUSTY = 0x4a3324;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Quad carrying a region of the decal atlas (pixel rect in a 512×256 atlas), facing +z
function decal(w, h, px, py, pw, ph) {
  const g = new THREE.PlaneGeometry(w, h);
  const u0 = px / 512, u1 = (px + pw) / 512, v1 = 1 - py / 256, v0 = 1 - (py + ph) / 256;
  g.attributes.uv.array.set([u0, v1, u1, v1, u0, v0, u1, v0]);
  return g;
}
function halfTube(R, len) {         // wheel-well liner: top half of a cylinder, axis along x
  const g = new THREE.CylinderGeometry(R, R, len, 14, 1, true, 0, Math.PI);
  g.rotateZ(Math.PI / 2);
  return g;
}
function halfDisc(R, faceX) {
  const g = new THREE.CircleGeometry(R, 14, 0, Math.PI);
  g.rotateY(faceX > 0 ? Math.PI / 2 : -Math.PI / 2);
  return g;
}

export function buildVisual(vehicle) {
  if (!materialsReady()) prepareMaterials();
  const def = vehicle.def, b = def.body, sedan = b.style === "sedan", classic = !!b.classic;
  const skin = def.skin ? skinMaterials(def) : null;
  const paint = skin ? skin.body : b.gloss ? glossPaint(vehicle.paint) : paintMaterial(vehicle.paint, vehicle.wearLook);
  // Skinned trucks have separate sheets for the red cab end and the white bed / grille surround
  const paintF = skin ? skin.front : paint, paintR = skin ? skin.rear : paint;
  const TRIM = skin ? 0xe4e0d4 : CHROME, trimMat = skin ? M.vc : M.vcMetal;    // painted grille instead of chrome
  const lamps = lampMaterials();
  const root = new THREE.Group();
  root.name = "model";
  root.position.y = -def.comH;
  vehicle.mesh.add(root);

  const { grid, panels } = buildShell(def);
  const P = grid.P, at = grid.at;
  const hw = b.hw, belt = b.beltY;
  const S = new Batch();                                  // static body
  const DB = { L: new Batch(), R: new Batch() };          // doors
  const HB = new Batch(), RB = new Batch();               // hood, tailgate / trunk lid
  const INT = b.interior, DASH = b.dash, HEAD = b.headliner;
  const BEDC = 0x4b463f;

  // ── Shell panels → batches ──
  const route = {
    body: [S, paint], roof: [S, paint], cowl: [S, M.vcRough, 0x1b1a19], seam: [S, M.vc, 0x0a0a0a],
    windshield: [S, M.glassFront], rearGlass: [S, M.glassFront], glassFixed: [S, M.glassSide],
    headliner: [S, M.vcRough, HEAD], bedInner: [S, M.vcRough, BEDC],
    hood: [HB, paint], hoodInner: [HB, M.vcRough, 0x2a2623],
    trunk: [RB, paint], trunkInner: [RB, M.vcRough, 0x2a2623],
    doorL: [DB.L, paint], doorR: [DB.R, paint], doorCardL: [DB.L, M.vc, INT], doorCardR: [DB.R, M.vc, INT],
    doorGlassL: [DB.L, M.glassSide], doorGlassR: [DB.R, M.glassSide],
  };
  for (const [name, p] of panels) {
    const r = route[name];
    if (!r) continue;
    r[0].raw(p.pos, p.nor, p.uv, r[1], r[2]);
  }

  // ── Door seams and furniture (in door batches so they swing with the door) ──
  const colOf = (i, j0, j1) => { const pts = []; for (let j = j0; j <= j1; j++) pts.push(P[i][j]); return pts; };
  const rowOf = (j, i0, i1) => { const pts = []; for (let i = i0; i <= i1; i++) pts.push(P[i][j]); return pts; };
  const seams = (batch, side, lines) => {
    for (const pts of lines) {
      const mp = pts.map((p) => [p[0] * side, p[1], p[2]]);
      batch.add(seamStrip(mp, mp.map(() => [side, 0.1, 0]), 0.009), M.vc, { c: 0x070707 });
    }
  };
  for (const side of [1, -1]) {
    const D = side > 0 ? DB.L : DB.R;
    seams(D, side, [colOf(at.Sa, 1, 6), colOf(at.Sb2, 1, 7), rowOf(1, at.Sa, at.Sb2)]);
    if (sedan && !b.twoDoor) seams(S, side, [colOf(at.Sd, 1, 7), colOf(at.Se2, 1, 7), rowOf(1, at.Sd, at.Se2)]);
    const zh = b.zDoorRear + 0.15, hy = belt - 0.11, x = hw * side;
    D.add(rbox(0.012, 0.03, 0.13, 0.005, 1), M.vc, { p: [x - side * 0.004, hy, zh], c: 0x0b0b0b });
    D.add(rbox(0.022, 0.022, 0.12, 0.008, 1), M.vcMetal, { p: [x + side * 0.008, hy + 0.004, zh], c: CHROME });
    D.add(cyl(0.011, 0.011, 0.012, 8, "x"), M.vcMetal, { p: [x + side * 0.002, hy - 0.045, zh - 0.02], c: CHROME });
    // Mirror on a tubular arm
    const mz = b.zDoorFront - 0.14, my = belt + (sedan ? 0.1 : 0.2), mx = (hw + (sedan ? 0.12 : 0.2)) * side;
    D.add(tube([[x - side * 0.03, belt + 0.01, mz + 0.05], [x + side * 0.08, belt + 0.03, mz + 0.03], [mx, my - 0.02, mz]], 0.008, 8, 5), M.vcMetal, { c: CHROME });
    if (!sedan) D.add(tube([[x - side * 0.05, belt + 0.26, mz + 0.16], [x + side * 0.08, belt + 0.27, mz + 0.06], [mx, my + 0.06, mz]], 0.007, 8, 5), M.vcMetal, { c: CHROME });
    const mw = sedan ? 0.17 : 0.15, mh = sedan ? 0.1 : 0.23, chromeMirror = !sedan || classic;
    D.add(rbox(mw, mh, 0.04, 0.012), chromeMirror ? M.vcMetal : M.vc, { p: [mx, my, mz], c: chromeMirror ? CHROME : BLACK });
    D.add(new THREE.PlaneGeometry(mw - 0.022, mh - 0.022), M.mirror, { p: [mx, my, mz - 0.0206], r: [0, Math.PI, 0] });
    // Inner door furniture
    const ix = x - side * 0.075, zm = (b.zDoorFront + b.zDoorRear) / 2;
    D.add(rbox(0.06, 0.05, 0.42, 0.02), M.vc, { p: [ix - side * 0.02, belt - 0.2, zm - 0.05], c: mixc(INT, 0x000000, 0.35) });
    D.add(rbox(0.012, 0.02, 0.1, 0.005, 1), M.vcMetal, { p: [ix, belt - 0.1, zm + 0.2], c: CHROME });
    D.add(cyl(0.02, 0.02, 0.012, 10, "x"), M.vcMetal, { p: [ix, belt - 0.24, zm + 0.26], c: CHROME });
    D.add(rbox(0.014, 0.014, 0.08, 0.005, 1), M.vcMetal, { p: [ix - side * 0.012, belt - 0.24, zm + 0.225], c: CHROME });
    D.add(sphere(0.012, 8, 6), M.vc, { p: [ix - side * 0.018, belt - 0.24, zm + 0.19], c: BLACK });
    D.add(rbox(0.012, 0.3, 0.5, 0.004, 1), M.vc, { p: [ix + side * 0.004, belt - 0.42, zm], c: mixc(INT, 0xffffff, 0.08) });
    D.add(cyl(0.006, 0.006, 0.03, 6), M.vcMetal, { p: [x - side * 0.045, belt + 0.045, b.zDoorRear + 0.1], c: CHROME });
  }

  // ── Front end ──
  const zN = P[at.N0][0][2];
  S.add(capXY(stationOutline(grid, at.N0), zN, 1), paintR);
  const nhw = P[at.N0][3][0];                             // half width of the (rounded) nose at the crease
  const lampPos = [];
  if (classic) {
    // 1950: a wide grille mouth with a chrome surround, one bar across it carrying the bullet nose and the round
    // parking lamps at its ends; round headlamps up in the fender fronts under chrome visors
    const gw = nhw * 2 - 0.46, gy = lerp(b.bumperY, b.hoodYFront, 0.52), gh = 0.2;
    S.add(rbox(gw, gh, 0.03, 0.08), M.vc, { p: [0, gy, zN + 0.004], c: 0x060606 });
    for (const dy of [gh / 2, -gh / 2]) S.add(rbox(gw + 0.03, 0.03, 0.045, 0.014, 1), M.vcMetal, { p: [0, gy + dy, zN + 0.022], c: CHROME });
    for (const s of [1, -1]) S.add(cyl(gh / 2 + 0.015, gh / 2 + 0.015, 0.045, 16, "z"), M.vcMetal, { p: [s * (gw / 2 - 0.02), gy, zN + 0.018], s: [0.5, 1, 1], c: CHROME });
    for (let i = 1; i < 4; i++) S.add(box(gw - 0.1, 0.008, 0.012), M.vcMetal, { p: [0, gy - gh / 2 + (i / 4) * gh, zN + 0.014], c: 0x9a9a96 });
    S.add(cyl(0.026, 0.026, gw - 0.06, 14, "x"), M.vcMetal, { p: [0, gy, zN + 0.055], c: CHROME });
    S.add(sphere(0.09, 20, 14), M.vcMetal, { p: [0, gy, zN + 0.08], s: [1, 1, 1.45], c: CHROME });
    S.add(cyl(0.035, 0.035, 0.012, 16, "z"), M.vc, { p: [0, gy, zN + 0.21], c: 0x8a1a12 });
    for (const s of [1, -1]) {
      const px = s * (gw / 2 - 0.13);
      S.add(cyl(0.05, 0.05, 0.03, 18, "z"), lamps.amber, { p: [px, gy, zN + 0.075] });
      S.add(torus(0.052, 0.01, 18, 6, "z"), M.vcMetal, { p: [px, gy, zN + 0.09], c: CHROME });
      const lx = s * (nhw - 0.17), ly = b.hoodYFront - 0.07;
      S.add(cyl(0.115, 0.115, 0.08, 22, "z"), M.vcMetal, { p: [lx, ly, zN + 0.03], c: CHROME });
      S.add(sphere(0.1, 20, 10), lamps.head, { p: [lx, ly, zN + 0.07], s: [1, 1, 0.35] });
      S.add(torus(0.108, 0.014, 22, 8, "z"), M.vcMetal, { p: [lx, ly, zN + 0.075], c: CHROME });
      lampPos.push([lx, ly, zN + 0.12]);
    }
  } else {
    const gy = lerp(b.creaseY, b.hoodYFront, 0.42), gh = (b.hoodYFront - b.creaseY) * (sedan ? 0.95 : 1.0) + 0.12, gw = sedan ? hw * 2 - 0.16 : nhw * 2 - 0.1;
    S.add(box(gw - 0.03, gh - 0.03, 0.02), M.vc, { p: [0, gy, zN + 0.006], c: 0x080808 });
    const fr = (w, h, x, y) => S.add(rbox(w, h, 0.04, 0.008, 1), trimMat, { p: [x, y, zN + 0.025], c: TRIM });
    fr(gw, 0.028, 0, gy + gh / 2); fr(gw, 0.028, 0, gy - gh / 2); fr(0.028, gh, gw / 2, gy); fr(0.028, gh, -gw / 2, gy);
    const lampW = sedan ? 0.34 : 0.3, gx = gw / 2 - lampW;
    fr(0.024, gh, gx, gy); fr(0.024, gh, -gx, gy);
    const nb = sedan ? 7 : 4;
    for (let i = 1; i <= nb; i++) S.add(box(gx * 2 - 0.03, sedan ? 0.01 : 0.014, 0.02), trimMat, { p: [0, gy - gh / 2 + (i / (nb + 1)) * gh, zN + 0.02], c: sedan ? 0x9c9c98 : TRIM });
    for (let i = 1; i < 12; i++) S.add(box(0.007, gh - 0.04, 0.014), trimMat, { p: [-gx + (i / 12) * gx * 2, gy, zN + 0.016], c: skin ? TRIM : 0x8c8c88 });
    S.add(rbox(0.16, 0.05, 0.02, 0.008, 1), M.vcMetal, { p: [0, gy, zN + 0.034], c: 0xb9b9b4 });
    for (const s of [1, -1]) {
      const lx = s * (gx + lampW / 2 - 0.005);
      if (sedan) {
        for (const dx of [-0.075, 0.075]) {        // quad rectangular sealed beams
          S.add(rbox(0.135, 0.095, 0.03, 0.012), lamps.head, { p: [lx + dx, gy + 0.03, zN + 0.022] });
          S.add(rbox(0.15, 0.11, 0.02, 0.012), M.vcMetal, { p: [lx + dx, gy + 0.03, zN + 0.012], c: 0x6f6f6c });
        }
        S.add(rbox(0.28, 0.045, 0.03, 0.01), lamps.amber, { p: [lx, gy - gh / 2 + 0.05, zN + 0.02] });
        lampPos.push([lx, gy + 0.03, zN + 0.06]);
      } else {
        const ly = gy + 0.035;
        S.add(cyl(0.1, 0.1, 0.03, 20, "z"), lamps.head, { p: [lx, ly, zN + 0.026] });
        S.add(torus(0.103, 0.012, 20, 6, "z"), M.vcMetal, { p: [lx, ly, zN + 0.036], c: CHROME });
        S.add(rbox(0.2, 0.05, 0.03, 0.01), lamps.amber, { p: [lx, gy - gh / 2 + 0.055, zN + 0.02] });
        lampPos.push([lx, ly, zN + 0.07]);
      }
    }
  }
  // Bumpers
  const bumper = (z, dir, w) => {
    if (classic) {
      // Heavy rolled chrome blade wrapping round the corners, with two tall guards
      const cp = [[0, -0.075], [0.06 * dir, -0.072], [0.105 * dir, -0.035], [0.115 * dir, 0.01], [0.1 * dir, 0.05], [0.05 * dir, 0.072], [0, 0.068]];
      S.add(extrudeX(dir > 0 ? cp : cp.slice().reverse(), w, 0.03), M.vcMetal, { p: [0, b.bumperY, z], c: CHROME });
      for (const s of [1, -1]) {
        S.add(rbox(0.1, 0.145, 0.32, 0.05), M.vcMetal, { p: [s * (w / 2 - 0.04), b.bumperY, z - dir * 0.12], r: [0, s * dir * 0.35, 0], c: CHROME });
        S.add(rbox(0.075, 0.27, 0.11, 0.035), M.vcMetal, { p: [s * 0.36, b.bumperY + 0.05, z + dir * 0.1], c: CHROME });
        S.add(box(0.05, 0.07, 0.3), M.vcRough, { p: [s * 0.46, b.bumperY - 0.02, z - dir * 0.14], c: DARK });
      }
      return;
    }
    const prof = [[0, -0.085], [0.05 * dir, -0.095], [0.085 * dir, -0.055], [0.09 * dir, 0], [0.085 * dir, 0.055], [0.05 * dir, 0.095], [0, 0.085]];
    const bm = skin ? skin.bumper : M.vcMetal, bc = skin ? 0xffffff : CHROME;
    S.add(extrudeX(dir > 0 ? prof : prof.slice().reverse(), w, 0.012), bm, { p: [0, b.bumperY, z], c: bc });
    for (const s of [1, -1]) {
      S.add(rbox(0.05, 0.19, 0.16, 0.02), bm, { p: [s * (w / 2 - 0.005), b.bumperY, z - dir * 0.03], c: bc });
      S.add(box(0.05, 0.07, 0.3), M.vcRough, { p: [s * 0.46, b.bumperY - 0.02, z - dir * 0.14], c: DARK });
      if (sedan) S.add(rbox(0.07, 0.13, 0.05, 0.015), M.vc, { p: [s * 0.3, b.bumperY, z + dir * 0.085], c: BLACK });
    }
    if (sedan) S.add(box(w - 0.06, 0.035, 0.012), M.vc, { p: [0, b.bumperY, z + dir * 0.092], c: BLACK });
  };
  bumper(zN + 0.035, 1, classic ? nhw * 2 + 0.2 : sedan ? hw * 2 + 0.06 : nhw * 2 + 0.1);
  S.add(decal(0.3, 0.15, 0, 0, 192, 96), M.decal, { p: [0, b.bumperY - (sedan ? 0 : 0.005), zN + 0.132] });
  if (!classic) S.add(box(hw * 2 - 0.4, 0.14, 0.02), M.vcRough, { p: [0, b.bumperY - 0.2, zN - 0.08], c: DARK });       // valance

  // Chrome side spear (front fender, then on the door so it swings with it) and sill trim under the side glass
  if (classic) {
    const strip = (batch, z0, z1, y, dx, r, side) => {
      const pts = [];
      for (let k = 0; k <= 8; k++) { const z = lerp(z0, z1, k / 8); pts.push([side * (grid.hwAt(z) + dx), y, z]); }
      batch.add(tube(pts, r, 16, 6), M.vcMetal, { c: CHROME });
    };
    const sy = b.creaseY + 0.05, zs0 = b.zNose - 0.45, zd = b.zDoorFront - 0.012, zr = b.zDoorRear + 0.02;
    for (const side of [1, -1]) {
      const D = side > 0 ? DB.L : DB.R;
      strip(S, zs0, zd, sy, 0.006, 0.011, side);
      strip(D, zd - 0.012, zr + 0.15, sy, 0.006, 0.011, side);
      strip(D, b.zDoorFront - 0.03, b.zDoorRear + 0.03, belt + 0.012, -0.045, 0.008, side);
      strip(S, b.zDoorRear - 0.05, b.zDoor2Rear + 0.05, belt + 0.012, -0.045, 0.008, side);
    }
  }

  // ── Rear end ──
  const zT = b.zTail, rearB = RB;
  bumper(zT - 0.045, -1, classic ? grid.hwAt(zT) * 2 + 0.2 : hw * 2 + 0.04);
  S.add(decal(0.3, 0.15, 0, 0, 192, 96), M.decal, { p: [0, b.bumperY, zT - 0.142], r: [0, Math.PI, 0] });
  let rearOrigin, cargoBox;
  if (!sedan) {
    const iB0 = at.B0, iB2 = at.B2, wallX = P[iB2][8][0], top = belt + 0.015, fl = b.bedFloorY;
    for (const s of [1, -1]) {
      S.add(capXY(ringOutline(grid, iB2, 0, 8, s), zT, -1), paintR);
      S.add(capXY(ringOutline(grid, iB0, 0, 8, s), b.zBedFront, 1), paintR);
      S.add(rbox(0.085, 0.27, 0.03, 0.01), lamps.tail, { p: [s * (wallX + 0.062), belt - 0.2, zT - 0.008] });
      S.add(rbox(0.085, 0.07, 0.03, 0.01), M.vc, { p: [s * (wallX + 0.062), belt - 0.39, zT - 0.008], c: 0xd9d6cc });
      S.add(box(0.3, 0.3, 0.012), M.vc, { p: [s * (hw - 0.2), 0.47, def.axleR - b.archR - 0.1], c: BLACK });      // mud flap
    }
    // Bed front wall (faces the bed) and its back
    const wall = stationOutline(grid, iB0, 8, 15);
    S.add(capXY(wall, b.zBedFront + 0.002, -1), M.vcRough, { c: BEDC });
    // Cab back panel with the rear window opening
    const wy = lerp(belt, b.roofY, 0.47);
    S.add(capXY(stationOutline(grid, at.Sc), b.zCabBack, -1, [roundedRect(0, wy, 1.22, 0.36, 0.07)]), paintF);
    S.add(new THREE.PlaneGeometry(1.26, 0.4), M.glassSide, { p: [0, wy, b.zCabBack + 0.004] });
    S.add(seamStrip(roundedRect(0, wy, 1.24, 0.38, 0.075).concat([roundedRect(0, wy, 1.24, 0.38, 0.075)[0]]).map(([x, y]) => [x, y, b.zCabBack]), Array(22).fill([0, 0, -1]), 0.03), M.vc, { c: 0x0b0b0b });
    // Bed floor ribs
    for (let i = -3; i <= 3; i++) S.add(box(0.05, 0.008, zT - b.zBedFront + 0.1), M.vcRough, { p: [i * 0.2, fl + 0.004, (zT + b.zBedFront) / 2], c: mixc(BEDC, 0x000000, 0.2) });
    // Tailgate (hinged at the bed floor)
    const tw = wallX * 2 - 0.012, th = top - fl;
    rearOrigin = [0, fl, zT + 0.03];
    rearB.add(rbox(tw, th, 0.055, 0.014), skin ? M.vcRough : paint, { p: [0, fl + th / 2, zT + 0.03], c: 0x4a3027 });
    rearB.add(rbox(tw - 0.16, th - 0.14, 0.02, 0.008, 1), M.vcRough, { p: [0, fl + th / 2, zT + 0.058], c: BEDC });
    rearB.add(rbox(0.16, 0.035, 0.03, 0.01), M.vcMetal, { p: [0, top - 0.09, zT - 0.006], c: CHROME });
    if (skin) rearB.add(new THREE.PlaneGeometry(tw - 0.01, th - 0.01), skin.tailgate, { p: [0, fl + th / 2, zT + 0.0015], r: [0, Math.PI, 0] });
    else rearB.add(decal(1.3, 0.165, 0, 112, 512, 64), M.decal, { p: [0, fl + th * 0.42, zT + 0.0015], r: [0, Math.PI, 0] });
    if (skin) {
      // Bed-side trim: two chrome spears around a black stripe, nose of the bed to the tail lamps
      const z0 = b.zBedFront - 0.04, z1 = zT + 0.25, ty = b.creaseY - 0.005;    // between the arch and the fuel filler
      for (const s of [1, -1]) for (const [dy, h, c, m] of [[0.035, 0.016, CHROME, M.vcMetal], [0, 0.05, BLACK, M.vc], [-0.035, 0.016, CHROME, M.vcMetal]]) {
        S.add(rbox(0.012, h, z0 - z1, 0.005, 1), m, { p: [s * (hw + 0.002), ty + dy, (z0 + z1) / 2], c });
      }
    }
    // The whole bed opening up to a hand's width above the rails, so aiming over a bed wall finds it (a soft target:
    // anything secured inside it still wins the raycast, see targets.js)
    const cx = hw - 0.05, cz0 = zT + 0.04, cz1 = b.zBedFront - 0.01, cy1 = top + 0.3;
    cargoBox = [cx * 2, cy1 - fl, cz1 - cz0, 0, (cy1 + fl) / 2, (cz0 + cz1) / 2];
  } else {
    const zR = P[at.D2][0][2], tailY = b.deckY - (b.deckDrop || 0);
    S.add(capXY(stationOutline(grid, at.D2), zR, -1), paint);
    if (classic) {
      // Round tail lamps in chrome bezels low on the rear fenders
      const tx = grid.hwAt(zR) - 0.2, ty = tailY - 0.17;
      for (const s of [1, -1]) {
        S.add(cyl(0.085, 0.085, 0.07, 20, "z"), M.vcMetal, { p: [s * tx, ty, zR + 0.01], c: CHROME });
        S.add(sphere(0.072, 18, 10), lamps.tail, { p: [s * tx, ty, zR - 0.025], s: [1, 1, 0.4] });
        S.add(torus(0.078, 0.011, 20, 6, "z"), M.vcMetal, { p: [s * tx, ty, zR - 0.03], c: CHROME });
      }
    } else for (const s of [1, -1]) {
      S.add(rbox(0.36, 0.12, 0.03, 0.012), lamps.tail, { p: [s * (hw - 0.26), b.deckY - 0.14, zR - 0.01] });
      S.add(rbox(0.1, 0.12, 0.03, 0.012), M.vc, { p: [s * (hw - 0.5), b.deckY - 0.14, zR - 0.01], c: 0xd9d6cc });
      S.add(rbox(0.5, 0.14, 0.012, 0.006, 1), M.vcMetal, { p: [s * (hw - 0.3), b.deckY - 0.14, zR - 0.002], c: 0x8a8a86 });
    }
    if (!classic) S.add(decal(0.34, 0.085, 200, 0, 192, 48), M.decal, { p: [-0.4, b.deckY - 0.03, zR - 0.004], r: [0, Math.PI, 0] });
    // Trunk tub: floor, walls and the bulkhead behind the rear seat
    const tf = b.cargo.y0 - 0.02, tz0 = zR + 0.03, tz1 = b.zDeckFront + 0.1, tx = hw - 0.14;
    S.add(box(tx * 2, 0.02, tz1 - tz0), M.vcRough, { p: [0, tf, (tz0 + tz1) / 2], c: 0x2c2a27 });
    S.add(box(tx * 2, b.deckY - tf, 0.02), M.vcRough, { p: [0, (b.deckY + tf) / 2, tz1], c: 0x2c2a27 });
    for (const s of [1, -1]) S.add(box(0.02, tailY - tf - 0.03, tz1 - tz0), M.vcRough, { p: [s * tx, (tailY + tf) / 2 - 0.015, (tz0 + tz1) / 2], c: 0x2c2a27 });
    rearOrigin = [0, b.deckY + 0.02, b.zDeckFront - 0.075];
    rearB.add(rbox(0.1, 0.02, 0.02, 0.006, 1), M.vcMetal, { p: [0, tailY - 0.005, zR + 0.0], c: CHROME });
    cargoBox = [b.cargo.x1 - b.cargo.x0, b.deckY - tf - 0.06, b.cargo.z1 - b.cargo.z0, (b.cargo.x0 + b.cargo.x1) / 2, (b.deckY + tf) / 2 - 0.02, (b.cargo.z0 + b.cargo.z1) / 2];
  }

  // ── Underside, wheel wells, running gear ──
  const fy = b.floorY, len = def.zFront - def.zRear;
  S.add(box(hw * 2 - 0.16, 0.04, b.zCowl - b.zCabBack + 0.25), M.vcRough, { p: [0, fy - 0.02, (b.zCowl + b.zCabBack) / 2 + 0.1], c: 0x1b1917 });
  S.add(box(hw * 2 - 0.16, b.hoodYRear - fy + 0.08, 0.03), M.vcRough, { p: [0, (b.hoodYRear + fy) / 2 - 0.04, b.zCowl - 0.015], c: 0x2a2725 });   // firewall
  const railY = b.rockerY + 0.01;
  for (const s of [1, -1]) {
    S.add(box(0.07, 0.11, len - 0.5), M.vcRough, { p: [s * (sedan ? 0.5 : 0.44), railY, 0], c: 0x171412 });
    for (const [az, front] of [[def.axleF, true], [def.axleR, false]]) {
      const lw = sedan ? 0.3 : 0.36, R = b.archR - 0.012;
      S.add(halfTube(R, lw), M.vcRough, { p: [s * (hw - 0.03 - lw / 2), def.wheelR + 0.02, az], c: 0x151312 });
      S.add(halfDisc(R, -s), M.vcRough, { p: [s * (hw - 0.03 - lw), def.wheelR + 0.02, az], c: 0x151312 });
      if (front) {
        S.add(box(0.34, 0.035, 0.14), M.vcRough, { p: [s * (def.track / 2 - 0.2), def.wheelR - 0.09, az], c: 0x1a1715 });
        S.add(cyl(0.05, 0.05, 0.26, 8), M.vcRough, { p: [s * (def.track / 2 - 0.22), def.wheelR + 0.06, az], c: 0x2a2522 });
      } else {
        S.add(box(0.06, 0.03, 1.15), M.vcRough, { p: [s * (def.track / 2 - 0.2), def.wheelR + 0.07, az], c: 0x1a1715 });
      }
    }
  }
  for (const z of [def.axleF, 0.3, def.axleR + 0.7, def.zRear + 0.35]) S.add(box(sedan ? 1.0 : 0.9, 0.09, 0.1), M.vcRough, { p: [0, railY - 0.01, z], c: 0x171412 });
  const tY = b.engineY - 0.2;
  S.add(cyl(0.13, 0.085, b.engineZ - 0.45 - 0.2, 12, "z"), M.vcRough, { p: [0, tY, (b.engineZ - 0.45 + 0.2) / 2], c: 0x5d5e5c });                    // transmission
  S.add(cyl(0.035, 0.035, 0.2 - (def.axleR + 0.16), 8, "z"), M.vcRough, { p: [0, lerp(tY, def.wheelR, 0.6), (0.2 + def.axleR + 0.16) / 2], r: [(tY - def.wheelR) * 0.25, 0, 0], c: 0x2a2623 });
  const ex = -(sedan ? 0.3 : 0.3), ey = railY - 0.04;
  S.add(tube([[ex, b.engineY - 0.3, b.engineZ - 0.5], [ex - 0.02, ey, 0.5], [ex - 0.02, ey, -0.25]], 0.028, 14, 6), M.vcRough, { c: RUSTY });
  S.add(cyl(0.085, 0.085, 0.5, 10, "z"), M.vcRough, { p: [ex - 0.02, ey, -0.5], s: [1.3, 0.8, 1], c: RUSTY });
  S.add(tube([[ex - 0.02, ey, -0.75], [ex - 0.08, ey + 0.05, def.axleR + 0.45], [ex - 0.1, def.wheelR + 0.17, def.axleR], [ex - 0.16, ey + 0.02, def.axleR - 0.5], [ex - 0.2, ey, def.zRear + 0.1]], 0.026, 20, 6), M.vcRough, { c: RUSTY });
  S.add(rbox(sedan ? 0.8 : 0.9, 0.2, sedan ? 0.42 : 0.5, 0.04), M.vcRough, { p: [0.05, railY + (sedan ? 0.08 : 0.08), def.axleR - (sedan ? 0.62 : 0.58)], c: 0x211e1c });   // fuel tank
  // Engine bay furniture: radiator support, battery tray, engine mounts, brake booster, washer bottle
  const rz = b.radiatorZ, ry = b.radiatorY;
  S.add(box(hw * 2 - 0.3, 0.035, 0.05), M.vcRough, { p: [0, ry + 0.27, rz + 0.05], c: 0x1f1c1a });
  S.add(box(hw * 2 - 0.3, 0.05, 0.08), M.vcRough, { p: [0, ry - 0.27, rz], c: 0x1f1c1a });
  for (const s of [1, -1]) S.add(box(0.04, 0.56, 0.05), M.vcRough, { p: [s * 0.37, ry, rz + 0.05], c: 0x1f1c1a });
  const bp = b.batteryPos;
  S.add(box(0.24, 0.015, 0.32), M.vcRough, { p: [bp[0], bp[1] - 0.118, bp[2]], c: 0x1a1816 });
  S.add(box(0.03, bp[1] - 0.12 - railY, 0.03), M.vcRough, { p: [bp[0] - 0.08, (bp[1] - 0.12 + railY) / 2, bp[2]], c: 0x1a1816 });
  for (const s of [1, -1]) S.add(box(0.14, 0.05, 0.1), M.vcRough, { p: [s * 0.27, b.engineY - 0.2, b.engineZ + 0.1], c: 0x1a1715 });
  S.add(cyl(0.11, 0.11, 0.1, 14, "z"), M.vcRough, { p: [b.seatX, b.hoodYRear - 0.16, b.zCowl + 0.07], c: 0x18181a });
  S.add(rbox(0.07, 0.06, 0.14, 0.012), M.vcMetal, { p: [b.seatX, b.hoodYRear - 0.14, b.zCowl + 0.19], c: STEEL });
  S.add(rbox(0.16, 0.16, 0.1, 0.02), M.vc, { p: [-(hw - 0.3), b.hoodYRear - 0.17, b.zCowl + 0.08], c: 0xc9c6b5 });
  S.add(cyl(0.02, 0.02, 0.012, 8), M.vc, { p: [-(hw - 0.3), b.hoodYRear - 0.085, b.zCowl + 0.08], c: 0x2a4a7a });
  // Wipers, antenna, fuel cap bezel
  for (const s of [1, -1]) {
    const wx = s * 0.36 + 0.08;
    S.add(box(0.44, 0.012, 0.014), M.vc, { p: [wx, b.hoodYRear + 0.058, b.zCowl + 0.012], r: [0, 0.05, 0.03], c: BLACK });
    S.add(cyl(0.012, 0.012, 0.02, 6), M.vc, { p: [wx + 0.2, b.hoodYRear + 0.045, b.zCowl + 0.03], c: BLACK });
  }
  S.add(cyl(0.003, 0.002, 0.75, 5), M.vcMetal, { p: [-(hw - 0.09), b.hoodYRear + 0.39, b.zCowl + 0.2], r: [-0.12, 0, 0], c: CHROME });
  S.add(cyl(0.012, 0.012, 0.03, 6), M.vc, { p: [-(hw - 0.09), b.hoodYRear + 0.025, b.zCowl + 0.245], c: BLACK });

  // ── Hood furniture ──
  const hoodOrigin = [0, b.hoodYRear + 0.02, b.zHoodRear];
  for (const s of [1, -1]) HB.add(box(0.03, 0.02, b.zNose - b.zHoodRear - 0.2), M.vcRough, { p: [s * 0.3, lerp(b.hoodYFront, b.hoodYRear, 0.55) - 0.02, (b.zNose + b.zHoodRear) / 2], r: [(b.hoodYFront - b.hoodYRear) / (b.zNose - b.zHoodRear) * -1, s * 0.25, 0], c: 0x1f1c1a });
  if (classic) {
    // Chrome bullet ornament at the front of the hood and a spear down its centre
    const hy = b.hoodYFront + 0.024 + (b.hoodCrown ?? 0.035);
    HB.add(sphere(0.03, 14, 10), M.vcMetal, { p: [0, hy + 0.02, b.zNose - 0.12], s: [0.7, 0.8, 3], c: CHROME });
    HB.add(rbox(0.016, 0.012, 0.6, 0.005, 1), M.vcMetal, { p: [0, hy + 0.008, b.zNose - 0.48], r: [-(b.hoodYFront - b.hoodYRear) / (b.zNose - b.zHoodRear), 0, 0], c: CHROME });
  } else if (!sedan) HB.add(rbox(0.5, 0.012, 0.03, 0.004, 1), M.vcMetal, { p: [0, b.hoodYFront + 0.023 + (b.hoodCrown ?? 0.035), b.zNose - 0.05], c: CHROME });
  else HB.add(rbox(0.03, 0.05, 0.03, 0.008, 1), M.vcMetal, { p: [0, b.hoodYFront + 0.07, b.zNose - 0.06], c: CHROME });

  // ── Interior ──
  const interior = buildInterior(S, def, lamps);
  for (const o of interior.own) root.add(o);

  // ── Assemble ──
  S.build(root, { name: "body" });
  const mkPivot = (batch, origin, name) => {
    const g = new THREE.Group(); g.name = name; g.position.set(...origin);
    batch.build(g, { origin, name });
    root.add(g);
    return g;
  };
  const doorL = mkPivot(DB.L, [hw - 0.03, 0, b.zDoorFront], "door:driver");
  const doorR = mkPivot(DB.R, [-(hw - 0.03), 0, b.zDoorFront], "door:passenger");
  const hoodG = mkPivot(HB, hoodOrigin, "hood");
  const rearG = mkPivot(rearB, rearOrigin, def.rearDoor);

  // Fuel filler, cargo floor proxy
  const fuelCap = new THREE.Group(); fuelCap.name = "fuelCap"; fuelCap.position.set(...b.fuelCap);
  const fb = new Batch();
  fb.add(cyl(0.05, 0.05, 0.012, 14, "x"), M.vcMetal, { c: 0x9a9a96 });
  fb.add(cyl(0.035, 0.03, 0.03, 12, "x"), M.vcMetal, { p: [0.012, 0, 0], c: CHROME });
  fb.add(box(0.01, 0.012, 0.06), M.vcMetal, { p: [0.03, 0, 0], c: CHROME });
  fb.build(fuelCap);
  fuelCap.add(new THREE.Mesh(box(0.08, 0.16, 0.16), M.proxy));
  root.add(fuelCap);
  const cargo = new THREE.Mesh(box(cargoBox[0], cargoBox[1], cargoBox[2]), M.proxy);
  cargo.position.set(cargoBox[3], cargoBox[4], cargoBox[5]); cargo.name = "cargo";
  root.add(cargo);

  // Component bays
  const bay = (name, pos, size) => {
    const g = new THREE.Group(); g.name = "bay:" + name; g.position.set(...pos);
    const proxy = new THREE.Mesh(box(...size), M.proxy); proxy.name = "proxy";
    g.add(proxy); root.add(g);
    return { g, proxy, part: null };
  };
  const bays = {
    engine: bay("engine", [0, b.engineY, b.engineZ], [0.6, 0.6, 0.85]),
    battery: bay("battery", bp, [0.2, 0.22, 0.3]),
    radiator: bay("radiator", [0, ry, rz], [0.66, 0.5, 0.1]),
  };
  const stable = (name) => { const g = new THREE.Group(); g.name = name; root.add(g); return g; };
  const oilCap = stable("oilCap"), dipstick = stable("dipstick"), radCap = stable("radCap");
  oilCap.position.copy(bays.engine.g.position); dipstick.position.copy(bays.engine.g.position); radCap.position.copy(bays.radiator.g.position);

  // Wheels: hub (suspension) → steer → squash → spin → wheel / drum
  const hubs = def.wheels.map((w, i) => {
    const hub = new THREE.Group(); hub.name = "hub" + i; hub.position.set(w.x, def.wheelR, w.z);
    const steer = new THREE.Group(), squash = new THREE.Group(), spin = new THREE.Group(), holder = new THREE.Group();
    holder.rotation.z = w.x > 0 ? -Math.PI / 2 : Math.PI / 2;
    const drum = drumMesh(def.wheelR); holder.add(drum);
    spin.add(holder); squash.add(spin); steer.add(squash); hub.add(steer); root.add(hub);
    return { hub, steer, squash, spin, holder, wheel: null, wheelId: null };
  });
  // Rear axle follows the rear wheels
  const axle = new THREE.Group(); axle.position.set(0, def.wheelR, def.axleR);
  const ab = new Batch();
  ab.add(cyl(0.04, 0.04, def.track - 0.12, 8, "x"), M.vcRough, { c: 0x1d1a18 });
  ab.add(sphere(0.13, 10, 8), M.vcRough, { s: [1, 1, 1.1], c: 0x221e1b });
  ab.build(axle); root.add(axle);

  // ── Crash damage (Vehicle.addDent): skin vertices near a dent are pushed in with a crumpled, faceted finish and the
  // paint scraped toward bare metal; a heavy front hit or a crushed roof cracks the windscreen. Wheels, axle and the engine-bay
  // parts are left alone. Undamaged positions are kept per geometry so a repair can rebuild from them.
  const keepOut = new Set([...hubs.map((h) => h.hub), axle, bays.engine.g, bays.battery.g, bays.radiator.g, fuelCap, cargo]);
  const painted = new Set([paint, paintF, paintR]);
  const skinMeshes = () => {
    const out = [];
    const walk = (o) => { if (keepOut.has(o)) return; if (o.isMesh && o.material !== M.proxy) out.push(o); for (const c of o.children) walk(c); };
    walk(root);
    return out;
  };
  let quiet = true;                                       // rebuilding saved dents makes no noise
  const dent = (dn) => {
    vehicle.mesh.updateMatrixWorld(true);
    _inv.copy(vehicle.mesh.matrixWorld).invert();
    for (const mesh of skinMeshes()) dentMesh(mesh, _m4.multiplyMatrices(_inv, mesh.matrixWorld), dn, painted.has(mesh.material));
    if ((dn.depth > 0.14 && dn.p[2] > b.zCowl - 0.35) || (dn.depth > 0.1 && dn.n[1] < -0.5)) {    // heavy front hit or roof crush
      let broke = false;
      root.traverse((o) => { if (o.isMesh && o.material === M.glassFront) { o.material = crackedGlass(); broke = true; } });
      if (broke && quiet === false) sfx("glass_crack", { pos: vehicle.localToWorld(0, b.beltY - def.comH + 0.2, b.zCowl - 0.2) });
    }
  };
  const resetDents = () => {
    for (const mesh of skinMeshes()) {
      const g = mesh.geometry, o = g.userData.undamaged;
      if (!o) continue;
      g.attributes.position.array.set(o.p); g.attributes.normal.array.set(o.n); if (o.c) g.attributes.color.array.set(o.c);
      for (const k of ["position", "normal", "color"]) if (g.attributes[k]) g.attributes[k].needsUpdate = true;
      g.computeBoundingSphere();
      if (mesh.material === crackedGlass()) mesh.material = M.glassFront;
    }
    for (const dn of vehicle.dents) dent(dn);
  };
  const bursts = [];

  const rig = {
    root, parts: { doors: { driver: doorL, passenger: doorR, hood: hoodG, [def.rearDoor]: rearG }, fuelCap, oilCap, dipstick, radCap, hubs: hubs.map((h) => h.hub), bays: { engine: bays.engine.g, battery: bays.battery.g, radiator: bays.radiator.g }, cargo },
    lampPos, lamps, needles: interior.needles, _n: { speed: 0, rpm: 0, fuel: 0, temp: 0 }, lit: false,

    slotsChanged() {
      for (const k of ["engine", "battery", "radiator"]) {
        const bayK = bays[k], item = vehicle.slots[k];
        const id = item ? item.id + ":" + item.type : null;
        if (bayK.id === id) continue;
        bayK.id = id;
        const stables = k === "engine" ? [oilCap, dipstick] : k === "radiator" ? [radCap] : [];
        for (const s of stables) { for (const c of [...s.children]) { s.remove(c); disposeTree(c); } }
        if (bayK.part) { bayK.g.remove(bayK.part); disposeTree(bayK.part); bayK.part = null; }
        bayK.proxy.visible = !item;
        if (item) {
          bayK.part = makePartMesh(item.type, item);
          bayK.g.add(bayK.part);
          for (const s of stables) { const c = bayK.part.getObjectByName(s.name); if (c) s.add(c); }
        }
      }
      hubs.forEach((h, i) => {
        const item = vehicle.slots[WHEEL_SLOTS[i]], id = item ? item.id + ":" + item.type : null;
        if (h.wheelId === id) return;
        h.wheelId = id;
        if (h.wheel) { h.holder.remove(h.wheel); disposeTree(h.wheel); h.wheel = null; }
        if (item) { h.wheel = makePartMesh(item.type, item); h.holder.add(h.wheel); }
      });
    },

    update(dt, env) {
      const d = def, v = vehicle;
      // Crash damage and sparks
      if (v.dentsReset) { v.dentsReset = false; v.dentQ.length = 0; resetDents(); }
      while (v.dentQ.length) {
        const dn = v.dentQ.shift(), at = v.localToWorld(dn.p[0], dn.p[1], dn.p[2]);
        if (dn.depth > 0) {
          quiet = false; dent(dn); quiet = true;
          sfx("metal_crunch", { pos: at, vol: Math.min(1, 0.3 + dn.depth * 4) });
          if (dn.depth > 0.06) sfx("debris", { pos: at, vol: Math.min(1, dn.depth * 5) });
        } else if (dn.sparks > 0) sfx("metal_scrape", { pos: at, vol: Math.min(1, 0.35 + dn.sparks * 0.65) });
        if (dn.sparks > 0 && vehicle.mesh.parent) bursts.push(sparkBurst(vehicle, dn));
      }
      for (let i = bursts.length - 1; i >= 0; i--) if (!bursts[i].step(dt)) bursts.splice(i, 1);
      // Wheels and suspension
      for (let i = 0; i < 4; i++) {
        const h = hubs[i], w = v.wheels[i], item = v.slots[WHEEL_SLOTS[i]];
        h.hub.position.y = d.wheelR - d.sag[i] + clamp(w.comp, 0, d.susp.travel + 0.04);
        h.steer.rotation.y = w.front ? v.steer : 0;
        h.spin.rotation.x = w.spin;
        const flat = item && item.flat;
        h.squash.scale.y = flat ? 0.86 : 1;
      }
      const yl = hubs[2].hub.position.y, yr = hubs[3].hub.position.y;
      axle.position.y = (yl + yr) / 2; axle.rotation.z = Math.atan2(yl - yr, d.track);
      // Hinged panels
      const D = v.doors, H = d.doorHinge, ease = (t) => t * t * (3 - 2 * t);
      doorL.rotation.y = -ease(D.driver) * H.driver.open;
      doorR.rotation.y = ease(D.passenger) * H.passenger.open;
      hoodG.rotation.x = -ease(D.hood) * H.hood.open;
      rearG.rotation.x = (sedan ? 1 : -1) * ease(D[d.rearDoor]) * H[d.rearDoor].open;
      if (sedan) cargo.visible = D.trunk > 0.6;
      // Steering wheel
      interior.wheelSpin.rotation.z = -(v.steer / d.steerLock) * 4.2;
      // Instruments (electrical gauges fall to rest with the ignition off)
      const on = v.ign !== "off", n = rig._n, kq = Math.min(1, dt * 7);
      n.speed += (Math.abs(v.speed) * 3.6 - n.speed) * Math.min(1, dt * 10);
      n.rpm += (v.rpm - n.rpm) * Math.min(1, dt * 14);
      n.fuel += ((on ? v.fuel / d.tank : 0) - n.fuel) * kq * 0.4;
      n.temp += ((on ? clamp((v.temp - 50) / 80, 0, 1) : 0) - n.temp) * kq * 0.4;
      const N = interior.needles, ang = (g, f) => -(g.a0 + (g.a1 - g.a0) * clamp(f, 0, 1.03));
      N.speed.rotation.z = ang(GAUGE.speedo, n.speed / GAUGE.speedo.max);
      N.rpm.rotation.z = ang(GAUGE.tach, n.rpm / GAUGE.tach.max);
      N.fuel.rotation.z = ang(GAUGE.fuel, n.fuel);
      N.temp.rotation.z = ang(GAUGE.temp, n.temp);
      const power = on && (v.ign === "running" || batteryCharge(v) > 1);
      lamps.lampOil.emissiveIntensity = power && (v.ign !== "running" || v.oilPressure < 0.25) ? 3 : 0;
      lamps.lampBat.emissiveIntensity = power && !v.charging ? 3 : 0;
      lamps.lampTemp.emissiveIntensity = power && v.temp > 110 ? 3 : 0;
      // Lamps
      const lit = v.lights && (v.ign === "running" || batteryCharge(v) > 0.5);
      rig.lit = lit;
      lamps.gauges.emissiveIntensity = lit ? 0.5 : 0;
      lamps.head.emissiveIntensity = lit ? 3.2 : 0;
      lamps.amber.emissiveIntensity = lit ? 0.9 : 0;
      lamps.tail.emissiveIntensity = (lit ? 0.7 : 0) + (v.brake > 0.1 && power ? 2.6 : 0);
    },

    stats() {
      let tris = 0, meshes = 0;
      vehicle.mesh.traverse((o) => { if (o.isMesh && o.material !== M.proxy && o.visible) { meshes++; tris += o.geometry.attributes.position.count / 3; } });
      return { tris: Math.round(tris), meshes };
    },

    dispose() {
      vehicle.mesh.remove(root);
      disposeTree(root);
      for (const m of Object.values(lamps)) m.dispose();
      for (const bu of bursts) bu.dispose();
      bursts.length = 0;
    },
  };
  rig.slotsChanged();
  vehicle.dentQ.length = 0; vehicle.dentsReset = false;
  for (const dn of vehicle.dents) dent(dn);
  return rig;
}

// ── Crash damage helpers ──
const _m4 = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _mi = new THREE.Matrix4(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _c = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _n3 = new THREE.Matrix3();
// Smooth 0..1 noise (continuous, so split edges stay closed when pushed)
const crumple = (x, y, z) => 0.5 + 0.25 * Math.sin(x * 9.1 + z * 6.3 + y * 2.1) * Math.sin(y * 11.7 - z * 4.1) + 0.25 * Math.sin(x * 17.3 - y * 5.9 + z * 13.1);
const MAX_LEVEL = 4;

// Split the triangles near dent dn (in mesh space: P, radius R) until no edge is longer than MAX_EDGE, so a flat panel
// built from a few big triangles can crumple. Every attribute, and the undamaged copy, is interpolated alike.
function densify(g, toLocal, dn) {
  const pos = g.attributes.position, A = pos.array, und = g.userData.undamaged;
  const near = new Uint8Array(pos.count / 3);
  let count = 0;
  const P = dn.p, N = dn.n, R = dn.r + 0.1, MAX_EDGE = Math.min(0.16, Math.max(0.1, dn.r / 5));
  const Nm = g.attributes.normal.array;
  const seg = (ax, ay, az, bx, by, bz) => {               // distance from the dent centre to a segment (vehicle-local)
    const ex = bx - ax, ey = by - ay, ez = bz - az, l2 = ex * ex + ey * ey + ez * ez;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((P[0] - ax) * ex + (P[1] - ay) * ey + (P[2] - az) * ez) / l2)) : 0;
    return Math.hypot(ax + ex * t - P[0], ay + ey * t - P[1], az + ez * t - P[2]);
  };
  const L = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let t = 0; t < near.length; t++) {
    for (let j = 0; j < 3; j++) L[j].fromArray(A, (t * 3 + j) * 3).applyMatrix4(toLocal);
    const long = Math.max(L[0].distanceTo(L[1]), L[1].distanceTo(L[2]), L[2].distanceTo(L[0]));
    if (long <= MAX_EDGE) continue;
    // Only skin facing the blow: interior trim and panels turned away from it stay coarse
    _b.fromArray(Nm, t * 9).applyMatrix3(_n3.setFromMatrix4(toLocal)).normalize();
    if (_b.x * N[0] + _b.y * N[1] + _b.z * N[2] > -0.25) continue;
    const cx = (L[0].x + L[1].x + L[2].x) / 3 - P[0], cy = (L[0].y + L[1].y + L[2].y) / 3 - P[1], cz = (L[0].z + L[1].z + L[2].z) / 3 - P[2];
    if (cx * N[0] + cy * N[1] + cz * N[2] > 0.25) continue;              // deep inside: interior, not skin
    const d = Math.min(seg(L[0].x, L[0].y, L[0].z, L[1].x, L[1].y, L[1].z), seg(L[1].x, L[1].y, L[1].z, L[2].x, L[2].y, L[2].z), seg(L[2].x, L[2].y, L[2].z, L[0].x, L[0].y, L[0].z));
    if (d < R) { near[t] = 1; count++; }
  }
  if (!count) return;
  // Parallel float arrays: [array, itemSize, normalise after lerp]
  const chans = [[A, 3, false], [g.attributes.normal.array, 3, true], [g.attributes.uv.array, 2, false]];
  if (g.attributes.color) chans.push([g.attributes.color.array, 3, false]);
  chans.push([und.p, 3, false], [und.n, 3, true]);
  if (und.c) chans.push([und.c, 3, false]);
  const outs = chans.map(() => []);
  const vert = (ci, i) => { const [arr, k] = chans[ci]; return Array.from(arr.subarray(i * k, i * k + k)); };
  const mid = (ci, a, b) => { const m = a.map((x, k) => (x + b[k]) / 2); if (chans[ci][2]) { const l = Math.hypot(...m) || 1; return m.map((x) => x / l); } return m; };
  const emit = (tri) => { for (let ci = 0; ci < chans.length; ci++) for (const v of tri[ci]) outs[ci].push(...v); };
  const split = (tri, lvl) => {                          // tri[ci] = [v0, v1, v2]
    const p = tri[0];
    const e = Math.max(Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1], p[0][2] - p[1][2]), Math.hypot(p[1][0] - p[2][0], p[1][1] - p[2][1], p[1][2] - p[2][2]), Math.hypot(p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]));
    if (lvl >= MAX_LEVEL || e * toLocalScale(toLocal) <= MAX_EDGE) { emit(tri); return; }
    const m = tri.map((v, ci) => [mid(ci, v[0], v[1]), mid(ci, v[1], v[2]), mid(ci, v[2], v[0])]);
    const sub = (f) => tri.map((v, ci) => f(v, m[ci]));
    split(sub((v, q) => [v[0], q[0], q[2]]), lvl + 1); split(sub((v, q) => [q[0], v[1], q[1]]), lvl + 1);
    split(sub((v, q) => [q[2], q[1], v[2]]), lvl + 1); split(sub((v, q) => [q[0], q[1], q[2]]), lvl + 1);
  };
  for (let t = 0; t < near.length; t++) {
    const tri = chans.map((_, ci) => [vert(ci, t * 3), vert(ci, t * 3 + 1), vert(ci, t * 3 + 2)]);
    if (near[t]) split(tri, 0); else emit(tri);
  }
  const names = ["position", "normal", "uv"];
  if (g.attributes.color) names.push("color");
  names.forEach((nm, ci) => g.setAttribute(nm, new THREE.BufferAttribute(new Float32Array(outs[ci]), chans[ci][1])));
  let ci = names.length;
  und.p = new Float32Array(outs[ci++]); und.n = new Float32Array(outs[ci++]); if (und.c) und.c = new Float32Array(outs[ci++]);
}
const toLocalScale = (m) => Math.hypot(m.elements[0], m.elements[1], m.elements[2]);
const BARE = new THREE.Color(0x6b625a);           // scraped paint: grey primer and bare steel

// Push one mesh's vertices near dent dn inward. toLocal: mesh space → vehicle-local.
function dentMesh(mesh, toLocal, dn, scrape) {
  const g = mesh.geometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  _a.copy(g.boundingSphere.center).applyMatrix4(toLocal);
  const P = dn.p, N = dn.n, r = dn.r, r2 = r * r;
  if (Math.hypot(_a.x - P[0], _a.y - P[1], _a.z - P[2]) - g.boundingSphere.radius > r + 0.4) return;
  const pos = g.attributes.position, nor = g.attributes.normal, col = g.attributes.color, A = pos.array;
  if (!g.userData.undamaged) g.userData.undamaged = { p: A.slice(), n: nor.array.slice(), c: col ? col.array.slice() : null };
  densify(g, toLocal, dn);
  return dentPush(mesh, toLocal, dn, scrape);
}
function dentPush(mesh, toLocal, dn, scrape) {
  const g = mesh.geometry, P = dn.p, N = dn.n, r = dn.r, r2 = r * r;
  const pos = g.attributes.position, nor = g.attributes.normal, col = g.attributes.color, A = pos.array;
  _mi.copy(toLocal).invert();
  const tris = new Uint8Array(pos.count / 3);
  let any = false;
  for (let i = 0; i < pos.count; i++) {
    _a.fromArray(A, i * 3).applyMatrix4(toLocal);
    const dx = _a.x - P[0], dy = _a.y - P[1], dz = _a.z - P[2];
    const along = dx * N[0] + dy * N[1] + dz * N[2];               // > 0: already inside the skin
    if (along > 0.4 || along < -0.25) continue;
    const lat2 = dx * dx + dy * dy + dz * dz - along * along;
    if (lat2 >= r2) continue;
    const w = (1 - lat2 / r2) ** 2, k = along < 0.12 ? 1 : 1 - (along - 0.12) / 0.28;
    const h = crumple(_a.x, _a.y, _a.z), amt = dn.depth * w * k * (0.55 + 0.9 * h);
    _a.x += N[0] * amt; _a.y += N[1] * amt - (h - 0.5) * amt * 0.4; _a.z += N[2] * amt;
    _a.applyMatrix4(_mi);
    A[i * 3] = _a.x; A[i * 3 + 1] = _a.y; A[i * 3 + 2] = _a.z;
    tris[(i / 3) | 0] = 1; any = true;
    if (scrape && col) {
      const t = Math.min(0.75, w * k * dn.depth * 7), C = col.array;
      C[i * 3] += (BARE.r - C[i * 3]) * t; C[i * 3 + 1] += (BARE.g - C[i * 3 + 1]) * t; C[i * 3 + 2] += (BARE.b - C[i * 3 + 2]) * t;
    }
  }
  if (!any) return;
  // Crumpled metal: the moved triangles shade flat
  const Nn = nor.array;
  for (let t = 0; t < tris.length; t++) {
    if (!tris[t]) continue;
    const o = t * 9;
    _a.fromArray(A, o); _b.fromArray(A, o + 3); _c.fromArray(A, o + 6);
    _e1.subVectors(_b, _a); _e2.subVectors(_c, _a); _e1.cross(_e2);
    const l = _e1.length();
    if (l < 1e-12) continue;
    _e1.multiplyScalar(1 / l);
    if (_e1.dot(_b.fromArray(Nn, o)) < 0) _e1.negate();             // keep the side the panel faced
    for (let j = 0; j < 3; j++) { Nn[o + j * 3] = _e1.x; Nn[o + j * 3 + 1] = _e1.y; Nn[o + j * 3 + 2] = _e1.z; }
  }
  pos.needsUpdate = true; nor.needsUpdate = true; if (col) col.needsUpdate = true;
  g.computeBoundingSphere();
}

// Sparks and a few paint / glass chips flying off the struck point, in world space (the vehicle's parent)
const SPARK_MAT = typeof document !== "undefined" ? new THREE.PointsMaterial({ color: 0xffb455, size: 0.07, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }) : null;
const CHIP_MAT = typeof document !== "undefined" ? new THREE.PointsMaterial({ color: 0x3a3632, size: 0.045, transparent: true, depthWrite: false }) : null;
function sparkBurst(vehicle, dn) {
  const n = Math.round(10 + 40 * dn.sparks), chips = dn.depth > 0 ? Math.round(6 + 20 * Math.min(1, dn.depth * 6)) : 0;
  const at = vehicle.localToWorld(dn.p[0], dn.p[1], dn.p[2]);
  const out = new THREE.Vector3(-dn.n[0], -dn.n[1], -dn.n[2]).applyQuaternion(vehicle.quat);   // away from the body
  const make = (count, mat, speed) => {
    const p = new Float32Array(count * 3), v = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      p[i * 3] = at.x; p[i * 3 + 1] = at.y; p[i * 3 + 2] = at.z;
      const s = speed * (0.4 + Math.random());
      v[i * 3] = vehicle.vel.x * 0.6 + (out.x + (Math.random() - 0.5) * 1.6) * s;
      v[i * 3 + 1] = (Math.abs(out.y) + 0.4 + Math.random()) * s * 0.7;
      v[i * 3 + 2] = vehicle.vel.z * 0.6 + (out.z + (Math.random() - 0.5) * 1.6) * s;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(g, mat.clone()); pts.frustumCulled = false;
    vehicle.mesh.parent.add(pts);
    return { pts, v };
  };
  const sets = [make(n, SPARK_MAT, 5)];
  if (chips) sets.push(make(chips, CHIP_MAT, 2.5));
  let t = 0;
  const LIFE = 0.7;
  return {
    step(dt) {
      t += dt;
      for (const s of sets) {
        const p = s.pts.geometry.attributes.position, a = p.array, v = s.v;
        for (let i = 0; i < a.length; i += 3) {
          v[i + 1] -= 9.8 * dt;
          a[i] += v[i] * dt; a[i + 1] += v[i + 1] * dt; a[i + 2] += v[i + 2] * dt;
        }
        p.needsUpdate = true;
        s.pts.material.opacity = Math.max(0, 1 - t / LIFE);
      }
      if (t < LIFE) return true;
      this.dispose();
      return false;
    },
    dispose() { for (const s of sets) { s.pts.parent?.remove(s.pts); s.pts.geometry.dispose(); s.pts.material.dispose(); } sets.length = 0; },
  };
}

function disposeTree(o) { o.traverse((c) => { if (c.geometry) c.geometry.dispose(); }); }

function mixc(a, c, t) {
  const ch = (s) => Math.round(((a >> s) & 255) + (((c >> s) & 255) - ((a >> s) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

// Dashboard, instruments, steering wheel, pedals, seats, mirror, visors. Static parts go into batch S; the moving bits
// (steering wheel, needles) are returned as objects to add under the model root (they are parented by `own`).
function buildInterior(S, def, lamps) {
  const b = def.body, sedan = b.style === "sedan", hw = b.hw, belt = b.beltY, fy = b.floorY;
  const INT = b.interior, DASH = b.dash, HEAD = b.headliner;
  const dz = b.dashZ, zc = b.zCowl - 0.03, sx = b.seatX;
  const dw = (hw - 0.085) * 2;
  // Dash body (padded top, face, under-tray)
  S.add(extrudeX([[zc, belt + 0.03], [dz + 0.04, belt + 0.048], [dz, belt + 0.022], [dz + 0.012, belt - 0.03], [dz + 0.04, belt - 0.2], [dz + 0.13, belt - 0.26], [zc, belt - 0.26]].reverse(), dw, 0.01), M.vc, { p: [0, 0, 0], c: DASH });
  S.add(box(dw - 0.02, 0.012, 0.04), M.vc, { p: [0, belt - 0.03, dz + 0.004], c: mixc(DASH, 0xffffff, 0.12) });
  // Instrument binnacle in front of the driver
  S.add(rbox(0.5, 0.25, 0.09, 0.03), M.vc, { p: [sx, belt - 0.085, dz + 0.012], c: mixc(DASH, 0x000000, 0.3) });
  S.add(rbox(0.52, 0.03, 0.13, 0.012), M.vc, { p: [sx, belt + 0.05, dz + 0.005], c: mixc(DASH, 0x000000, 0.2) });
  const cl = new THREE.Group();
  cl.position.set(sx, belt - 0.09, dz - 0.036); cl.rotation.set(0.14, Math.PI, 0, "YXZ");
  const GW = 0.44, GH = 0.22;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(GW, GH), lamps.gauges); cl.add(face);
  const gx = (px) => (px / GAUGE.w - 0.5) * GW, gy = (py) => (0.5 - py / GAUGE.h) * GH, gr = (r) => (r / GAUGE.w) * GW;
  const needle = (g, len) => {
    const piv = new THREE.Group(); piv.position.set(gx(g.cx), gy(g.cy), 0.004);
    const nb = new Batch();
    nb.add(box(0.0045, gr(g.r) * len, 0.002), M.vcGlow, { p: [0, gr(g.r) * len * 0.36, 0], c: 0xff5a1e });
    nb.build(piv, { shadow: false });
    const hubM = new THREE.Mesh(cyl(gr(g.r) * 0.13, gr(g.r) * 0.13, 0.004, 10, "z"), M.vc); hubM.position.z = 0.002;
    // vc material needs a colour attribute
    const n = hubM.geometry.attributes.position.count; hubM.geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(0.004), 3));
    piv.add(hubM); cl.add(piv);
    return piv;
  };
  const needles = { speed: needle(GAUGE.speedo, 0.95), rpm: needle(GAUGE.tach, 0.95), fuel: needle(GAUGE.fuel, 0.9), temp: needle(GAUGE.temp, 0.9) };
  [[226, lamps.lampOil], [256, lamps.lampBat], [286, lamps.lampTemp]].forEach(([px, mat]) => {
    const m = new THREE.Mesh(rbox(0.016, 0.009, 0.003, 0.002, 1), mat); m.position.set(gx(px), gy(141), 0.002); cl.add(m);
  });
  // Dash details: radio, heater slides, glovebox, vents
  const fz = dz + 0.006;
  S.add(rbox(0.2, 0.065, 0.02, 0.006, 1), M.vc, { p: [-0.02, belt - 0.085, fz], c: 0x0d0d0d });
  S.add(box(0.11, 0.022, 0.004), M.vc, { p: [-0.02, belt - 0.075, fz - 0.011], c: 0xb9a66a });
  for (const x of [-0.105, 0.065]) S.add(cyl(0.012, 0.012, 0.025, 8, "z"), M.vcMetal, { p: [x, belt - 0.09, fz - 0.016], c: CHROME });
  S.add(rbox(0.16, 0.05, 0.012, 0.004, 1), M.vcMetal, { p: [-0.02, belt - 0.165, fz + 0.02], r: [0.14, 0, 0], c: 0x7a7a76 });
  for (let i = 0; i < 3; i++) S.add(box(0.012, 0.014, 0.02), M.vc, { p: [-0.07 + i * 0.05 + (i === 1 ? 0.02 : 0), belt - 0.16 + i * 0.008, fz + 0.012], c: BLACK });
  S.add(rbox(0.36, 0.13, 0.012, 0.01, 1), M.vc, { p: [-(hw - 0.42), belt - 0.105, fz + 0.012], r: [0.1, 0, 0], c: mixc(DASH, 0xffffff, 0.06) });
  S.add(cyl(0.012, 0.012, 0.012, 8, "z"), M.vcMetal, { p: [-(hw - 0.42), belt - 0.06, fz - 0.002], c: CHROME });
  for (const x of [hw - 0.2, -(hw - 0.2), 0.14 - (sedan ? 0.3 : 0.28)]) S.add(rbox(0.13, 0.045, 0.012, 0.006, 1), M.vc, { p: [x, belt - 0.005, dz + 0.003], r: [0.2, 0, 0], c: 0x090909 });
  S.add(box(dw - 0.1, 0.004, 0.2), M.vc, { p: [0, belt + 0.045, (zc + dz) / 2 + 0.02], c: mixc(DASH, 0x000000, 0.25) });     // dash top pad (dusty)
  // Steering column and wheel
  const R = b.wheelDia / 2, tilt = sedan ? 0.38 : 0.46;
  const col = new THREE.Group();
  col.position.set(sx, belt - (sedan ? 0.12 : 0.13), dz - 0.26); col.rotation.x = tilt;
  const cb = new Batch();
  cb.add(cyl(0.028, 0.028, 0.36, 10, "z"), M.vc, { p: [0, 0, 0.19], c: mixc(DASH, 0x000000, 0.2) });
  cb.add(tube([[-0.03, 0, 0.1], [-0.12, 0.04, 0.09], [-0.2, 0.09, 0.06]], 0.006, 8, 5), M.vcMetal, { c: CHROME });         // column shifter
  cb.add(sphere(0.017, 8, 6), M.vc, { p: [-0.2, 0.09, 0.06], c: BLACK });
  cb.add(tube([[0.03, 0, 0.09], [0.13, 0.015, 0.075]], 0.005, 4, 5), M.vc, { c: BLACK });                                    // indicator stalk
  cb.add(sphere(0.011, 6, 5), M.vc, { p: [0.13, 0.015, 0.075], c: BLACK });
  cb.build(col, { shadow: false });
  const spin = new THREE.Group(); col.add(spin);
  const wb = new Batch(), rimC = sedan ? 0x15171a : 0x17120f;
  wb.add(torus(R, 0.014, 30, 8, "z"), M.vc, { c: rimC });
  wb.add(rbox(0.1, 0.07, 0.045, 0.02), M.vc, { p: [0, -0.005, 0.02], c: rimC });
  wb.add(box(R * 2 - 0.02, 0.028, 0.012), M.vc, { p: [0, 0, 0.012], c: rimC });
  wb.add(box(0.03, R - 0.01, 0.012), M.vc, { p: [0, -R / 2, 0.012], c: rimC });
  wb.add(cyl(0.022, 0.022, 0.008, 12, "z"), M.vcMetal, { p: [0, -0.005, -0.004], c: CHROME });
  wb.build(spin, { shadow: false });
  // Pedals
  S.add(rbox(0.11, 0.07, 0.02, 0.008, 1), M.vc, { p: [sx + 0.02, fy + 0.15, dz + 0.1], r: [-0.5, 0, 0], c: BLACK });
  S.add(box(0.015, 0.2, 0.015), M.vcMetal, { p: [sx + 0.02, fy + 0.25, dz + 0.15], r: [-0.25, 0, 0], c: 0x55554f });
  S.add(rbox(0.05, 0.15, 0.018, 0.008, 1), M.vc, { p: [sx - 0.16, fy + 0.11, dz + 0.13], r: [-0.75, 0, 0], c: BLACK });
  S.add(rbox(0.06, 0.05, 0.02, 0.008, 1), M.vc, { p: [sx + 0.3, fy + 0.2, dz + 0.12], r: [-0.5, 0, 0], c: BLACK });
  // Floor: rubber mat, transmission tunnel, kick-up to the firewall
  S.add(box(hw * 2 - 0.2, 0.012, b.zCowl - 0.1 - (sedan ? b.zDeckFront + 0.4 : b.zCabBack + 0.05)), M.vc, { p: [0, fy + 0.006, (b.zCowl - 0.1 + (sedan ? b.zDeckFront + 0.4 : b.zCabBack + 0.05)) / 2], c: 0x151414 });
  S.add(rbox(0.3, 0.14, 1.1, 0.05), M.vc, { p: [0, fy + 0.02, dz - 0.25], c: 0x181716 });
  S.add(box(hw * 2 - 0.2, 0.3, 0.012), M.vc, { p: [0, fy + 0.12, dz + 0.22], r: [-0.6, 0, 0], c: 0x151414 });
  // Seats
  const seat = (z, w, x = 0) => {
    S.add(rbox(w, 0.17, 0.52, 0.06, 3), M.fabric, { p: [x, b.seatY - 0.04, z], r: [0.06, 0, 0] });
    S.add(rbox(w, 0.6, 0.15, 0.06, 3), M.fabric, { p: [x, b.seatY + 0.3, z - 0.31], r: [-0.2, 0, 0] });
    S.add(box(w - 0.1, b.seatY - 0.12 - fy, 0.4), M.vc, { p: [x, (b.seatY - 0.12 + fy) / 2, z], c: 0x171615 });
  };
  if (!sedan) seat(b.seatZ, hw * 2 - 0.36);
  else {
    seat(b.seatZ, hw * 2 - 0.4);
    seat(b.zDoor2Rear + 0.22, hw * 2 - 0.44);
    S.add(box(hw * 2 - 0.3, 0.02, b.zDoor2Rear - 0.1 - b.zDeckFront), M.vc, { p: [0, belt - 0.02, (b.zDoor2Rear - 0.1 + b.zDeckFront) / 2 - 0.02], c: mixc(INT, 0x000000, 0.3) });   // parcel shelf
    for (const s of [1, -1]) { S.add(rbox(0.16, 0.2, 0.09, 0.03), M.fabric, { p: [s * 0.36, b.seatY + 0.66, b.seatZ - 0.39], r: [-0.2, 0, 0] }); }
  }
  // Rear wall trim (pickup), mirror, visors, dome lamp
  if (!sedan) S.add(box(hw * 2 - 0.22, belt - fy, 0.02), M.vc, { p: [0, (belt + fy) / 2, b.zCabBack + 0.03], c: INT });
  const my = b.roofY - 0.15, mz = b.zRoofFront - 0.09;
  S.add(cyl(0.008, 0.008, 0.09, 6), M.vc, { p: [0, my + 0.05, mz + 0.03], r: [0.5, 0, 0], c: BLACK });
  S.add(rbox(0.24, 0.065, 0.025, 0.012), M.vc, { p: [0, my, mz], c: BLACK });
  S.add(new THREE.PlaneGeometry(0.22, 0.05), M.mirror, { p: [0, my, mz - 0.0135], r: [0, Math.PI, 0] });
  for (const s of [1, -1]) S.add(rbox(0.38, 0.014, 0.15, 0.006, 1), M.vc, { p: [s * 0.37, b.roofY - 0.085, b.zRoofFront - 0.16], r: [0.12, 0, 0], c: HEAD });
  S.add(rbox(0.1, 0.012, 0.06, 0.005, 1), M.vc, { p: [0, b.roofY - 0.035, (b.zRoofFront + b.zRoofRear) / 2], c: 0xd9d4bc });
  return { needles, wheelSpin: spin, own: [cl, col] };
}
