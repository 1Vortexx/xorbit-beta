// Long Haul – gameplay HUD. Pure presentation: main.js feeds real state through hud.update() every frame and this
// module diffs it against what is already on screen, touching the DOM only when a value changed.
import { on } from "../core/bus.js";
import { bindingLabel } from "../input.js";
import { icon, critIcon, esc, clamp01, fmtDist, weatherIcon, hasIcon } from "./icons.js";

const NEEDS = [["health", "heart", "Health"], ["hunger", "food", "Food"], ["thirst", "thirst", "Water"], ["energy", "energy", "Energy"]];
const WARN_ICON = { fuel: "fuel", temp: "temp", oil: "oil", coolant: "coolant", battery: "battery", tyre: "tyre", engine: "engine", body: "body" };
const IGN = { off: "OFF", on: "ON", cranking: "STARTING", running: "RUNNING" };
const PRIO = { crit: 3, warn: 2, good: 1, info: 0 };
const NOTE_MS = { crit: 8000, warn: 5500, good: 3800, info: 3500 };
const ARC_R = 42, ARC_C = 2 * Math.PI * ARC_R, ARC_L = ARC_C * (240 / 360);

const TICKS = `${`0.8 ${(ARC_L / 8 - 0.8).toFixed(2)} `.repeat(8)}0.8 ${ARC_C.toFixed(1)}`;

let root, vig, fadeEl, el = {};
let prefs = null;
let visible = false, dimmed = false, lockedNow = false;
let showMode = "full", critOnly = true;
let lastMusic = "", musicTimer = 0, pushedMusic = null;
let sig = { actions: "", slots: "", warns: "", held: "" };
let actionRows = [];

// ── tiny diffing helpers ───────────────────────────────────────────────────
const memo = (e) => e._m || (e._m = {});
const text = (e, v) => { const m = memo(e); if (m.t !== v) { m.t = v; e.textContent = v; } };
const html = (e, v) => { const m = memo(e); if (m.h !== v) { m.h = v; e.innerHTML = v; } };
const cls = (e, n, onv) => { const m = memo(e), k = "c" + n; onv = !!onv; if (m[k] !== onv) { m[k] = onv; e.classList.toggle(n, onv); } };
const css = (e, n, v) => { const m = memo(e), k = "s" + n; if (m[k] !== v) { m[k] = v; e.style.setProperty(n, v); } };
const attr = (e, n, v) => { const m = memo(e), k = "a" + n; if (m[k] !== v) { m[k] = v; e.setAttribute(n, v); } };
const vis = (e, onv) => { const m = memo(e); onv = !!onv; if (m.v !== onv) { m.v = onv; e.hidden = !onv; } };
const q2 = (v) => Math.round(clamp01(v) * 200) / 200;   // quantise bar fractions so tiny float noise never writes

