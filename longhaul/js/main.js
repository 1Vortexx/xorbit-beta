// Long Haul – boot, game loop, state machine and the glue between systems.
// Contracts between modules are described in ARCHITECTURE.md.
import * as THREE from "three";
import { on, emit, notify, sfx } from "./core/bus.js";
import { worldRoot, origin, rebase, resetOrigin } from "./core/origin.js";
import { ws } from "./core/worldstate.js";
import { setSeed, getSeed, heightAt, surfaceAt, hashStr } from "./world/terrain.js";
import { startSite, sitesBetween } from "./world/sites.js";
import { World, prepare as prepareWorld, setVehicleLookup } from "./world/index.js";
import { Sky, DAY_SECONDS } from "./sky.js";
import { Weather } from "./weather.js";
import { Vehicles, prepare as prepareVehicles } from "./vehicles/index.js";
import { Player } from "./player.js";
import { Props } from "./props.js";
import { Pockets } from "./pockets.js";
import { Interaction } from "./interact.js";
import { ITEMS, SHOP_STOCK, makeItem, itemLabel } from "./items.js";
import { Needs } from "./survival.js";
import { CameraRig } from "./camera.js";
import { audio } from "./audio.js";
import { music } from "./music.js";
import { initInput, drive, foot, took, isDown, endFrame, releaseAll, requestLock, locked, look, bindingLabel } from "./input.js";
import { hud } from "./ui/hud.js";
import { menus } from "./ui/menus.js";
import { loadSave, writeSave, clearSave, previewOf, loadPrefs, savePrefs, loadBest, saveBest } from "./save.js";
import { watchPerformance, settingsFor, embedded } from "./perf.js";

const STEP = 1 / 120;
const HOUR = DAY_SECONDS / 24;          // real seconds per in-game hour
const DIFF = {
  easy:   { label: "Easygoing", desc: "Slower hunger and thirst, gentler wear, $200 and roadside rescue.", needs: 0.6,  wear: 0.6, money: 200, rescue: true },
  normal: { label: "Survival",  desc: "The intended balance. $120 and roadside rescue when you run dry.", needs: 1,    wear: 1,   money: 120, rescue: true },
  hard:   { label: "Hardcore",  desc: "Fast wear, scarce cash ($50) and nobody stops to help.", needs: 1.3,  wear: 1.5, money: 50,  rescue: false },
};
const DIFF_LIST = Object.entries(DIFF).map(([id, d]) => ({ id, label: d.label, desc: d.desc }));

const $ = (id) => document.getElementById(id);
const canvas = $("game");

// ── Renderer and scene ─────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.add(worldRoot);
const camera = new THREE.PerspectiveCamera(70, 1, 0.08, 5200);
worldRoot.add(camera);
const rig = new CameraRig(camera);

const prefs = loadPrefs();
let settings = settingsFor(false);
let xorbitLite = false;

// Systems (created in boot once their assets are prepared)
let sky, weather, world, vehicles, props, interaction;
const player = new Player();
const pockets = new Pockets();
const needs = new Needs();
const wallet = { money: 0 };

// Journey state
let state = "boot"; // boot | menu | playing | paused | ui | sleeping | dead
const game = {
  diff: "normal", day: 1, vehicle: null /* the Vehicle you sit in */, lights: "auto",
  stats: { distance: 0, litres: 0, sites: 0 }, hints: {}, lastVehicleName: "Pickup",
};
let lastTime = 0.3, blackout = 0, nextBlackout = 20, stuckFor = 0, saveFailed = false, saveError = null;
let menuFocus = { x: 0, y: 0, z: 0, yaw: 0 };
const diff = () => DIFF[game.diff] || DIFF.normal;
const focusPos = () => (game.vehicle ? game.vehicle.pos : player.pos);
const ambient = () => weather.ambient(sky.time);
const fmtDist = (m) => (prefs.units === "mi" ? (m / 1609.34).toFixed(1) + " mi" : (m / 1000).toFixed(1) + " km");

function resize() {
  const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);

function liteNow() { return prefs.quality === "auto" ? xorbitLite : prefs.quality === "lite"; }
function applyQuality() {
  const lite = liteNow();
  settings = settingsFor(lite);
  renderer.setPixelRatio(settings.pixelRatio);
  renderer.shadowMap.enabled = settings.shadows;
  resize();
  if (!world) return;
  sky.setQuality?.({ lite, shadowSize: settings.shadowSize, fogFar: settings.fogFar });
  sky.setLite?.(lite, settings.fogFar);
  weather.setQuality?.({ lite });
  weather.setLite?.(lite);
  weather.baseFar = settings.fogFar;
  world.setOptions({ lite, ahead: settings.ahead, behind: settings.behind });
  vehicles.setQuality?.({ lite });
  scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
  if (state !== "boot") world.update(focusPoints(), true);
}
watchPerformance((lite) => { xorbitLite = lite; applyQuality(); });

