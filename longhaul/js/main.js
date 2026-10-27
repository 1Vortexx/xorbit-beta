// Long Haul – game loop, menus, survival, camera and HUD
import * as THREE from "three";
import { World, setSeed, getSeed, heightAt } from "./world.js";
import { stationExtras, resetStations, nearPump, shopNear } from "./stations.js";
import { Car, TANK } from "./car.js";
import { Sky, DAY_SECONDS } from "./sky.js";
import { Weather } from "./weather.js";
import { Parts, OVERHEAT } from "./parts.js";
import { Needs } from "./survival.js";
import { ITEMS, SHOP_ORDER, Inventory, lootFor } from "./items.js";
import { Player } from "./player.js";
import { audio } from "./audio.js";
import { initInput, controls, footControls, took, endFrame, releaseAll, look } from "./input.js";
import { loadSave, writeSave, clearSave, loadPrefs, savePrefs, loadBest, saveBest } from "./save.js";
import { watchPerformance, settingsFor } from "./perf.js";

const STEP = 1 / 120;
const HOUR = DAY_SECONDS / 24;          // real seconds per in-game hour
const FUEL_PRICE = 1.6;                 // $ per litre
const REFUEL_RATE = 8;                  // litres per second
const DIFF = {
  easy:   { label: "Easygoing", needs: 0.6,  wear: 0.6, money: 200, rescue: true },
  normal: { label: "Survival",  needs: 1,    wear: 1,   money: 120, rescue: true },
  hard:   { label: "Hardcore",  needs: 1.35, wear: 1.5, money: 50,  rescue: false },
};

const $ = (id) => document.getElementById(id);
const canvas = $("game");

// ── Scene ──────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1300);
const sky = new Sky(scene);
const weather = new Weather(scene);
const world = new World(scene, [stationExtras]);
const car = new Car(scene);
const parts = new Parts();
const needs = new Needs();
const inv = new Inventory();
const player = new Player();

const prefs = loadPrefs();
let settings = settingsFor(false);
let xorbitLite = false;

// Trip state
let state = "menu"; // menu | playing | paused | ui | sleeping | dead
const game = { diff: "normal", day: 1, onFoot: false, looted: new Set(), lights: "auto", stats: { wrecks: 0, litres: 0 } };
let stuckFor = 0, shake = 0, blackout = 0, nextBlackout = 20, lastTime = 0.3;
const focus = () => (game.onFoot ? player.pos : car.pos);
const diff = () => DIFF[game.diff] || DIFF.normal;

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

function applyQuality() {
  const lite = prefs.quality === "auto" ? xorbitLite : prefs.quality === "lite";
  settings = settingsFor(lite);
  renderer.setPixelRatio(settings.pixelRatio);
  resize();
  sky.setLite(lite, settings.fogFar);
  weather.setLite(lite);
  weather.baseFar = settings.fogFar;
  world.setOptions({ lite, ahead: settings.ahead, behind: settings.behind });
  world.update(focus().z, true);
  car._lightsOn = null;
  $("liteBadge").hidden = !lite;
}
watchPerformance((lite) => { xorbitLite = lite; applyQuality(); });

function applyPrefs() {
  camera.fov = prefs.fov;
  camera.updateProjectionMatrix();
  look.sens = prefs.sens;
  audio.setVolume(prefs.volume);
  audio.setMuted(prefs.muted);
  $("help").hidden = !prefs.showHelp;
  $("speedUnit").textContent = prefs.units === "mi" ? "MPH" : "KM/H";
}
applyPrefs();

initInput(canvas, () => (state === "playing" ? "play" : state === "ui" || state === "paused" ? "overlay" : "none"));

// ── Screens ────────────────────────────────────────────
const SCREENS = ["mainMenu", "newTrip", "settings", "howTo", "pauseMenu", "inventory", "shop", "gameOver"];
const backStack = [];
function show(id, push = true) {
  const cur = SCREENS.find((s) => !$(s).hidden);
  if (push && cur && cur !== id) backStack.push(cur);
  SCREENS.forEach((s) => { $(s).hidden = s !== id; });
  $("hud").hidden = !(state === "playing" || state === "ui" || state === "sleeping" || id === "pauseMenu");
}
function hideScreens() {
  SCREENS.forEach((s) => { $(s).hidden = true; });
  backStack.length = 0;
  $("hud").hidden = false;
}
function back() {
  const prev = backStack.pop();
  if (prev) show(prev, false);
}
document.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", back));
document.addEventListener("click", (e) => { if (e.target.closest(".btn, .tab, .diff")) audio.click(); });