function build() {
  root = document.getElementById("hud");
  if (!root) { root = document.createElement("div"); root.id = "hud"; document.body.appendChild(root); }
  root.className = "hud";
  root.setAttribute("data-mode", "foot");
  const need = NEEDS.map(([k, ic, label]) =>
    `<div class="need" data-need="${k}" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100">${icon(ic)}<span class="bar"><i></i></span><b class="mark" aria-hidden="true"></b></div>`).join("");
  root.innerHTML = `
  <div class="hud-tl">
    <div class="plate status" data-tier="full">
      <span class="st-day"><b data-k="day">Day 1</b><i data-k="clock">--:--</i></span>
      <span class="st-wx"><span data-k="wxIcon"></span><b data-k="weather"></b><i data-k="tempC"></i></span>
      <span class="st-money" data-k="money"></span>
      <span class="st-lite" data-k="lite" hidden title="Lite rendering is active">LITE</span>
    </div>
    <div class="plate nowplaying" data-k="np" data-tier="full" hidden>${icon("note")}<span data-k="npText"></span></div>
  </div>
  <div class="hud-tr">
    <div class="plate needs" data-k="needs">${need}</div>
    <div class="notes" data-k="notes" role="status" aria-live="polite"></div>
  </div>
  <div class="hud-bl">
    <div class="plate prog" data-k="prog" hidden><span data-k="progLabel"></span><span class="bar"><i data-k="progBar"></i></span><b data-k="progPct"></b></div>
    <div class="plate cargo only-foot" data-k="cargo" hidden>${icon("box")}<span data-k="cargoTxt"></span></div>
    <div class="plate cluster only-drive" data-k="cluster">
      <div class="dial">
        <svg viewBox="0 0 100 100" aria-hidden="true" data-tier="full">
          <g transform="rotate(150 50 52)" fill="none" stroke-linecap="butt">
            <circle class="arc-bg" cx="50" cy="52" r="${ARC_R}" stroke-dasharray="${ARC_L} ${ARC_C}"/>
            <circle class="arc-red" data-k="arcRed" cx="50" cy="52" r="${ARC_R}"/>
            <circle class="arc-val" data-k="arcVal" cx="50" cy="52" r="${ARC_R}" stroke-dasharray="0 ${ARC_C}"/>
            <circle class="arc-tick" cx="50" cy="52" r="${ARC_R}" stroke-dasharray="${TICKS}" stroke-dashoffset="0.4"/>
          </g>
        </svg>
        <div class="speed"><b data-k="speed">0</b><i data-k="unit">KM/H</i></div>
        <div class="gear" data-tier="full"><b data-k="gear">P</b><i data-k="gearMode">AUTO</i></div>
      </div>
      <div class="gauges">
        <div class="ign" data-tier="full"><span>ENGINE</span><b data-k="ign">OFF</b><i data-k="rpm">0 rpm</i></div>
        <div class="gauge" data-k="fuelRow">${icon("fuel")}<span class="bar"><i data-k="fuelBar"></i></span><b data-k="fuelTxt">0 L</b></div>
        <div class="gauge" data-k="tempRow" data-tier="full">${icon("temp")}<span class="bar"><i data-k="tempBar"></i></span><b data-k="tempTxt">–</b></div>
        <div class="lamps" data-tier="full">
          <span class="lamp" data-k="lampLights">${icon("lights")}<i>LIGHTS</i></span>
          <span class="lamp" data-k="lampBrake">${icon("pbrake")}<i>P-BRAKE</i></span>
        </div>
      </div>
    </div>
    <div class="plate heldp only-foot" data-k="held" data-tier="full" hidden>
      <div class="held-h">${icon("box")}<span>IN HANDS</span></div>
      <div class="held-n"><b data-k="heldName"></b><i data-k="heldQty"></i></div>
      <div class="held-hints" data-k="heldHints"></div>
    </div>
  </div>
  <div class="hud-br">
    <div class="warns" data-k="warns" role="status" aria-live="polite"></div>
    <div class="plate trip only-drive" data-tier="full">
      <span class="trip-v" data-k="vehicle"></span>
      <span class="trip-d">${icon("road")}<b data-k="trip">0.0 km</b></span>
    </div>
    <div class="plate hints only-foot" data-k="footHints" data-tier="help"></div>
  </div>
  <div class="hud-bc">
    <div class="stam only-foot" data-k="stam" hidden><span>STAMINA</span><span class="bar"><i data-k="stamBar"></i></span></div>
    <div class="slotname only-foot" data-k="slotName" data-tier="full"></div>
    <div class="slots only-foot" data-k="slots" data-tier="full"></div>
    <div class="plate hints only-drive" data-k="driveHints" data-tier="help"></div>
  </div>
  <div class="cross only-foot" data-k="cross" aria-hidden="true"><i></i></div>
  <div class="target only-foot" data-k="target" hidden>
    <div class="plate tcard">
      <div class="t-name" data-k="tName"></div>
      <div class="t-info" data-k="tInfo"></div>
    </div>
    <div class="acts" data-k="acts"></div>
  </div>
  <div class="plate lockhint" data-k="lock" hidden>${icon("cursor")}<span>Click to look around</span></div>`;
  for (const n of root.querySelectorAll("[data-k]")) el[n.dataset.k] = n;
  el.need = {};
  for (const n of root.querySelectorAll("[data-need]")) el.need[n.dataset.need] = { row: n, bar: n.querySelector("i"), mark: n.querySelector(".mark") };

  vig = document.getElementById("hud-vignette") || mk("hud-vignette");
  vig.innerHTML = `<i class="v-hurt"></i><i class="v-tired"></i>`;
  fadeEl = document.getElementById("hud-fade") || mk("hud-fade");
  fadeEl.innerHTML = `<span></span>`;
  fadeEl.hidden = true;
  renderHints();
}
function mk(id) { const d = document.createElement("div"); d.id = id; root.after(d); return d; }