function applyPrefs() {
  look.sens = prefs.sens;
  look.invertY = prefs.invertY;
  audio.setVolumes(prefs.vol, prefs.muted);
  music.setVolume(prefs.muted ? 0 : prefs.vol.master * prefs.vol.music);
  hud.applyPrefs(prefs);
  for (const v of vehicles ? vehicles.list : []) v.setGearMode?.(prefs.gearbox);
}
let lastQuality = prefs.quality;
function onPrefs() {
  savePrefs(prefs);
  applyPrefs();
  if (prefs.quality !== lastQuality) { lastQuality = prefs.quality; applyQuality(); }
}

// ── Input mode ─────────────────────────────────────────
function inputMode() {
  if (state === "playing") return game.vehicle ? "drive" : "foot";
  if (state === "ui" || state === "paused") return "overlay";
  return "none";
}

// ── Colliders ──────────────────────────────────────────
const collScratch = [];
// Static world + every loaded vehicle near the point (used by the player, props and the interaction system)
function getColliders(x, z, r = 12) {
  collScratch.length = 0;
  world.collidersNear(x, z, r, collScratch);
  for (const v of vehicles.list) {
    if (Math.abs(v.pos.x - x) > r + 5 || Math.abs(v.pos.z - z) > r + 5) continue;
    for (const c of v.colliders()) collScratch.push(c);
  }
  return collScratch;
}
function focusPoints() {
  const pts = [focusPos()];
  if (game.vehicle && false) pts.push(player.pos);
  return pts;
}

// ── Menus ──────────────────────────────────────────────
function musicInfo() { return music.info(); }
function showMain() {
  state = "menu";
  hud.setVisible(false);
  const { save, error } = loadSave();
  saveError = error;
  const best = loadBest();
  menus.show("main", {
    save: previewOf(save), saveError: error, hostAvailable: false, difficulties: DIFF_LIST, units: prefs.units,
    best, music: musicInfo(),
  });
  music.setContext("menu");
  music.resume();
}

const handlers = {
  onFirstGesture() { audio.start(); music.unlock(); applyPrefs(); },
  onContinue() { const { save } = loadSave(); if (save) startJourney(save); },
  onNewJourney({ difficulty, seed }) { clearSave(); startJourney(null, { difficulty, seed }); },
  onResume() { resume(); },
  onSaveAndMenu() { persist(); toMenu(); },
  onMainMenu() { toMenu(); },
  onPrefs() { onPrefs(); },
  onRadioNext() { music.next(); },
  onReturnToHost() {},
  onCloseOverlay() { if (state === "ui") resume(); },
  onUseSlot(i) { useSlot(i); refreshInventory(); },
  onDropSlot(i) { dropSlot(i); refreshInventory(); },
  onBuy(type) { buy(type); },
};

function toMenu() {
  audio.update({ active: false, wind: 0, rain: 0 });
  releaseAll();
  if (document.pointerLockElement) document.exitPointerLock();
  buildBackdrop();
  showMain();
}

// The scene behind the main menu: the journey's start site with the pickup parked outside
function buildBackdrop() {
  const { save } = loadSave();
  resetJourney(save ? save.seed : 20261113);
  const site = startSite();
  world.update([new THREE.Vector3(site.vehicleSpawn.x, 0, site.vehicleSpawn.z)], true);
  const v = vehicles.spawnStarter(site.vehicleSpawn);
  vehicles.sync([v.pos]);
  menuFocus = { x: v.pos.x, y: v.pos.y, z: v.pos.z, yaw: site.vehicleSpawn.yaw || 0, v };
  sky.time = 0.74; // late afternoon light for the title shot
  weather.restore({ current: "clear", target: "clear", blend: 1, hoursLeft: 6 });
  rig.snap();
}

function resetJourney(seed) {
  game.vehicle = null;
  interaction.clear?.();
  props.clear?.();
  vehicles.clear?.();
  world.clear();
  ws.reset();
  setSeed(seed);
  resetOrigin();
  needs.reset();
  pockets.restore(null);
  wallet.money = 0;
}

