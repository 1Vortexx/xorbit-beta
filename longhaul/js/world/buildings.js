// Long Haul – turns a site plan (plan.js) into meshes, hinged doors/lids, interaction targets and ground patches.
import * as THREE from "three";
import { toGeometry } from "./geo.js";
import { planSite } from "./plan.js";
import { M, signAtlasTexture } from "./tex.js";
import { heightAt, roadX, roadDir, ROAD_HALF } from "./terrain.js";
import { addTarget, addOccluder } from "../core/targets.js";
import { ws } from "../core/worldstate.js";
import { sfx, notify, emit } from "../core/bus.js";

export const FUEL_PRICE = 1.6, PUMP_RATE = 4;
const FUEL_CAPS = { fuelcan: 10, jerrycan: 20 };
let vehicleLookup = null;
// fn(x, z, radius) → nearest parked vehicle { fuel, def: { tank } } or null. Wired by main to the vehicle manager.
export function setVehicleLookup(fn) { vehicleLookup = fn; }

const SHADOW = { plaster: 3, wood: 3, metal: 3, roof: 3, concrete: 3, smooth: 3, fabric: 1, rubber: 1, rock: 1, tile: 2, glass: 0, glow: 0, sign: 0 };  // bit0 cast, bit1 receive

// state: 0/undefined = default, 1 = open, 2 = closed
const isOpen = (d) => { const f = ws.flag(d.flag); return f === 1 ? true : f === 2 ? false : d.open0; };

function pumpTarget(site, t, wx, wz) {
  let lastTick = 0;
  const find = (ctx) => {
    const v = vehicleLookup ? vehicleLookup(wx, wz, 6) : null;
    if (v && v.def && v.fuel < v.def.tank - 0.01) return { v };
    const h = ctx.held;
    if (h && FUEL_CAPS[h.type] && (h.qty || 0) < FUEL_CAPS[h.type] - 0.01) return { can: h };
    return { full: v || (h && FUEL_CAPS[h.type] ? h : null) };
  };
  return {
    id: t.id, name: "Fuel pump",
    info: () => ({ note: `$${FUEL_PRICE.toFixed(2)} / L` }),
    reach: 3,
    actions: (ctx) => {
      const f = find(ctx);
      if (f.full) return [{ key: "use", label: "Fill up", blocked: "Already full" }];
      if (!f.v && !f.can) return [{ key: "use", label: "Fill up", blocked: "Park within 6 m or hold a fuel can" }];
      if (ctx.wallet && ctx.wallet.money < 0.05) return [{ key: "use", label: "Fill up", blocked: "No money" }];
      return [{
        key: "use", label: f.v ? `Fill ${f.v.def.name || "vehicle"} (hold)` : "Fill fuel can (hold)",
        tick: (c, dt) => {
          const g = find(c);
          if (!g.v && !g.can) return false;
          const cap = g.v ? g.v.def.tank : FUEL_CAPS[g.can.type], have = g.v ? g.v.fuel : g.can.qty || 0;
          const money = c.wallet ? c.wallet.money : Infinity;
          const add = Math.min(PUMP_RATE * dt, cap - have, money / FUEL_PRICE);
          if (add <= 1e-6) { if (money < 0.05) c.notify && c.notify("Out of money", { level: "warn", key: "pump" }); return false; }
          if (g.v) g.v.fuel = have + add; else g.can.qty = have + add;
          if (c.wallet) c.wallet.money = Math.max(0, money - add * FUEL_PRICE);
          const now = performance.now();
          if (now - lastTick > 400) sfx("pour_start");
          lastTick = now; pumping.set(t.id, now);
          emit("fuel:bought", { litres: add, cost: add * FUEL_PRICE, site });
          if (c.onFuelBought) c.onFuelBought(add);
          return (have + add) / cap;
        },
      }];
    },
  };
}
const pumping = new Map();
// called every frame by World: ends the pour sound when the player lets go
export function tickPumps() {
  if (!pumping.size) return;
  const now = performance.now();
  for (const [id, t] of pumping) if (now - t > 300) { pumping.delete(id); sfx("pour_stop"); sfx("cash"); }
}

