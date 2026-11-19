// Long Haul – boot, game loop, state machine and the glue between systems.
// Contracts between modules are described in ARCHITECTURE.md.
import * as THREE from "three";
import { on, emit, notify, sfx } from "./core/bus.js";
import { worldRoot, origin, rebase, resetOrigin } from "./core/origin.js";
import { ws } from "./core/worldstate.js";
import { setSeed, getSeed, heightAt, surfaceAt, hashStr, roadX, roadDir } from "./world/terrain.js";
import { resolveCircle, circleFree } from "./core/collide.js";
import { startSite, sitesBetween } from "./world/sites.js";
import { World, prepare as prepareWorld, setVehicleLookup, setSiteFilter } from "./world/index.js";
import { Sky, DAY_SECONDS } from "./sky.js";
import { Weather } from "./weather.js";
import { Vehicles, prepare as prepareVehicles } from "./vehicles/index.js";
import { Npcs, prepare as prepareNpcs } from "./npc/index.js";
import { Hitchhikers } from "./npc/hitch.js";
import { Encounters } from "./encounters/index.js";
import { makeStock } from "./stock.js";
import { Player } from "./player.js";
import { Props } from "./props.js";
import { Pockets } from "./pockets.js";
import { Interaction } from "./interact.js";
import { ITEMS, SHOP_STOCK, makeItem, itemLabel } from "./items.js";
import { Needs, crashInjury, fallInjury, CRAWL_BELOW, STAND_AT } from "./survival.js";
import { CameraRig } from "./camera.js";
import { audio } from "./audio.js";
import { music } from "./music.js";
import { BINDINGS, initInput, drive, foot, took, isDown, endFrame, releaseAll, requestLock, locked, look, bindingLabel } from "./input.js";
import { hud } from "./ui/hud.js";
import { photo } from "./photo.js";
import { Combat } from "./combat.js";
import { devmap, DEV_AVAILABLE, DEV_SEED } from "./devmap.js";
import { menus } from "./ui/menus.js";
import { loadSave, writeSave, clearSave, checkSave, previewOf, loadPrefs, savePrefs, loadBest, saveBest } from "./save.js";
import { watchPerformance, settingsFor, embedded } from "./perf.js";
import { loadCareer, saveCareer, tripOf, track, endTrip, totals, unlock, mergeAchievements, ACHIEVEMENTS } from "./career.js";
import { Convoy } from "./convoy.js";
import { Body } from "./body.js";
import { MapMemory, Minimap, MapView, KIND_STYLE } from "./map.js";
import { EngineSmoke } from "./smoke.js";
import { identity, signIn, signOut, logLaunch, newTripId, reportTrip, pushAchievements, fetchAchievements, fetchBoard, fetchMine, putSave, getSave, dropSave } from "./online.js";

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
let npcs, hitch, encounters, dialogueSpec, subtitle, combat;
const player = new Player();
const pockets = new Pockets();
const needs = new Needs();
const wallet = { money: 0 };

// Journey state
let state = "boot"; // boot | menu | playing | photo | paused | ui | sleeping | dead
const game = {
  diff: "normal", day: 1, vehicle: null /* the Vehicle you sit in */, lights: "auto",
  stats: { distance: 0, litres: 0, sites: 0, escapes: 0, rides: 0 }, hints: {}, lastVehicleName: "Pickup", tripId: null,
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
  npcs?.setQuality({ lite });
  scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
  if (state !== "boot") world.update(focusPoints(), true);
}
watchPerformance((lite) => { xorbitLite = lite; applyQuality(); });

function syncLookLimit() {
  look.clamp = (!!game.vehicle || !!game.riding) && prefs.camera === "cab";
  if (look.clamp) look.yaw = Math.max(-2.2, Math.min(2.2, look.yaw));
}

function applyPrefs() {
  syncLookLimit();
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
  if (state === "playing") return game.vehicle || game.riding ? "drive" : "foot";
  if (state === "photo") return "photo";
  if (state === "sleeping" && game.zz && !game.zz.go) return "drive";     // lying awake: the sleep key or Esc gets up
  if (state === "ui" || state === "paused") return "overlay";
  return "none";
}

// ── Colliders ──────────────────────────────────────────
const collScratch = [];
// Static world + every loaded vehicle near the point (used by the player, props and the interaction system)
function terrainColliders(x, z, r, out = []) {
  world.collidersNear(x, z, r, out);
  encounters?.colliders(x, z, r, out);
  if (convoy.active) convoy.colliders(x, z, r, out, false);     // convoy people; their trucks come through the vehicle step
  return out;
}
function getColliders(x, z, r = 12) {
  collScratch.length = 0;
  terrainColliders(x, z, r, collScratch);
  npcs?.colliders(x, z, r, collScratch);
  for (const v of vehicles.list) {
    if (Math.abs(v.pos.x - x) > r + 5 || Math.abs(v.pos.z - z) > r + 5) continue;
    for (const c of v.colliders()) collScratch.push(c);
  }
  if (convoy.active) for (const car of convoy.ghostCars(x, z, r + 8)) collScratch.push(...car.colliders());
  return collScratch;
}
function focusPoints() {
  const pts = [focusPos()];
  encounters?.focusPoints(pts);
  return pts;
}

// ── Menus ──────────────────────────────────────────────
function musicInfo() { return music.info(); }
function showMain() {
  audio.stopDeath();
  state = "menu";
  hud.setVisible(false);
  const { save, error } = loadSave();
  saveError = error;
  const best = loadBest();
  menus.show("main", {
    save: previewOf(save), saveError: error, hostAvailable: false, difficulties: DIFF_LIST, units: prefs.units,
    best, music: musicInfo(), dev: DEV_AVAILABLE, account: identity(), acct: accountView(), career: careerView(), convoy: convoyView(),
  });
  checkCloud(save);
  music.setContext("menu");
  music.resume();
}

