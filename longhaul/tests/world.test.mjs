// Long Haul – world checks (pure logic). Run: node tests/world.test.mjs
import assert from "node:assert";
import * as T from "../js/world/terrain.js";
import * as S from "../js/world/sites.js";
import { planSite, ITEM_TYPES } from "../js/world/plan.js";
import { scatter } from "../js/world/scatter.js";
import { naturalHeight } from "../js/world/base.js";

const { CHUNK, heightAt, roadX, roadY } = T;
const snap = (seed) => {
  T.setSeed(seed);
  const h = [];
  for (let i = 0; i < 400; i++) { const z = i * 173.3 - 2000, x = roadX(z) + ((i * 37) % 900) - 450; h.push(heightAt(x, z)); }
  const sites = S.sitesBetween(-100, 40000).map((s) => [s.id, s.kind, s.x, s.z, s.yaw, s.y]);
  const spawns = S.sitesBetween(-100, 12000).flatMap((s) => { const p = planSite(s); return [...p.spawns, ...p.vehicleSpawns]; });
  const sc = scatter(7);
  return JSON.stringify({ h, sites, spawns, inst: sc.inst, col: sc.colliders });
};

// 1. determinism
const a = snap(1), b = snap(2), a2 = snap(1);
assert.strictEqual(a, a2, "same seed must give an identical world");
assert.notStrictEqual(a, b, "different seeds must differ");