const cap = (k) => `<kbd>${esc(k)}</kbd>`;
function renderHints() {
  const row = (list) => list.map(([a, l]) => `<span class="hint">${cap(bindingLabel(a))}${esc(l)}</span>`).join("");
  html(el.driveHints, row([["ignition", "Ignition"], ["exit", "Get out"], ["lights", "Lights"], ["camera", "Camera"], ["parkingBrake", "P-brake"], ["inventory", "Inventory"]]));
  html(el.footHints, row([["use", "Use"], ["grab", "Pick up"], ["stow", "Stow"], ["consume", "Use pocket item"], ["inventory", "Inventory"]]));
}

// ── notifications ─────────────────────────────────────────────────────────
const notes = { active: [], waiting: [] };
const maxNotes = () => (innerHeight < 500 ? 3 : 4);
function noteIcon(n) {
  return n.level === "crit" ? critIcon() : icon(n.level === "warn" ? "warn" : n.level === "good" ? "good" : "info");
}
function noteShow(n) {
  const d = document.createElement("div");
  d.className = `note plate lv-${n.level}`;
  d.innerHTML = `${noteIcon(n)}${n.icon ? `<span class="n-glyph">${esc(n.icon)}</span>` : ""}<span class="n-text"></span>`;
  d.querySelector(".n-text").textContent = n.text;
  n.el = d;
  el.notes.appendChild(d);
  notes.active.push(n);
  noteArm(n);
}
function noteArm(n) {
  clearTimeout(n.timer);
  n.timer = setTimeout(() => noteDrop(n), n.ms || NOTE_MS[n.level] || 3500);
}
function noteDrop(n, instant) {
  const i = notes.active.indexOf(n);
  if (i < 0) return;
  notes.active.splice(i, 1);
  clearTimeout(n.timer);
  const d = n.el;
  if (instant) d.remove();
  else { d.classList.add("out"); setTimeout(() => d.remove(), 260); }
  if (notes.waiting.length && notes.active.length < maxNotes()) noteShow(notes.waiting.shift());
}
function onNotify(n) {
  if (!root || !n || !n.text) return;
  n = { text: String(n.text), level: PRIO[n.level] != null ? n.level : "info", icon: n.icon || "", key: n.key || null, ms: n.ms || 0 };
  if (showMode === "off" && !(critOnly && n.level === "crit")) return;
  const same = (x) => (n.key ? x.key === n.key : x.text === n.text && x.level === n.level);
  const a = notes.active.find(same);
  if (a) {                                             // coalesce: update in place and restart its timer
    a.text = n.text; a.ms = n.ms;
    if (a.level !== n.level || a.icon !== n.icon) {
      a.level = n.level; a.icon = n.icon;
      a.el.className = `note plate lv-${n.level}`;
      a.el.innerHTML = `${noteIcon(n)}${n.icon ? `<span class="n-glyph">${esc(n.icon)}</span>` : ""}<span class="n-text"></span>`;
    }
    a.el.querySelector(".n-text").textContent = n.text;
    noteArm(a);
    return;
  }
  const w = notes.waiting.find(same);
  if (w) { Object.assign(w, n); return; }
  if (notes.active.length < maxNotes()) { noteShow(n); return; }
  // full: a more important message replaces the least important (oldest first) visible one
  let low = notes.active[0];
  for (const x of notes.active) if (PRIO[x.level] < PRIO[low.level]) low = x;
  if (PRIO[n.level] > PRIO[low.level]) { noteDrop(low, true); if (notes.active.length < maxNotes()) noteShow(n); else notes.waiting.unshift(n); return; }
  notes.waiting.push(n);
  notes.waiting.sort((x, y) => PRIO[y.level] - PRIO[x.level]);
  if (notes.waiting.length > 8) notes.waiting.length = 8;
}

// ── updates ───────────────────────────────────────────────────────────────
function updNeeds(needs) {
  if (!needs) return;
  for (const [k] of NEEDS) {
    const e = el.need[k], v = Math.max(0, Math.min(100, needs[k] ?? 0));
    css(e.bar, "--v", String(Math.round(v) / 100));
    attr(e.row, "aria-valuenow", String(Math.round(v)));
    const crit = v < 12, low = v < 28;
    cls(e.row, "low", low); cls(e.row, "crit", crit);
    text(e.mark, crit ? "!!" : low ? "!" : "");
  }
}