const handlers = {
  onFirstGesture() { audio.start(); music.unlock(); applyPrefs(); },
  onContinue() {
    // The account's copy of this same journey is newer (played on another device): carry on from that
    if (cloud && cloud.same && cloud.newer) { writeSave(cloud.save); cloud = null; }
    const { save } = loadSave(); if (save) startJourney(save);
  },
  // A different journey kept on the account: it replaces the one on this device
  onContinueCloud() {
    if (!cloud) return;
    writeSave(cloud.save); cloud = null;
    const { save } = loadSave(); if (save) startJourney(save);
  },
  onNewJourney(opts) { if (loadSave().save) finishTrip("Abandoned"); clearSave(); startJourney(null, opts); },
  // A throwaway test range; your saved journey is left alone
  onDevMap() {
    devmap.active = true;                     // before startJourney: its closing persist() must not touch the save
    startJourney(null, { seed: DEV_SEED, difficulty: "easy", hostile: false });
    devmap.setup({ player, props, npcs, vehicles, world, pockets, interaction, needs, wallet, site: startSite(), playing: () => state === "playing" });
    look.yaw = player.yaw;
  },
  onDialogueChoice(id) {
    const spec = dialogueSpec;
    if (state !== "ui" || !spec?.choices.some(c => c.id === id && !c.disabled)) return;
    dialogueSpec = null;
    resume();
    spec.onChoose(id);
    if (state === "playing" && needs.dead) die(needs.cause);
    persist();
  },
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
  async onOpenCareer() {
    const user = identity();
    const cloud = user ? await fetchMine(user) : null;
    if (menus.screen === "leaderboard") menus.refresh({ cloud });
  },
  onMapCanvas(canvas) { mapView.attach(canvas, mapData); },
  onMapZoom(f) { mapView.zoom(f); },
  onMapCentre() { mapView.centre(); },
  onOpenAccount() { accountMsg = ""; refreshAccount(); },
  async onSignIn(id, password) {
    if (accountBusy || state !== "menu") return;
    accountBusy = true; accountMsg = "Signing in…"; refreshAccount();
    const r = await signIn(id, password);
    accountBusy = false;
    accountMsg = r.user ? `Signed in as @${r.user}.`
      : r.error === "blocked" ? `This account is blocked${r.reason ? ": " + r.reason : "."}`
      : r.error === "offline" ? "X-ORBIT can't be reached right now. Check your connection and try again."
      : "Wrong username, email or password.";
    if (r.user) accountChanged(); else refreshAccount();
    return !!r.user;
  },
  onSignOut() { signOut(); accountMsg = "Signed out."; accountChanged(); },
  onOpenConvoy() { convoyMsg = ""; refreshConvoy(); },
  onConvoyHost() {
    if (devmap.active || state === "menu" || convoy.active) return;
    convoy.host(myName(), convoyInfo);
    convoyMsg = "";
    refreshConvoy();
  },
  onConvoyLeave() { convoy.leave(); convoyMsg = "You left the convoy."; refreshConvoy(); },
  async onVoice(what) {
    const v = convoy.voice;
    if (what === "on") { convoyMsg = "Asking for the microphone…"; refreshConvoy(); convoyMsg = (await v.start()) ? "Voice is on." : ""; }
    else if (what === "off") { v.stop(); convoyMsg = "Voice is off."; }
    else if (what === "mute") { v.muted = !v.muted; v.applyMic(); convoyMsg = ""; }
    else if (what === "mode") { prefs.voiceMode = prefs.voiceMode === "ptt" ? "open" : "ptt"; savePrefs(prefs); convoyMsg = ""; }
    syncVoice();
    refreshConvoy();
  },
  async onConvoyJoin(code) {
    code = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (convoyBusy || convoy.active) return;
    if (code.length !== 5) { convoyMsg = "A convoy code has 5 letters and numbers."; refreshConvoy(); return; }
    const fromMenu = state === "menu";
    convoyBusy = true; convoyMsg = `Looking for convoy ${code}…`; refreshConvoy();
    let info = null;
    try { info = await convoy.join(code, myName(), convoyInfo); }
    catch (e) {
      convoyMsg = e.message === "full" ? "That convoy is full (6 drivers)."
        : `No convoy found with code ${code}. Check the code, and that someone in it is playing right now.`;
    }
    convoyBusy = false;
    if (!info) { refreshConvoy(); return; }
    if (fromMenu) {
      if (state !== "menu") { convoy.leave(); return; }
      // A new journey on the convoy's road, time of day and weather, starting just behind whoever answered
      handlers.onNewJourney({ seed: String(info.seed), difficulty: info.diff, hostile: info.hostile !== false });
      if (typeof info.time === "number") { sky.time = info.time; lastTime = sky.time; }
      if (info.weather) weather.restore(info.weather);
      regroup(info);
      notify(`Joined convoy ${code}. Your truck is just behind @${info.n}.`, { level: "good", icon: "⛟", ms: 6000 });
    } else if ((info.seed >>> 0) !== getSeed()) {
      convoy.leave();
      convoyMsg = "That convoy is on a different road. Join it from the main menu instead: it starts a new journey on their road.";
    } else {
      regroup(info);
      convoyMsg = `Joined convoy ${code}. You're just behind @${info.n}.`;
    }
    refreshConvoy();
  },
  async onOpenBoard(kind) {
    boardKind = kind;
    menus.refresh({ board: { kind, loading: true } });
    const user = identity(), res = await fetchBoard(kind, user);
    if (boardKind !== kind || menus.screen !== "leaderboard") return;
    menus.refresh({ board: res ? { kind, user, ...res } : { kind, error: true } });
  },
};
let boardKind = null;

function toMenu() {
  convoy.leave();
  devmap.teardown();
  audio.update({ active: false, wind: 0, rain: 0 });
  releaseAll();
  if (document.pointerLockElement) document.exitPointerLock();
  buildBackdrop();
  showMain();
}

// The scene behind the main menu: the journey's start site with the pickup parked outside
function buildBackdrop() {
  sitesLive = false;
  const { save } = loadSave();
  resetJourney(save ? save.seed : 20261113);
  const site = startSite();
  world.update([new THREE.Vector3(site.vehicleSpawn.x, 0, site.vehicleSpawn.z)], true);
  const v = vehicles.spawnStarter(site.vehicleSpawn, getSeed());
  vehicles.sync([v.pos]);
  menuFocus = { x: v.pos.x, y: v.pos.y, z: v.pos.z, yaw: site.vehicleSpawn.yaw || 0, v };
  sky.time = 0.74; // late afternoon light for the title shot
  weather.restore({ current: "clear", target: "clear", blend: 1, hoursLeft: 6 });
  rig.snap();
}

function resetJourney(seed) {
  dialogueSpec = subtitle = null;
  smoke?.clear();
  encounters?.clear(); hitch?.clear(); npcs?.clear();
  game.vehicle = game.parked = game.zz = game.ejected = null;
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
  audio.stopDeath();
  const fresh = !save || !save.world; // new journey, or one carried over from an older version of the game
  resetJourney(save ? save.seed : seedFrom(opts.seed));
  sitesLive = true;
  mapMemory.restore(save && save.map);
  const site = startSite();
  Object.assign(game, {
    playTime: save?.playTime || 0, hostile: (save || opts).hostile !== false,
    diff: save ? save.diff : opts.difficulty || "normal", day: save ? save.day : 1, lights: (save && save.lights) || "auto",
    stats: Object.assign({ distance: 0, litres: 0, sites: 0, escapes: 0, rides: 0 }, save && save.stats), hints: (save && save.hints) || {},
    tripId: (save && save.tripId) || newTripId(), riding: null,
  });
  lastUpload = -Infinity;
  sky.time = save ? save.time : 0.31;
  if (save && save.weather) weather.restore(save.weather);
  else weather.restore({ current: "clear", target: "clear", blend: 1, hoursLeft: 5 });
  if (save) needs.restore(save.needs);
  wallet.money = save && save.wallet ? save.wallet.money : diff().money;

  if (fresh) {
    world.update([new THREE.Vector3(site.playerSpawn.x, 0, site.playerSpawn.z)], true);
    const truck = vehicles.spawnStarter(site.vehicleSpawn, getSeed());
    pockets.add(makeItem("knife"));            // everyone leaves home with a knife
    player.teleport(site.playerSpawn.x, site.playerSpawn.z, site.playerSpawn.yaw || 0);
    if (save && save.legacy) carryOverLegacy(save.legacy, truck);
    ws.setFlag("site:" + site.id, 1);
  } else {
    ws.restore(save.world);
    player.restore(save.player);
    // A seated player's on-foot position can be kilometres behind their truck.
    const parked = save.drivenId && ws.vehicles.get(save.drivenId);
    const resumeAt = parked?.pos ? new THREE.Vector3().fromArray(parked.pos) : player.pos;
    world.update([resumeAt], true);
    vehicles.sync([resumeAt]);
    interaction.restore?.(save.interact);
    const v = save.drivenId ? vehicles.ensure(save.drivenId) : null;
    if (v) seat(v, true);
  }
  vehicles.sync(focusPoints());
  lastTime = sky.time;
  blackout = stuckFor = 0;
  look.yaw = game.vehicle ? 0 : player.yaw;
  look.pitch = 0;
  syncLookLimit();
  rig.snap();
  music.setContext("none");
  hud.setNowPlaying?.(null); // the menu track is fading out; do not announce it over the game
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
  encounters?.flush(); hitch?.flush();
  vehicles.flush();
  props.flush();
  return {
    tripId: game.tripId, hostile: game.hostile, playTime: game.playTime, seed: getSeed(), time: sky.time, day: game.day, diff: game.diff, lights: game.lights, stats: game.stats, hints: game.hints,
    needs: needs.serialize(), wallet: { money: wallet.money }, weather: weather.serialize(),
    player: player.serialize(), interact: interaction.serialize(), drivenId: game.vehicle ? game.vehicle.id : null,
    vehicleName: game.lastVehicleName, world: ws.serialize(), map: mapMemory.serialize(),
  };
}
function persist() {
  if (state === "menu" || state === "dead" || state === "boot" || devmap.active) return;     // the dev map is never saved
  const ok = writeSave(snapshot());
  if (!ok && !saveFailed) notify("Saving failed: this browser is blocking or out of storage. Progress will be lost when you leave.", { level: "crit", icon: "⚠", key: "save", ms: 9000 });
  saveFailed = !ok;
  const best = loadBest() || { km: 0, days: 0 };
  const km = game.stats.distance / 1000;
  if (km > best.km) saveBest({ km, days: game.day });
  careerTick();
  cloudSave(state !== "playing");
}