// Ground patch following the terrain: grid over a site-local rectangle, alpha-feathered edges.
function patchMesh(site, x0, z0, x1, z1, mat, fade, parentPos, uvs = 0.25) {
  const nx = Math.max(2, Math.ceil((x1 - x0) / 2.5)), nz = Math.max(2, Math.ceil((z1 - z0) / 2.5));
  const pos = [], col = [], uv = [], idx = [], c = Math.cos(site.yaw), s = Math.sin(site.yaw);
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const lx = x0 + ((x1 - x0) * i) / nx, lz = z0 + ((z1 - z0) * j) / nz;
    const wx = site.x + lx * c + lz * s, wz = site.z - lx * s + lz * c;
    pos.push(wx - parentPos.x, heightAt(wx, wz) + 0.012, wz - parentPos.z);
    const e = Math.min(lx - x0, x1 - lx, lz - z0, z1 - lz);
    // never paint over the highway
    const dr = Math.abs(wx - roadX(wz)) / Math.hypot(1, roadDir(wz).x / roadDir(wz).z) - ROAD_HALF - 0.2;
    col.push(1, 1, 1, Math.max(0, Math.min(1, e / fade, dr / 0.8)));
    uv.push((wx - parentPos.x) * uvs, (wz - parentPos.z) * uvs);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, d = a + nx + 1, e = d + 1; idx.push(a, d, b, b, d, e); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true; m.renderOrder = 2;
  return m;
}
// Ribbon along a side track
function trackMesh(route, parentPos) {
  const pts = route.pts, pos = [], col = [], uv = [], idx = [], hw = route.half + 0.5;
  const N = (pts.length - 1) * 3;
  for (let i = 0; i <= N; i++) {
    const t = i / 3, k = Math.min(pts.length - 2, Math.floor(t)), f = t - k, a = pts[k], b = pts[k + 1];
    const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
    let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
    const sdist = a.s + (b.s - a.s) * f;
    for (const [o, al] of [[-hw, 0], [-hw + 0.9, 1], [hw - 0.9, 1], [hw, 0]]) {
      const px = x + dz * o, pz = z - dx * o;
      pos.push(px - parentPos.x, heightAt(px, pz) + 0.015, pz - parentPos.z);
      col.push(1, 1, 1, al * Math.min(1, Math.max(0, (sdist - ROAD_HALF - 1) / 3)));
      uv.push((o / (2 * hw) + 0.5) * 1.2, sdist * 0.25);
    }
  }
  for (let i = 0; i < N; i++) for (let q = 0; q < 3; q++) { const a = i * 4 + q, b = a + 1, d = a + 4, e = d + 1; idx.push(a, d, b, b, d, e); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, M.patch.track);
  m.receiveShadow = true; m.renderOrder = 2;
  return m;
}