function seedFrom(text) {
  if (text === undefined || text === null || String(text).trim() === "") return (Math.random() * 2 ** 31) | 0 || 1;
  const s = String(text).trim();
  return /^\d+$/.test(s) ? (Number(s) >>> 0) || 1 : hashStr(s) || 1;
}

// ── Journey lifecycle ──────────────────────────────────
function startJourney(save, opts = {}) {
  const fresh = !save || !save.world; // new journey, or one carried over from an older version of the game
  resetJourney(save ? save.seed : seedFrom(opts.seed));
  const site = startSite();
  Object.assign(game, {
    diff: save ? save.diff : opts.difficulty || "normal", day: save ? save.day : 1, lights: (save && save.lights) || "auto",
    stats: Object.assign({ distance: 0, litres: 0, sites: 0 }, save && save.stats), hints: (save && save.hints) || {},
  });
  sky.time = save ? save.time : 0.31;
  if (save && save.weather) weather.restore(save.weather);
  else weather.restore({ current: "clear", target: "clear", blend: 1, hoursLeft: 5 });
  if (save) needs.restore(save.needs);
  wallet.money = save && save.wallet ? save.wallet.money : diff().money;

  if (fresh) {
    world.update([new THREE.Vector3(site.playerSpawn.x, 0, site.playerSpawn.z)], true);
    const truck = vehicles.spawnStarter(site.vehicleSpawn);
    player.teleport(site.playerSpawn.x, site.playerSpawn.z, site.playerSpawn.yaw || 0);
    if (save && save.legacy) carryOverLegacy(save.legacy, truck);
    ws.setFlag("site:" + site.id, 1);
  } else {
    ws.restore(save.world);
    player.restore(save.player);
    world.update([player.pos], true);
    vehicles.sync([player.pos]);
    interaction.restore?.(save.interact);
    const v = save.drivenId ? vehicles.get(save.drivenId) : null;
    if (v) seat(v, true);
  }
  vehicles.sync(focusPoints());
  lastTime = sky.time;
  blackout = stuckFor = 0;
  look.yaw = game.vehicle ? 0 : player.yaw;
  look.pitch = 0;
  look.clamp = !!game.vehicle;
  rig.snap();
  music.setContext("none");
  resume();
  if (!save) notify("Day 1. A half-empty tank, a tired truck and a long road east.", { icon: "☀", ms: 6000 });
  else if (save.migrated) notify("Your journey from an older version continues from the garage: day, cash and supplies kept.", { icon: "↻", ms: 8000 });
  else notify(`Day ${game.day}. Back on the road.`, { icon: "☀" });
  persist();
}

// Supplies and truck condition from a version-2 save
function carryOverLegacy(legacy, truck) {
  const map = { water: "water", beans: "beans", jerky: "jerky", coffee: "coffee", medkit: "medkit", repairkit: "repairkit", tyre: "wheel_16", coolant: "coolant", fuelcan: "fuelcan", battery: "battery" };
  let n = 0;
  for (const [old, count] of Object.entries(legacy.items || {})) {
    const type = map[old];
    if (!type || !ITEMS[type]) continue;
    for (let i = 0; i < Math.min(count, 6); i++) {
      const item = makeItem(type);
      if (ITEMS[type].pocket && pockets.add(item)) continue;
      // Bulky things wait on the ground beside the truck
      const a = (n++ / 6) * Math.PI * 2;
      const x = truck.pos.x + Math.cos(a) * 3.2, z = truck.pos.z + Math.sin(a) * 3.2;
      props.spawn(item, new THREE.Vector3(x, heightAt(x, z) + 0.4, z));
    }
  }
  if (typeof legacy.fuel === "number") truck.fuel = Math.max(truck.fuel, Math.min(truck.def.tank, legacy.fuel));
}

function snapshot() {
  vehicles.flush();
  props.flush();
  return {
    seed: getSeed(), time: sky.time, day: game.day, diff: game.diff, lights: game.lights, stats: game.stats, hints: game.hints,
    needs: needs.serialize(), wallet: { money: wallet.money }, weather: weather.serialize(),
    player: player.serialize(), interact: interaction.serialize(), drivenId: game.vehicle ? game.vehicle.id : null,
    vehicleName: game.lastVehicleName, world: ws.serialize(),
  };
}
function persist() {
  if (state === "menu" || state === "dead" || state === "boot") return;
  const ok = writeSave(snapshot());
  if (!ok && !saveFailed) notify("Saving failed: this browser is blocking or out of storage. Progress will be lost when you leave.", { level: "crit", icon: "⚠", key: "save", ms: 9000 });
  saveFailed = !ok;
  const best = loadBest() || { km: 0, days: 0 };
  const km = game.stats.distance / 1000;
  if (km > best.km) saveBest({ km, days: game.day });
}
setInterval(() => { if (state === "playing") persist(); }, 5000);
addEventListener("pagehide", persist);
document.addEventListener("visibilitychange", () => { if (document.hidden) { persist(); pause(); } });
addEventListener("blur", () => pause());