// ── Career and the X-ORBIT account ─────────────────────
// Lifetime totals and achievements live on this browser (career.js); when signed in to X-ORBIT the journey is also
// reported to the account and the global leaderboard (online.js) about once a minute, and when it ends.
let careerOwner = identity(), career = loadCareer(careerOwner);
let lastReport = -Infinity;
const keepCareer = () => saveCareer(career, careerOwner);
function careerTick() {
  if (devmap.active || !game.tripId) return;
  if (career.live && career.live.id !== game.tripId) endTrip(career);   // a journey that ended without us seeing it
  track(career, tripOf(game));
  const got = unlock(career);
  for (const a of got) notify(`Achievement unlocked: ${a.name}`, { level: "good", icon: "★", key: "ach-" + a.id, ms: 6000 });
  keepCareer();
  const user = identity();
  if (!user) return;
  if (got.length) pushAchievements(user, Object.keys(career.ach));
  if (got.length || performance.now() - lastReport > 60000) {
    lastReport = performance.now();
    reportTrip(user, career.live);
  }
}
// ── Maps and the Digimap ───────────────────────────────
// The minimap and the full map (M) only show what this player has found (js/map.js). A Digimap carried in the pockets
// or hands reveals the road ahead and the next open fuel and services – and its catch: a station, garage, diner or
// motel whose chunk is first built while you carry one is, more often than not, a ruin (just its slab). The fate is
// decided once per site and saved (ws flag "fate:<id>": 1 open, 2 ruin), so places never change once they exist.
const mapMemory = new MapMemory(), minimap = new Minimap(), mapView = new MapView();
const RUIN_KINDS = new Set(["station", "garage", "diner", "motel"]), RUIN_CHANCE = 0.65, REVEAL = 15000;
let sitesLive = false, mapClock = 0;
const carryingDigimap = () => pockets.has("digimap") || interaction.held?.type === "digimap";
const wouldRuin = (s) => RUIN_KINDS.has(s.kind) && !s.start && !s.sedan && (hashStr(getSeed() + ":ruin:" + s.id) % 1000) / 1000 < RUIN_CHANCE;
// world/index.js asks this when it builds a site's chunk
function siteGone(s) {
  const f = ws.flag("fate:" + s.id);
  if (f) return f === 2;
  if (!sitesLive || devmap.active || !RUIN_KINDS.has(s.kind)) return false;
  const gone = carryingDigimap() && wouldRuin(s);
  ws.setFlag("fate:" + s.id, gone ? 2 : 1);
  return gone;
}
// Whether a site will be open when you get there, as things stand (for the Digimap's view ahead)
function willBeOpen(s) {
  const f = ws.flag("fate:" + s.id);
  return f ? f === 1 : !(carryingDigimap() && wouldRuin(s));
}
function headingOf() {
  const v = game.vehicle || (game.riding && convoy.vehicleOf(game.riding.id));
  if (!v) return player.yaw;
  const f = _fwd.set(0, 0, 1).applyQuaternion(v.quat);
  return Math.atan2(f.x, f.z);
}
const _fwd = new THREE.Vector3();
function mapData() {
  const p = focusPos(), digi = carryingDigimap(), ext = mapMemory.extent;
  const lo = Math.min(ext ? ext[0] : p.z, p.z) - 600, hi = Math.min(Math.max(ext ? ext[1] : p.z, p.z + (digi ? REVEAL : 0)) + 600, p.z + REVEAL + 2000);
  const sites = [];
  for (const s of sitesBetween(lo, hi)) {
    if (s.start || ws.flag("site:" + s.id)) sites.push({ ...s, state: ws.flag("fate:" + s.id) === 2 ? "ruin" : "found" });
    else if (digi && s.kind !== "wreck" && s.kind !== "home" && s.zRoad > p.z && s.zRoad < p.z + REVEAL && willBeOpen(s)) sites.push({ ...s, state: "intel" });
  }
  const seed = getSeed();
  const members = convoy.active ? [...convoy.members.values()].filter((m) => m.st && m.seed === seed)
    .map((m) => ({ name: m.name, x: m.st.p.x, z: m.st.p.z, paused: m.paused })) : [];
  return { memory: mapMemory, sites, members, me: { x: p.x, z: p.z, yaw: headingOf() }, reveal: digi ? [p.z - 300, p.z + REVEAL] : null };
}
// The full map's side panel: legend, and with a Digimap the next open places ahead
function mapScreenData() {
  const p = focusPos(), digi = carryingDigimap(), next = [];
  if (digi) {
    for (const kind of ["station", "garage", "diner", "motel"]) {
      const s = sitesBetween(p.z, p.z + REVEAL).find((q) => q.kind === kind && q.zRoad > p.z && !ws.flag("site:" + q.id) && willBeOpen(q));
      next.push({ kind, label: KIND_STYLE[kind].label, letter: KIND_STYLE[kind].letter, color: KIND_STYLE[kind].color, name: s ? s.name : null, dist: s ? fmtDist(s.zRoad - p.z) : null });
    }
  }
  return { digimap: digi, next, convoy: convoy.active, legend: Object.entries(KIND_STYLE).map(([k, v]) => ({ kind: k, ...v })) };
}
function updateMap(dt) {
  if (state === "playing" && (mapClock -= dt) <= 0) { mapClock = 0.25; const p = focusPos(); mapMemory.record(p.x, p.z); }
  minimap.update(dt, state === "playing" && prefs.hud.show !== "off", mapData);
}

// ── Chase camera zoom: mouse wheel or +/- while driving (or riding) in chase view; remembered in the settings ──
let zoomSaveIn = 0;
function chaseZoom(dt) {
  const keys = (isDown("camZoomOut") ? 1 : 0) - (isDown("camZoomIn") ? 1 : 0);
  const amount = look.zoom * 0.0012 + keys * dt * 0.6;
  look.zoom = 0;
  if (!amount || prefs.camera !== "chase") return;
  const z = Math.max(0.5, Math.min(2.5, prefs.chaseZoom * Math.exp(amount)));
  if (z === prefs.chaseZoom) return;
  prefs.chaseZoom = z;
  zoomSaveIn = 0.6;
}
setInterval(() => { if (zoomSaveIn > 0 && (zoomSaveIn -= 0.25) <= 0) savePrefs(prefs); }, 250);

// ── Engine smoke (js/smoke.js) ─────────────────────────
let smoke = null;
const smokeLight = () => (sky.night ? 0.3 : 1);

// ── The player's body ──────────────────────────────────
// At the wheel it is seen from chase view and in photos (and from the cab without its head, where the camera sits);
// on foot the camera is the eyes, so it only shows in photo mode. Convoy members see the same person (js/convoy.js).
let body = null;
function updateBody(dt) {
  const journey = state !== "menu" && state !== "boot" && state !== "dead" && !!game.tripId;
  if (!journey) { body?.show("hidden"); return; }
  const name = myName();
  if (!body || body.name !== name) { body?.dispose(); body = new Body(worldRoot, name); body.name = name; }
  const v = game.vehicle, ride = game.riding && convoy.vehicleOf(game.riding.id);
  if (game.ejected) { body.update(dt, { thrown: game.ejected, pos: game.ejected.pos, yaw: game.ejected.yaw }); body.show("full"); return; }
  if (v) body.update(dt, { vehicle: v, seat: "driver" });
  else if (ride) body.update(dt, { vehicle: ride, seat: game.riding.seat });
  else body.update(dt, { pos: player.pos, yaw: player.yaw, speed: Math.hypot(player.vel.x, player.vel.z), crawl: player.crawling });
  // The photo camera starts at the eyes: the head appears once it has moved away
  const inHead = () => camera.getWorldPosition(_cam).distanceTo(body.rig.head.getWorldPosition(_head)) < 0.6;
  if (state === "photo") body.show(inHead() ? "headless" : "full");
  else if (v || ride) body.show(prefs.camera === "chase" ? "full" : "headless");
  else body.show("hidden");
}
const _cam = new THREE.Vector3(), _head = new THREE.Vector3();

