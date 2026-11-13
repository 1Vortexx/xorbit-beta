// Long Haul – meshes for vehicle components (engine, battery, radiator, wheels). The same mesh is used for the
// loose prop and for the part installed on a vehicle. Origin = centre of the item's `size` box.
// Loose orientation: engines/radiator/battery sit upright with +z = front; wheels lie flat (axle = +y, outer face up).
import * as THREE from "three";
import { M, materialsReady, prepareMaterials } from "./materials.js";
import { Batch, box, rbox, cyl, torus, tube, lathe, sphere } from "./loft.js";

const WHEELS = { wheel_16: { R: 0.38, w: 0.25, paint: 0xcfc8b6 }, wheel_14: { R: 0.31, w: 0.2, paint: 0x9a9c9e } };
const RUST = 0x6b3a1c;
function mix(a, b, t) {
  const ch = (s) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function wheelMesh(type, item) {
  const { R, w, paint } = WHEELS[type], hw = w / 2, rr = R * 0.59;
  const wear = 1 - (item?.cond ?? 70) / 100;
  const g = new THREE.Group();
  const b = new Batch();
  b.add(lathe([[rr, -hw * 0.8], [R - 0.085, -hw * 0.98], [R - 0.03, -hw * 0.94], [R - 0.005, -hw * 0.72], [R, -hw * 0.3], [R, hw * 0.3],
    [R - 0.005, hw * 0.72], [R - 0.03, hw * 0.94], [R - 0.085, hw * 0.98], [rr, hw * 0.8]], 28), M.tyre);
  const steel = mix(paint, RUST, 0.15 + wear * 0.4);
  // Outer rim face, dish and barrel
  b.add(lathe([[rr + 0.012, hw * 0.78], [rr + 0.004, hw * 0.86], [rr - 0.012, hw * 0.8], [rr - 0.022, hw * 0.52], [rr * 0.8, hw * 0.4], [rr * 0.52, hw * 0.52]], 24), M.vc, { c: steel });
  b.add(lathe([[rr * 0.52, hw * 0.52], [rr * 0.46, hw * 0.66], [rr * 0.24, hw * 0.74], [0.001, hw * 0.76]], 20), M.vcMetal, { c: 0xd6d6d2 });
  b.add(lathe([[0.001, -hw * 0.25], [rr * 0.55, -hw * 0.25], [rr - 0.02, -hw * 0.5], [rr + 0.004, -hw * 0.86], [rr + 0.012, -hw * 0.78]], 20), M.vcRough, { c: 0x2a2623 });
  for (let i = 0; i < 8; i++) {                       // vent slots in the dish
    const a = (i / 8) * 6.283, r = rr * 0.67;
    b.add(rbox(0.05, 0.012, 0.022, 0.005, 1), M.vc, { p: [Math.cos(a) * r, hw * 0.47, Math.sin(a) * r], r: [0, -a + Math.PI / 2, 0], c: 0x0c0c0c });
  }
  b.add(cyl(0.004, 0.004, 0.03, 5), M.vc, { p: [rr - 0.03, hw * 0.62, 0], r: [0, 0, 0.5], c: 0x111111 });   // valve stem
  b.build(g);
  g.userData.radius = R; g.userData.width = w;
  return g;
}

// Brake drum + backing plate left on the hub when the wheel is off (axle = +y, outer face up)
export function drumMesh(R) {
  const g = new THREE.Group(), b = new Batch(), r = R * 0.36;
  b.add(cyl(r, r, 0.09, 16), M.vcRough, { p: [0, 0.0, 0], c: 0x5a3a26 });
  b.add(cyl(r * 0.45, r * 0.4, 0.05, 12), M.vcRough, { p: [0, 0.06, 0], c: 0x3b2a20 });
  b.add(cyl(r * 1.12, r * 1.12, 0.012, 16), M.vcRough, { p: [0, -0.05, 0], c: 0x241d19 });
  for (let i = 0; i < 5; i++) { const a = (i / 5) * 6.283; b.add(cyl(0.008, 0.008, 0.05, 6), M.vcMetal, { p: [Math.cos(a) * r * 0.62, 0.065, Math.sin(a) * r * 0.62], c: 0x8a8a86 }); }
  b.build(g);
  return g;
}

const ENGINE_LOOK = {
  engine_i6: { n: 6, vee: false, L: 0.98, H: 0.74, blockW: 0.3, blockL: 0.74, paint: 0x2c5a86, cover: 0x356b9c },
  engine_v8: { n: 8, vee: true, L: 0.86, H: 0.74, blockW: 0.42, blockL: 0.62, paint: 0xb04a1c, cover: 0xc9c9c4 },
  engine_i4: { n: 4, vee: false, L: 0.7, H: 0.66, blockW: 0.27, blockL: 0.5, paint: 0x3d3f42, cover: 0x8f1f1a },
};

function engineMesh(type, item) {
  const k = ENGINE_LOOK[type], g = new THREE.Group(), b = new Batch();
  const wear = 1 - (item?.cond ?? 70) / 100;
  const paint = mix(k.paint, 0x33271f, 0.25 + wear * 0.45), cover = mix(k.cover, 0x4a3b2e, 0.1 + wear * 0.4);
  const iron = 0x2b2725, rusty = mix(0x4a3a30, RUST, 0.5), alu = 0xa6a8a6, black = 0x121212;
  const y0 = -k.H / 2, bl = k.blockL, zf = bl / 2;          // zf: front face of the block
  const blockY = y0 + 0.14 + 0.15;
  b.add(rbox(k.blockW - 0.05, 0.15, bl * 0.92, 0.03), M.vcRough, { p: [0, y0 + 0.075, -0.01], c: black });           // oil pan
  b.add(cyl(0.012, 0.012, 0.02, 6, "y"), M.vcMetal, { p: [0, y0 + 0.005, -bl * 0.3], c: 0x8a8a86 });                  // drain plug
  b.add(rbox(k.blockW, 0.3, bl, 0.02), M.vcRough, { p: [0, blockY, 0], c: paint });                                   // block
  b.add(cyl(k.blockW * 0.62, k.blockW * 0.5, 0.12, 14, "z"), M.vcRough, { p: [0, blockY - 0.03, -zf - 0.05], c: alu }); // bellhousing
  b.add(cyl(0.05, 0.05, 0.14, 10, "z"), M.vcRough, { p: [0, blockY - 0.05, -zf - 0.17], c: iron });                    // transmission stub
  const topY = blockY + 0.15;
  let oilCap, dip;
  if (!k.vee) {
    b.add(rbox(k.blockW - 0.03, 0.1, bl, 0.015), M.vcRough, { p: [0, topY + 0.05, 0], c: paint });                    // head
    b.add(rbox(k.blockW - 0.1, 0.085, bl - 0.04, 0.03), M.vc, { p: [0, topY + 0.14, 0], c: cover });                  // valve cover
    for (const z of [-bl * 0.36, bl * 0.36]) b.add(cyl(0.009, 0.009, 0.012, 6), M.vcMetal, { p: [0, topY + 0.186, z], c: 0x9a9a96 });
    oilCap = [0, topY + 0.195, bl * 0.22];
    // Manifolds on the right (−x): intake log with runners above, rusty exhaust log below
    const mx = -k.blockW / 2 - 0.06;
    b.add(cyl(0.03, 0.03, bl * 0.82, 8, "z"), M.vcRough, { p: [mx - 0.02, topY + 0.07, 0], c: alu });
    b.add(cyl(0.034, 0.034, bl * 0.86, 8, "z"), M.vcRough, { p: [mx, topY - 0.03, 0], c: rusty });
    for (let i = 0; i < k.n; i++) {
      const z = -bl * 0.4 + (i / (k.n - 1)) * bl * 0.8;
      b.add(cyl(0.02, 0.02, 0.09, 6, "x"), M.vcRough, { p: [mx + 0.035, topY + 0.07, z], c: alu });
      b.add(cyl(0.022, 0.022, 0.08, 6, "x"), M.vcRough, { p: [mx + 0.04, topY - 0.02, z + 0.02], c: rusty });
    }
    b.add(tube([[mx, topY - 0.04, -bl * 0.2], [mx - 0.02, topY - 0.16, -bl * 0.26], [mx + 0.02, y0 + 0.08, -bl * 0.4], [mx + 0.06, y0 + 0.05, -zf - 0.12]], 0.028, 10, 7), M.vcRough, { c: rusty });
    // Carburettor and air cleaner
    b.add(rbox(0.09, 0.08, 0.1, 0.01), M.vcRough, { p: [mx - 0.03, topY + 0.13, 0], c: alu });
    const ar = Math.min(0.16, k.H / 2 - (topY + 0.17) > 0.06 ? 0.16 : 0.14);
    b.add(cyl(ar, ar, 0.07, 20), M.vc, { p: [mx - 0.03, topY + 0.205, 0], c: mix(0x1a1a1a, RUST, wear * 0.3) });
    b.add(cyl(ar + 0.006, ar + 0.006, 0.012, 20), M.vcMetal, { p: [mx - 0.03, topY + 0.245, 0], c: 0xc9c9c4 });
    b.add(cyl(0.012, 0.012, 0.02, 6), M.vcMetal, { p: [mx - 0.03, topY + 0.26, 0], c: 0xd6d6d2 });
    // Distributor, coil and plug leads on the left (+x)
    const dx = k.blockW / 2 + 0.03, dz = -bl * 0.08;
    b.add(cyl(0.03, 0.03, 0.09, 8), M.vcRough, { p: [dx, topY - 0.02, dz], c: alu });
    b.add(cyl(0.02, 0.038, 0.05, 8), M.vc, { p: [dx, topY + 0.045, dz], c: 0x5a2a1c });
    b.add(cyl(0.025, 0.025, 0.09, 8, "z"), M.vc, { p: [dx + 0.02, topY + 0.1, bl * 0.34], c: 0x151515 });
    for (let i = 0; i < k.n; i++) {
      const z = -bl * 0.4 + (i / (k.n - 1)) * bl * 0.8;
      b.add(cyl(0.011, 0.011, 0.05, 6, "x"), M.vc, { p: [k.blockW / 2 - 0.01, topY + 0.06, z], c: 0xd8d2c2 });       // plug
      b.add(tube([[dx, topY + 0.07, dz], [dx + 0.03, topY + 0.13, (dz + z) / 2], [k.blockW / 2 + 0.02, topY + 0.065, z]], 0.005, 6, 4), M.vc, { c: 0x141414 });
    }
    b.add(cyl(0.045, 0.045, 0.11, 10, "x"), M.vc, { p: [k.blockW / 2 + 0.05, blockY - 0.09, bl * 0.12], c: 0xc8641e }); // oil filter
    b.add(cyl(0.045, 0.045, 0.2, 8, "z"), M.vcRough, { p: [mx + 0.05, blockY - 0.13, -bl * 0.32], c: iron });          // starter
    dip = [[k.blockW / 2 + 0.005, blockY - 0.05, bl * 0.26], [k.blockW / 2 + 0.035, topY + 0.03, bl * 0.28], [k.blockW / 2 + 0.05, topY + 0.13, bl * 0.29]];
  } else {
    // V8: two banks tilted outwards, intake valley in the middle, big round air cleaner
    for (const s of [1, -1]) {
      const r = [0, 0, -s * 0.62];
      b.add(rbox(0.16, 0.1, bl, 0.015), M.vcRough, { p: [s * 0.17, topY + 0.01, 0], r, c: paint });
      b.add(rbox(0.13, 0.07, bl - 0.06, 0.028), M.vcMetal, { p: [s * 0.215, topY + 0.075, 0], r, c: mix(cover, RUST, wear * 0.35) });
      b.add(cyl(0.034, 0.034, bl * 0.84, 8, "z"), M.vcRough, { p: [s * 0.3, topY - 0.07, 0], c: rusty });
      for (let i = 0; i < 4; i++) {
        const z = -bl * 0.38 + (i / 3) * bl * 0.76;
        b.add(cyl(0.022, 0.022, 0.07, 6, "x"), M.vcRough, { p: [s * 0.265, topY - 0.05, z], c: rusty });
        b.add(tube([[0, topY + 0.13, -bl * 0.36], [s * 0.1, topY + 0.19, (z - bl * 0.36) / 2], [s * 0.2, topY + 0.115, z]], 0.005, 6, 4), M.vc, { c: 0x141414 });
      }
      b.add(tube([[s * 0.3, topY - 0.08, -bl * 0.3], [s * 0.29, topY - 0.2, -bl * 0.4], [s * 0.2, y0 + 0.06, -zf - 0.1]], 0.028, 8, 7), M.vcRough, { c: rusty });
    }
    b.add(rbox(0.2, 0.08, bl * 0.8, 0.02), M.vcRough, { p: [0, topY + 0.05, 0], c: alu });                              // intake
    b.add(rbox(0.1, 0.07, 0.12, 0.01), M.vcRough, { p: [0, topY + 0.12, 0.02], c: alu });                               // carb
    b.add(cyl(0.2, 0.2, 0.07, 22), M.vc, { p: [0, topY + 0.19, 0.02], c: mix(0x1a1a1a, RUST, wear * 0.3) });
    b.add(cyl(0.206, 0.206, 0.012, 22), M.vcMetal, { p: [0, topY + 0.23, 0.02], c: 0xc9c9c4 });
    b.add(cyl(0.012, 0.012, 0.02, 6), M.vcMetal, { p: [0, topY + 0.245, 0.02], c: 0xd6d6d2 });
    b.add(cyl(0.032, 0.032, 0.1, 8), M.vcRough, { p: [0, topY + 0.07, -bl * 0.42], c: alu });                           // distributor
    b.add(cyl(0.02, 0.04, 0.05, 8), M.vc, { p: [0, topY + 0.14, -bl * 0.42], c: 0x5a2a1c });
    b.add(cyl(0.045, 0.045, 0.11, 10, "z"), M.vc, { p: [0.13, y0 + 0.2, zf + 0.02], c: 0xc8641e });
    b.add(cyl(0.045, 0.045, 0.2, 8, "z"), M.vcRough, { p: [-0.17, y0 + 0.15, -bl * 0.3], c: iron });
    oilCap = [0.235, topY + 0.125, bl * 0.22];
    dip = [[0.2, blockY - 0.02, bl * 0.3], [0.27, topY + 0.02, bl * 0.34], [0.3, topY + 0.14, bl * 0.36]];
  }
  // Front dress: water pump, pulleys, belt, fan, alternator
  const fz = zf + 0.03, fanY = blockY + 0.1;
  b.add(rbox(0.16, 0.14, 0.06, 0.02), M.vcRough, { p: [0, fanY, fz], c: alu });
  b.add(cyl(0.085, 0.085, 0.03, 16, "z"), M.vcRough, { p: [0, blockY - 0.11, fz + 0.03], c: iron });                    // crank pulley
  b.add(cyl(0.065, 0.065, 0.03, 14, "z"), M.vcRough, { p: [0, fanY, fz + 0.045], c: iron });                            // fan pulley
  const ax = k.vee ? 0.2 : 0.2, ay = fanY + 0.08;
  b.add(cyl(0.058, 0.058, 0.11, 12, "z"), M.vcRough, { p: [ax, ay, fz - 0.04], c: alu });                               // alternator
  b.add(cyl(0.035, 0.035, 0.025, 10, "z"), M.vcRough, { p: [ax, ay, fz + 0.03], c: iron });
  const belt = [[0, blockY - 0.195, fz + 0.03], [0.07, blockY - 0.05, fz + 0.03], [ax + 0.03, ay - 0.02, fz + 0.03], [ax, ay + 0.036, fz + 0.03], [0.03, fanY + 0.06, fz + 0.04], [-0.066, fanY, fz + 0.04], [-0.085, blockY - 0.11, fz + 0.03]];
  b.add(tube(belt, 0.007, 28, 4, true), M.vc, { c: 0x0c0c0c });
  b.add(cyl(0.02, 0.02, 0.05, 8, "z"), M.vcMetal, { p: [0, fanY, fz + 0.08], c: 0x8f8f8a });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * 6.283 + 0.3;
    b.add(box(0.07, 0.15, 0.004), M.vcMetal, { p: [Math.cos(a) * 0.105, fanY + Math.sin(a) * 0.105, fz + 0.1], r: [0.35, 0, a - Math.PI / 2], c: 0x9a9a94 });
  }
  b.add(cyl(0.022, 0.022, 0.07, 8), M.vcRough, { p: [0.05, topY + (k.vee ? 0.1 : 0.03), zf - 0.03], c: alu });           // thermostat housing
  b.build(g);
  // Separate small meshes so the vehicle can make them interaction targets
  const cb = new Batch();
  cb.add(cyl(0.034, 0.03, 0.028, 12), M.vc, { c: 0x16161a });
  cb.add(cyl(0.012, 0.012, 0.012, 6), M.vcMetal, { p: [0, 0.018, 0], c: 0xb9b9b4 });
  // generous invisible grab volume
  const cap = new THREE.Group(); cap.name = "oilCap"; cap.position.set(...oilCap);
  cb.build(cap);
  cap.add(new THREE.Mesh(cyl(0.06, 0.06, 0.07, 8), M.proxy));
  g.add(cap);
  const dg = new THREE.Group(); dg.name = "dipstick";
  const db = new Batch();
  db.add(tube(dip, 0.006, 8, 5), M.vcMetal, { c: 0x9a9a96 });
  db.add(torus(0.02, 0.005, 12, 5, "x"), M.vc, { p: [dip[2][0] + 0.004, dip[2][1] + 0.02, dip[2][2]], c: 0xd9b21c });
  db.build(dg);
  const grab = new THREE.Mesh(box(0.08, 0.14, 0.08), M.proxy); grab.position.set(dip[2][0], dip[2][1] - 0.03, dip[2][2]);
  dg.add(grab);
  g.add(dg);
  return g;
}