function pause() {
  if (state !== "playing") return;
  state = "paused";
  persist();
  audio.suspend();
  music.pause();
  releaseAll();
  if (document.pointerLockElement) document.exitPointerLock();
  hud.dim(true);
  menus.show("pause", {
    summary: `Day ${game.day} · ${fmtDist(game.stats.distance)} · ${diff().label}`, saved: !saveFailed, music: musicInfo(), hostAvailable: false,
  });
}
function resume() {
  state = "playing";
  menus.hide();
  hud.setVisible(true);
  hud.dim(false);
  audio.start();
  music.resume();
  canvas.focus();
  last = performance.now();
}

function die(cause) {
  state = "dead";
  const best = loadBest() || { km: 0, days: 0 };
  if (game.stats.distance / 1000 > best.km) saveBest({ km: game.stats.distance / 1000, days: game.day });
  clearSave();
  audio.suspend();
  music.setContext("none");
  releaseAll();
  if (document.pointerLockElement) document.exitPointerLock();
  hud.setVisible(false);
  menus.show("gameover", {
    cause: {
      Dehydration: "The heat got you. You ran out of water.",
      Starvation: "You ran out of food, and then out of strength.",
      Exhaustion: "You pushed on too long without sleep.",
      Heatstroke: "The midday sun was too much without water.",
      "A crash": "The last crash was one too many.",
    }[cause] || "The desert won this time.",
    stats: [["Distance", fmtDist(game.stats.distance)], ["Days survived", game.day], ["Places found", game.stats.sites], ["Fuel bought", Math.round(game.stats.litres) + " L"]],
  });
}

// ── Vehicles: getting in and out ───────────────────────
function seat(v, quiet) {
  if (interaction.held) interaction.dropHeld?.();
  game.vehicle = v;
  v.occupied = true;
  v.setGearMode?.(prefs.gearbox);
  game.lastVehicleName = v.def.name;
  look.clamp = true;
  look.yaw = look.pitch = 0;
  rig.snap();
  if (!quiet) sfx("door_close");
  hint("drive");
}
function enterVehicle(v) {
  if (state !== "playing" || game.vehicle) return;
  seat(v);
}
function exitVehicle() {
  const v = game.vehicle;
  if (!v) return;
  if (Math.abs(v.speed) > 2) { notify("Stop before getting out", { key: "exit", icon: "✋" }); return; }
  player.exitVehicle(v, getColliders(v.pos.x, v.pos.z, 10));
  v.occupied = false;
  game.vehicle = null;
  look.clamp = false;
  look.yaw = player.yaw;
  look.pitch = 0;
  sfx("door_open");
}

// ── Shop, pockets, sleep ───────────────────────────────
let shopSite = null;
function openOverlay(name, data) {
  state = "ui";
  releaseAll();
  if (document.pointerLockElement) document.exitPointerLock();
  hud.dim(true);
  menus.show(name, data);
}
function shopData() {
  return { site: shopSite, stock: SHOP_STOCK.map((s) => ({ ...s, name: ITEMS[s.type].name, icon: ITEMS[s.type].icon, desc: ITEMS[s.type].desc || "" })), money: wallet.money };
}
function openShop(site) { shopSite = site; openOverlay("shop", shopData()); }
function buy(type) {
  const entry = SHOP_STOCK.find((s) => s.type === type);
  if (!entry) return;
  if (wallet.money < entry.price) { menus.setMessage("Not enough cash"); sfx("error"); return; }
  wallet.money -= entry.price;
  const item = makeItem(type);
  if (ITEMS[type].pocket && pockets.add(item)) menus.setMessage(`Bought ${ITEMS[type].name}. It's in your pockets.`);
  else {
    const e = player.eye(new THREE.Vector3());
    const f = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
    props.spawn(item, e.addScaledVector(f, 0.9).setY(e.y - 0.45));
    menus.setMessage(`Bought ${ITEMS[type].name}. It's on the counter in front of you.`);
  }
  sfx("cash");
  menus.refresh(shopData());
}
function inventoryData() {
  const v = game.vehicle || nearestVehicle(player.pos, 8);
  return {
    slots: pockets.view(), selected: pockets.selected, held: interaction.held ? { name: itemLabel(interaction.held) } : null,
    needs: needs.serialize(), money: wallet.money,
    vehicle: v ? { name: v.def.name, parts: v.inspect(), tel: v.telemetry() } : null,
    stats: [["Day", game.day], ["Distance", fmtDist(game.stats.distance)], ["Difficulty", diff().label], ["Weather", `${weather.label}, ${Math.round(ambient())}°C`], ["Places found", game.stats.sites], ["Fuel bought", Math.round(game.stats.litres) + " L"]],
  };
}
function refreshInventory() { if (menus.current === "inventory") menus.refresh(inventoryData()); }
function useSlot(i) {
  const r = interaction.consumeSlot(i);
  if (r && r.msg && menus.current === "inventory") menus.setMessage(r.msg);
}
function dropSlot(i) { if (interaction.dropSlot(i)) sfx("drop"); }
function nearestVehicle(p, range) {
  let best = null, bd = range;
  for (const v of vehicles.list) { const d = v.pos.distanceTo(p); if (d < bd) { bd = d; best = v; } }
  return best;
}