// Builds one site into `chunk`. Returns the list of live hinges (for animation).
export function buildSite(site, chunk, opts) {
  const plan = planSite(site);
  chunk.colliders.push(...plan.colliders);
  chunk.spawns.push(...plan.spawns);
  chunk.vehicleSpawns.push(...plan.vehicleSpawns);

  const gp = chunk.group.position;
  // ground: pad + apron to the road, and the side track
  const K = site.spec, lite = !!opts.lite;
  if (site.kind !== "wreck") chunk.group.add(own(chunk, patchMesh(site, -K.hx - 3, -K.hz - 3, K.hx + 3, K.hz + (site.route ? 3 : 9), M.patch[K.surface] || M.patch.dirt, 4, gp)));
  if (site.route) chunk.group.add(own(chunk, trackMesh(site.route, gp)));

  const root = new THREE.Group();
  root.position.set(site.x - gp.x, site.y, site.z - gp.z);
  root.rotation.y = site.yaw;
  chunk.group.add(root);

  let signMat = null;
  for (const [id, b] of Object.entries(plan.batches)) {
    if (!b.count) continue;
    let mat = M[id] || M.smooth;
    if (id === "sign") {
      const tex = signAtlasTexture(plan.signs, lite ? 512 : 1024);
      signMat = mat = M.sign.clone(); mat.map = tex;
      chunk.owned.push(tex, mat);
    }
    const mesh = new THREE.Mesh(toGeometry(THREE, b), mat);
    const sh = SHADOW[id] === undefined ? 3 : SHADOW[id];
    mesh.castShadow = !!(sh & 1); mesh.receiveShadow = !!(sh & 2);
    if (id === "glass") mesh.renderOrder = 3;
    chunk.owned.push(mesh.geometry);
    root.add(mesh);
  }
  if (plan.occ.count) {
    const occ = new THREE.Mesh(toGeometry(THREE, plan.occ), M.occ);
    chunk.owned.push(occ.geometry);
    root.add(occ); addOccluder(occ);
  }

  // hinged doors and lids
  for (const d of plan.dyn) {
    const pivot = new THREE.Group();
    pivot.position.set(d.x, d.y, d.z);
    const hinge = new THREE.Group();
    pivot.rotation.y = d.yaw; pivot.add(hinge); root.add(pivot);
    for (const [id, b] of Object.entries(d.batches)) {
      const mesh = new THREE.Mesh(toGeometry(THREE, b), M[id] || M.smooth);
      mesh.castShadow = d.kind === "door"; mesh.receiveShadow = true;
      chunk.owned.push(mesh.geometry);
      hinge.add(mesh);
    }
    const live = { d, hinge, open: isOpen(d), t: 0 };
    live.t = live.open ? 1 : 0;
    const apply = () => { const a = d.angle * live.t * (2 - live.t); if (d.axis === "x") hinge.rotation.x = a; else hinge.rotation.y = a; };
    live.apply = apply; apply();
    if (d.collider) d.collider.solid = !live.open;
    const isDoor = d.kind === "door";
    addTarget(hinge, {
      id: d.id, name: d.name, reach: 2.8,
      actions: () => [{
        key: "use", label: (live.open ? "Close " : "Open ") + (isDoor ? "door" : d.name.toLowerCase()),
        run: () => {
          live.open = !live.open;
          ws.setFlag(d.flag, live.open === d.open0 ? 0 : live.open ? 1 : 2);
          if (d.collider) d.collider.solid = !live.open;
          sfx(isDoor ? (live.open ? "door_open" : "door_close") : "container");
          chunk.anim.add(live);
        },
      }],
    });
    chunk.hinges.push(live);
  }

  // static targets
  for (const t of plan.targets) {
    const m = new THREE.Mesh(boxGeo(), M.pick);
    m.scale.set(t.sx, t.sy, t.sz); m.position.set(t.x, t.y + t.sy / 2, t.z); m.rotation.y = t.yaw;
    root.add(m);
    const c = Math.cos(site.yaw), s = Math.sin(site.yaw), wx = site.x + t.x * c + t.z * s, wz = site.z - t.x * s + t.z * c;
    if (t.type === "pump") addTarget(m, pumpTarget(site, t, wx, wz));
    else if (t.type === "shop") addTarget(m, { id: t.id, name: site.name, info: () => ({ note: "Shop" }), reach: 3, actions: (ctx) => [{ key: "use", label: "Browse shop", run: (c2) => (c2 || ctx).openShop(site) }] });
    else if (t.type === "bed") addTarget(m, { id: t.id, name: t.name, reach: 2.8, actions: (ctx) => [{ key: "use", label: "Sleep", run: (c2) => (c2 || ctx).sleep("bed") }] });
  }
  void signMat; void notify;
  return plan;
}
let _box = null;
function boxGeo() { return _box || (_box = new THREE.BoxGeometry(1, 1, 1)); }
function own(chunk, mesh) { chunk.owned.push(mesh.geometry); return mesh; }

// Advance door/lid animations of a chunk (dt seconds)
export function animateHinges(chunk, dt) {
  for (const live of chunk.anim) {
    const target = live.open ? 1 : 0;
    live.t += Math.sign(target - live.t) * Math.min(Math.abs(target - live.t), dt * 3.2);
    live.apply();
    if (live.t === target) chunk.anim.delete(live);
  }
}