function showMain() {
  state = "menu";
  backStack.length = 0;
  const save = loadSave();
  $("mContinue").hidden = !save;
  if (save) {
    $("mContinueSub").textContent = `Day ${save.day} · ${fmtDist(save.car.odometer)} · ${(DIFF[save.diff] || DIFF.normal).label}`;
  }
  const best = loadBest();
  $("mainFoot").textContent = best ? `Best trip: ${fmtDist(best.km * 1000)} over ${best.days} day${best.days === 1 ? "" : "s"}` : "No trips yet. The road's waiting.";
  show("mainMenu", false);
  $("hud").hidden = true;
  setFootUi(false);
}

$("mContinue").onclick = () => { const s = loadSave(); if (s) startTrip(s); };
$("mNew").onclick = () => { $("newWarn").hidden = !loadSave(); show("newTrip"); };
$("mSettings").onclick = () => { fillSettings(); show("settings"); };
$("mHow").onclick = () => show("howTo");

let chosenDiff = "normal";
document.querySelectorAll(".diff").forEach((b) => b.addEventListener("click", () => {
  chosenDiff = b.dataset.d;
  document.querySelectorAll(".diff").forEach((x) => x.classList.toggle("sel", x === b));
}));
$("startTrip").onclick = () => { clearSave(); startTrip(null, chosenDiff); };

// Settings
function fillSettings() {
  $("sQuality").value = prefs.quality;
  $("sFov").value = prefs.fov;
  $("sSens").value = prefs.sens;
  $("sVol").value = prefs.volume;
  $("sUnits").value = prefs.units;
  $("sHelp").checked = prefs.showHelp;
  settingLabels();
}
function settingLabels() {
  $("vFov").textContent = prefs.fov + "°";
  $("vSens").textContent = (+prefs.sens).toFixed(1) + "×";
  $("vVol").textContent = Math.round(prefs.volume * 100) + "%";
}
function onSetting() {
  const q = $("sQuality").value, qChanged = q !== prefs.quality;
  Object.assign(prefs, {
    quality: q, fov: +$("sFov").value, sens: +$("sSens").value, volume: +$("sVol").value,
    units: $("sUnits").value, showHelp: $("sHelp").checked,
  });
  savePrefs(prefs);
  settingLabels();
  applyPrefs();
  if (qChanged) applyQuality();
}
["sQuality", "sFov", "sSens", "sVol", "sUnits", "sHelp"].forEach((id) => $(id).addEventListener("input", onSetting));
$("sFull").onclick = () => {
  try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch (e) {}
};

// Pause
$("pResume").onclick = () => resume();
$("pSettings").onclick = () => { fillSettings(); show("settings"); };
$("pHow").onclick = () => show("howTo");
$("pQuit").onclick = () => { persist(); showMain(); };

// Game over
$("goMenu").onclick = () => showMain();
$("goNew").onclick = () => { $("newWarn").hidden = true; backStack.length = 0; show("newTrip", false); };

