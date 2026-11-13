// Long Haul – soundtrack. Reads audio/music/manifest.json and plays a "menu" playlist on the menus and a "radio"
// playlist while driving. Works with zero tracks (reports an empty playlist), skips files that are missing or in a
// format the browser cannot play, cross-fades between tracks and never plays two copies of the same list.
// Volume is applied to the <audio> elements directly so music does not depend on the WebAudio context.
import { emit } from "./core/bus.js";

const MANIFEST = "audio/music/manifest.json";
const TYPES = { mp3: "audio/mpeg", ogg: "audio/ogg", oga: "audio/ogg", opus: 'audio/ogg; codecs="opus"', m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", flac: "audio/flac" };
const FADE = 1.4; // seconds

const lists = { menu: [], radio: [] };
const options = { menuOrder: "sequence", radioOrder: "shuffle", loop: true };
const problems = [];           // human-readable notes about tracks that were skipped
let loaded = false, unlocked = false, paused = false;
let context = "none";          // which playlist should be sounding: "menu" | "radio" | "none"
let volume = 0.5;              // master × music, 0..1 (0 when muted)
let current = null;            // { el, track, list, level, target }
const fading = new Set();      // elements on their way out
const index = { menu: -1, radio: -1 };
let timer = null, serial = 0;

function playable(file) {
  const ext = String(file).split("?")[0].split(".").pop().toLowerCase();
  if (!TYPES[ext]) return `unsupported file type ".${ext}"`;
  try {
    const a = document.createElement("audio");
    if (!a.canPlayType(TYPES[ext])) return `this browser cannot play .${ext} files`;
  } catch (e) { return "audio is not available"; }
  return null;
}

function readList(raw, name) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const t of raw) {
    if (!t || typeof t.file !== "string" || !t.file.trim()) { problems.push(`${name}: an entry has no "file"`); continue; }
    if (/^[a-z]+:\/\//i.test(t.file) || t.file.startsWith("//")) { problems.push(`${t.file}: only local files in audio/music/ are supported`); continue; }
    const why = playable(t.file);
    if (why) { problems.push(`${t.file}: ${why}`); continue; }
    out.push({
      file: t.file, url: "audio/music/" + t.file.replace(/^\.?\//, ""),
      title: t.title || t.file.replace(/\.[^.]+$/, ""), artist: t.artist || "", license: t.license || "", bad: false,
    });
  }
  return out;
}

function tick() {
  const step = 0.05 / FADE;
  if (current) {
    current.level += Math.max(-step, Math.min(step, current.target - current.level));
    current.el.volume = Math.max(0, Math.min(1, current.level * volume));
  }
  for (const f of [...fading]) {
    f.level -= step;
    if (f.level <= 0) { try { f.el.pause(); f.el.removeAttribute("src"); f.el.load(); } catch (e) {} fading.delete(f); }
    else f.el.volume = Math.max(0, Math.min(1, f.level * volume));
  }
  if (!current && !fading.size) { clearInterval(timer); timer = null; }
}
function ensureTimer() { if (!timer) timer = setInterval(tick, 50); }

function fadeOutCurrent() {
  if (!current) return;
  current.el.onended = current.el.onerror = null;
  fading.add(current);
  current = null;
  ensureTimer();
  emit("music:track", null);
}

function pick(name, dir = 1) {
  const list = lists[name].filter((t) => !t.bad);
  if (!list.length) return null;
  const order = name === "menu" ? options.menuOrder : options.radioOrder;
  if (order === "shuffle" && list.length > 1) {
    let i; do { i = Math.floor(Math.random() * list.length); } while (list[i] === (current && current.track));
    return list[i];
  }
  index[name] = (index[name] + dir + list.length) % list.length;
  return list[index[name]];
}

function startTrack(name, dir = 1) {
  const track = pick(name, dir);
  fadeOutCurrent();
  if (!track) return;
  const my = ++serial;
  const el = new Audio();
  el.preload = "auto";
  el.src = track.url;
  el.volume = 0;
  const cur = { el, track, list: name, level: 0, target: 1 };
  el.onended = () => {
    if (my !== serial || context !== name) return;
    if (!options.loop && lists[name].filter((t) => !t.bad).length <= 1) { fadeOutCurrent(); return; }
    startTrack(name);
  };
  el.onerror = () => {
    track.bad = true;
    problems.push(`${track.file}: could not be loaded`);
    emit("music:problem", { file: track.file });
    if (my === serial && context === name) { current = null; startTrack(name); }
  };
  current = cur;
  ensureTimer();
  const p = el.play();
  if (p && p.catch) p.catch(() => { /* blocked until a user gesture; resume() retries */ });
  emit("music:track", { title: track.title, artist: track.artist, list: name });
}

function sync() {
  if (!loaded || !unlocked) return;
  if (paused || context === "none") { if (current) current.target = 0, pauseSoon(); return; }
  if (current && current.list === context) {
    current.target = 1;
    if (current.el.paused) { const p = current.el.play(); if (p && p.catch) p.catch(() => {}); }
    ensureTimer();
    return;
  }
  startTrack(context);
}
// Fade down, then pause in place (so resuming continues the same track)
function pauseSoon() {
  ensureTimer();
  const cur = current;
  setTimeout(() => { if (cur === current && cur.target === 0) { try { cur.el.pause(); } catch (e) {} } }, FADE * 1000 + 100);
}

export const music = {
  // Loads the manifest. Never rejects: a missing or broken manifest simply means an empty playlist.
  async init() {
    try {
      const res = await fetch(MANIFEST, { cache: "no-cache" });
      if (res.ok) {
        const m = await res.json();
        lists.menu = readList(m.menu, "menu");
        lists.radio = readList(m.radio, "radio");
        if (m.options) {
          if (["sequence", "shuffle"].includes(m.options.menuOrder)) options.menuOrder = m.options.menuOrder;
          if (["sequence", "shuffle"].includes(m.options.radioOrder)) options.radioOrder = m.options.radioOrder;
          if (typeof m.options.loop === "boolean") options.loop = m.options.loop;
        }
      } else problems.push("audio/music/manifest.json was not found");
    } catch (e) { problems.push("audio/music/manifest.json could not be read"); }
    loaded = true;
    sync();
    return this.info();
  },
  // Call from the first user gesture
  unlock() { unlocked = true; sync(); },
  setContext(name) { if (name === context) return; context = name; sync(); },
  setVolume(v) { volume = Math.max(0, Math.min(1, v)); if (current) current.el.volume = current.level * volume; },
  pause() { paused = true; sync(); },
  resume() { paused = false; sync(); },
  next() { if (unlocked && context !== "none" && !paused) startTrack(context, 1); },
  info() {
    const all = [...lists.menu, ...lists.radio];
    return {
      loaded, menu: lists.menu.length, radio: lists.radio.length, tracks: all.length,
      current: current ? { title: current.track.title, artist: current.track.artist, list: current.list } : null,
      credits: all.filter((t, i) => all.findIndex((u) => u.file === t.file) === i).map((t) => ({ title: t.title, artist: t.artist, license: t.license })),
      problems: [...problems],
    };
  },
};