// ── Convoy (multiplayer) ───────────────────────────────
// Friends on the same seed see each other's vehicles and bodies (js/convoy.js). Each world is still private.
const convoy = new Convoy({
  root: worldRoot, onChange: () => refreshConvoy(),
  localVehicle: () => game.vehicle,
  rideTarget: (id) => ({
    id: "convoy:" + id, reach: 3.6,
    name: () => `@${convoy.members.get(id)?.name || "driver"}'s ${convoy.vehicleOf(id)?.def.name || "truck"}`,
    actions: () => {
      if (game.vehicle || game.riding || !convoy.vehicleOf(id)) return [];
      const seat = convoy.freeSeat(id), who = convoy.members.get(id)?.name || "driver";
      return [{ key: "use", label: `Ride with @${who}`, blocked: seat ? undefined : "No free seat", run: () => startRide(id) }];
    },
  }),
  onNotice: (text) => notify(text, { icon: "⛟", key: "convoy-seat" }),
  onClock: adoptClock,
  // Paused or awake through it: no rest, the leader's clock moves this player's time on
  onSleep: (h) => {
    if (game.zz && !game.zz.go) sleepNow(h);
    else notify(`The convoy slept ${Math.round(h)} hours while you were away.`, { icon: "☾", key: "sleep", ms: 6000 });
  },
});
// The convoy leader's time of day and weather (js/convoy.js): small drift is left alone, anything more snaps to theirs
function adoptClock(c) {
  if (state === "menu" || state === "dead" || state === "boot") return;
  if (typeof c.tm === "number") {
    let d = c.tm - sky.time;
    if (d > 0.5) d -= 1; else if (d < -0.5) d += 1;
    if (Math.abs(d) * DAY_SECONDS > 3) {
      if (d > 0 && sky.time + d >= 1) game.day++;
      sky.time = (((sky.time + d) % 1) + 1) % 1;
      lastTime = sky.time;
    }
  }
  const w = c.wx;
  if (w && (w.current !== weather.current || w.target !== weather.target || Math.abs((w.blend ?? 1) - weather.blend) > 0.05)) weather.restore(w);
  else if (w && typeof w.hoursLeft === "number") weather.hoursLeft = w.hoursLeft;
}
let convoyMsg = "", convoyBusy = false;
function myName() {
  const user = identity();
  if (user) return user;
  try {
    let g = sessionStorage.getItem("longhaul-guest");
    if (!g) { g = "guest-" + Math.floor(1000 + Math.random() * 9000); sessionStorage.setItem("longhaul-guest", g); }
    return g;
  } catch (e) { return "guest"; }
}
// What a newcomer needs to drive the same road; null while there's no journey to share
function convoyInfo() {
  if (!game.tripId || devmap.active || state === "menu" || state === "dead" || state === "boot") return null;
  const p = focusPos();
  return { seed: getSeed(), diff: game.diff, hostile: game.hostile, time: sky.time, weather: weather.serialize(), p: [p.x, p.z] };
}
function convoyLocal() {
  const o = convoyMove();
  o.tm = sky.time; o.wx = weather.serialize();
  if (game.zz && !game.zz.go) o.zz = game.zz.hours;
  const pk = game.parked;
  if (!game.vehicle && pk && vehicles.byId.get(pk.id) === pk) o.pk = pk;
  return o;
}
function convoyMove() {
  const v = game.vehicle, r = game.riding;
  if (v) {
    const fs = Object.keys(v.def.seats).filter((k) => k !== "driver" && v.seats[k] === null);
    return { seed: getSeed(), m: "car", p: v.pos, q: v.quat, v: v.vel, sp: v.speed, vt: v.type, pa: v.paint, vs: v.seed, w: v.wearLook, st: v.steer, l: v.lights, fs };
  }
  if (r) { const car = convoy.vehicleOf(r.id); return { seed: getSeed(), m: "ride", host: r.id, seat: r.seat, p: player.pos, v: car ? car.vel : player.vel, sp: car ? Math.abs(car.speed) : 0 }; }
  return { seed: getSeed(), m: "foot", p: player.pos, v: player.vel, sp: Math.hypot(player.vel.x, player.vel.z), yaw: player.yaw, cr: player.crawling };
}
function convoyView() {
  return {
    code: convoy.code, status: convoy.status, me: myName(), busy: convoyBusy, msg: convoyMsg,
    voice: { on: convoy.voice.on, muted: convoy.voice.muted, mode: prefs.voiceMode, error: convoy.voice.error },
    members: convoy.active && state !== "menu" ? convoy.list(focusPos(), prefs.units) : [],
    inJourney: state !== "menu" && state !== "dead", dev: devmap.active, account: identity(),
  };
}
function refreshConvoy() { if (menus.screen === "convoy") menus.refresh({ convoy: convoyView() }); }
// Push to talk also works with a menu open (pause, inventory, map), where the menus own the keyboard – but not while
// typing in a text box
const TALK_KEYS = new Set(BINDINGS.find((b) => b.action === "talk")?.keys || []);
let talkInMenu = false;
addEventListener("keydown", (e) => { if (TALK_KEYS.has(e.code) && state !== "playing" && !e.target.closest?.("input, textarea")) talkInMenu = true; }, true);
addEventListener("keyup", (e) => { if (TALK_KEYS.has(e.code)) talkInMenu = false; }, true);
addEventListener("blur", () => { talkInMenu = false; });
// Voice settings and push to talk, every frame
function syncVoice() {
  const v = convoy.voice;
  convoy.talkKey = bindingLabel("talk");
  v.mode = prefs.voiceMode;
  const talking = isDown("talk") || talkInMenu;
  if (talking !== v.talking || v._mode !== v.mode) { v.talking = talking; v._mode = v.mode; v.applyMic(); }
  v.setVolume(prefs.muted ? 0 : (prefs.vol.master ?? 1) * (prefs.vol.voice ?? 1));
}
// Put this player (and the vehicle they sit in, or the starter truck on a fresh journey) on the road just behind
// the convoy member at info.p
function regroup(info) {
  const [mx, mz] = info.p;
  const z = mz - 22, off = Math.max(-3, Math.min(3, mx - roadX(mz))), x = roadX(z) + off;
  const dir = roadDir(z), yaw = Math.atan2(dir.x, dir.z);
  world.update([new THREE.Vector3(x, 0, z)], true);
  let v = game.vehicle;
  if (!v) { const s = vehicles.get("starter"); if (s && s.pos.distanceTo(player.pos) < 30) v = s; }
  if (v) {
    v.place(x, z, yaw);
    v.vel.set(0, 0, 0); v.angVel.set(0, 0, 0); v.speed = 0; v.wake?.(); v.modified?.();
    if (!game.vehicle) seat(v, true);
  } else {
    player.teleport(x + Math.cos(yaw) * 6, z - Math.sin(yaw) * 6, yaw);
  }
  vehicles.sync(focusPoints());
  look.yaw = game.vehicle ? 0 : player.yaw; look.pitch = 0;
  rig.snap();
  persist();
}

// ── Account ────────────────────────────────────────────
let accountMsg = "", accountBusy = false;
function accountView() { return { user: identity(), busy: accountBusy, msg: accountMsg }; }
function refreshAccount() { if (menus.screen === "account") menus.refresh({ acct: accountView() }); }
// Another account now plays: its own career, its cloud journey and achievements
function accountChanged() {
  careerOwner = identity();
  career = loadCareer(careerOwner);
  lastReport = lastUpload = -Infinity; cloud = null; pendingUpload = null;
  menus.refresh({ account: careerOwner, acct: accountView(), career: careerView(), cloudSave: null });
  checkCloud(loadSave().save);
  syncAccount();
}