// ── Trip lifecycle ─────────────────────────────────────
function startTrip(save, difficulty) {
  const seed = save ? save.seed : (Math.random() * 2 ** 31) | 0;
  setSeed(seed);
  resetStations();
  world.clear();
  parts.reset(); needs.reset();
  inv.items = {}; inv.money = 0;
  if (save) {
    car.restore(save.car);
    parts.restore(save.parts);
    needs.restore(save.needs);
    inv.restore(save.inv);
    weather.restore(save.weather);
    sky.time = save.time;
    Object.assign(game, {
      diff: save.diff, day: save.day, onFoot: !!save.onFoot, looted: new Set(save.looted || []),
      lights: save.lights || "auto", stats: Object.assign({ wrecks: 0, litres: 0 }, save.stats),
    });
    if (game.onFoot) player.restore(save.player);
  } else {
    car.placeOnRoad(20);
    car.fuel = TANK * 0.5;
    car.odometer = 0;
    sky.time = 0.3;
    weather.restore({ current: "clear", target: "clear", blend: 1, hoursLeft: 4 });
    Object.assign(game, { diff: difficulty || "normal", day: 1, onFoot: false, looted: new Set(), lights: "auto", stats: { wrecks: 0, litres: 0 } });
    inv.money = diff().money;
    inv.add("water", 2); inv.add("jerky", 1);
    parts.running = true;
  }
  lastTime = sky.time;
  car.running = parts.running;
  world.update(focus().z, true);
  look.clamp = !game.onFoot;
  look.yaw = game.onFoot ? player.yaw : 0;
  look.pitch = 0;
  camPos.copy(car.pos).add(tmp.set(0, 4, -9).applyQuaternion(car.quat));
  stuckFor = blackout = 0;
  setFootUi(game.onFoot);
  resume();
  toast(save ? `Day ${game.day}. Back on the road.` : "Day 1. The tank's half full and the road goes on forever.");
  persist();
}

function snapshot() {
  return {
    seed: getSeed(), time: sky.time, day: game.day, diff: game.diff,
    car: car.serialize(), parts: parts.serialize(), needs: needs.serialize(), inv: inv.serialize(),
    weather: weather.serialize(), looted: [...game.looted], lights: game.lights, stats: game.stats,
    onFoot: game.onFoot, player: player.serialize(),
  };
}
function persist() {
  if (state === "menu" || state === "dead") return;
  writeSave(snapshot());
  recordBest();
}
function recordBest() {
  const best = loadBest() || { km: 0, days: 0 };
  const km = car.odometer / 1000;
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
  releaseAll();
  if (document.pointerLockElement) document.exitPointerLock();
  $("pauseSub").textContent = `Day ${game.day} · ${fmtDist(car.odometer)} driven · ${diff().label}`;
  backStack.length = 0;
  show("pauseMenu", false);
}
function resume() {
  state = "playing";
  hideScreens();
  audio.start();
  canvas.focus();
  last = performance.now();
}

function die(cause) {
  state = "dead";
  recordBest();
  clearSave();
  audio.suspend();
  if (document.pointerLockElement) document.exitPointerLock();
  $("goCause").textContent = {
    Dehydration: "The heat got you. You ran out of water.",
    Starvation: "You ran out of food, and then out of strength.",
    Exhaustion: "You pushed on too long without sleep.",
    Heatstroke: "The midday sun was too much without water.",
    "A crash": "The last crash was one too many.",
  }[cause] || "The desert won this time.";
  $("goStats").innerHTML = [
    ["Distance", fmtDist(car.odometer)], ["Days survived", game.day],
    ["Wrecks searched", game.stats.wrecks], ["Fuel bought", Math.round(game.stats.litres) + " L"],
  ].map(([k, v]) => `<div>${k}<b>${v}</b></div>`).join("");
  backStack.length = 0;
  show("gameOver", false);
  $("hud").hidden = true;
}

// ── Inventory / shop ───────────────────────────────────
let invTab = "supplies";
function itemCtx() {
  return {
    needs, parts, car,
    nearTruck: !game.onFoot || player.pos.distanceTo(car.pos) < 4.5,
    truckStopped: Math.abs(car.speed) < 1,
  };
}
function openInventory() {
  state = "ui";
  releaseAll();
  if (document.pointerLockElement) document.exitPointerLock();
  $("invMsg").textContent = "";
  renderInventory();
  backStack.length = 0;
  show("inventory", false);
}
function closeUi() { resume(); }
$("invClose").onclick = closeUi;
$("shopClose").onclick = closeUi;
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => { invTab = t.dataset.tab; renderInventory(); }));