function updStatus(s) {
  text(el.day, `Day ${s.day ?? 1}`);
  text(el.clock, s.clock ?? "");
  const wi = weatherIcon(s.weather, s.clock);
  html(el.wxIcon, icon(wi));
  text(el.weather, s.weather ?? "");
  text(el.tempC, s.tempC == null ? "" : `${Math.round(s.tempC)}°C`);
  text(el.money, `$${Math.floor(s.money ?? 0)}`);
  vis(el.lite, s.lite);
}

function updDrive(s) {
  const t = s.tel;
  if (!t) return;
  const mi = s.units === "mi";
  text(el.speed, String(Math.round(Math.abs(t.speed || 0) * (mi ? 2.23694 : 3.6))));
  text(el.unit, mi ? "MPH" : "KM/H");
  text(el.gear, String(t.gear ?? "–"));
  text(el.gearMode, t.gearMode === "manual" ? "MANUAL" : "AUTO");
  const ign = IGN[t.ignition] || "OFF";
  text(el.ign, ign);
  attr(el.ign, "data-s", t.ignition || "off");
  const red = t.redline || 5000, max = Math.ceil((red * 1.14) / 500) * 500;
  const f = Math.round(clamp01((t.rpm || 0) / max) * 120) / 120;
  attr(el.arcVal, "stroke-dasharray", `${(ARC_L * f).toFixed(1)} ${ARC_C.toFixed(1)}`);
  const rf = Math.round((red / max) * 100) / 100;
  attr(el.arcRed, "stroke-dasharray", `0 ${(ARC_L * rf).toFixed(1)} ${(ARC_L * (1 - rf)).toFixed(1)} ${ARC_C.toFixed(1)}`);
  cls(el.cluster, "redline", (t.rpm || 0) >= red);
  text(el.rpm, `${Math.round((t.rpm || 0) / 50) * 50} rpm`);

  const tank = t.tank || 1, ff = clamp01((t.fuel || 0) / tank);
  css(el.fuelBar, "--v", String(q2(ff)));
  text(el.fuelTxt, `${(t.fuel || 0).toFixed((t.fuel || 0) < 10 ? 1 : 0)} L`);
  cls(el.fuelRow, "low", ff < 0.15); cls(el.fuelRow, "crit", ff < 0.06);

  css(el.tempBar, "--v", String(q2(((t.temp ?? 40) - 40) / 90)));
  text(el.tempTxt, t.overheating ? `${Math.round(t.temp)}°C HOT` : `${Math.round(t.temp ?? 0)}°C`);
  cls(el.tempRow, "crit", !!t.overheating); cls(el.tempRow, "low", !t.overheating && (t.temp || 0) > 108);

  cls(el.lampLights, "on", !!t.lights);
  cls(el.lampBrake, "on", !!t.parkingBrake);
  text(el.vehicle, s.vehicleName || "");
  text(el.trip, fmtDist(s.trip, s.units));
}

function updWarns(s) {
  let list = s.mode === "drive" && s.tel && Array.isArray(s.tel.warnings) ? s.tel.warnings : [];
  if (showMode !== "full") list = list.filter((w) => w.level === "crit");
  if (showMode === "off" && !critOnly) list = [];
  let k = "";
  for (const w of list) k += `${w.id}|${w.level}|${w.text};`;
  if (k === sig.warns) return;
  sig.warns = k;
  const sorted = [...list].sort((a, b) => (b.level === "crit") - (a.level === "crit"));
  el.warns.innerHTML = sorted.slice(0, 6).map((w) => {
    const c = w.level === "crit";
    return `<div class="warnchip plate ${c ? "crit" : "warn"}">${c ? critIcon() : icon("warn")}${icon(WARN_ICON[w.id] || "info", "w-kind")}<span>${esc(w.text)}</span></div>`;
  }).join("");
}

function fmtQty(q) {
  if (q == null || q === "") return "";
  return typeof q === "number" ? (Number.isInteger(q) ? String(q) : q.toFixed(1)) : String(q);
}