function batteryMesh(item) {
  const g = new THREE.Group(), b = new Batch();
  const dead = (item?.cond ?? 80) < 35;
  b.add(rbox(0.18, 0.17, 0.27, 0.012), M.vc, { p: [0, -0.02, 0], c: 0x1b1b1e });
  b.add(rbox(0.186, 0.03, 0.276, 0.01), M.vc, { p: [0, 0.075, 0], c: 0x2a2a30 });
  for (let i = 0; i < 6; i++) b.add(cyl(0.013, 0.013, 0.012, 8), M.vc, { p: [i % 2 ? 0.03 : -0.03, 0.094, -0.07 + ((i / 2) | 0) * 0.07], c: 0xd0a51e });
  for (const [z, c] of [[0.105, 0xb03a2a], [-0.105, 0x202024]]) {
    b.add(cyl(0.011, 0.013, 0.022, 8), M.vcMetal, { p: [0.05, 0.1, z], c: 0x8e8e8c });
    b.add(rbox(0.035, 0.012, 0.03, 0.004, 1), M.vcMetal, { p: [0.05, 0.103, z], c: dead ? 0x7fae9a : 0x9a9a96 });
    b.add(cyl(0.01, 0.01, 0.006, 6), M.vc, { p: [0.05, 0.113, z], c });
  }
  b.add(box(0.002, 0.07, 0.2), M.vc, { p: [0.091, -0.01, 0], c: 0xb8402c });
  b.add(box(0.003, 0.025, 0.16), M.vc, { p: [0.0915, -0.005, 0], c: 0xe6dfcc });
  b.add(tube([[-0.02, 0.09, 0.12], [-0.02, 0.135, 0.06], [-0.02, 0.135, -0.06], [-0.02, 0.09, -0.12]], 0.006, 10, 5), M.vc, { c: 0x111114 });
  b.build(g);
  return g;
}