const pctClass = (v) => (v < 20 ? "badv" : v < 45 ? "warnv" : "");
function statRow(label, v, text) {
  return `<div class="stat ${pctClass(v)}">${label}<div class="bar"><i style="width:${Math.max(0, Math.min(100, v)).toFixed(0)}%"></i></div><b>${text ?? Math.round(v) + "%"}</b></div>`;
}
function renderInventory() {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("sel", t.dataset.tab === invTab));
  $("invCash").textContent = "$" + inv.money;
  const body = $("invBody");
  if (invTab === "supplies") {
    const ids = Object.keys(inv.items).filter((id) => ITEMS[id]);
    body.innerHTML = ids.length
      ? `<div class="items">${ids.map((id) => `<div class="item"><div class="ic">${ITEMS[id].icon}</div><b>${ITEMS[id].name}<em>×${inv.count(id)}</em></b><span>${ITEMS[id].desc}</span>
          <div class="act"><span></span><button class="btn small primary" data-use="${id}">Use</button></div></div>`).join("")}</div>`
      : `<div class="empty">Nothing in your bag. Search wrecks or visit a station shop.</div>`;
    body.querySelectorAll("[data-use]").forEach((b) => b.addEventListener("click", () => {
      const r = inv.use(b.dataset.use, itemCtx());
      $("invMsg").textContent = r.msg;
      renderInventory();
    }));
  } else if (invTab === "truck") {
    const names = ["Front left tyre", "Front right tyre", "Rear left tyre", "Rear right tyre"];
    const tempPct = 100 - Math.max(0, Math.min(100, ((parts.temp - 60) / (OVERHEAT + 10 - 60)) * 100));
    body.innerHTML = [
      statRow("Fuel", (car.fuel / TANK) * 100, car.fuel.toFixed(1) + " L"),
      statRow("Engine", parts.engine), statRow("Body", parts.body),
      statRow("Coolant", parts.coolant), statRow("Battery", parts.battery),
      statRow("Engine temp", tempPct, Math.round(parts.temp) + "°C"),
      ...parts.tyres.map((t, i) => statRow(names[i], t, parts.flat[i] ? "FLAT" : Math.round(t) + "%")),
    ].join("");
  } else {
    body.innerHTML = `<div class="stats">${[
      ["Day", game.day], ["Distance", fmtDist(car.odometer)], ["Difficulty", diff().label],
      ["Weather", `${weather.label}, ${Math.round(ambient())}°C`], ["Wrecks searched", game.stats.wrecks], ["Fuel bought", Math.round(game.stats.litres) + " L"],
    ].map(([k, v]) => `<div>${k}<b>${v}</b></div>`).join("")}</div>`;
  }
}

function openShop() {
  state = "ui";
  releaseAll();
  if (document.pointerLockElement) document.exitPointerLock();
  $("shopMsg").textContent = "";
  renderShop();
  backStack.length = 0;
  show("shop", false);
}
function renderShop() {
  $("shopCash").textContent = "$" + inv.money;
  $("shopItems").innerHTML = SHOP_ORDER.map((id) => {
    const it = ITEMS[id];
    return `<div class="item"><div class="ic">${it.icon}</div><b>${it.name}${inv.count(id) ? `<em>×${inv.count(id)}</em>` : ""}</b><span>${it.desc}</span>
      <div class="act"><span class="price">$${it.price}</span><button class="btn small primary" data-buy="${id}" ${inv.money < it.price ? "disabled" : ""}>Buy</button></div></div>`;
  }).join("");
  $("shopItems").querySelectorAll("[data-buy]").forEach((b) => b.addEventListener("click", () => {
    $("shopMsg").textContent = inv.buy(b.dataset.buy).msg;
    renderShop();
  }));
}

// ── Sleep ──────────────────────────────────────────────
function sleep() {
  if (needs.energy > 75) { toast("You're not tired enough to sleep"); return; }
  state = "sleeping";
  releaseAll();
  const fade = $("fade");
  fade.textContent = "Sleeping…";
  fade.style.opacity = 1;
  setTimeout(() => {
    const hours = Math.max(1, Math.min(9, (100 - needs.energy) / 14));
    const before = sky.time;
    sky.time = (sky.time + hours / 24) % 1;
    if (sky.time < before) game.day++;
    lastTime = sky.time;
    const temp = ambient();
    needs.update(hours, { temp, sleeping: true, rate: diff().needs });
    weather.advance(hours);
    parts.stop();
    parts.temp = temp;
    car.vel.set(0, 0, 0);
    setTimeout(() => {
      fade.style.opacity = 0;
      if (needs.dead) { die(needs.cause); return; }
      state = "playing";
      last = performance.now();
      toast(`You slept ${Math.round(hours)} hours. It's ${sky.clock()} on day ${game.day}.`);
      persist();
    }, 700);
  }, 900);
}