function updFoot(s) {
  // target card + actions
  const t = s.target, acts = Array.isArray(s.actions) ? s.actions : [];
  const showT = !!t || acts.length > 0;
  vis(el.target, showT);
  cls(el.cross, "aim", showT);
  if (showT) {
    text(el.tName, t ? String(t.name ?? "") : "");
    let info = "";
    if (t) {
      if (t.cond != null) {
        const c = Math.round(t.cond);
        info += `<span class="t-cond${c < 25 ? " bad" : ""}"><em>Condition</em><span class="bar"><i style="--v:${clamp01(c / 100)}"></i></span><b>${c}%</b></span>`;
      }
      if (t.qty != null && t.qty !== "") info += `<span class="t-qty"><em>Amount</em><b>${esc(fmtQty(t.qty))}</b></span>`;
      if (t.note) info += `<span class="t-note">${esc(t.note)}</span>`;
    }
    html(el.tInfo, info);
    vis(el.tInfo, !!info);
    vis(el.tName.parentNode, !!t);
    let k = "";
    for (const a of acts) k += `${a.key}|${a.label}|${a.blocked || ""}|${a.progress != null ? 1 : 0};`;
    if (k !== sig.actions) {
      sig.actions = k;
      el.acts.innerHTML = acts.slice(0, 4).map((a) => {
        const key = /^[a-z]/.test(String(a.key)) ? bindingLabel(a.key) : a.key;   // accept action names as well as labels
        return `<div class="act plate${a.blocked ? " blocked" : ""}">${cap(key)}<span class="a-l">${esc(a.label)}</span>${a.blocked ? `<span class="a-b">${esc(a.blocked)}</span>` : ""}<span class="a-p" hidden><i></i></span></div>`;
      }).join("");
      actionRows = [...el.acts.children].map((r) => ({ row: r, p: r.querySelector(".a-p"), bar: r.querySelector(".a-p i") }));
    }
    for (let i = 0; i < actionRows.length; i++) {
      const a = acts[i], r = actionRows[i], has = a.progress != null && !a.blocked;
      vis(r.p, has);
      if (has) css(r.bar, "--v", String(q2(a.progress)));
    }
  } else if (sig.actions) { sig.actions = ""; el.acts.innerHTML = ""; actionRows = []; }

  // held item
  const hd = s.held;
  vis(el.held, !!hd);
  if (hd) {
    text(el.heldName, String(hd.name ?? ""));
    text(el.heldQty, fmtQty(hd.qty));
    const hints = Array.isArray(hd.hints) ? hd.hints : [];
    const k = hints.map((x) => (typeof x === "string" ? x : `${x.key} ${x.label}`)).join("|");
    if (k !== sig.held) {
      sig.held = k;
      el.heldHints.innerHTML = hints.map((x) => {
        let key, label;
        if (typeof x === "string") { const i = x.indexOf(" "); key = i > 0 ? x.slice(0, i) : ""; label = i > 0 ? x.slice(i + 1) : x; }
        else { key = x.key; label = x.label; }
        return `<span class="hint">${key ? cap(key) : ""}${esc(label)}</span>`;
      }).join("");
    }
  }
  vis(el.cargo, !!s.cargoHint);
  if (s.cargoHint) text(el.cargoTxt, s.cargoHint);

  // stamina: only while sprinting or recovering
  const st = s.stamina == null ? 1 : s.stamina;
  const showS = !!s.sprinting || st < 0.995;
  vis(el.stam, showS);
  if (showS) { css(el.stamBar, "--v", String(q2(st))); cls(el.stam, "low", st < 0.2); }

  // quick slots
  const slots = Array.isArray(s.slots) ? s.slots : [];
  let k = `${s.selected}#`;
  for (let i = 0; i < 6; i++) { const it = slots[i]; k += it ? `${it.icon}|${it.name}|${it.count}|${it.qty};` : "-;"; }
  if (k !== sig.slots) {
    sig.slots = k;
    let out = "";
    for (let i = 0; i < 6; i++) {
      const it = slots[i], sel = i === s.selected;
      const glyph = it ? (hasIcon(it.icon) ? icon(it.icon) : `<span class="s-g">${esc(it.icon || "•")}</span>`) : "";
      out += `<div class="slot plate${sel ? " sel" : ""}${it ? "" : " empty"}"><kbd>${i + 1}</kbd>${glyph}${it && it.count > 1 ? `<b class="s-c">×${it.count}</b>` : ""}</div>`;
    }
    el.slots.innerHTML = out;
    const it = slots[s.selected];
    text(el.slotName, it ? `${it.name}${it.count > 1 ? ` ×${it.count}` : ""}${it.qty != null && it.qty !== "" ? ` · ${fmtQty(it.qty)}` : ""}` : "");
    vis(el.slotName, !!it);
  }
}