function sleep(where) {
  if (state !== "playing") return;
  if (needs.energy > 75) { notify("You're not tired enough to sleep", { key: "sleep", icon: "☾" }); return; }
  state = "sleeping";
  releaseAll();
  hud.dim(true);
  hud.fade(1, "Sleeping…");
  setTimeout(() => {
    const hours = Math.max(1, Math.min(9, (100 - needs.energy) / 13));
    const before = sky.time;
    sky.time = (sky.time + hours / 24) % 1;
    if (sky.time < before) game.day++;
    lastTime = sky.time;
    const temp = ambient();
    needs.update(hours, { temp, sleeping: true, shade: true, rate: diff().needs });
    weather.advance(hours);
    if (game.vehicle) game.vehicle.sleepReset?.(temp);
    setTimeout(() => {
      hud.fade(0, "");
      hud.dim(false);
      if (needs.dead) { die(needs.cause); return; }
      state = "playing";
      last = performance.now();
      notify(`You slept ${Math.round(hours)} hours${where === "bed" ? " in a real bed" : ""}. It's ${sky.clock()} on day ${game.day}.`, { icon: "☾", ms: 5000 });
      persist();
    }, 700);
  }, 900);
}

// ── Onboarding hints: shown once per journey, only when they apply ──
const HINTS = {
  start: () => `Look around the garage. ${bindingLabel("grab")} picks things up, ${bindingLabel("stow")} pockets small items.`,
  cargo: () => `Carry supplies to the truck bed and press ${bindingLabel("grab")} to secure them for the drive.`,
  enter: () => `Aim at the driver's door and press ${bindingLabel("alt")} to get in.`,
  drive: () => `${bindingLabel("ignition")} turns the key. ${bindingLabel("throttle")}/${bindingLabel("brake")} drive, ${bindingLabel("exit")} gets out, ${bindingLabel("camera")} changes view.`,
  station: () => "Fuel ahead. Park beside a pump, get out and hold the use key on the pump to fill up.",
  lowfuel: () => "Low on fuel. A fuel can pours into the filler on the truck's side.",
  hot: () => "The engine is running hot. Stop, open the hood and top up the radiator.",
  tired: () => `You're getting tired. Stop and press ${bindingLabel("sleep")} in the truck, or find a bed.`,
};
function hint(id) {
  if (game.hints[id] || !prefs.hud.help) return;
  game.hints[id] = 1;
  notify(HINTS[id](), { icon: "ⓘ", key: "hint", ms: 9000 });
}
let hintClock = 0;
function updateHints(dt, tel) {
  hintClock += dt;
  if (hintClock > 3) hint("start");
  if (hintClock > 22 && !game.vehicle) hint("cargo");
  if (hintClock > 45 && !game.vehicle) hint("enter");
  if (tel && tel.fuel < tel.tank * 0.15) hint("lowfuel");
  if (tel && tel.overheating) hint("hot");
  if (needs.energy < 25) hint("tired");
}

// ── Discovery ──────────────────────────────────────────
let discoverClock = 0;
function updateDiscovery(dt, p) {
  discoverClock -= dt;
  if (discoverClock > 0) return;
  discoverClock = 0.5;
  for (const s of sitesBetween(p.z - 150, p.z + 400)) {
    if (ws.flag("site:" + s.id)) continue;
    const d = Math.hypot(s.x - p.x, s.z - p.z);
    if (s.kind === "station" && d < 380 && s.z > p.z) hint("station");
    if (d > 70) continue;
    ws.setFlag("site:" + s.id, 1);
    game.stats.sites++;
    notify(`Discovered: ${s.name || s.kind}`, { level: "good", icon: "◎" });
    sfx("discover");
    emit("discover", { site: s });
  }
}

