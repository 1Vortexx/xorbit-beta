// Long Haul – local save (survives X-ORBIT putting the app to sleep) and settings
const KEY = "longhaul-save-v2";

export function loadSave() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "null");
    return d && d.v === 2 && d.car ? d : null;
  } catch (e) { return null; }
}

export function writeSave(data) {
  try { localStorage.setItem(KEY, JSON.stringify(Object.assign({ v: 2, at: Date.now() }, data))); } catch (e) {}
}

export function clearSave() {
  try { localStorage.removeItem(KEY); localStorage.removeItem("longhaul-save-v1"); } catch (e) {}
}

const PREFS = "longhaul-prefs";
const DEFAULTS = { camera: "chase", muted: false, quality: "auto", fov: 65, sens: 1, volume: 0.8, units: "km", showHelp: true };
export function loadPrefs() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(PREFS) || "{}")); }
  catch (e) { return { ...DEFAULTS }; }
}
export function savePrefs(p) {
  try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch (e) {}
}

// Best trip, shown on the main menu
const BEST = "longhaul-best";
export function loadBest() {
  try { return JSON.parse(localStorage.getItem(BEST) || "null"); } catch (e) { return null; }
}
export function saveBest(b) {
  try { localStorage.setItem(BEST, JSON.stringify(b)); } catch (e) {}
}