// Riding in a convoy member's truck: you sit in one of its free seats and go where they drive; your own vehicle
// stays where you left it. The driver's game holds the seat for you (js/convoy.js).
function startRide(id) {
  if (game.vehicle || game.riding || !convoy.active) return;
  const car = convoy.vehicleOf(id), seat = convoy.freeSeat(id), name = convoy.members.get(id)?.name || "driver";
  if (!car || !seat) { notify(`There's no free seat in @${name}'s truck.`, { icon: "⛟", key: "ride" }); return; }
  interaction.dropHeld?.();
  game.riding = { id, seat, name, last: car };
  look.yaw = look.pitch = 0;
  syncLookLimit();
  rig.snap();
  sfx("door_close");
  notify(`Riding with @${name}. ${bindingLabel("exit")} to get out.`, { icon: "⛟", key: "ride", level: "good" });
}
function stopRide(message) {
  const r = game.riding;
  if (!r) return;
  game.riding = null;
  const car = r.last;
  if (car) { const s = car.doorSpot(r.seat); player.teleport(s.x, s.z, car.yaw); }
  else player.teleport(player.pos.x, player.pos.z, player.yaw);
  look.yaw = player.yaw; look.pitch = 0;
  syncLookLimit();
  rig.snap();
  sfx("door_open");
  notify(message || `You got out of @${r.name}'s truck.`, { icon: "⛟", key: "ride" });
}
// Every frame while riding: follow the seat, or get out when the truck is gone (they left it, or the convoy)
function rideUpdate(dt) {
  const r = game.riding, car = convoy.active ? convoy.vehicleOf(r.id) : null;
  if (!car) { stopRide(`@${r.name} isn't driving any more. You climb out.`); return; }
  r.last = car;
  car.seatPos(r.seat, player.pos);
  player.vel.copy(car.vel);
  if (took("exit")) {
    if (Math.abs(car.speed) > 2) notify(`Ask @${r.name} to stop first.`, { key: "exit", icon: "✋" });
    else stopRide();
  }
  if (took("camera")) {
    prefs.camera = prefs.camera === "cab" ? "chase" : "cab";
    savePrefs(prefs); syncLookLimit(); look.yaw = look.pitch = 0; rig.snap();
  }
}
// The view from a passenger seat: the driver's eye height, moved across to that seat
function rideCamera(dt) {
  const r = game.riding, car = convoy.vehicleOf(r.id);
  if (!car) return;
  if (prefs.camera === "chase") { rig.chase(dt, car, look, prefs.chaseZoom); return; }
  const d = car.def, seat = d.seats[r.seat].pos, eye = d.seatEye, drv = d.seats.driver.pos;
  rideEye.vehicle = car;
  rideEye.local = [seat[0], eye[1], seat[2] + (eye[2] - drv[2])];
  rig.cab(dt, rideEye, look, 0);
}
const rideEye = {
  vehicle: null, local: [0, 0, 0], camMotion: null,
  get quat() { return this.vehicle.quat; },
  seatEye(out) { return this.vehicle.localToWorld(this.local[0], this.local[1], this.local[2], out); },
};

// ── Cloud saves ────────────────────────────────────────
// The journey is copied to the X-ORBIT account every minute while playing, and right away on pause, menu or tab
// switch. One journey per account: the last device to save wins, and the menu offers whichever copy is newer.
let lastUpload = -Infinity, cloud = null, pendingUpload = null;
function cloudSave(now) {
  const user = identity();
  if (!user || devmap.active || !game.tripId) return;
  const wait = (now ? 4000 : 60000) - (performance.now() - lastUpload);
  if (wait > 0 && !now) return;
  // The journey as it is now: by the time a held-back upload goes out, the menu may have replaced the scene
  const data = { v: 4, at: Date.now(), ...snapshot() };
  if (wait > 0) {
    if (!pendingUpload) setTimeout(flushUpload, wait);
    pendingUpload = { user, data };
    return;
  }
  pendingUpload = null;
  sendUpload({ user, data });
}
function sendUpload(p) { lastUpload = performance.now(); putSave(p.user, p.data); }
function flushUpload() { const p = pendingUpload; pendingUpload = null; if (p) sendUpload(p); }
addEventListener("pagehide", flushUpload);
async function checkCloud(local) {
  cloud = null;
  const user = identity();
  if (!user) return;
  const got = await getSave(user);
  if (state !== "menu" || !got) return;
  const save = checkSave(got.data);
  if (!save) return;
  const same = !!local && !!save.tripId && local.tripId === save.tripId;
  const newer = !local || (save.at || got.at) > (local.at || 0) + 1000;
  if (same && !newer) return;                 // this device already has the latest copy
  cloud = { save, same, newer };
  if (state === "menu") menus.refresh({ cloudSave: { ...previewOf(save), same, replaces: !!local && !same } });
}
function finishTrip(cause) {
  const t = endTrip(career);
  keepCareer();
  if (t) { pendingUpload = null; reportTrip(identity(), t, true, cause); dropSave(identity(), t.id); }
}
function careerView() {
  return { totals: totals(career), best: career.best, ach: { ...career.ach }, list: ACHIEVEMENTS.map(({ id, name, desc }) => ({ id, name, desc })) };
}
// Achievements earned on another device show up here, and ones earned here before signing in reach the account
async function syncAccount() {
  const user = identity();
  if (!user) return;
  const remote = await fetchAchievements(user);
  if (!remote) return;
  mergeAchievements(career, remote);
  keepCareer();
  if (Object.keys(career.ach).some((id) => !remote.includes(id))) pushAchievements(user, Object.keys(career.ach));
  if (state === "menu") menus.refresh({ career: careerView() });
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
    convoy: convoyView(),
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

function die(cause, summary = []) {
  state = "dead";
  convoy.leave();
  const best = loadBest() || { km: 0, days: 0 };
  if (!devmap.active) {                      // dying on the dev map leaves your real journey and record alone
    if (game.stats.distance / 1000 > best.km) saveBest({ km: game.stats.distance / 1000, days: game.day });
    clearSave();
    careerTick();
    finishTrip(cause || "Unknown");
  }
  audio.suspend();
  audio.death(/crash|fall|beat|kill|stab|struck|shot/i.test(cause || ""));
  music.setContext("none");
  hud.setNowPlaying?.(null); // the menu track is fading out; do not announce it over the game
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
      "A fall": "It was a long way down.",
    }[cause] || cause || "The desert won this time.",
    stats: [["Distance", fmtDist(game.stats.distance)], ["Days survived", game.day], ["Places found", game.stats.sites], ["Fuel bought", Math.round(game.stats.litres) + " L"], ...summary],
  });
}

// ── Vehicles: getting in and out ───────────────────────
function seat(v, quiet) {
  if (v.seats.driver !== "player" && !v.claimSeat("driver", "player")) {
    notify("Someone is already at the wheel."); return;
  }
  if (interaction.held) interaction.dropHeld?.();
  game.vehicle = v; game.parked = null;
  v.occupied = true;
  v.setGearMode?.(prefs.gearbox);
  game.lastVehicleName = v.def.name;
  syncLookLimit();
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
  v.releaseSeat("driver");
  v.occupied = false;
  game.vehicle = null; game.parked = v;        // convoy members still see it standing here (js/convoy.js)
  syncLookLimit();
  look.yaw = player.yaw;
  look.pitch = 0;
  sfx("door_open");
}