function updShared(s) {
  const p = s.progress;
  vis(el.prog, !!p);
  if (p) {
    text(el.progLabel, String(p.label ?? ""));
    css(el.progBar, "--v", String(q2(p.pct)));
    text(el.progPct, `${Math.round(clamp01(p.pct) * 100)}%`);
  }
  const m = s.music !== undefined ? s.music : pushedMusic, key = m && m.title ? `${m.title}\n${m.artist || ""}` : "";
  if (key !== lastMusic) {
    lastMusic = key;
    clearTimeout(musicTimer);
    if (key) {
      text(el.npText, m.artist ? `${m.title} – ${m.artist}` : m.title);
      vis(el.np, true);
      musicTimer = setTimeout(() => vis(el.np, false), 6000);
    } else vis(el.np, false);
  }
}

function refreshLock() {
  if (!root) return;
  vis(el.lock, visible && !dimmed && !lockedNow && showMode !== "off");
}

export const hud = {
  init({ prefs: p } = {}) {
    if (!root) {
      build();
      on("notify", onNotify);
      on("pointerlock", (v) => { lockedNow = !!v; refreshLock(); });
    }
    lockedNow = !!document.pointerLockElement;
    root.hidden = !visible;
    if (p) hud.applyPrefs(p);
    refreshLock();
    return hud;
  },
  applyPrefs(p) {
    prefs = p || prefs;
    if (!root || !prefs) return;
    const h = prefs.hud || {}, a = prefs.a11y || {};
    root.style.setProperty("--hud-scale", String(Math.max(0.75, Math.min(1.5, h.scale ?? 1))));
    root.style.setProperty("--hud-opacity", String(Math.max(0.3, Math.min(1, h.opacity ?? 1))));
    showMode = h.show === "minimal" || h.show === "off" ? h.show : "full";
    critOnly = h.critical !== false;
    root.classList.toggle("show-minimal", showMode === "minimal");
    root.classList.toggle("show-off", showMode === "off");
    root.classList.toggle("keep-crit", critOnly);
    root.classList.toggle("no-help", h.help === false);
    root.classList.toggle("hc", !!a.highContrast);
    document.documentElement.classList.toggle("lh-reduce-motion", !!a.reduceMotion);
    sig.warns = "\0";                                   // re-filter warnings on the next update
    if (showMode === "off") for (const n of [...notes.active]) if (!(critOnly && n.level === "crit")) noteDrop(n, true);
    refreshLock();
  },
  setVisible(v) { visible = !!v; if (root) { root.hidden = !visible; refreshLock(); } },
  dim(v) { dimmed = !!v; if (root) { root.classList.toggle("dim", dimmed); refreshLock(); } },
  // Called every frame with the state object of ARCHITECTURE §10.
  update(s) {
    if (!root || !s) return;
    const mode = s.mode === "drive" ? "drive" : "foot";
    attr(root, "data-mode", mode);
    updStatus(s);
    updNeeds(s.needs);
    updWarns(s);
    if (mode === "drive") updDrive(s); else updFoot(s);
    updShared(s);
  },
  // hurt / tired 0..1 – red-brown and dark edge vignettes
  setVignette({ hurt = 0, tired = 0 } = {}) {
    if (!vig) return;
    css(vig, "--hurt", String(q2(hurt)));
    css(vig, "--tired", String(q2(tired)));
  },
  // Full-screen fade (sleeping, blackouts). opacity 0..1, optional centred text.
  fade(opacity, txt) {
    if (!fadeEl) return;
    const o = q2(opacity);
    vis(fadeEl, o > 0);
    css(fadeEl, "--o", String(o));
    text(fadeEl.firstChild, txt || "");
  },
  // Alternative to state.music: push the current track ({title, artist} | null); a toast shows when it changes.
  setNowPlaying(t) { pushedMusic = t && t.title ? t : null; },
  // Direct access for main.js / tests (bus "notify" is the normal route).
  notify: onNotify,
  get root() { return root; },
};
export default hud;