// ── Loop ───────────────────────────────────────────────
let last = performance.now(), acc = 0, fpsT = 0, fpsN = 0;
const perfStats = { fps: 0, calls: 0, tris: 0, geos: 0, tex: 0 };
const IDLE = { throttle: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false };
const hudState = { actions: [], slots: [] };
const NO_UI = { target: null, actions: [], held: null, cargoHint: null, progress: null };
let lastTel = null, rough = 0, lastMotionY = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;

  if (took("pause")) {
    if (state === "playing") pause();
    else if (state === "paused" && menus.current === "pause") resume();
    else if (state === "ui") resume();
  }
  if (took("inventory")) {
    if (state === "playing") openOverlay("inventory", inventoryData());
    else if (state === "ui" && menus.current === "inventory") resume();
  }

  if (state === "playing") tick(dt);
  else if (state === "menu") {
    sky.update(dt * 0.1, camera, menuFocus);
    weather.update(dt, 0, camera, sky);
    vehicles.update(dt, envNow());
    rig.menu(dt, menuFocus, prefs.a11y.reduceMotion);
    rig.finish(dt, 52, 0, 0);
    audio.update({ active: true, tel: null, wind: 0.25, rain: 0 }, dt);
  }
  endFrame();
  if (state !== "boot" && state !== "dead") renderer.render(scene, camera);

  fpsN++; fpsT += dt;
  if (fpsT >= 1) {
    perfStats.fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0;
    perfStats.calls = renderer.info.render.calls; perfStats.tris = renderer.info.render.triangles;
    perfStats.geos = renderer.info.memory.geometries; perfStats.tex = renderer.info.memory.textures;
  }
}

function envNow() {
  return { ambient: ambient(), wet: weather.wet || 0, sand: weather.p.sand || 0, wear: diff().wear, night: sky.night };
}