// ── Thrown through the windscreen ──────────────────────
// A head-on crash this bad (health lost) throws the driver out over the hood
const EJECT_HURT = 70;
const _preVel = new THREE.Vector3(), _nose = new THREE.Vector3(), _lost = new THREE.Vector3();
// Most of the speed lost along the vehicle's nose: it stopped against something in front of it
function headOn(v, before) {
  _lost.subVectors(before, v.vel);
  _nose.set(0, 0, 1).applyQuaternion(v.quat);
  return _lost.length() > 12 && _lost.dot(_nose) > 0.6 * _lost.length();
}
// The body flies out over the hood, tumbling, hits the ground, bounces, rolls and slides to a stop, all watched from
// a camera that pulls out of the cab to follow it. Only once it has lain still does control come back, or, if the
// crash killed you, the journey end (main's death check waits for game.ejected to clear).
const EJECT_G = 18, BODY_R = 0.3;
const _camWant = new THREE.Vector3(), _push = { x: 0, z: 0 };
function eject(v, vel) {
  const d = v.def, b = d.body;
  v.addDent(0, b.hoodYRear - d.comH + 0.3, b.zCowl - 0.25, 0, 0, 1, 45);      // out through the windscreen
  v.releaseSeat("driver");
  v.occupied = false;
  game.vehicle = null; game.parked = v;
  syncLookLimit();
  const yaw = Math.atan2(vel.x, vel.z);
  game.ejected = {
    car: v, t: 0, rest: 0, landed: false, settled: false, spin: 0, yaw,
    pos: v.localToWorld(0, b.roofY - d.comH + 0.15, b.zCowl + 0.25),            // the body's middle
    vel: new THREE.Vector3(vel.x * 0.75, Math.max(0, vel.y) + 4.5, vel.z * 0.75),
    dir: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)),
  };
  player.vel.set(0, 0, 0); player.crouched = false;
  hud.setVisible(false);
  sfx("glass_crack", { pos: game.ejected.pos.clone(), vol: 1 });
  if (!needs.dead) notify("You went through the windscreen.", { level: "bad", icon: "✚", key: "crash-hurt", ms: 6000 });
}
// A way to lie that doesn't put head or legs through whatever the body ended up against
function clearYaw(p, yaw) {
  const near = getColliders(p.x, p.z, 4), g = heightAt(p.x, p.z);
  for (let k = 0; k < 8; k++) {
    const a = yaw + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 4), sx = Math.sin(a), sz = Math.cos(a);
    if ([-1.6, -0.8, 0.8, 1.6].every((d) => circleFree(p.x + sx * d, p.z + sz * d, 0.22, near, g, g + 0.5))) return a;
  }
  return yaw;
}
function ejectStep(dt) {
  const e = game.ejected, p = e.pos, vel = e.vel;
  e.t += dt;
  const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
  let grounded = e.settled;                              // once it has come to rest it stays where it lies
  for (let i = 0; i < n && !e.settled; i++) {
    vel.y -= EJECT_G * h;
    p.addScaledVector(vel, h);
    // Walls, rocks and vehicles stop the body (not the car it just left, for the first moments)
    const near = getColliders(p.x, p.z, 4).filter((o) => e.t > 0.4 || o.vehicle !== e.car);
    _push.x = p.x; _push.z = p.z;
    const hit = resolveCircle(_push, BODY_R, near, p.y - BODY_R, p.y + BODY_R);
    if (hit) {
      p.x = _push.x; p.z = _push.z;
      const into = vel.x * hit.nx + vel.z * hit.nz;
      if (into < 0) {                                    // lose most of the speed into the wall, keep a little bounce
        vel.x -= 1.3 * into * hit.nx; vel.z -= 1.3 * into * hit.nz; vel.x *= 0.5; vel.z *= 0.5;
        if (into < -6) { sfx("punch", { pos: p.clone(), vol: Math.min(1, -into / 15) }); needs.hurt(fallInjury(-into), "A crash"); }
      }
    }
    const g = heightAt(p.x, p.z) + 0.16;                 // lying on the ground, the middle is this high
    if (p.y <= g) {
      p.y = g;
      grounded = true;
      if (vel.y < -2.5) {
        const impact = -vel.y;
        if (!e.landed) { e.landed = true; needs.hurt(fallInjury(impact + 6), "A crash"); }
        sfx("land", { vol: Math.min(1, impact / 9), surface: surfaceAt(p.x, p.z) });
        if (impact > 4) sfx("punch", { pos: p.clone(), vol: Math.min(1, impact / 14) });
        vel.y = impact * 0.3;                            // a bounce, smaller each time, losing speed as it hits
        vel.x *= 0.6; vel.z *= 0.6;
      } else vel.y = 0;
      // Rolling and sliding along the ground: a tumbling body drags hard
      const hs = Math.hypot(vel.x, vel.z), drop = 14 * h, k = hs > drop ? (hs - drop) / hs : 0;
      vel.x *= k; vel.z *= k;
    }
  }
  const hs = e.settled ? 0 : Math.hypot(vel.x, vel.z);
  // Tumbling: head over heels in the air, rolling with the ground speed, then lying still
  if (!e.settled) e.spin += (grounded ? hs / 0.45 : 7) * dt;
  if (grounded && hs < 0.35 && Math.abs(vel.y) < 0.6) e.rest += dt; else e.rest = 0;
  if (e.rest > 0.15 && !e.settled) {
    e.settled = true; e.yaw = clearYaw(p, e.yaw);
    // Look down from over open ground, so the truck it ended up against isn't in the way
    const near = getColliders(p.x, p.z, 5), g = heightAt(p.x, p.z);
    e.camDir = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => k * Math.PI / 4)
      .find((a) => circleFree(p.x + Math.sin(a) * 1.8, p.z + Math.cos(a) * 1.8, 0.6, near, g, g + 3)) ?? Math.atan2(-e.dir.x, -e.dir.z);
  }
  // The player (sounds, convoy, the map) follows the body
  player.pos.set(p.x, heightAt(p.x, p.z), p.z);
  // Camera: out of the cab to a spot behind, to the side and above the body, looking at it (off the line it travels,
  // so whatever it was thrown over doesn't block the view)
  const back = Math.max(4, Math.min(7, 3.5 + hs * 0.1)), sx = e.dir.z, sz = -e.dir.x;
  if (e.settled) _camWant.set(p.x + Math.sin(e.camDir) * 1.1, p.y + 5.4, p.z + Math.cos(e.camDir) * 1.1);    // nearly overhead
  else _camWant.set(p.x - e.dir.x * back * 0.55 + sx * back * 0.8, p.y + 2.6, p.z - e.dir.z * back * 0.55 + sz * back * 0.8);
  _camWant.y = Math.max(_camWant.y, heightAt(_camWant.x, _camWant.z) + 1);
  camera.position.lerp(_camWant, 1 - Math.exp(-dt * (e.t < 0.25 ? 5 : e.settled ? 2.5 : 12)));
  camera.lookAt(p.x, p.y + 0.2, p.z);
  camera.updateMatrixWorld(true);
  // At rest: a moment lying there, then up (if alive) or the end
  if (e.rest > (needs.dead ? 1.6 : 1.0) || e.t > 12) {
    game.ejected = null;
    if (!needs.dead) hud.setVisible(true);
    player.pos.set(p.x, heightAt(p.x, p.z), p.z); player.vel.set(0, 0, 0); player.grounded = true;
    player.yaw = look.yaw = e.yaw; look.pitch = player.pitch = 0;
  }
}