// ── HUD ────────────────────────────────────────────────
const shown = {};
function setText(id, text) { if (shown[id] !== text) { shown[id] = text; $(id).textContent = text; } }
function setWidth(el, pct) { el.style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + "%"; }
let toastTimer = 0;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
}
function fmtDist(m) {
  return prefs.units === "mi" ? (m / 1609.34).toFixed(1) + " mi" : (m / 1000).toFixed(1) + " km";
}
const ambient = () => weather.ambient(sky.time);
function setWarn(id, on, bad) {
  const el = $(id);
  el.classList.toggle("on", on && !bad);
  el.classList.toggle("bad", !!bad);
}
function setFootUi(on) {
  $("crosshair").hidden = !on;
  $("help").innerHTML = on
    ? "<b>WASD</b> walk · <b>Shift</b> run · click to look<br/><b>E</b> interact · <b>F</b> get in · <b>Tab</b> inventory<br/><b>P</b> pause · <b>M</b> sound"
    : "<b>W/S</b> drive · <b>A/D</b> steer · <b>Space</b> handbrake<br/><b>F</b> get out · <b>Z</b> sleep · <b>C</b> camera · <b>L</b> lights<br/><b>Tab</b> inventory · <b>R</b> reset · <b>P</b> pause";
}

function updateHud(prompt) {
  setText("day", String(game.day));
  setText("clock", sky.clock());
  setText("weather", weather.label);
  setText("temp", Math.round(ambient()) + "°C");
  setText("money", "$" + inv.money);
  const sp = Math.abs(car.speed) * (prefs.units === "mi" ? 2.237 : 3.6);
  setText("speed", String(game.onFoot ? 0 : Math.round(sp)));
  setText("gear", game.onFoot ? "ON FOOT" : parts.crank > 0 ? "STARTING" : !parts.running ? "ENGINE OFF" : car.speed < -0.5 ? "R" : "D");

  const fuelPct = (car.fuel / TANK) * 100;
  setWidth($("fuelFill"), fuelPct);
  $("fuelBar").classList.toggle("low", fuelPct < 15);
  setText("fuelText", car.fuel.toFixed(car.fuel < 10 ? 1 : 0) + " L");
  setWidth($("tempFill"), ((parts.temp - 40) / 90) * 100);
  setText("tempText", Math.round(parts.temp) + "°");

  const minTyre = Math.min(...parts.tyres);
  setWarn("wEng", parts.engine < 50, parts.engine < 20 || parts.temp > OVERHEAT);
  setWarn("wTyre", minTyre < 40, parts.flat.some(Boolean) || minTyre < 15);
  setWarn("wCool", parts.coolant < 40, parts.coolant < 15);
  setWarn("wBatt", parts.battery < 30, parts.battery < 10);
  setWarn("wBody", parts.body < 50, parts.body < 20);

  for (const [id, v] of [["nHealth", needs.health], ["nHunger", needs.hunger], ["nThirst", needs.thirst], ["nEnergy", needs.energy]]) {
    const el = $(id);
    setWidth(el.querySelector("i"), v);
    el.classList.toggle("low", v < 20);
  }

  // Edge darkening when exhausted, red when badly hurt
  const vig = $("vignette");
  const tired = needs.energy < 15 ? (15 - needs.energy) / 15 : 0;
  const hurt = needs.health < 35 ? (35 - needs.health) / 35 : 0;
  vig.style.background = hurt > tired
    ? "radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(150,10,10,0.75) 100%)"
    : "radial-gradient(ellipse at center, rgba(0,0,0,0) 40%, rgba(0,0,0,0.9) 100%)";
  vig.style.opacity = Math.max(tired, hurt * (0.7 + 0.3 * Math.sin(performance.now() / 300)));

  setText("prompt", prompt);
  $("prompt").classList.toggle("show", !!prompt);
}

