// Long Haul – dev map: a throwaway journey for testing items. The player stands at a firing range a few hundred
// metres down the road from home, with every loose item laid out in rows, practice targets downrange and one of
// each vehicle on the shoulder. Never saved. Shown on the main menu on localhost or with ?dev=1.
//   7  respawn the targets      8  refill: full magazines, ammo boxes, health, needs, cash
//   9  spawn the next vehicle in front of you      0  show / hide this help
import * as THREE from "three";
import { ITEMS, makeItem } from "./items.js";
import { roadX, roadDir } from "./world/base.js";
import { sitesBetween } from "./world/sites.js";
import { notify } from "./core/bus.js";

export const DEV_AVAILABLE = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
  || new URLSearchParams(location.search).get("dev") === "1";
export const DEV_SEED = "devmap";

const TARGETS = [[8, -2], [8, 2], [15, 0], [25, -4], [25, 4], [40, 0], [70, 0]];     // [metres downrange, metres right]
const VEHICLES = ["pickup", "poopmobile", "sedan", "meridian"];
const ROW = 0.75;                                                                 // spacing of the laid-out items

let ctx = null, help = null, keyFn = null, frame = null, targets = [], nextVehicle = 0;

// Open ground beside the road, clear of sites and fences: returns { x, z, yaw (facing away from the road), f, r }
function rangeSpot(fromZ) {
  let z = fromZ + 350;
  for (let n = 0; n < 40 && sitesBetween(z - 180, z + 180).length; n++) z += 120;
  const d = roadDir(z), side = 1;
  const n = { x: d.z * side, z: -d.x * side };                     // perpendicular to the road
  const x = roadX(z) + n.x * 26, zz = z + n.z * 26;            // past the ranch fence some stretches have at 17 m
  return { x, z: zz, yaw: Math.atan2(n.x, n.z), f: n, r: { x: -n.z, z: n.x } };
}

export const devmap = {
  active: false,

  // Call right after a fresh journey has started.
  // c: { player, props, npcs, vehicles, world, pockets, interaction, needs, wallet, site, playing() }
  setup(c) {
    ctx = c; this.active = true;
    const s = frame = rangeSpot(c.site.z);
    const at = (fwd, right) => ({ x: s.x + s.f.x * fwd + s.r.x * right, z: s.z + s.f.z * fwd + s.r.z * right });
    c.world.update([new THREE.Vector3(s.x, 0, s.z)], true);
    c.player.teleport(s.x, s.z, s.yaw);

    // Every loose item: weapons and ammo first, then everything else; engines are left out (290 kg each)
    const types = Object.keys(ITEMS).filter((t) => !/^engine_/.test(t));
    const first = ["knife", "handgun", "ak47", "ammo_9mm", "ammo_762"];
    types.sort((a, b) => (first.includes(b) ? 1 : 0) - (first.includes(a) ? 1 : 0) || first.indexOf(a) - first.indexOf(b));
    const perRow = 8;
    types.forEach((type, i) => {
      const row = Math.floor(i / perRow), col = i % perRow - (perRow - 1) / 2;
      const p = at(2.2 + row * ROW, col * ROW);
      c.props.spawn(makeItem(type), [p.x, c.props.heightAt(p.x, p.z) + 0.02, p.z], { base: true, yaw: s.yaw });
    });
    // Spare ammo next to the guns
    for (let k = 0; k < 3; k++) for (const [type, right] of [["ammo_9mm", 0.5], ["ammo_762", 1.2]]) {
      const p = at(1.4, right + k * 0.25 - 3.5);
      c.props.spawn(makeItem(type), [p.x, c.props.heightAt(p.x, p.z) + 0.02, p.z], { base: true, yaw: s.yaw });
    }
    // The guns in your pockets too, loaded
    c.pockets.add(makeItem("handgun")); c.pockets.add(makeItem("ammo_9mm"));

    this.spawnTargets();
    // One of each vehicle along the shoulder behind you
    VEHICLES.forEach((type, i) => {
      const p = at(-3.5, (i - 1) * 6.5);
      c.vehicles.spawn({ id: "dev:" + type, type, seed: 7 + i, pristine: true, x: p.x, z: p.z, yaw: s.yaw + Math.PI / 2 });
    });
    c.wallet.money = 5000;

    keyFn = (e) => {
      if (!this.active || e.repeat || !c.playing()) return;
      if (e.code === "Digit7") { this.spawnTargets(); notify("Targets reset", { key: "dev" }); }
      else if (e.code === "Digit8") this.refill();
      else if (e.code === "Digit9") this.spawnVehicle();
      else if (e.code === "Digit0") help.style.display = help.style.display === "none" ? "" : "none";
    };
    addEventListener("keydown", keyFn);
    help = document.createElement("div");
    help.style.cssText = "position:fixed;left:12px;top:60px;z-index:40;padding:8px 11px;border-radius:5px;background:rgba(0,0,0,.55);"
      + "color:#eee;font:12px/1.55 system-ui,sans-serif;pointer-events:none;white-space:pre";
    help.textContent = "DEV MAP · not saved\n7  reset targets\n8  refill ammo, health, needs, cash\n9  spawn next vehicle (pickup / Poopmobile / sedan)\n0  hide this";
    document.body.append(help);
    notify("Dev map: items laid out ahead, targets downrange, vehicles behind you", { key: "dev", ms: 6000 });
  },

  spawnTargets() {
    const c = ctx, s = frame;
    for (const n of targets) if (c.npcs.get(n.id)) c.npcs.remove(n);
    targets = TARGETS.map(([fwd, right], i) => {
      const x = s.x + s.f.x * (fwd + 6) + s.r.x * right, z = s.z + s.f.z * (fwd + 6) + s.r.z * right;
      return c.npcs.spawn({ id: "dev:target" + i + ":" + Date.now(), role: "guard", seed: 11 + i, x, z, yaw: s.yaw + Math.PI, name: `Target ${fwd} m` });
    });
  },

  refill() {
    const c = ctx;
    const fill = (it) => { const d = ITEMS[it.type]; if (d && d.cap && (d.kind === "weapon" || d.kind === "ammo")) it.qty = d.cap; };
    if (c.interaction.held) fill(c.interaction.held);
    for (const sl of c.pockets.slots) if (sl) for (const it of sl.items) fill(it);
    if (!c.pockets.has("ammo_9mm")) c.pockets.add(makeItem("ammo_9mm"));
    if (!c.pockets.has("ammo_762")) c.pockets.add(makeItem("ammo_762"));
    Object.assign(c.needs, { health: 100, hunger: 100, thirst: 100, energy: 100 });
    c.wallet.money = Math.max(c.wallet.money, 5000);
    notify("Refilled: ammo, health, needs and cash", { key: "dev" });
  },

  spawnVehicle() {
    const c = ctx, pl = c.player, type = VEHICLES[nextVehicle++ % VEHICLES.length];
    const x = pl.pos.x + Math.sin(pl.yaw) * 6, z = pl.pos.z + Math.cos(pl.yaw) * 6;
    c.vehicles.spawn({ type, seed: 20 + nextVehicle, pristine: true, x, z, yaw: pl.yaw + Math.PI / 2 });
    notify(`Spawned ${type === "poopmobile" ? "The Poopmobile" : type}`, { key: "dev" });
  },

  teardown() {
    if (!this.active) return;
    this.active = false;
    if (keyFn) removeEventListener("keydown", keyFn);
    help?.remove();
    keyFn = help = ctx = frame = null; targets = [];
  },
};