// ── Shop, pockets, sleep ───────────────────────────────
let shopSite = null;
function openOverlay(name, data) {
  sfx(name === "dialogue" ? "ui_click" : "inventory");
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

// In a convoy everyone on the road has to be asleep (in a cab or a bed) before the night skips ahead; until then this
// player lies awake waiting (game.zz) and can get up again
function sleep(where) {
  if (state !== "playing") return;
  if (needs.energy > 75) { notify("You're not tired enough to sleep", { key: "sleep", icon: "☾" }); return; }
  state = "sleeping";
  releaseAll();
  hud.dim(true);
  const hours = Math.max(1, Math.min(9, (100 - needs.energy) / 13));
  game.zz = { hours, where, go: false, shown: "" };
  if (convoy.active && convoy.othersHere().length) sleepWait();
  else sleepNow(hours);
}
function sleepWait() {
  const z = game.zz;
  if (z.go) return;
  if (took("sleep")) { getUp(); return; }
  const s = convoy.sleepers(z.hours);
  if (s.asleep >= s.of && convoy.leader() === convoy.me.id) { convoy.wakeAll(s.hours); sleepNow(s.hours); return; }
  const txt = `Waiting for the convoy to sleep · ${s.asleep}/${s.of} asleep\nPress ${bindingLabel("sleep")} or ${bindingLabel("pause")} to get up`;
  if (txt !== z.shown) { z.shown = txt; hud.fade(0.85, txt); }
}
function getUp() {
  game.zz = null; state = "playing"; last = performance.now();
  releaseAll(); hud.fade(0, ""); hud.dim(false);
  notify("You got up.", { key: "sleep", icon: "☾" });
}
function sleepNow(hours) {
  const where = game.zz?.where;
  if (game.zz) game.zz.go = true;
  hud.fade(1, "Sleeping…");
  setTimeout(() => {
    game.zz = null;
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
  notify(HINTS[id](), { key: "hint", ms: 9000 });
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
    const ruin = ws.flag("fate:" + s.id) === 2;
    if (s.kind === "station" && !ruin && d < 380 && s.z > p.z) hint("station");
    if (d > 70) continue;
    ws.setFlag("site:" + s.id, 1);
    game.stats.sites++;
    notify(ruin ? `Found what's left of ${s.name || s.kind}: it closed down long ago.` : `Discovered: ${s.name || s.kind}`, { level: ruin ? "warn" : "good", icon: "◎" });
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
    else if (state === "ui" && menus.current !== "dialogue") resume();
    else if (state === "sleeping" && game.zz && !game.zz.go) getUp();
  }
  if (took("photo") && state === "playing") {
    state = "photo";
    hud.setVisible(false);
    photo.enter(camera);
  } else if (state === "photo" && took("photoExit")) {
    photo.exit(camera);
    state = "playing";
    hud.setVisible(true);
    rig.snap();
    last = performance.now();
  }
  if (took("map")) {
    if (state === "playing") openOverlay("map", mapScreenData());
    else if (state === "ui" && menus.current === "map") resume();
  }
  if (took("inventory")) {
    if (state === "playing") openOverlay("inventory", inventoryData());
    else if (state === "ui" && menus.current === "inventory") resume();
  }

  if (state === "playing") tick(dt);
  else if (state === "sleeping" && game.zz) sleepWait();
  else if (state === "photo") photo.update(dt, camera, () => renderer.render(scene, camera));
  else if (state === "menu") {
    sky.update(dt * 0.1, camera, menuFocus);
    weather.update(dt, 0, camera, sky);
    vehicles.update(dt, envNow());
    rig.menu(dt, menuFocus, prefs.a11y.reduceMotion);
    rig.finish(dt, 52, 0, 0);
    audio.update({ active: true, tel: null, wind: 0.25, rain: 0 }, dt);
  }
  updateBody(dt);
  updateMap(dt);
  if (state === "playing" && smoke) smoke.update(dt, vehicles, { camera, height: renderer.domElement.height, light: smokeLight() });
  if (convoy.voice.on) syncVoice();
  if (convoy.active && state !== "menu" && state !== "boot" && state !== "dead") {
    convoy.tick(dt, state === "playing" || (state === "sleeping" && game.zz) ? convoyLocal() : null, focusPos());
    convoy.showPanel(state === "playing" && prefs.hud.show !== "off", prefs.units);
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
  game.playTime += dt;
  audio.setListener(focusPos());
  const nearbyTalk = !game.vehicle && (encounters.hud()?.prompt || hitch.hud()?.prompt);
  const talk = took("talk") || (nearbyTalk && took("use"));
  encounters.update(dt, { talk });
  if (state !== "playing") return;
  hitch.update(dt, { talk: talk && !encounters.hud()?.prompt });
  if (state !== "playing") return;
  npcs.update(dt, { playerPos: focusPos(), playerVehicle: game.vehicle, lite: settings.lite, night: sky.night });
  const d = diff();
  let v = game.vehicle;

  // One-shot actions
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
  if (v) _preVel.copy(v.vel);
  let steps = 0, first = true;
  const fp = focusPos(), convoyCars = convoy.active ? convoy.ghostCars(fp.x, fp.z, 300) : null;
  while (acc >= STEP && steps < 12) {
    vehicles.step(STEP, v, first ? input : { ...input, shiftUp: false, shiftDown: false }, env, convoyCars);
    first = false; acc -= STEP; steps++;
  }
  if (steps === 12) acc = 0;
  vehicles.update(dt, env);

  const tel = v ? v.telemetry() : null;
  lastTel = tel;
  if (tel) {
    game.stats.distance += Math.abs(tel.speed) * dt;
    let thrown = false;
    if (tel.impact > 0.5) {
      const hurt = crashInjury(tel.impact);
      needs.hurt(hurt, "A crash");
      if (hurt >= 40) audio.crunch();
      thrown = hurt >= EJECT_HURT && headOn(v, _preVel);
      if (hurt >= 30 && !needs.dead && !thrown) notify(hurt >= 60 ? "You're badly hurt." : "That crash hurt.", { level: "bad", icon: "✚", key: "crash-hurt", ms: 5000 });
      rig.shake(tel.impact * 0.02);
      sfx("crash", { vol: Math.min(1, tel.impact / 20) });
    }
    stuckFor = v.upright !== undefined && v.upright < 0.45 && Math.abs(tel.speed) < 2 ? stuckFor + dt : 0;
    const my = v.camMotion ? v.camMotion.y || 0 : 0;
    rough += (Math.min(1, Math.abs(my - lastMotionY) * 60) - rough) * Math.min(1, dt * 6);
    lastMotionY = my;
    if (thrown) { eject(v, _preVel); v = null; }
  }

  // On foot
  let ui = NO_UI;
  const temp = env.ambient;
  if (v || game.riding) { interaction.hideLight(); chaseZoom(dt); }
  if (!v && game.riding) {
    rideUpdate(dt);
    if (state !== "playing") return;
  } else if (!v && game.ejected) {
    ejectStep(dt);
  } else if (!v) {
    const fi = foot();
    // Too badly hurt to stand: crawl until healed a little
    const crawl = player.crawling ? needs.health < STAND_AT : needs.health < CRAWL_BELOW;
    if (crawl !== player.crawling) {
      player.crawling = crawl;
      if (!needs.dead) notify(crawl ? "You're too badly hurt to stand. You can only crawl." : "You can stand again.", { level: crawl ? "bad" : "good", icon: "✚", key: "crawl", ms: 6000 });
    }
    player.lastImpact = 0;
    player.yaw = look.yaw;
    player.pitch = look.pitch;
    player.update(dt, fi, getColliders(player.pos.x, player.pos.z, 10), { needs, canSprint: needs.energy > 8, camMotion: prefs.a11y.reduceMotion ? 0 : prefs.camMotion });
    look.yaw = player.yaw;
    if (player.lastImpact > 0) { const hurt = fallInjury(player.lastImpact); if (hurt > 0) needs.hurt(hurt, "A fall"); }
    player.applyCamera(camera);
    camera.updateMatrixWorld(true);
    ui = interaction.update(dt, fi) || NO_UI;
    combat.update(dt, fi);
    if (state !== "playing") return;
    if (game.vehicle) v = game.vehicle; // got in this frame
  }
  props.update(dt);

  // Needs
  const indoors = !v && !!world.indoorsAt?.(player.pos.x, player.pos.z);
  needs.update(dt / HOUR, { temp, sprinting: !v && !game.riding && player.sprinting, sleeping: false, shade: !!v || !!game.riding || indoors, rate: d.needs });
  if (needs.dead && !game.ejected) { die(needs.cause); return; }

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
    else rig.chase(dt, v, look, prefs.chaseZoom);
  } else if (game.riding) rideCamera(dt);
  rig.finish(dt, prefs.fov, tel ? Math.abs(tel.speed) : 0, motion);

  // Sound
  let heard = tel, dist = 0;
  if (!v) {
    const nv = nearestVehicle(player.pos, 45);
    if (nv && !nv.ai) { const t = nv.telemetry(); if (t.ignition === "running" || t.ignition === "cranking") { heard = t; dist = nv.pos.distanceTo(player.pos); } }
  }
  audio.update({
    others: vehicles.list.filter(car => car !== v && car.ai && car.pos.distanceToSquared(at) < 14400)
      .sort((a,b) => a.pos.distanceToSquared(at) - b.pos.distanceToSquared(at)).slice(0,2)
      .map(car => ({ tel: { ignition: car.ign, rpm: car.rpm, redline: car.redline, load: car.load }, dist: car.pos.distanceTo(at) })),
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
  h.encounter = encounters.hud() || hitch.hud();
  h.subtitle = subtitle && subtitle.until > game.playTime ? subtitle : null;
  h.prompt = v ? drivePrompt(v, tel, d)
    : game.riding ? `Riding with @${game.riding.name} · ${bindingLabel("exit")} get out · ${bindingLabel("camera")} camera` : null;
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
  logLaunch(identity(), { hasSave: !!loadSave().save });
  resize();
  menus.init({ prefs, handlers, difficulties: DIFF_LIST });
  hud.init({ prefs });
  hud.setVisible(false);
  initInput(canvas, inputMode);
  on("pause:request", () => pause());
  on("fuel:bought", (e) => { game.stats.litres += (e && e.litres) || 0; });
  on("encounter:end", (e) => { if (e && e.state === "escaped") game.stats.escapes++; });
  on("hitch:arrived", () => { game.stats.rides++; });
  on("music:discovery", id => {
    if (career.ach[id]) return;
    mergeAchievements(career, [id]);
    if (!career.ach[id]) return;
    keepCareer();
    if (careerOwner) pushAchievements(careerOwner, Object.keys(career.ach));
    if (state === "menu") menus.refresh({ career: careerView() });
    const name = ACHIEVEMENTS.find(a => a.id === id).name;
    if (state !== "menu") notify("Achievement unlocked: " + name, { level: "good", icon: "★" });
    if (state === "menu") {
      const toast = document.createElement("div");
      toast.className = "lh-discovery-toast";
      toast.setAttribute("role", "status");
      toast.textContent = "★ Achievement unlocked: " + name;
      document.body.append(toast);
      setTimeout(() => toast.remove(), 6000);
    }
  });
  on("music:track", (t) => { menus.setNowPlaying?.(t); hud.setNowPlaying?.(t); });
  canvas.addEventListener("click", () => { if (state === "playing" && !locked()) requestLock(); });

  const musicReady = music.init();
  const beginMusic = () => { audio.start(); music.unlock(); applyPrefs(); music.setContext("menu"); music.resume(); };
  window.addEventListener("longhaul-start-audio", beginMusic, { once: true });
  await window.longHaulStart;
  window.removeEventListener("longhaul-start-audio", beginMusic);
  beginMusic();
  const loadingDuration = 20000 + Math.random() * 10000;
  const loadingStarted = performance.now();
  let prepared = 0, loadingLabel = "Warming up";
  let shownProgress = 0, visibleLoadingTime = 0, lastLoadingFrame = loadingStarted;
  menus.show("loading", { pct: 0, label: loadingLabel });
  const paintLoading = () => {
    const now = performance.now();
    // Pace the presentation while retaining real readiness as the upper bound.
    const frameTime = Math.min(100, Math.max(0, now - lastLoadingFrame));
    if (!document.hidden) visibleLoadingTime += frameTime;
    const elapsed = Math.max(0, visibleLoadingTime - 400);
    const target = Math.min(prepared, elapsed / Math.max(1, loadingDuration - 700), 1);
    shownProgress = Math.min(target, shownProgress + (document.hidden ? 0 : frameTime) / (loadingDuration - 700));
    lastLoadingFrame = now;
    menus.show("loading", { pct: shownProgress, label: prepared === 1 ? "Getting ready for the road" : loadingLabel });
  };
  const loadingTimer = setInterval(paintLoading, 50);
  const report = (base, span) => (pct, label) => {
    prepared = Math.max(prepared, base + span * Math.max(0, Math.min(1, pct)));
    loadingLabel = label;
  };
  try {
    await prepareWorld(report(0.02, 0.5));
    await prepareVehicles(report(0.52, 0.38));
    await prepareNpcs(report(0.90, 0.04));
    prepared = 0.95; loadingLabel = "Parking the truck";
    sky = new Sky(worldRoot, scene);
    weather = new Weather(worldRoot, scene);
    weather.onThunder = () => sfx("thunder");
    world = new World({ root: worldRoot });
    vehicles = new Vehicles({ root: worldRoot, getColliders: terrainColliders });
    setSiteFilter(siteGone);
    // Red flash at the screen edges for every hit taken (a scratch barely flickers, a beating glares)
    needs.onHurt = (amount) => { if (amount >= 0.5 && state === "playing") hud.damageFlash(0.3 + amount / 30); };
    smoke = new EngineSmoke(worldRoot);
    setVehicleLookup?.((x, z, r) => { let best = null, bd = r; for (const c of vehicles.list) { const dd = Math.hypot(c.pos.x - x, c.pos.z - z); if (dd < bd && Math.abs(c.speed) < 1) { bd = dd; best = c; } } return best; });
    props = new Props({ root: worldRoot, getColliders, getVehicle: (id) => vehicles.get(id) });
    interaction = new Interaction({
      camera, player, props, pockets,
      hooks: { enterVehicle, openShop, sleep, wallet, needs, getColliders, weaponHints: (item) => combat.hints(item) },
    });
    npcs = new Npcs({ root: worldRoot, getColliders, getVehicle: id => vehicles.get(id) });
    combat = new Combat({ player, npcs, pockets, props, interaction, getColliders, root: worldRoot });
    const stock = makeStock({ wallet, pockets, interaction, props, defs: ITEMS, makeItem,
      vehicle: () => game.vehicle || nearestVehicle(player.pos, 25),
      drop: item => { const p = focusPos(); props.spawn(item, [p.x + 2, heightAt(p.x + 2,p.z) + 0.5,p.z]); } });
    const ctx = { root: worldRoot, npcs, vehicles, world, getColliders, needs, stock, sfx, notify, combat,
      player: () => { const v = game.vehicle, vel = (v || player).vel;
        return { vehicle: v, onFoot: !v, pos: focusPos(), vel, speed: Math.hypot(vel.x,vel.z), health: needs.health }; },
      now: () => game.playTime, diff: () => game.diff, hostile: () => game.hostile,
      progress: () => ({ km: game.stats.distance / 1000, day: game.day, money: wallet.money }),
      dialogue: spec => { if (state !== "playing") return false; dialogueSpec = spec; openOverlay("dialogue", spec); return true; },
      ejectPlayer: () => { exitVehicle(); return !game.vehicle; },
      releasePlayer: ({x,z}) => { if (!game.vehicle) player.teleport(x,z,player.yaw); },
      kill: die };
    encounters = new Encounters(ctx);
    hitch = new Hitchhikers(ctx);
    on("npc:say", ({name,text,ms}) => { subtitle = {name,text,until: game.playTime + (ms || 3500)/1000}; });
    await musicReady;
    applyQuality();
    applyPrefs();
    buildBackdrop();
    prepared = 1;
    await new Promise(resolve => {
      const finish = () => {
        paintLoading();
        if (shownProgress >= 1) resolve();
        else setTimeout(finish, 50);
      };
      finish();
    });
    clearInterval(loadingTimer);
    menus.show("loading", { pct: 1, label: "Ready" });
    await new Promise(resolve => setTimeout(resolve, 300));
    showMain();
    syncAccount();
    requestAnimationFrame(frame);
  } catch (e) {
    clearInterval(loadingTimer);
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
  get npcs() { return npcs; }, get combat() { return combat; }, convoy, get body() { return body; }, mapMemory, roadX, sitesBetween, get smoke() { return smoke; }, startRide, stopRide, look, get hudState() { return hudState; },
  get encounters() { return new URLSearchParams(location.search).get("dev") === "1" ? encounters : undefined; },
  startJourney, persist, pause, resume, snapshot, seat, exitVehicle, getColliders, handlers, music, audio,
  tick, makeItem, sleep,
};