// ── Camera ─────────────────────────────────────────────
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
const lookQ = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, "YXZ");
function updateCamera(dt) {
  car.setCabView(!game.onFoot && prefs.camera === "cab");
  if (game.onFoot) {
    player.applyCamera(camera);
  } else if (prefs.camera === "cab") {
    camera.position.copy(tmp.set(0.42, 1.02, 0.35).applyQuaternion(car.quat).add(car.pos));
    euler.set(look.pitch, look.yaw, 0);
    camera.quaternion.copy(car.quat).multiply(lookQ.setFromEuler(euler));
    camera.rotateY(Math.PI); // camera looks down −z, the truck faces +z
  } else {
    const f = tmp.set(0, 0, 1).applyQuaternion(car.quat);
    f.y = 0;
    if (f.lengthSq() < 0.01) f.set(0, 0, 1);
    f.normalize();
    tmp2.copy(car.pos).addScaledVector(f, -8.5);
    tmp2.y = Math.max(car.pos.y + 3.4, heightAt(tmp2.x, tmp2.z) + 1.2);
    camPos.lerp(tmp2, 1 - Math.exp(-dt * 5));
    camera.position.copy(camPos);
    camLook.copy(car.pos).addScaledVector(f, 4);
    camLook.y += 1;
    camera.lookAt(camLook);
  }
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt * 2);
  }
}
canvas.addEventListener("click", () => {
  if (state === "playing" && (game.onFoot || prefs.camera === "cab") && !document.pointerLockElement) {
    try { canvas.requestPointerLock(); } catch (e) {}
  }
});

// ── Doors ──────────────────────────────────────────────
function getOut() {
  if (Math.abs(car.speed) > 2) { toast("Stop the truck first"); return; }
  game.onFoot = true;
  parts.stop();
  player.exitTruck(car);
  look.clamp = false;
  look.yaw = player.yaw;
  look.pitch = 0;
  setFootUi(true);
}
function getIn() {
  game.onFoot = false;
  look.clamp = true;
  look.yaw = look.pitch = 0;
  if (prefs.camera !== "cab" && document.pointerLockElement) document.exitPointerLock();
  setFootUi(false);
  if (car.fuel > 0) { parts.tryStart(car.fuel); audio.crank(); }
}
function truckColliders() {
  const f = tmp.set(0, 0, 1).applyQuaternion(car.quat);
  return [
    { x: car.pos.x + f.x * 1.35, z: car.pos.z + f.z * 1.35, r: 1.1 },
    { x: car.pos.x - f.x * 1.35, z: car.pos.z - f.z * 1.35, r: 1.1 },
  ];
}

// ── Loop ───────────────────────────────────────────────
weather.onThunder = () => audio.thunder();
let last = performance.now(), acc = 0, menuAngle = 0;
const IDLE = { throttle: 0, steer: 0, handbrake: true, use: false, horn: false };

function frame(now) {
  requestAnimationFrame(frame);
  // rAF timestamps can be slightly older than performance.now() taken on resume
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;

  if (took("pause")) {
    if (state === "playing") pause();
    else if (state === "paused") resume();
    else if (state === "ui") closeUi();
  }
  if (took("inventory")) {
    if (state === "playing") openInventory();
    else if (state === "ui") closeUi();
  }

  if (state === "playing") tick(dt);
  else if (state === "menu") {
    // Slow orbit around the truck behind the menu
    menuAngle += dt * 0.08;
    sky.update(dt * 0.15, camera, car.pos);
    weather.update(dt, 0, camera, sky);
    camera.position.set(car.pos.x + Math.sin(menuAngle) * 11, car.pos.y + 3.2, car.pos.z + Math.cos(menuAngle) * 11);
    camera.lookAt(car.pos.x, car.pos.y + 0.6, car.pos.z);
    car.syncMesh();
  }
  audio.update({
    running: parts.running, speed: car.speed, throttle: car.throttle, inCab: !game.onFoot,
    wind: weather.p.sand + weather.p.rain * 0.5, rain: weather.p.rain,
    horn: state === "playing" && !game.onFoot && controls().horn, active: state === "playing",
  });
  endFrame();
  if (state === "playing" || state === "menu" || state === "sleeping") renderer.render(scene, camera);
}