function tick(dt) {
  const d = diff();
  let v = game.vehicle;

  // One-shot actions
  if (took("mute")) { prefs.muted = !prefs.muted; onPrefs(); notify(prefs.muted ? "Sound off" : "Sound on", { key: "mute", icon: "♪" }); }
  if (took("radioNext")) {
    if (music.info().radio) music.next();
    else notify("No radio tracks installed", { key: "radio", icon: "♪" });
  }
  if (v) {
    if (took("exit")) { exitVehicle(); v = game.vehicle; }
    if (v && took("camera")) {
      prefs.camera = prefs.camera === "cab" ? "chase" : "cab";
      savePrefs(prefs);
      look.yaw = look.pitch = 0;
      rig.snap();
      notify(prefs.camera === "cab" ? "Cab view" : "Chase view", { key: "cam", icon: "◉" });
    }
    if (v && took("ignition")) v.toggleIgnition();
    if (v && took("parkingBrake")) v.toggleParkingBrake();
    if (v && took("gearMode")) {
      prefs.gearbox = prefs.gearbox === "auto" ? "manual" : "auto";
      onPrefs();
      notify(prefs.gearbox === "auto" ? "Automatic gearbox" : `Manual gearbox: ${bindingLabel("shiftUp")} up, ${bindingLabel("shiftDown")} down`, { key: "gear", icon: "⚙" });
    }
    if (v && took("lights")) {
      game.lights = { auto: "on", on: "off", off: "auto" }[game.lights];
      notify("Headlights: " + game.lights, { key: "lights", icon: "☼" });
    }
    if (v && took("sleep")) {
      if (Math.abs(v.speed) > 1) notify("Pull over and stop to sleep", { key: "sleep", icon: "☾" });
      else { sleep("cab"); return; }
    }
    if (v && took("recover")) recover(v, d);
  }

  // Driver input (none when blacking out)
  let input = IDLE;
  if (v) {
    input = drive();
    if (needs.energy <= 0) {
      nextBlackout -= dt;
      if (nextBlackout <= 0) { blackout = 1.6; nextBlackout = 10 + Math.random() * 20; notify("You nod off at the wheel…", { level: "crit", icon: "☾" }); }
    }
    if (blackout > 0) { blackout -= dt; input = IDLE; }
    v.horn?.(isDown("horn"));
  }
  hud.fade(blackout > 0 ? 0.85 : 0, "");

  // Physics
  const env = envNow();
  const lightsOn = game.lights === "on" || (game.lights === "auto" && (sky.night || weather.p.fog < 0.4));
  if (v) v.setLights(lightsOn);
  acc += dt;
  let steps = 0, first = true;
  while (acc >= STEP && steps < 12) {
    vehicles.step(STEP, v, first ? input : { ...input, shiftUp: false, shiftDown: false }, env);
    first = false; acc -= STEP; steps++;
  }
  if (steps === 12) acc = 0;
  vehicles.update(dt, env);

  const tel = v ? v.telemetry() : null;
  lastTel = tel;
  if (tel) {
    game.stats.distance += Math.abs(tel.speed) * dt;
    if (tel.impact > 0.5) {
      needs.hurt(tel.impact * 0.45, "A crash");
      rig.shake(tel.impact * 0.02);
      sfx("thud", { vol: Math.min(1, tel.impact / 20) });
    }
    stuckFor = v.upright !== undefined && v.upright < 0.45 && Math.abs(tel.speed) < 2 ? stuckFor + dt : 0;
    const my = v.camMotion ? v.camMotion.y || 0 : 0;
    rough += (Math.min(1, Math.abs(my - lastMotionY) * 60) - rough) * Math.min(1, dt * 6);
    lastMotionY = my;
  }

  // On foot
  let ui = NO_UI;
  const temp = env.ambient;
  if (!v) {
    const fi = foot();
    player.yaw = look.yaw;
    player.pitch = look.pitch;
    player.update(dt, fi, getColliders(player.pos.x, player.pos.z, 10), { needs, canSprint: needs.energy > 8, camMotion: prefs.a11y.reduceMotion ? 0 : prefs.camMotion });
    look.yaw = player.yaw;
    player.applyCamera(camera);
    camera.updateMatrixWorld(true);
    ui = interaction.update(dt, fi) || NO_UI;
    if (game.vehicle) v = game.vehicle; // got in this frame
  }
  props.update(dt);

  // Needs
  const indoors = !v && !!world.indoorsAt?.(player.pos.x, player.pos.z);
  needs.update(dt / HOUR, { temp, sprinting: !v && player.sprinting, sleeping: false, shade: !!v || indoors, rate: d.needs });
  if (needs.dead) { die(needs.cause); return; }

  // World
  const at = focusPos();
  sky.update(dt, camera, at);
  if (sky.time < lastTime) game.day++;
  lastTime = sky.time;
  weather.update(dt, dt / HOUR, camera, sky);
  const pts = focusPoints();
  world.update(pts, false);
  vehicles.sync(pts);
  rebase(at);
  updateDiscovery(dt, at);
  updateHints(dt, tel);

  // Camera
  const motion = prefs.a11y.reduceMotion ? 0 : prefs.camMotion;
  if (v) {
    if (prefs.camera === "cab") rig.cab(dt, v, look, motion);
    else rig.chase(dt, v, look);
  }
  rig.finish(dt, prefs.fov, tel ? Math.abs(tel.speed) : 0, motion);

  // Sound
  let heard = tel, dist = 0;
  if (!v) {
    const nv = nearestVehicle(player.pos, 45);
    if (nv) { const t = nv.telemetry(); if (t.ignition === "running" || t.ignition === "cranking") { heard = t; dist = nv.pos.distanceTo(player.pos); } }
  }
  audio.update({
    active: true, tel: heard, inCab: !!v, dist, indoors, rough: v ? rough : 0,
    wind: (weather.p.sand || 0) + (weather.p.rain || 0) * 0.5, rain: weather.p.rain || 0, horn: !!v && isDown("horn"),
  }, dt);
  music.setContext(v && prefs.radio && tel.ignition !== "off" ? "radio" : "none");

  // HUD
  const h = hudState;
  h.mode = v ? "drive" : "foot";
  h.units = prefs.units;
  h.tel = tel;
  h.vehicleName = v ? v.def.name : "";
  h.needs = needs;
  h.stamina = player.stamina;
  h.sprinting = !v && player.sprinting;
  h.day = game.day; h.clock = sky.clock(); h.weather = weather.label; h.tempC = Math.round(temp);
  h.money = wallet.money; h.trip = game.stats.distance;
  h.target = ui.target; h.actions = ui.actions; h.held = ui.held; h.cargoHint = ui.cargoHint; h.progress = ui.progress;
  h.slots = pockets.view(); h.selected = pockets.selected;
  h.lite = settings.lite;
  h.locked = locked();
  h.prompt = v ? drivePrompt(v, tel, d) : null;
  hud.update(h);
  const tired = needs.energy < 15 ? (15 - needs.energy) / 15 : 0;
  const hurt = needs.health < 35 ? (35 - needs.health) / 35 : 0;
  hud.setVignette({ hurt, tired });
}

