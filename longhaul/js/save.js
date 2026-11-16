// Long Haul – local saves (version 4), settings and best-trip record.
// Version 4 adds strangers: world.enc (encounter records), `hostile` and `playTime`. The storage key keeps its old
// name so a version-3 journey is found and carried on.
// Storage can be missing or full (private windows, embedded frames): every call reports failure instead of throwing.
const KEY = "longhaul-save-v3";
const KEY_V2 = "longhaul-save-v2";
const BACKUP = "longhaul-save-backup";
export const SAVE_VERSION = 4;

let store = null;
try { store = globalThis.localStorage || null; } catch (e) { store = null; }
// Tests can swap the storage
export function setStorage(s) { store = s; }

const get = (k) => { try { return store ? store.getItem(k) : null; } catch (e) { return null; } };
const set = (k, v) => { try { if (!store) return false; store.setItem(k, v); return true; } catch (e) { return false; } };
const del = (k) => { try { store && store.removeItem(k); } catch (e) {} };

const isNum = (v) => typeof v === "number" && isFinite(v);

function valid(d) {
  return d && (d.v === SAVE_VERSION || d.v === 3) && isNum(d.seed) && isNum(d.day) && d.player && Array.isArray(d.player.pos)
    && d.player.pos.every(isNum) && d.world && d.needs;
}

// A version-3 journey has no strangers yet: it continues as it was, and encounters appear on the road ahead
// (none are created behind the player or on top of them – the schedule only instantiates what is approached).
export function migrateV3(d) {
  if (!d || d.v !== 3) return d;
  return { ...d, v: SAVE_VERSION, hostile: true, playTime: 0, world: { ...d.world, enc: [] } };
}

// A version-2 save knew one truck on a different road. The road is new, so the journey restarts at the garage
// with everything that still means something: seed, day, clock, needs, cash, difficulty, distance and supplies.
export function migrateV2(d) {
  if (!d || d.v !== 2 || !d.car) return null;
  return {
    v: SAVE_VERSION, at: d.at || Date.now(), migrated: 2,
    seed: d.seed >>> 0 || 1, time: isNum(d.time) ? d.time : 0.3, day: d.day || 1, diff: d.diff || "normal",
    needs: d.needs || null, wallet: { money: (d.inv && d.inv.money) || 0 }, weather: d.weather || null,
    stats: { wrecks: 0, litres: 0, sites: 0, ...(d.stats || {}), distance: d.car.odometer || 0 },
    legacy: {
      items: (d.inv && d.inv.items) || {}, fuel: d.car.fuel,
      engine: d.parts && d.parts.engine, body: d.parts && d.parts.body,
    },
    player: null, interact: null, drivenId: null, world: null,
  };
}

// → { save, error }  error: null | "corrupt" | "newer" | "unavailable"
// A save that cannot be read is never deleted: it is copied to a backup key and reported.
export function loadSave() {
  if (!store) return { save: null, error: "unavailable" };
  const raw = get(KEY);
  if (raw) {
    try {
      const d = JSON.parse(raw);
      if (valid(d)) return { save: migrateV3(d), error: null };
      if (d && d.v > SAVE_VERSION) return { save: null, error: "newer" };
      set(BACKUP, raw);
      return { save: null, error: "corrupt" };
    } catch (e) {
      set(BACKUP, raw);
      return { save: null, error: "corrupt" };
    }
  }
  const old = get(KEY_V2);
  if (old) {
    try {
      const m = migrateV2(JSON.parse(old));
      if (m) return { save: m, error: null };
    } catch (e) {}
    set(BACKUP, old);
    return { save: null, error: "corrupt" };
  }
  return { save: null, error: null };
}

// A journey from somewhere else (the X-ORBIT account): the same checks as a local save → save | null
export function checkSave(d) {
  return d && typeof d === "object" && valid(d) ? migrateV3(d) : null;
}

// Returns true when the save reached storage
export function writeSave(data) {
  let json;
  try { json = JSON.stringify(Object.assign({ v: SAVE_VERSION, at: Date.now() }, data)); } catch (e) { return false; }
  return set(KEY, json);
}

// Starting a new journey: the old one (any version) is removed
export function clearSave() { del(KEY); del(KEY_V2); del("longhaul-save-v1"); }

// What the main menu shows about a save
export function previewOf(save) {
  if (!save) return null;
  return {
    day: save.day, diff: save.diff, distance: (save.stats && save.stats.distance) || 0,
    vehicle: save.vehicleName || (save.migrated ? "Pickup (journey from an older version)" : "Pickup"),
    at: save.at, migrated: !!save.migrated,
  };
}

// ── Settings ───────────────────────────────────────────
const PREFS = "longhaul-prefs";
export const PREF_DEFAULTS = {
  quality: "auto", fov: 70, camMotion: 1, camera: "cab", chaseZoom: 1, sens: 1, invertY: false,
  units: "km", gearbox: "auto",
  vol: { master: 0.8, music: 0.6, sfx: 0.8, ambience: 0.7, voice: 1 }, muted: false, radio: true, voiceMode: "open",
  hud: { scale: 1, opacity: 1, show: "full", critical: true, help: true },
  a11y: { reduceMotion: false, highContrast: false },
};
function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!over || typeof over !== "object") return out;
  for (const k of Object.keys(base)) {
    const b = base[k], o = over[k];
    if (o === undefined || o === null) continue;
    if (b && typeof b === "object") out[k] = merge(b, o);
    else if (typeof o === typeof b) out[k] = o;
  }
  return out;
}
export function loadPrefs() {
  let raw = {};
  try { raw = JSON.parse(get(PREFS) || "{}") || {}; } catch (e) { raw = {}; }
  // Settings from the first version of the game
  if (isNum(raw.volume) && !raw.vol) raw.vol = { master: raw.volume };
  if (typeof raw.showHelp === "boolean" && !raw.hud) raw.hud = { help: raw.showHelp };
  const p = merge(PREF_DEFAULTS, raw);
  if (!["auto", "high", "lite"].includes(p.quality)) p.quality = "auto";
  if (!["cab", "chase"].includes(p.camera)) p.camera = "cab";
  if (!["open", "ptt"].includes(p.voiceMode)) p.voiceMode = "open";
  if (!["km", "mi"].includes(p.units)) p.units = "km";
  if (!["auto", "manual"].includes(p.gearbox)) p.gearbox = "auto";
  if (!["full", "minimal", "off"].includes(p.hud.show)) p.hud.show = "full";
  p.fov = Math.max(50, Math.min(110, p.fov));
  p.chaseZoom = Math.max(0.5, Math.min(2.5, p.chaseZoom));
  return p;
}
export function savePrefs(p) { return set(PREFS, JSON.stringify(p)); }

// Best trip, shown on the main menu
const BEST = "longhaul-best";
export function loadBest() { try { return JSON.parse(get(BEST) || "null"); } catch (e) { return null; } }
export function saveBest(b) { set(BEST, JSON.stringify(b)); }