function tick(dt) {
  const inTruck = !game.onFoot;
  const d = diff();

  // One-shot actions
  if (took("camera") && inTruck) {
    prefs.camera = prefs.camera === "cab" ? "chase" : "cab";
    savePrefs(prefs);
    look.yaw = look.pitch = 0;
    if (prefs.camera === "chase" && document.pointerLockElement) document.exitPointerLock();
    toast(prefs.camera === "cab" ? "Cab view. Click to look around." : "Chase view");
  }
  if (took("lights")) {
    game.lights = { auto: "on", on: "off", off: "auto" }[game.lights];
    toast("Headlights: " + game.lights);
  }
  if (took("mute")) { prefs.muted = !prefs.muted; savePrefs(prefs); applyPrefs(); toast(prefs.muted ? "Sound off" : "Sound on"); }
  if (took("door")) {
    if (inTruck) getOut();
    else if (player.pos.distanceTo(car.pos) < 3.6) getIn();
    else toast("Walk up to the truck to get in");
  }
  if (took("sleep") && inTruck) {
    if (Math.abs(car.speed) > 1) toast("Pull over and stop to sleep");
    else { sleep(); return; }
  }
  if (took("reset") && inTruck) {
    if (car.fuel <= 0 && Math.abs(car.speed) < 1 && car.upright > 0.45) {
      if (!d.rescue) toast("Nobody's coming out here. You're on your own.");
      else {
        const cost = Math.min(inv.money, 20);
        inv.money -= cost;
        car.fuel = 10;
        toast(cost ? `A passing driver sells you 10 L for $${cost}` : "A passing driver spares you 10 L for free");
      }
    } else if (Math.abs(car.speed) < 4 || stuckFor > 0.5) {
      car.placeOnRoad(car.pos.z);
      stuckFor = 0;
      toast("Back on the road");
    }
  }

  // Driver input (none when you're out of the truck or blacking out)
  let input = inTruck ? controls() : IDLE;
  if (inTruck && needs.energy <= 0) {
    nextBlackout -= dt;
    if (nextBlackout <= 0) { blackout = 1.6; nextBlackout = 10 + Math.random() * 20; toast("You nod off at the wheel…"); }
  }
  if (blackout > 0) {
    blackout -= dt;
    input = { ...IDLE, handbrake: false };
  }
  $("fade").textContent = "";
  $("fade").style.opacity = blackout > 0 ? 0.85 : 0;

  // Engine start: press W when it's off
  if (inTruck && input.throttle > 0 && !parts.running && parts.crank <= 0 && Math.abs(car.speed) < 3) {
    parts.tryStart(car.fuel);
    if (parts.crank > 0) audio.crank();
  }

  // Physics
  const temp = ambient();
  const mods = parts.mods(weather.wet);
  const colliders = world.collidersNear(car.pos.z);
  car.running = parts.running;
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 12) { car.step(STEP, input, mods, colliders); acc -= STEP; steps++; }
  if (steps === 12) acc = 0;
  const sev = car.takeImpact();
  if (sev > 0.5) {
    parts.impact(sev);
    if (inTruck) needs.hurt(sev * 0.45, "A crash");
    shake = Math.min(0.6, shake + sev * 0.02);
  }
  const lightsOn = game.lights === "on" || (game.lights === "auto" && (sky.night || weather.p.fog < 0.4));
  parts.update(dt, car, { ambient: temp, sand: weather.p.sand, wear: d.wear, lights: lightsOn, throttle: car.throttle, handbrake: input.handbrake });
  car.running = parts.running;
  if (parts.event) { toast(parts.event); parts.event = null; }
  stuckFor = car.upright < 0.45 && Math.abs(car.speed) < 2 ? stuckFor + dt : 0;

  // On foot
  if (!inTruck) {
    player.yaw = look.yaw;
    player.pitch = look.pitch;
    player.update(dt, footControls(), [...world.collidersNear(player.pos.z), ...truckColliders()], needs.energy > 8);
    look.yaw = player.yaw;
  }

  // Needs
  needs.update(dt / HOUR, { temp, sprinting: !inTruck && player.sprinting, sleeping: false, rate: d.needs });
  if (needs.dead) { die(needs.cause); return; }

  // Interactions
  const at = focus();
  let prompt = "";
  const truckAtPump = nearPump(car.pos.x, car.pos.z) && Math.abs(car.speed) < 1;
  const canPump = truckAtPump && (inTruck || (nearPump(player.pos.x, player.pos.z) && player.pos.distanceTo(car.pos) < 7));
  if (canPump && (inTruck ? input.use : controls().use) && car.fuel < TANK) {
    const want = Math.min(TANK - car.fuel, REFUEL_RATE * dt);
    const afford = Math.min(want, inv.money / FUEL_PRICE - (game._owed || 0));
    if (afford > 0) {
      car.fuel += afford;
      game.stats.litres += afford;
      game._owed = (game._owed || 0) + afford * FUEL_PRICE;
      const whole = Math.floor(game._owed);
      inv.money -= whole;
      game._owed -= whole;
      prompt = `Refuelling… $${inv.money} left`;
    } else prompt = "Not enough cash for fuel";
  } else if (canPump) {
    prompt = car.fuel >= TANK - 0.01 ? "Tank full" : `Hold E to refuel ($${FUEL_PRICE.toFixed(2)}/L)`;
  } else if (!inTruck) {
    const shop = shopNear(at.x, at.z);
    const wreck = world.wrecksNear(at.x, at.z, 3.4);
    if (shop) {
      prompt = "Press E to open the shop";
      if (took("use")) { openShop(); return; }
    } else if (wreck) {
      const done = game.looted.has(wreck.id);
      prompt = done ? "You've already searched this wreck" : "Press E to search the wreck";
      if (!done && took("use")) searchWreck(wreck);
    } else if (player.pos.distanceTo(car.pos) < 3.6) {
      prompt = "Press F to get in";
    } else if (nearPump(at.x, at.z)) {
      prompt = "Park the truck at the pump to refuel";
    }
  } else if (nearPump(car.pos.x, car.pos.z)) {
    prompt = "Stop at the pump to refuel";
  } else if (!parts.running && parts.crank <= 0) {
    if (car.fuel <= 0) prompt = Math.abs(car.speed) < 1 ? (d.rescue ? "Out of fuel. Press R to flag down a passing driver." : "Out of fuel") : "Out of fuel";
    else prompt = "Engine off. Press W to start it.";
  } else if (stuckFor > 1.5) {
    prompt = "Press R to put the truck back on the road";
  }

  // World
  sky.update(dt, camera, at);
  if (sky.time < lastTime) game.day++;
  lastTime = sky.time;
  weather.update(dt, dt / HOUR, camera, sky);
  if (lightsOn !== car._lightsOn || settings.lite !== car._lightsLite) {
    car.setHeadlights(lightsOn, settings.lite);
    car._lightsOn = lightsOn; car._lightsLite = settings.lite;
  }
  world.update(at.z, false);
  car.syncMesh();
  updateCamera(dt);
  updateHud(prompt);
}

function searchWreck(w) {
  game.looted.add(w.id);
  game.stats.wrecks++;
  const loot = lootFor(getSeed(), w.id);
  inv.money += loot.money;
  loot.items.forEach((id) => inv.add(id));
  const found = [...(loot.money ? [`$${loot.money}`] : []), ...loot.items.map((id) => ITEMS[id].name)];
  toast(found.length ? "Found: " + found.join(", ") : "Nothing useful in this one");
  persist();
}

// ── Start: menu backdrop at sunset ─────────────────────
setSeed((Math.random() * 2 ** 31) | 0);
resetStations();
world.clear();
car.placeOnRoad(20);
sky.time = 0.72;
world.update(20, true);
car.syncMesh();
showMain();
requestAnimationFrame(frame);

// Handy for testing from the console
window.__longhaul = { car, world, sky, weather, parts, needs, inv, player, game, scene, camera, renderer, startTrip, state: () => state };