// A single line of help for the driver when something needs doing
function drivePrompt(v, tel, d) {
  if (stuckFor > 1.5) return `Press ${bindingLabel("recover")} to put the vehicle back on its wheels`;
  if (tel.ignition === "off") return `Press ${bindingLabel("ignition")} to turn the key`;
  if (tel.ignition === "on" && tel.fuel <= 0 && Math.abs(tel.speed) < 1) return d.rescue ? `Out of fuel. Press ${bindingLabel("recover")} to flag down a passing driver.` : "Out of fuel";
  if (tel.ignition === "on") return `Engine stopped. Press ${bindingLabel("ignition")} to start it.`;
  return null;
}

function recover(v, d) {
  const tel = v.telemetry();
  if (tel.fuel <= 0 && Math.abs(tel.speed) < 1 && stuckFor < 0.5) {
    if (!d.rescue) { notify("Nobody's coming out here. You're on your own.", { level: "warn", icon: "⚠" }); return; }
    const cost = Math.min(wallet.money, 20);
    wallet.money -= cost;
    v.fuel = Math.min(v.def.tank, v.fuel + 10);
    notify(cost ? `A passing driver sells you 10 L for $${cost}` : "A passing driver spares you 10 L for free", { level: "good", icon: "⛽", ms: 5000 });
    return;
  }
  if (Math.abs(tel.speed) < 4 || stuckFor > 0.5) {
    v.recover();
    stuckFor = 0;
    rig.snap();
    notify("Back on its wheels", { key: "recover", icon: "↺" });
  }
}

// ── Boot ───────────────────────────────────────────────
async function boot() {
  resize();
  menus.init({ prefs, handlers, difficulties: DIFF_LIST });
  hud.init({ prefs });
  hud.setVisible(false);
  initInput(canvas, inputMode);
  on("pause:request", () => pause());
  on("fuel:bought", (e) => { game.stats.litres += (e && e.litres) || 0; });
  on("music:track", (t) => { menus.setNowPlaying?.(t); hud.setNowPlaying?.(t); });
  canvas.addEventListener("click", () => { if (state === "playing" && !locked()) requestLock(); });

  const report = (base, span) => (pct, label) => menus.show("loading", { pct: base + span * Math.max(0, Math.min(1, pct)), label });
  menus.show("loading", { pct: 0, label: "Warming up" });
  try {
    const musicReady = music.init();
    await prepareWorld(report(0.02, 0.5));
    await prepareVehicles(report(0.52, 0.4));
    menus.show("loading", { pct: 0.95, label: "Parking the truck" });
    sky = new Sky(worldRoot, scene);
    weather = new Weather(worldRoot, scene);
    weather.onThunder = () => sfx("thunder");
    world = new World({ root: worldRoot });
    vehicles = new Vehicles({ root: worldRoot, getColliders: (x, z, r) => world.collidersNear(x, z, r) });
    setVehicleLookup?.((x, z, r) => { let best = null, bd = r; for (const c of vehicles.list) { const dd = Math.hypot(c.pos.x - x, c.pos.z - z); if (dd < bd && Math.abs(c.speed) < 1) { bd = dd; best = c; } } return best; });
    props = new Props({ root: worldRoot, getColliders, getVehicle: (id) => vehicles.get(id) });
    interaction = new Interaction({
      camera, player, props, pockets,
      hooks: { enterVehicle, openShop, sleep, wallet, needs, getColliders },
    });
    await musicReady;
    applyQuality();
    applyPrefs();
    buildBackdrop();
    showMain();
    requestAnimationFrame(frame);
  } catch (e) {
    console.error(e);
    menus.show("loading", { pct: 1, label: "Long Haul could not start: " + (e && e.message ? e.message : e), error: true });
  }
}
boot();

// Handy for testing from the console
window.__lh = {
  get state() { return state; }, game, prefs, needs, wallet, player, pockets, ws, perfStats, renderer, camera,
  get world() { return world; }, get vehicles() { return vehicles; }, get props() { return props; }, get interaction() { return interaction; },
  get sky() { return sky; }, get weather() { return weather; }, get tel() { return lastTel; }, origin,
  startJourney, persist, pause, resume, snapshot, seat, exitVehicle, getColliders, handlers, music, audio,
  tick, makeItem,
};