for (const seed of [1, 987654]) {
  T.setSeed(seed);
  // 2. API shape
  const st = S.startSite();
  assert(st.id && st.kind === "home" && st.playerSpawn && st.vehicleSpawn && Math.abs(st.zRoad - 60) < 100, "start site");
  assert(["asphalt", "gravel", "dirt", "sand", "rock", "concrete", "wood"].includes(T.surfaceAt(st.x, st.z)));
  assert.strictEqual(T.surfaceAt(roadX(500), 500), "asphalt");
  assert(T.onRoad(roadX(500) + 3, 500) && !T.onRoad(roadX(500) + 9, 500));
  assert(T.regionAt(0, 0).id && T.regionAt(0, 0).name);
  const n = T.normalAt(roadX(10), 10, {});
  assert(Math.abs(Math.hypot(n.x, n.y, n.z) - 1) < 1e-9 && n.y > 0.9);
  assert.strictEqual(T.hashStr("abc"), T.hashStr("abc"));
  const d = T.roadDir(100); assert(Math.abs(Math.hypot(d.x, d.z) - 1) < 1e-9 && d.z > 0);

  // 3. continuity: no step > 0.6 m between samples 0.5 m apart
  let worst = 0, where = "";
  const probe = (x, z, tag) => {
    const h = heightAt(x, z);
    assert(Number.isFinite(h), "finite height");
    for (const [dx, dz] of [[0.5, 0], [0, 0.5]]) { const s = Math.abs(heightAt(x + dx, z + dz) - h); if (s > worst) { worst = s; where = `${tag} ${x.toFixed(1)},${z.toFixed(1)}`; } }
  };
  for (let k = 0; k < 150; k++) for (let o = -700; o <= 700; o += 3.7) { const z = k * CHUNK - 0.25; probe(roadX(z) + o, z, "chunk border"); }   // across chunk borders
  for (let z = -500; z < 60000; z += 1.7) { probe(roadX(z), z, "road"); probe(roadX(z) + 6.4, z, "shoulder"); probe(roadX(z) - 9, z, "verge"); }
  let rs = 12345; const r = () => (rs = (Math.imul(rs, 1103515245) + 12345) >>> 0) / 4294967296;
  for (let i = 0; i < 150000; i++) { const z = r() * 120000, x = roadX(z) + (r() - 0.5) * 9000; probe(x, z, "far off-road"); }
  const all = S.sitesBetween(-100, 300000);
  for (const s of all.slice(0, 120)) {
    // pad edges and the side track
    for (let t = 0; t < 6.283; t += 0.05) for (const rr of [0.8, 1, 1.15, 1.5]) { const w = S.siteToWorld(s, Math.cos(t) * s.pad.hx * rr * 1.2, Math.sin(t) * s.pad.hz * rr * 1.2); probe(w.x, w.z, "pad " + s.id); }
    if (s.route) for (const p of s.route.pts) for (const o of [-6, -2.5, 0, 2.5, 6]) probe(p.x + o, p.z + o * 0.4, "track " + s.id);
  }
  assert(worst <= 0.62, `height step ${worst.toFixed(3)} m at ${where}`);

  // 4. pads are flat where buildings stand, and the road stays the road
  for (const s of all.slice(0, 200)) {
    for (let lx = -s.pad.hx; lx <= s.pad.hx; lx += s.pad.hx / 4) for (let lz = -s.pad.hz; lz <= s.pad.hz - 6; lz += s.pad.hz / 4) {
      const w = S.siteToWorld(s, lx, lz);
      if (Math.abs(w.x - roadX(w.z)) < 14) continue;
      assert(Math.abs(heightAt(w.x, w.z) - s.y) < 0.03, `pad of ${s.id} not flat at ${lx},${lz}: ${heightAt(w.x, w.z)} vs ${s.y}`);
    }
    for (const f of s.pad.floors) for (const [ex, ez] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) {
      const w = S.siteToWorld(s, f.x + ex * f.hx, f.z + ez * f.hz);
      assert(Math.abs(heightAt(w.x, w.z) - s.y) < 1e-6, `floor of ${s.id} not level`);
      assert.strictEqual(T.surfaceAt(S.siteToWorld(s, f.x, f.z).x, S.siteToWorld(s, f.x, f.z).z), f.surface);
      assert(!T.onRoad(w.x, w.z), "building on the road");
    }
    if (s.route) { const m = s.route.pts[Math.floor(s.route.pts.length * 0.6)]; assert(["dirt", "gravel"].includes(T.surfaceAt(m.x, m.z)), "track surface"); assert(s.route.len >= 60 && s.route.len <= 520, "track length " + s.route.len); }
    assert(Math.abs(heightAt(roadX(s.zRoad), s.zRoad) - roadY(s.zRoad)) < 1e-9, "road height unchanged at site");
  }

  // 5. sites: order, ids, spacing, overlap, stations
  const ids = new Set();
  for (const s of all) { assert(!ids.has(s.id), "duplicate site id " + s.id); ids.add(s.id); assert(/^s\d+$/.test(s.id)); }
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length && all[j].z - all[i].z < 200; j++) {
    const p = all[i], q = all[j], dist = Math.hypot(p.x - q.x, p.z - q.z);
    assert(dist > Math.hypot(p.pad.hx, p.pad.hz) + Math.hypot(q.pad.hx, q.pad.hz), `sites ${p.id} and ${q.id} overlap`);
  }
  for (const s of all) for (let t = 0; t < 6.283; t += 0.2) { const w = S.siteToWorld(s, Math.cos(t) > 0 ? s.pad.hx : -s.pad.hx, Math.sin(t) * s.pad.hz); assert(!T.onRoad(w.x, w.z), `pad of ${s.id} reaches the asphalt`); }
  const stations = all.filter((s) => s.kind === "station");
  assert(stations[0].zRoad - st.zRoad > 1100 && stations[0].zRoad - st.zRoad < 1900, "first station 1.2–1.8 km from the start: " + stations[0].zRoad);
  for (let i = 1; i < stations.length; i++) { const g = stations[i].zRoad - stations[i - 1].zRoad; assert(g > 4500 && g < 10000, "station gap " + g); }
  assert(stations[stations.length - 1].zRoad > 290000 - 10000);
  assert.strictEqual(S.nextSiteAfter(0, "station").id, stations[0].id);
  assert.strictEqual(S.nextSiteAfter(stations[3].zRoad + 1, "station").id, stations[4].id);
  const kinds = new Set(all.map((s) => s.kind));
  for (const k of ["station", "home", "garage", "diner", "motel", "junkyard", "wreck"]) assert(kinds.has(k), "kind missing: " + k);
  assert(all.some((s) => s.route), "side routes exist");

  // 6. plans: loot ids unique + stable, types valid, colliders sane, quality-independent (plans take no options)
  const spawnIds = new Set(); let sedan = null;
  for (const s of all.slice(0, 150)) {
    const p = planSite(s), p2 = planSite(s);
    assert.strictEqual(JSON.stringify([p.spawns, p.vehicleSpawns, p.colliders]), JSON.stringify([p2.spawns, p2.vehicleSpawns, p2.colliders]), "plan not stable");
    for (const sp of p.spawns) {
      assert(!spawnIds.has(sp.id), "duplicate spawn id " + sp.id); spawnIds.add(sp.id);
      assert(sp.id.startsWith(s.id + ":"));
      assert(ITEM_TYPES.includes(sp.type), "unknown item type " + sp.type);
      assert(sp.pos.every(Number.isFinite) && Number.isFinite(sp.yaw));
      assert(Math.floor(sp.pos[2] / CHUNK) === Math.floor(s.z / CHUNK), "spawn outside its site's chunk");
      assert(sp.pos[1] >= s.y - 1e-6 && sp.pos[1] < s.y + 2.2, "spawn height");
      const loc = { x: 0, z: 0 }; S.padFactor(s.pad, sp.pos[0], sp.pos[2], loc);
      assert(Math.abs(loc.x) <= s.pad.hx && Math.abs(loc.z) <= s.pad.hz, "spawn off its pad");
      if (sp.qty !== undefined) assert(sp.qty > 0 && sp.qty <= 20);
      if (sp.cond !== undefined) assert(sp.cond > 0 && sp.cond <= 100);
    }
    for (const v of p.vehicleSpawns) { assert(["sedan", "pickup"].includes(v.type) && !spawnIds.has(v.id)); spawnIds.add(v.id); if (!sedan && v.type === "sedan") sedan = s; }
    for (const c of p.colliders) { assert(c.kind === "box" ? c.hx > 0 && c.hz > 0 && Number.isFinite(c.yaw) : c.r > 0); assert(Number.isFinite(c.x + c.z) && c.y1 > c.y0); }
    for (const dd of p.dyn) { assert(dd.flag.startsWith(dd.kind === "door" ? "door:" : "cont:")); assert(!spawnIds.has(dd.id)); spawnIds.add(dd.id); }
  }
  assert(sedan && sedan.zRoad < 10000, "a recoverable sedan within the first 10 km");
  // start kit
  const sp = planSite(st), count = (t) => sp.spawns.filter((x) => x.type === t).length;
  assert(count("water") >= 2 && count("beans") >= 1 && count("jerky") >= 1 && count("wrench") >= 1 && count("jack") >= 1 && count("wheel_16") >= 1 && count("oil") >= 1);
  assert(sp.spawns.some((x) => x.type === "fuelcan" && Math.abs(x.qty - 6) < 0.01) && sp.spawns.some((x) => x.type === "coolant" && x.qty < 4));
  // the spawn points are free of colliders
  const free = (pt, r) => sp.colliders.every((c) => c.solid === false || (c.kind === "box" ? (() => { const s2 = Math.sin(c.yaw), c2 = Math.cos(c.yaw), dx = pt.x - c.x, dz = pt.z - c.z; return Math.abs(dx * c2 - dz * s2) > c.hx + r || Math.abs(dx * s2 + dz * c2) > c.hz + r; })() : Math.hypot(pt.x - c.x, pt.z - c.z) > c.r + r));
  assert(free(st.playerSpawn, 0.4), "player spawn blocked"); assert(free(st.vehicleSpawn, 2.6), "vehicle spawn blocked");
  assert(!T.onRoad(st.vehicleSpawn.x, st.vehicleSpawn.z) && T.featureClear(st.vehicleSpawn.x, st.vehicleSpawn.z, 0) === false);
  // station targets
  const stp = planSite(stations[0]);
  assert.strictEqual(stp.targets.filter((t) => t.type === "pump").length, 4); assert.strictEqual(stp.targets.filter((t) => t.type === "shop").length, 1);
  assert(planSite(all.find((s) => s.kind === "motel")).targets.filter((t) => t.type === "bed").length >= 5);

  // 7. scenery placement: deterministic, off the road, off pads
  for (const k of [0, 7, 40, 333]) {
    const s1 = scatter(k), s2 = scatter(k);
    assert.strictEqual(JSON.stringify(s1), JSON.stringify(s2));
    for (const c of s1.colliders) { assert(!T.onRoad(c.x, c.z), "scenery collider on the road"); assert(T.featureClear(c.x, c.z, 0), "scenery collider on a pad"); }
  }
  // 8. far from the origin everything still works
  const zf = 250000; assert(Number.isFinite(heightAt(roadX(zf) + 100, zf)) && S.sitesBetween(zf, zf + 20000).length > 5);
  assert(Math.abs(naturalHeight(roadX(zf), zf) - roadY(zf)) < 1e-9);
  console.log(`seed ${seed}: ${all.length} sites over 300 km, ${stations.length} stations, worst 0.5 m step ${worst.toFixed(3)} m (${where})`);
}
console.log("world ok");