function radiatorMesh(item) {
  const g = new THREE.Group(), b = new Batch();
  const wear = 1 - (item?.cond ?? 70) / 100;
  const brass = mix(0x8a7440, 0x3a4a38, wear * 0.5), black = 0x151515;
  b.add(box(0.58, 0.36, 0.045), M.fins, { p: [0, -0.01, 0] });
  b.add(rbox(0.62, 0.07, 0.075, 0.02), M.vcRough, { p: [0, 0.205, 0], c: brass });
  b.add(rbox(0.62, 0.06, 0.075, 0.02), M.vcRough, { p: [0, -0.22, 0], c: brass });
  for (const s of [1, -1]) {
    b.add(box(0.022, 0.37, 0.06), M.vcRough, { p: [s * 0.3, -0.01, 0], c: black });
    b.add(box(0.05, 0.03, 0.004), M.vcRough, { p: [s * 0.325, 0.12, 0], c: black });
    b.add(box(0.05, 0.03, 0.004), M.vcRough, { p: [s * 0.325, -0.14, 0], c: black });
  }
  b.add(cyl(0.022, 0.022, 0.07, 8, "z"), M.vcRough, { p: [-0.18, 0.205, -0.05], c: brass });       // upper hose stub (to engine)
  b.add(cyl(0.022, 0.022, 0.07, 8, "z"), M.vcRough, { p: [0.2, -0.22, -0.05], c: brass });
  b.add(torus(0.2, 0.012, 20, 5, "z"), M.vc, { p: [0, -0.01, -0.045], c: black });                  // fan shroud ring
  b.add(cyl(0.024, 0.024, 0.02, 8), M.vcRough, { p: [0.14, 0.245, 0], c: brass });
  if (wear > 0.5) b.add(box(0.1, 0.18, 0.002), M.vc, { p: [-0.1, -0.08, 0.024], c: 0x5d7a5a });   // dried coolant stain
  b.build(g);
  const cap = new THREE.Group(); cap.name = "radCap"; cap.position.set(0.14, 0.262, 0);
  const cb = new Batch();
  cb.add(cyl(0.034, 0.034, 0.014, 12), M.vcMetal, { c: 0xb4b4ae });
  cb.add(box(0.085, 0.008, 0.018), M.vcMetal, { p: [0, 0.004, 0], c: 0xb4b4ae });
  cb.build(cap);
  cap.add(new THREE.Mesh(cyl(0.07, 0.07, 0.07, 8), M.proxy));
  g.add(cap);
  return g;
}

// item is optional (condition tints the mesh a little)
export function makePartMesh(type, item) {
  if (!materialsReady()) {
    if (typeof document === "undefined") return new THREE.Group();   // Node: harmless empty object
    prepareMaterials();
  }
  let g;
  if (type in WHEELS) g = wheelMesh(type, item);
  else if (type in ENGINE_LOOK) g = engineMesh(type, item);
  else if (type === "battery") g = batteryMesh(item);
  else if (type === "radiator") g = radiatorMesh(item);
  else g = new THREE.Group();
  g.name = "part:" + type;
  return g;
}
