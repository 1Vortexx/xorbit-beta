// Long Haul – front end: gate, loading, main menu, new journey, settings, controls, credits, pause and the in-game
// overlay screens (inventory, shop, dialogue, game over, sleep). Presentation only: receives data, calls handlers.
import { sfx } from "../core/bus.js";
import { BINDINGS, bindingLabel, bindingLabels } from "../input.js";
import { CHANGELOG } from "../changelog.js";
import { icon, critIcon, esc, fmtDist, hasIcon } from "./icons.js";

const DEFAULT_DIFFS = [
  { id: "easy", label: "Easygoing", desc: "Needs drain slowly and parts wear gently. Room to explore and make mistakes." },
  { id: "survival", label: "Survival", desc: "The intended balance. Supplies and fluids matter; plan your stops." },
  { id: "hardcore", label: "Hardcore", desc: "Needs drain fast, parts wear hard and money is tight. Little margin for error." },
];
// Fallback names for the fixed item ids of ARCHITECTURE §4 (used when a stock entry carries no name).
const ITEM_NAMES = {
  water: "Water bottle (0.5 L)", waterjug: "Water jug (4 L)", beans: "Canned beans", jerky: "Jerky", chips: "Chips", soda: "Soda",
  coffee: "Coffee", medkit: "Medkit", bandage: "Bandage", fuelcan: "Fuel can (10 L)", jerrycan: "Jerrycan (20 L)",
  oil: "Engine oil (1 L)", oiljug: "Engine oil jug (4 L)", coolant: "Coolant (4 L)", wrench: "Wrench", jack: "Jack and lug wrench",
  repairkit: "Repair kit", flashlight: "Flashlight", engine_i6: "Inline-six engine", engine_v8: "V8 engine", engine_i4: "Four-cylinder engine",
  battery: "Battery", radiator: "Radiator", wheel_16: "16″ wheel (pickup)", wheel_14: "14″ wheel (sedan)",
};
const STAT_LABELS = {
  distance: "Distance travelled", driven: "Distance driven", walked: "Distance walked", days: "Days survived", day: "Day",
  fuelUsed: "Fuel burned", money: "Money", earned: "Money earned", spent: "Money spent", repairs: "Repairs made",
  itemsUsed: "Items used", sites: "Places discovered", discovered: "Places discovered", playtime: "Time played", topSpeed: "Top speed",
};

const logoUrl = new URL("../../assets/branding/long-haul-logo.png", import.meta.url).href;
const LOGO = `<img class="lh-logo" src="${logoUrl}" alt="Long Haul" width="2172" height="724">`;
const brand = (sub) => `<div class="lh-brand"><div class="lh-kicker">Desert road-trip survival</div>${LOGO}${sub ? `<p class="lh-tag">${esc(sub)}</p>` : ""}</div>`;

let root = null, prefs = null, handlers = {};
let rootName = null, data = {}, stack = [];
let nowPlaying = null, message = "", gestureDone = false;
let dlgPicked = false, dlgReadyAt = 0;   // a dialogue answers once; a short guard after (re)opening absorbs double clicks
const ui = { tabs: { settings: "graphics", inventory: "pockets", controls: "driving", career: "stats", board: "trip" }, nj: { difficulty: null, seed: "", hostile: true, confirm: false }, code: "", login: { id: "", pass: "" } };

const call = (name, ...args) => { const f = handlers[name]; if (typeof f === "function") return f(...args); };
const screen = () => (stack.length ? stack[stack.length - 1] : rootName);
const units = () => (prefs && prefs.units === "mi" ? "mi" : "km");
const getPref = (path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), prefs);
function setPref(path, v) {
  const keys = path.split(".");
  let o = prefs;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] || (o[keys[i]] = {});
  o[keys[keys.length - 1]] = v;
  applyOwnPrefs();
  call("onPrefs", prefs);
}
function applyOwnPrefs() {
  document.documentElement.classList.toggle("lh-reduce-motion", !!(prefs.a11y && prefs.a11y.reduceMotion));
}
let initDiffs = null;
const diffs = () => (Array.isArray(data.difficulties) && data.difficulties.length ? data.difficulties : initDiffs || DEFAULT_DIFFS);
const SAVE_ERRORS = {
  corrupt: "Your previous journey could not be read. Nothing was deleted: it has been kept as a backup, and you can start a new journey.",
  newer: "Your journey was saved by a newer version of Long Haul and cannot be opened here. It has not been changed.",
  unavailable: "This window cannot store data, so progress will not be kept after you close it. You can still play.",
};
function diffLabel(id) {
  if (id == null) return "";
  const d = [...diffs(), ...DEFAULT_DIFFS].find((x) => x.id === id || x.label === id);
  return d ? d.label : String(id);
}
// "Day 4 · 37.2 km · Survival · Pickup" from a save preview / summary object (field names read defensively).
function summaryParts(p) {
  if (!p || typeof p !== "object") return [];
  const dist = p.distance ?? p.dist ?? p.trip;
  const veh = p.vehicle ?? p.vehicleName;
  return [p.day != null ? `Day ${p.day}` : "", dist != null ? fmtDist(dist, units()) : "", diffLabel(p.difficulty ?? p.diff), veh ? String(veh) : ""].filter(Boolean);
}
function fmtStat(k, v) {
  if (typeof v !== "number") return String(v);
  if (/^(distance|driven|walked)$/.test(k)) return fmtDist(v, units());
  if (/^(money|earned|spent)$/.test(k)) return `$${Math.round(v)}`;
  if (k === "fuelUsed") return `${v.toFixed(1)} L`;
  if (k === "topSpeed") return units() === "mi" ? `${Math.round(v * 2.23694)} mph` : `${Math.round(v * 3.6)} km/h`;
  if (k === "playtime") { const m = Math.round(v / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; }
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
function achSummary() {
  const c = data.career;
  return c ? `${c.list.filter((x) => c.ach[x.id]).length} of ${c.list.length} achievements` : "";
}
function statRows(stats) {
  if (!stats) return [];
  if (Array.isArray(stats)) return stats.map((s) => (Array.isArray(s) ? [String(s[0]), String(s[1])] : [String(s.label), String(s.value)]));
  return Object.entries(stats).filter(([, v]) => v != null && typeof v !== "object")
    .map(([k, v]) => [STAT_LABELS[k] || k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), fmtStat(k, v)]);
}
const kv = (rows) => `<dl class="lh-kv">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
const keys = (labels) => labels.map((l) => `<kbd>${esc(l)}</kbd>`).join("");
const k = (action) => `<kbd>${esc(bindingLabel(action))}</kbd>`;
const item = (act, label, opts = {}) =>
  `<button type="button" class="lh-item${opts.cls ? " " + opts.cls : ""}" data-act="${act}"${opts.arg != null ? ` data-arg="${esc(opts.arg)}"` : ""}${opts.focus ? " data-autofocus" : ""}><span>${esc(label)}</span>${opts.sub ? `<small>${esc(opts.sub)}</small>` : ""}</button>`;
function npContents() {
  if (!nowPlaying) return "";
  const { cover, title, artist } = nowPlaying;
  return `${cover ? `<img class="lh-cover" src="${esc(cover)}" alt="">` : icon("note")}
    <div class="lh-np-copy"><strong class="lh-track-title">${esc(title)}</strong>
      ${artist ? `<span>${esc(artist)}</span>` : ""}</div>`;
}
const npLine = (inline = false) => `<div class="lh-np${inline ? " lh-np-inline" : ""}"${nowPlaying ? "" : " hidden"}>${npContents()}</div>`;
const navHint = (back) => `<div class="lh-keys" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> Select</span><span><kbd>Enter</kbd> Confirm</span>${back ? `<span><kbd>Esc</kbd> ${back}</span>` : ""}</div>`;
const panel = (title, body, opts = {}) => `
  <section class="lh-panel${opts.cls ? " " + opts.cls : ""}" role="dialog" aria-label="${esc(title)}">
    <header class="lh-head"><button type="button" class="lh-back" data-act="back">${icon("back")}<span>${esc(opts.backLabel || "Back")}</span></button><h2>${esc(title)}</h2>${opts.headExtra || ""}</header>
    ${opts.tabs || ""}
    <div class="lh-scroll">${body}</div>
    ${opts.foot || ""}
  </section>`;
const tabsBar = (id, list) => `<div class="lh-tabs" role="tablist">${list.map(([tid, label]) =>
  `<button type="button" role="tab" class="lh-tab" aria-selected="${ui.tabs[id] === tid}" data-act="tab" data-arg="${id}:${tid}">${esc(label)}</button>`).join("")}</div>`;

// ── settings controls ─────────────────────────────────────────────────────
const pct = (v) => `${Math.round(v * 100)}%`;
const FMT = { pct, deg: (v) => `${Math.round(v)}°`, x: (v) => `${Number(v).toFixed(2)}×` };
function rowWrap(label, help, control, value, id) {
  return `<div class="lh-row"><div class="lh-rl"><label${id ? ` for="${id}"` : ""}>${esc(label)}</label>${help ? `<small>${help}</small>` : ""}</div><div class="lh-rc">${control}</div><output class="lh-rv" data-out="${id || ""}">${esc(value ?? "")}</output></div>`;
}
function slider(path, label, min, max, step, fmt, help) {
  const v = Number(getPref(path) ?? min), id = `lh-p-${path.replace(/\./g, "-")}`;
  return rowWrap(label, help, `<input type="range" id="${id}" data-pref="${path}" data-fmt="${fmt}" min="${min}" max="${max}" step="${step}" value="${v}" aria-valuetext="${FMT[fmt](v)}">`, FMT[fmt](v), id);
}
function seg(path, label, options, help) {
  const cur = getPref(path);
  const b = options.map(([val, text]) => `<button type="button" class="lh-segb" data-act="seg" data-pref="${path}" data-val="${val}" aria-pressed="${cur === val}">${esc(text)}</button>`).join("");
  return rowWrap(label, help, `<div class="lh-seg" role="group" aria-label="${esc(label)}">${b}</div>`, "", `seg-${path}`);
}
function toggle(path, label, help) {
  const onv = !!getPref(path);
  return rowWrap(label, help, `<button type="button" class="lh-switch" role="switch" aria-checked="${onv}" aria-label="${esc(label)}" data-act="toggle" data-pref="${path}"><i></i></button>`, onv ? "On" : "Off", `tg-${path}`);
}

function bindingTable(groups) {
  const names = { always: "Always", drive: "Driving", foot: "On foot", photo: "Photo mode" };
  return groups.map((g) => {
    const rows = BINDINGS.filter((b) => b.group === g && !/^slot[2-6]$/.test(b.action)).map((b) =>
      b.action === "slot1" ? `<div><span>Pocket 1–6 to hands</span><span class="lh-kc"><kbd>1</kbd>–<kbd>6</kbd></span></div>`
        : `<div><span>${esc(b.desc)}</span><span class="lh-kc">${keys(bindingLabels(b))}</span></div>`).join("");
    return `<h3>${names[g]}</h3><div class="lh-binds">${rows}</div>`;
  }).join("");
}

// The two halves of the Leaderboard screen
function careerPane() {
    const c = data.career, t = ui.tabs.career;
    if (!c) return `<p class="lh-empty">No career yet.</p>`;
    let body;
    if (t === "stats") {
      const a = c.totals, cl = data.cloud;
      body = `<h3>On this browser</h3>${kv([
        ["Distance driven", fmtDist(a.distance, units())], ["Journeys", a.trips], ["Days on the road", a.days],
        ["Longest journey", fmtDist(c.best.km * 1000, units())], ["Most days in one journey", c.best.days],
        ["Places discovered", a.sites], ["Fuel bought", `${Math.round(a.litres)} L`], ["Pursuits escaped", a.escapes],
        ["Passengers delivered", a.rides], ["Time played", fmtStat("playtime", a.playTime)],
      ])}`;
      if (data.account) {
        body += `<h3>On your X-ORBIT account</h3>` + (cl ? kv([
          ["Distance driven", fmtDist(cl.total_m, units())], ["Journeys", cl.trips], ["Longest journey", fmtDist(cl.best_m, units())],
          ["Most days in one journey", cl.best_days], ["Achievements", cl.achievements],
        ]) : `<p class="lh-empty">${data.cloud === null ? "Nothing on your account yet, or X-ORBIT can't be reached right now." : "Loading…"}</p>`)
          + `<p class="lh-help">Your account adds up journeys from every device you play on. Journeys under 0.5 km don't count.</p>`;
      } else {
        body += `<p class="lh-help">${icon("person")} Sign in from Account on the main menu to keep your career on your X-ORBIT account and join the global leaderboard.</p>`;
      }
    } else {
      const got = c.list.filter((x) => c.ach[x.id]).length;
      body = `<p class="lh-lead">${got} of ${c.list.length} unlocked</p><ul class="lh-achs">${[...c.list].sort((x, y) => !!c.ach[y.id] - !!c.ach[x.id]).map((x) => {
        const on = !!c.ach[x.id];
        return `<li class="${on ? "lh-got" : ""}">${icon(on ? "good" : "box")}<div><b>${esc(x.name)}</b><span>${esc(x.desc)}</span></div>
          <em>${on ? esc(new Date(c.ach[x.id]).toLocaleDateString()) : "Locked"}</em></li>`;
      }).join("")}</ul>`;
    }
    return body;
}
function boardPane() {
    const kind = ui.tabs.board, b = data.board && data.board.kind === kind ? data.board : { loading: true };
    const col = { trip: "Longest journey", total: "Total distance", days: "Most days" }[kind];
    const val = (r) => (kind === "days" ? `${r.best_days} ${r.best_days === 1 ? "day" : "days"}` : fmtDist(kind === "total" ? r.total_m : r.best_m, units()));
    const row = (r, rank) => `<li class="${r.username === data.account ? "lh-me" : ""}"><b class="lh-rank${rank <= 3 ? " lh-top" : ""}">${rank}</b>
      <span>@${esc(r.username)}</span><strong>${esc(val(r))}</strong><em>${r.trips} ${r.trips === 1 ? "trip" : "trips"}</em></li>`;
    let body;
    if (b.loading) body = `<p class="lh-empty">Loading the leaderboard…</p>`;
    else if (b.error) body = `<p class="lh-empty">${icon("warn")} The leaderboard can't be reached right now. Try again later.</p>`;
    else if (!b.rows.length) body = `<p class="lh-empty">No journeys on the board yet. Sign in and drive to be the first.</p>`;
    else body = `<ol class="lh-board"><li class="lh-bhead"><b>#</b><span>Driver</span><strong>${esc(col)}</strong><em></em></li>
      ${b.rows.map((r, i) => row(r, i + 1)).join("")}${b.me ? `<li class="lh-gap" aria-hidden="true">…</li>${row(b.me, b.rank)}` : ""}</ol>`;
    body += data.account ? `<p class="lh-help">Signed in as @${esc(data.account)}. Your journeys are added as you drive.</p>`
      : `<p class="lh-help">${icon("person")} Sign in from Account on the main menu to put your journeys on the board.</p>`;
    return body;
}

// ── screens ───────────────────────────────────────────────────────────────
const SCREENS = {
  gate: () => `<div class="lh-col lh-gate lh-studio-splash">
    <img src="${new URL("../../download/xorbit-studios-logo.png", import.meta.url).href}" width="2172" height="724" alt="X-ORBIT Studios">
    <button type="button" class="lh-gatebtn" data-act="gate" data-autofocus><span>Click or press any key to start</span></button>
  </div>`,

  loading: () => `<div class="lh-col lh-loading">${brand()}
    <div class="lh-load" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Loading">
      <div class="lh-loadbar"><i></i></div>
      <div class="lh-loadrow"><span class="lh-loadlabel"></span><b class="lh-loadpct"></b></div>
      <p class="lh-help lh-loading-tip" role="status"></p>
    </div></div>`,

  // Four doors: Play (journeys, convoys, controls), Career (your career + the global leaderboard), Settings, What's New.
  // Account and Credits are small links underneath.
  main() {
    let h = `<div class="lh-col lh-main">${brand("One road. One truck. Keep it running.")}`;
    if (data.saveError) {
      h += `<div class="lh-alert" role="alert">${icon("warn")}<p>${esc(SAVE_ERRORS[data.saveError] || (typeof data.saveError === "string" ? data.saveError : SAVE_ERRORS.corrupt))}</p></div>`;
    }
    const s = data.save || data.cloudSave, parts = summaryParts(s);
    h += `<nav class="lh-nav" aria-label="Main menu">`
      + item("play", "Play", { focus: true, sub: s ? `Continue · ${parts.slice(0, 2).join(" · ")}` : "Singleplayer or convoy" })
      + item("leaderboard", "Career", { sub: data.career ? achSummary() : "" })
      + item("download", "Download", { sub: "Windows & Mac desktop app" })
      + item("settings", "Settings") + item("whatsnew", "What's New", { sub: "v" + CHANGELOG[0].version });
    if (data.hostAvailable) h += item("host", "Return to X-ORBIT", { cls: "lh-quiet" });
    h += `</nav><div class="lh-links">
      <button type="button" class="lh-link" data-act="account">${icon("person")}<span>${data.account ? `@${esc(data.account)}` : "Sign in"}</span></button>
      <button type="button" class="lh-link" data-act="credits"><span>Credits</span></button></div>`;
    return h + `</div>${navHint()}`;
  },

  play() {
    const s = data.save, parts = summaryParts(s);
    let h = `<div class="lh-col lh-main"><div class="lh-brand lh-brand-s"><div class="lh-kicker">Long Haul</div><h1 class="lh-h1">Play</h1><div class="lh-lines" aria-hidden="true"><i></i><i></i></div></div>`;
    h += `<nav class="lh-nav" aria-label="Play">`;
    // cloudSave: the journey kept on the X-ORBIT account, when it is newer or different from this device's
    const cs = data.cloudSave, cparts = cs ? summaryParts(cs) : [];
    const cont = (act, label, p, note, focus) => `<button type="button" class="lh-item lh-continue" data-act="${act}"${focus ? " data-autofocus" : ""}><span>${esc(label)}</span>
        <small>${p.length ? p.map(esc).join(" <i>·</i> ") : "Saved journey"}${note ? ` <i>·</i> ${esc(note)}` : ""}</small></button>`;
    if (s && cs && cs.same) h += cont("continue", "Continue", cparts, "synced from your X-ORBIT account", true);
    else if (s) h += cont("continue", "Continue", parts, "", true);
    if (cs && !cs.same) h += cont("continuecloud", s ? "Continue from X-ORBIT" : "Continue", cparts, s ? "replaces the journey on this device" : "from your X-ORBIT account", !s);
    h += item("newjourney", "Singleplayer", { focus: !s && !cs, sub: "a new journey on your own" })
      + item("convoy", "Convoy", { sub: "drive the same road with friends" })
      + item("controls", "Controls / How to Play");
    if (data.dev) h += item("devmap", "Dev Map", { sub: "test range · not saved", cls: "lh-quiet" });
    h += item("back", "Back", { cls: "lh-quiet" });
    return h + `</nav></div>${navHint("Back")}`;
  },

  pause() {
    const sm = data.summary, parts = typeof sm === "string" ? [sm] : summaryParts(sm);
    return `<div class="lh-col lh-pause"><div class="lh-brand lh-brand-s"><div class="lh-kicker">Long Haul</div><h1 class="lh-h1">Paused</h1><div class="lh-lines" aria-hidden="true"><i></i><i></i></div>
      ${parts.length ? `<p class="lh-tag">${parts.map(esc).join(" · ")}</p>` : ""}</div>
      <nav class="lh-nav" aria-label="Pause menu">
        ${item("resume", "Resume", { focus: true })}${item("convoy", "Convoy", { sub: data.convoy && data.convoy.code ? `code ${data.convoy.code}` : "drive with friends" })}${item("settings", "Settings")}${item("controls", "Controls / How to Play")}
        ${item("savemenu", "Save & Return to Menu")}
      </nav>
      <p class="lh-note">${data.saved === false ? `${icon("warn")} Your journey could not be saved: this window cannot store data. Leaving now loses your progress.`
    : "Your journey is saved automatically. You can continue from the main menu."}</p></div>${navHint("Resume")}`;
  },

  newjourney() {
    const nj = ui.nj, list = diffs();
    if (!list.some((d) => d.id === nj.difficulty)) nj.difficulty = (list.find((d) => d.id === (data.difficulty || "survival")) || list[Math.min(1, list.length - 1)]).id;
    const saved = data.save || data.cloudSave, parts = summaryParts(saved);
    if (nj.confirm) {
      return panel("Replace your journey?", `
        <div class="lh-confirm">${icon("warn")}<div><p class="lh-lead">This replaces your current journey${parts.length ? `: <b>${parts.slice(0, 2).map(esc).join(" · ")}</b>` : ""}.</p>
        <p>The saved journey is overwritten as soon as the new one starts. This cannot be undone.</p></div></div>
        <div class="lh-btns"><button type="button" class="lh-btn" data-act="cancelconfirm" data-autofocus>Keep my journey</button>
        <button type="button" class="lh-btn lh-danger" data-act="confirmstart">Replace and start</button></div>`, { cls: "lh-narrow" });
    }
    const cards = list.map((d) => `<button type="button" class="lh-card" data-act="diff" data-arg="${esc(d.id)}" aria-pressed="${d.id === nj.difficulty}">
      <b>${esc(d.label)}</b><span>${esc(d.desc || "")}</span><em>${d.id === nj.difficulty ? "Selected" : "Select"}</em></button>`).join("");
    return panel("New Journey", `
      <h3>Difficulty</h3><div class="lh-cards" role="group" aria-label="Difficulty">${cards}</div>
      <h3>Strangers</h3>
      ${rowWrap("Hostile encounters", "Off: strangers are peaceful – no robberies, pursuits or capture.",
        `<button type="button" class="lh-switch" role="switch" aria-checked="${nj.hostile}" aria-label="Hostile encounters" data-act="hostile"><i></i></button>`, nj.hostile ? "On" : "Off", "nj-hostile")}
      <h3><label for="lh-seed">World seed</label></h3>
      <div class="lh-seedrow"><input type="text" id="lh-seed" class="lh-input" maxlength="32" autocomplete="off" spellcheck="false" placeholder="Leave blank for a random world" value="${esc(nj.seed)}">
        <button type="button" class="lh-btn lh-btn-s" data-act="randseed">${icon("dice")}<span>Randomise</span></button></div>
      <p class="lh-help">Words or numbers. The same seed always builds the same road, places and loot.</p>
      ${saved ? `<p class="lh-help lh-warnline">${icon("warn")}<span>You already have a journey${parts.length ? ` (${parts.slice(0, 2).map(esc).join(" · ")})` : ""}. Starting a new one replaces it – you will be asked to confirm.</span></p>` : ""}
      <div class="lh-btns"><button type="button" class="lh-btn lh-primary" data-act="start" data-autofocus>Start journey</button></div>`,
    { foot: navHint("Back") });
  },

  // A roadside conversation: who speaks, what they say, and the replies as a list. Never dismissable without a reply.
  dialogue() {
    const choices = dlgChoices(), hasBack = choices.some((c) => c.id === "back" && !c.disabled);
    const speaker = data.speaker || "Stranger", lines = Array.isArray(data.lines) ? data.lines : data.lines ? [data.lines] : [];
    const first = choices.findIndex((c) => !c.disabled && !c.danger && c.id !== "back"), auto = first >= 0 ? first : choices.findIndex((c) => !c.disabled);
    const rows = choices.map((c, i) => `<button type="button" class="lh-choice${c.danger ? " lh-risk" : ""}" data-act="choice" data-arg="${esc(c.id)}"${c.disabled ? ` aria-disabled="true"` : ""}${i === auto ? " data-autofocus" : ""}>
        ${i < 9 ? `<kbd aria-hidden="true">${i + 1}</kbd>` : `<kbd aria-hidden="true">·</kbd>`}
        <span class="lh-cl"><b>${esc(c.label)}</b>${c.danger ? `<em class="lh-tagrisk">${icon("warn")}Risky</em>` : ""}
          ${c.detail ? `<small>${esc(c.detail)}</small>` : ""}${c.disabled ? `<small class="lh-why">${icon("x")}<span>Not possible: ${esc(c.disabled === true ? "unavailable" : c.disabled)}</span></small>` : ""}</span>
        ${c.cost != null && c.cost !== "" ? `<span class="lh-cost"><i>Cost</i><b>${esc(c.cost)}</b></span>` : ""}</button>`).join("");
    return `<section class="lh-panel lh-over lh-narrow lh-dlg" role="dialog" aria-label="Conversation with ${esc(speaker)}">
      <header class="lh-dlghead"><span class="lh-face" aria-hidden="true">${icon("person")}</span>
        <div><div class="lh-kicker">${esc(data.role || "Stranger")}</div><h2>${esc(speaker)}</h2></div></header>
      <div class="lh-scroll">
        <div class="lh-said">${lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>
        ${data.note ? `<p class="lh-dlgnote" role="status">${icon("warn")}<span>${esc(data.note)}</span></p>` : ""}
        <h3 id="lh-dlg-q">Your answer</h3>
        <div class="lh-choices" role="group" aria-labelledby="lh-dlg-q">${rows}</div>
      </div>
      <div class="lh-keys" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> Select</span><span><kbd>Enter</kbd> Answer</span>${choices.length > 1 ? `<span><kbd>1</kbd>–<kbd>${Math.min(9, choices.length)}</kbd> Quick answer</span>` : ""}${hasBack ? `<span><kbd>Esc</kbd> ${esc(choices.find((c) => c.id === "back").label)}</span>` : ""}</div>
    </section>`;
  },

  settings() {
    const t = ui.tabs.settings;
    let body = "";
    if (t === "graphics") {
      const fsOk = !!document.fullscreenEnabled, fs = !!document.fullscreenElement;
      body = seg("quality", "Quality", [["auto", "Auto"], ["high", "High"], ["lite", "Lite"]],
        "Auto switches to Lite when the frame rate stays low. Quality only changes rendering cost (resolution, shadows, distant decoration). It never changes the world, loot or physics.")
        + rowWrap("Fullscreen", fsOk ? "" : "Not available in this window.",
          `<button type="button" class="lh-switch" role="switch" aria-checked="${fs}" aria-label="Fullscreen" data-act="fullscreen"${fsOk ? "" : " disabled"}><i></i></button>`, fs ? "On" : "Off", "fs");
    } else if (t === "camera") {
      body = slider("fov", "Field of view", 55, 100, 1, "deg")
        + slider("camMotion", "Camera motion", 0, 1.5, 0.05, "pct", "Head bob, suspension sway and engine vibration. 0% keeps the camera still.")
        + seg("camera", "Default driving camera", [["cab", "Cab"], ["chase", "Chase"]], `Switch any time while driving with ${k("camera")}.`)
        + slider("chaseZoom", "Chase camera distance", 0.5, 2.5, 0.05, "x", `Also the mouse wheel, or ${k("camZoomIn")} / ${k("camZoomOut")}, while driving in chase view.`);
    } else if (t === "controls") {
      body = slider("sens", "Mouse sensitivity", 0.3, 2.5, 0.05, "x")
        + toggle("invertY", "Invert mouse Y")
        + seg("gearbox", "Gearbox", [["auto", "Automatic"], ["manual", "Manual"]], `Manual: ${k("shiftUp")} shifts up, ${k("shiftDown")} shifts down. ${k("gearMode")} switches while driving.`)
        + seg("units", "Speed & distance", [["km", "KM/H"], ["mi", "MPH"]])
        + `<div class="lh-bindwrap"><p class="lh-help">Key bindings (fixed in this version)</p>${bindingTable(["always", "drive", "foot", "photo"])}</div>`;
    } else if (t === "hud") {
      body = slider("hud.scale", "HUD size", 0.75, 1.5, 0.05, "pct", "Small windows cap the size so panels never overlap.")
        + slider("hud.opacity", "HUD opacity", 0.3, 1, 0.05, "pct")
        + seg("hud.show", "HUD visibility", [["full", "Full"], ["minimal", "Minimal"], ["off", "Off"]], "Minimal keeps speed, fuel, needs, interaction prompts and critical warnings.")
        + toggle("hud.critical", "Always show critical warnings", "Shown even when the HUD is off.")
        + toggle("hud.help", "Show control hints");
    } else if (t === "audio") {
      const m = data.music;
      body = slider("vol.master", "Master volume", 0, 1, 0.05, "pct")
        + slider("vol.music", "Music", 0, 1, 0.05, "pct")
        + slider("vol.sfx", "Engine & effects", 0, 1, 0.05, "pct")
        + slider("vol.ambience", "Ambience", 0, 1, 0.05, "pct")
        + slider("vol.voice", "Convoy voice chat", 0, 1, 0.05, "pct")
        + seg("voiceMode", "Your microphone", [["open", "Open mic"], ["ptt", "Push to talk"]], `Push to talk: hold ${k("talk")} while you speak.`)
        + toggle("muted", "Mute all sound", "Silences music, engine, effects and ambience.")
        + toggle("radio", "Radio", "Plays the soundtrack while you travel.")
        + rowWrap("Soundtrack", "", m && m.tracks === 0
          ? `<span class="lh-empty">No soundtrack files installed</span>`
          : `<button type="button" class="lh-btn lh-btn-s" data-act="radionext">${icon("skip")}<span>Next track</span></button>`, "", "trk")
        + npLine(true);
    } else {
      body = toggle("a11y.reduceMotion", "Reduce motion", "Turns off menu and HUD animation and blinking. Your system setting is respected as well.")
        + toggle("a11y.highContrast", "High-contrast HUD", "Solid black plates, white text and stronger borders.");
    }
    return panel("Settings", body, {
      tabs: tabsBar("settings", [["graphics", "Graphics"], ["camera", "Camera"], ["controls", "Controls"], ["hud", "HUD"], ["audio", "Audio"], ["a11y", "Accessibility"]]),
      foot: `<div class="lh-keys" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> Select</span><span><kbd>←</kbd><kbd>→</kbd> Change</span><span><kbd>Esc</kbd> Back</span></div>`,
    });
  },

  controls() {
    const t = ui.tabs.controls;
    let body = "";
    if (t === "driving") {
      body = `<p class="lh-lead">Get in with ${k("alt")} at a door. Turn the key with ${k("ignition")}, then hold ${k("throttle")}. Release the parking brake (${k("parkingBrake")}) first.</p>
        <ul class="lh-list"><li>The engine needs fuel, a charged battery and an engine in the bay. Watch the warning lights in the bottom-right corner.</li>
        <li>${k("brake")} brakes, and reverses once you have stopped. ${k("handbrake")} locks the rear wheels.</li>
        <li>Automatic gearbox by default. ${k("gearMode")} switches to manual: ${k("shiftUp")} up, ${k("shiftDown")} down.</li>
        <li>Stuck or on your roof? ${k("recover")} puts the vehicle back on its wheels.</li></ul>${bindingTable(["drive"])}`;
    } else if (t === "foot") {
      body = `<p class="lh-lead">Look with the mouse. The crosshair opens into a ring when you can interact; the prompts beside it show exactly which key does what.</p>
        <ul class="lh-list"><li>${k("use")} is the main action, ${k("alt")} the second one. Some actions need the key held – a bar fills while you hold.</li>
        <li>A greyed prompt tells you what is missing, for example a tool.</li></ul>${bindingTable(["foot", "always"])}`;
    } else if (t === "cargo") {
      body = `<p class="lh-lead">Everything you find is a physical object. Small things go in your six pockets; bulky things are carried in your hands, one at a time.</p>
        <ul class="lh-list"><li>${k("grab")} picks up what you are looking at and puts it down again. ${k("throw")} throws it.</li>
        <li>Hold ${k("rotate")} and move the mouse to turn the item in your hands.</li>
        <li>${k("stow")} moves the held item into a pocket if it fits, or takes the selected pocket item into your hands.</li>
        <li>${k("slot1")}–${k("slot6")} take that pocket's item into your hands; press the same key again to put it away, or another to swap. The mouse wheel only selects a pocket. ${k("consume")} eats, drinks or uses the selected item.</li>
        <li><b>Securing cargo:</b> aim a held item at a truck bed or boot floor. An outline shows where it will sit; put it down to secure it. Secured cargo rides with the vehicle and does not fall out. Pick it up to free it.</li></ul>`;
    } else if (t === "maint") {
      body = `<p class="lh-lead">The truck is worn. Keep an eye on the gauges and carry spares.</p>
        <dl class="lh-dl">
        <div><dt>${icon("fuel")}Fuel</dt><dd>Hold a fuel can, aim at the filler cap and hold ${k("use")} to pour. At a station pump, hold ${k("use")} to fill the nearest parked vehicle or the can in your hands; it costs money.</dd></div>
        <div><dt>${icon("oil")}Oil</dt><dd>Open the hood, read the dipstick and pour oil into the filler. Running low on oil ruins the engine.</dd></div>
        <div><dt>${icon("coolant")}Coolant</dt><dd>Top up at the radiator cap with the hood open. If the temperature warning shows, stop and let the engine cool.</dd></div>
        <div><dt>${icon("tyre")}Tyres</dt><dd>A flat or missing wheel stops you. You need a jack to take a wheel off and fit another.</dd></div>
        <div><dt>${icon("battery")}Battery</dt><dd>A dead battery will not crank the engine. It charges while the engine runs. Swap it with a wrench, hood open.</dd></div>
        <div><dt>${icon("engine")}Engine & radiator</dt><dd>Removed and fitted with a wrench, hood open. Parts must fit the vehicle. A repair kit restores engine and body condition.</dd></div>
        </dl><p class="lh-help">Open the inventory (${k("inventory")}) and choose Vehicle to see the condition of every part.</p>`;
    } else if (t === "strangers") {
      body = `<p class="lh-lead">You are not alone out here. Most people on the road want a lift or a few dollars; some want everything you have.</p>
        <dl class="lh-dl">
        <div><dt>${icon("person")}Hitchhikers</dt><dd>Stop beside someone with a thumb out and press ${k("talk")} from the driver's seat, or walk up and press ${k("use")}. They tell you where they are going and what they offer. Take them or leave them – a passenger needs a free seat and gets out at the destination, or when you ask.</dd></div>
        <div><dt>${icon("warn")}Roadblocks</dt><dd>Warning signs come first. When the leader waves you down you can <b>pay</b> what is asked, <b>refuse</b>, <b>back away</b> the way you came, <b>ram</b> the barricade or <b>go around</b> through the desert. Every price is shown before you agree, and paying settles it for good.</dd></div>
        <div><dt>${icon("body")}Pursuit</dt><dd>Force your way past and they come after you in their cars. They give up only when they cannot drive on: out-drive them until they crash, roll, get stuck or break down. The plate at the top of the screen counts who is still chasing.</dd></div>
        <div><dt>${icon("heart")}Capture</dt><dd>Stopped or on foot with a pursuer beside you, you are caught. That can cost supplies, money, health – or the journey.</dd></div>
        </dl><p class="lh-help">Prefer a quiet road? Turn off “Hostile encounters” when you start a new journey: strangers stay peaceful.</p>`;
    } else {
      body = `<p class="lh-lead">Four needs sit in the top-right corner: health, food, water and energy. A “!” marks one that is running low.</p>
        <ul class="lh-list"><li>Eat and drink what you scavenge or buy. Select it in your pockets and press ${k("consume")}, or use it from the inventory.</li>
        <li>Sleep restores energy: use a bed, or ${k("sleep")} in the cab.</li>
        <li>Medkits and bandages restore health. Starving, dehydration and crashes take it away.</li>
        <li>Search houses, garages, wrecks and containers. Shop counters sell supplies, fluids and parts.</li>
        <li>Heat, dust and storms change how far you can see and how hard the engine works.</li>
        <li>The journey saves automatically.</li></ul>`;
    }
    return panel("Controls / How to Play", body, {
      tabs: tabsBar("controls", [["driving", "Driving"], ["foot", "On foot"], ["cargo", "Carrying & cargo"], ["maint", "Maintenance"], ["survival", "Survival"], ["strangers", "Strangers"]]),
      foot: `<div class="lh-keys" aria-hidden="true"><span><kbd>←</kbd><kbd>→</kbd> Section</span><span><kbd>Esc</kbd> Back</span></div>`,
    });
  },

  // Your career on the left, the global leaderboard on the right (stacked on narrow windows)
  leaderboard() {
    return panel("Career", `<div class="lh-split">
      <section class="lh-pane" aria-label="Your career"><h3>Your career</h3>${tabsBar("career", [["stats", "Stats"], ["achievements", "Achievements"]])}<div class="lh-panebody">${careerPane()}</div></section>
      <section class="lh-pane" aria-label="Global leaderboard"><h3>Global leaderboard</h3>${tabsBar("board", [["trip", "Longest journey"], ["total", "Total distance"], ["days", "Most days"]])}<div class="lh-panebody">${boardPane()}</div></section>
    </div>`, { cls: "lh-wide", foot: `<div class="lh-keys" aria-hidden="true"><span><kbd>←</kbd><kbd>→</kbd> Tab</span><span><kbd>Esc</kbd> Back</span></div>` });
  },

  // Multiplayer: start one (pause menu), join one by code, or see who is in yours
  convoy() {
    const c = data.convoy || {};
    let body;
    if (c.code) {
      const rows = (c.members || []).map((m) => `<li><b>@${esc(m.name)}${m.paused ? ` <i class="lh-paused" role="img" aria-label="paused"></i>` : ""}${m.voice ? ` <i class="lh-vc${m.speaking ? " lh-vc-talk" : ""}" role="img" aria-label="on voice"></i>` : ""}</b><span>${esc(m.where)}</span><em>${m.paused ? "paused" : m.voice ? (m.connected ? "on voice" : c.voice && c.voice.on ? "connecting voice…" : "on voice") : ""}</em></li>`).join("");
      body = `<p class="lh-lead">Your convoy code</p><div class="lh-code" tabindex="0" data-autofocus aria-label="Convoy code ${esc(c.code.split("").join(" "))}">${esc(c.code)}</div>
        <p class="lh-help">Friends join from the main menu → Join a Convoy, or from their pause menu if they're already on this road. Up to 6 drivers.</p>
        <h3>Drivers</h3><ul class="lh-tracks"><li><b>@${esc(c.me)}</b><span>you</span><em></em></li>${rows}</ul>
        ${c.status !== "joined" ? `<p class="lh-help">${icon("warn")} ${c.status === "reconnecting" ? "Connection lost. Reconnecting…" : "Connecting…"}</p>` : ""}
        <h3>Voice chat</h3>
        ${c.voice.on ? `<p class="lh-help">${c.voice.muted ? `${icon("warn")} Your microphone is muted.` : c.voice.mode === "ptt" ? `Push to talk: hold ${k("talk")} while you speak.` : "Open mic: everyone with voice on hears you."}</p>
          <div class="lh-btns"><button type="button" class="lh-btn" data-act="voicemute">${c.voice.muted ? "Unmute mic" : "Mute mic"}</button>
          <button type="button" class="lh-btn" data-act="voicemode">${c.voice.mode === "ptt" ? "Use open mic" : "Use push to talk"}</button>
          <button type="button" class="lh-btn" data-act="voiceoff">Turn voice off</button></div>`
        : `<p class="lh-help">Talk to the rest of the convoy. Your browser will ask to use the microphone.</p>
          ${c.voice.error ? `<p class="lh-help lh-warnline">${icon("warn")}<span>${c.voice.error === "denied" ? "The microphone was blocked. Allow it for this site in your browser and try again." : "Voice chat doesn't work in this browser."}</span></p>` : ""}
          <div class="lh-btns"><button type="button" class="lh-btn lh-primary" data-act="voiceon">Turn voice on</button></div>`}
        ${c.msg ? `<p class="lh-msg">${esc(c.msg)}</p>` : ""}
        <div class="lh-btns"><button type="button" class="lh-btn lh-danger" data-act="convoyleave">Leave convoy</button></div>`;
    } else {
      body = `<p class="lh-lead">Drive the same road with friends. You see each other's vehicles and where everyone is.</p>
        <ul class="lh-list"><li>Everyone keeps their own supplies, loot, strangers and damage. Only where you are is shared.</li>
        <li>Other drivers are see-through to collisions: you can't crash into each other.</li></ul>`;
      if (c.inJourney && !c.dev) {
        body += `<h3>Start a convoy</h3><p class="lh-help">Get a code to share. Friends who join appear right behind you on this road.</p>
          <div class="lh-btns"><button type="button" class="lh-btn lh-primary" data-act="convoyhost" data-autofocus>Start a convoy</button></div>`;
      } else if (c.dev) {
        body += `<p class="lh-help">${icon("info")} Convoys aren't available on the Dev Map.</p>`;
      }
      if (!c.dev) {
        body += `<h3><label for="lh-code">Join with a code</label></h3>
          <div class="lh-seedrow"><input type="text" id="lh-code" class="lh-input" maxlength="5" autocomplete="off" spellcheck="false" placeholder="ABCDE" value="${esc(ui.code)}"${c.inJourney ? "" : " data-autofocus"}>
          <button type="button" class="lh-btn lh-btn-s" data-act="convoyjoin"${c.busy ? " disabled" : ""}><span>${c.busy ? "Joining…" : "Join"}</span></button></div>
          <p class="lh-help">${c.inJourney ? "You must be on the same road (world seed) as the convoy. You'll be moved right behind one of them."
            : "Starts a new journey on the convoy's road, right behind one of its drivers."}</p>`;
        if (!c.inJourney && (data.save || data.cloudSave)) body += `<p class="lh-help lh-warnline">${icon("warn")}<span>Joining replaces your current journey.</span></p>`;
        if (!c.account) body += `<p class="lh-help">${icon("person")} You're not signed in (Account on the main menu), so you'll show up as a guest.</p>`;
      }
      if (c.msg) body += `<p class="lh-msg" role="status">${esc(c.msg)}</p>`;
    }
    return panel("Convoy", body, { cls: "lh-narrow", foot: `<div class="lh-keys" aria-hidden="true"><span><kbd>Enter</kbd> Confirm</span><span><kbd>Esc</kbd> Back</span></div>` });
  },

  // Which X-ORBIT account Long Haul plays as: only one signed in here. X-ORBIT's own sign-in is never used or changed.
  account() {
    const a = data.acct || {}, L = ui.login;
    let body = a.user
      ? `<p class="lh-lead">Signed in as <b>@${esc(a.user)}</b></p><p class="lh-help">Signed in to Long Haul only. Your X-ORBIT sign-in isn't used or changed.</p>`
      : `<p class="lh-lead">Not signed in</p><p class="lh-help">Your career stays on this browser, you're not on the leaderboard, there are no cloud saves, and convoys show you as a guest.</p>`;
    body += `<h3>${a.user ? "Use a different account" : "Sign in to X-ORBIT"}</h3>
      <div class="lh-login">
        <label for="lh-user">Username or email</label><input type="text" id="lh-user" class="lh-input" autocomplete="username" spellcheck="false" maxlength="120" value="${esc(L.id)}"${a.user ? "" : " data-autofocus"}>
        <label for="lh-pass">Password</label><input type="password" id="lh-pass" class="lh-input" autocomplete="current-password" maxlength="200" value="${esc(L.pass)}">
      </div>
      <div class="lh-btns"><button type="button" class="lh-btn lh-primary" data-act="signin"${a.busy ? " disabled" : ""}><span>${a.busy ? "Signing in…" : "Sign in"}</span></button></div>
      ${a.msg ? `<p class="lh-msg" role="status">${esc(a.msg)}</p>` : ""}`;
    if (a.user) body += `<h3>Sign out</h3><div class="lh-btns"><button type="button" class="lh-btn" data-act="signout" data-autofocus><span>Sign out of @${esc(a.user)}</span></button></div>`;
    body += `<p class="lh-help">Each account keeps its own career and achievements. Your journey on this device carries on with whichever account is signed in.</p>`;
    return panel("Account", body, { cls: "lh-narrow", foot: `<div class="lh-keys" aria-hidden="true"><span><kbd>Enter</kbd> Confirm</span><span><kbd>Esc</kbd> Back</span></div>` });
  },

  // The full map (M). The canvas is drawn by js/map.js through handlers.onMapCanvas.
  map() {
    const legend = (data.legend || []).filter((l) => l.kind !== "wreck").map((l) =>
      `<li><i class="lh-mapdot" style="background:${esc(l.color)}">${esc(l.letter)}</i>${esc(l.label)}</li>`).join("");
    let side = `<h3>Key</h3><ul class="lh-mapkey"><li><i class="lh-mapme"></i>You</li>${data.convoy ? `<li><i class="lh-mapdot lh-mapmember"></i>Convoy driver</li>` : ""}${legend}
      <li><i class="lh-mapdot lh-mapruin">F</i>Closed down</li></ul>`;
    if (data.digimap) {
      side += `<h3>Digimap: next ahead</h3><ul class="lh-mapkey">${data.next.map((n) =>
        `<li><i class="lh-mapdot lh-mapintel" style="color:${esc(n.color)}">${esc(n.letter)}</i><span>${esc(n.label)}<small>${n.name ? `${esc(n.name)} · ${esc(n.dist)}` : "none open in range"}</small></span></li>`).join("")}</ul>
        <p class="lh-help">${icon("warn")} While you carry the Digimap, far fewer places ahead are still open.</p>`;
    } else {
      side += `<p class="lh-help">Only the road you've driven and places you've found are on the map. A Digimap shows what's ahead.</p>`;
    }
    return panel("Map", `<div class="lh-mapwrap"><canvas class="lh-mapcv" aria-label="Map of the road you've travelled"></canvas><aside class="lh-mapside">${side}</aside></div>`, {
      cls: "lh-over lh-mapscreen", backLabel: "Close",
      foot: `<div class="lh-keys" aria-hidden="true"><span>Drag Move</span><span>Wheel <kbd>+</kbd><kbd>−</kbd> Zoom</span><span><kbd>C</kbd> Centre</span><span><kbd>M</kbd> Close</span></div>`,
    });
  },

  whatsnew() {
    const body = CHANGELOG.map((r) => `
      <h3>v${esc(r.version)}${r.name ? ` · ${esc(r.name)}` : ""} <small>${esc(r.date)}</small></h3>
      ${r.sections.map(([head, lines]) => `<h4>${esc(head)}</h4><ul class="lh-list">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`).join("")}`).join("");
    return panel("What's New", `<div class="lh-changelog">${body}</div>`, { cls: "lh-narrow", foot: `<div class="lh-keys" aria-hidden="true"><span><kbd>Esc</kbd> Back</span></div>` });
  },

  credits() {
    const m = data.music, list = m && Array.isArray(m.credits) ? m.credits : [];
    const music = list.length
      ? `<ul class="lh-tracks">${list.map((c) => `<li><b>${esc(c.title)}</b><span>${esc(c.artist || "Unknown artist")}</span><em>${esc(c.license || "")}</em></li>`).join("")}</ul>`
      : `<p class="lh-empty">No music is installed in this build, so there is nothing to credit here.</p>`;
    return panel("Credits", `
      <div class="lh-credits">
        <h3>Long Haul</h3>
        <p>A desert road-trip survival sandbox, made for X-ORBIT.</p>
        <p>All models, textures and sound effects are generated procedurally by the game.</p>
        <h3>People</h3>
        <ul class="lh-tracks">
          <li><b>1Vortexx</b><span>Creator and developer</span><em></em></li>
          <li><b>Michael Lester</b><span>Contributor and Music Composer</span><em></em></li>
          ${["ZeeAnimate", "$GlitzerX$"].map((n) => `<li><b>${esc(n)}</b><span>Contributor</span><em></em></li>`).join("")}
        </ul>
        <h3>Technology</h3>
        <p><b>Three.js</b> r170 – 3D rendering library. MIT License, © 2010–2024 three.js authors.</p>
        <h3>Music</h3>${music}
      </div>`, { cls: "lh-narrow", foot: `<div class="lh-keys" aria-hidden="true"><span><kbd>Esc</kbd> Back</span></div>` });
  },

  inventory() {
    const t = ui.tabs.inventory;
    let body = "";
    if (t === "pockets") {
      const slots = Array.isArray(data.slots) ? data.slots : [];
      let rows = "";
      for (let i = 0; i < 6; i++) {
        const it = slots[i];
        rows += it
          ? `<div class="lh-slotrow"><kbd>${i + 1}</kbd><span class="lh-glyph">${glyph(it.icon)}</span><span class="lh-sn"><b>${esc(it.name)}</b>${meta(it)}</span>
             <button type="button" class="lh-btn lh-btn-s" data-act="use" data-arg="${i}">Use</button><button type="button" class="lh-btn lh-btn-s" data-act="drop" data-arg="${i}">Drop</button></div>`
          : `<div class="lh-slotrow lh-slotempty"><kbd>${i + 1}</kbd><span class="lh-glyph"></span><span class="lh-sn">Empty</span></div>`;
      }
      const h = data.held;
      body = `<div class="lh-two"><div><h3>Pockets</h3>${rows}</div><div>
        <h3>In hands</h3>${h ? `<div class="lh-slotrow"><span class="lh-glyph">${glyph(h.icon || "box")}</span><span class="lh-sn"><b>${esc(h.name)}</b>${meta(h)}</span></div>
          <p class="lh-help">${k("stow")} pockets it if it fits. ${k("grab")} puts it down.</p>` : `<p class="lh-empty">Nothing in your hands.</p>`}
        ${data.needs ? `<h3>Condition</h3>${needBars(data.needs)}` : ""}</div></div><p class="lh-msg" role="status" aria-live="polite">${esc(message)}</p>`;
    } else if (t === "vehicle") {
      const vo = data.vehicle, v = Array.isArray(vo) ? vo : vo && Array.isArray(vo.parts) ? vo.parts : null;
      if (!v) body = `<p class="lh-empty">No vehicle nearby. Stand next to a vehicle or sit in it to inspect its parts.</p>`;
      else {
        const f = data.fluids || (vo && vo.tel) || data.tel, vname = (vo && vo.name) || data.vehicleName || "Vehicle";
        const parts = v.map((p) => {
          const missing = !p.item && p.cond == null, c = missing ? 0 : Math.round(p.cond ?? 0);
          const bad = missing || c < 25 || /flat|missing|dead/i.test(p.note || "");
          return `<div class="lh-part${bad ? " bad" : ""}"><span class="lh-pn">${bad ? icon("warn") : ""}${esc(p.label || p.slot)}</span>
            <span class="lh-bar"><i style="--v:${c / 100}"></i></span><b>${missing ? "—" : c + "%"}</b><em>${esc(p.note || (missing ? "Missing" : ""))}</em></div>`;
        }).join("");
        const fl = f ? [["fuel", "Fuel", f.fuel, f.tank], ["oil", "Oil", f.oil, f.oilCap], ["coolant", "Coolant", f.coolant, f.coolantCap]]
          .filter((x) => x[2] != null).map(([ic, label, val, capv]) => {
            const fr = capv ? Math.max(0, Math.min(1, val / capv)) : 0;
            return `<div class="lh-part${fr < 0.15 ? " bad" : ""}"><span class="lh-pn">${icon(ic)}${label}</span><span class="lh-bar"><i style="--v:${fr}"></i></span><b>${val.toFixed(1)} L</b><em>${capv ? `of ${Math.round(capv)} L` : ""}</em></div>`;
          }).join("") : "";
        body = `<h3>${esc(vname)} – parts</h3>${parts}${fl ? `<h3>Fluids</h3>${fl}` : ""}`;
      }
    } else {
      const j = data.journey || data, st = data.stats || {};
      if (Array.isArray(st)) return panel("Inventory", st.length ? kv(statRows(st)) : `<p class="lh-empty">No journey statistics yet.</p>`, invOpts());
      const rows = [];
      if (j.day != null) rows.push(["Day", String(j.day)]);
      const dist = j.distance ?? j.trip ?? st.distance;
      if (dist != null) rows.push(["Distance travelled", fmtDist(dist, units())]);
      if (j.difficulty ?? j.diff) rows.push(["Difficulty", diffLabel(j.difficulty ?? j.diff)]);
      if (j.weather) rows.push(["Weather", `${j.weather}${j.tempC != null ? `, ${Math.round(j.tempC)}°C` : ""}`]);
      if (j.money != null) rows.push(["Money", `$${Math.floor(j.money)}`]);
      if (j.seed != null) rows.push(["World seed", String(j.seed)]);
      const extra = statRows(st).filter(([l]) => !rows.some(([r]) => r === l));
      body = rows.length + extra.length ? kv([...rows, ...extra]) : `<p class="lh-empty">No journey statistics yet.</p>`;
    }
    return panel("Inventory", body, invOpts());
  },

  shop() {
    const stock = Array.isArray(data.stock) ? data.stock : [], money = Math.floor(data.money ?? 0);
    const rows = stock.map((s) => {
      const name = s.name || ITEM_NAMES[s.type] || String(s.type), cant = s.price > money, out = s.left === 0 || s.soldOut;
      return `<div class="lh-shoprow"><span class="lh-glyph">${glyph(s.icon || "bag")}</span><span class="lh-sn"><b>${esc(name)}</b>${s.bulky ? `<small>Bulky – placed on the counter</small>` : s.desc ? `<small>${esc(s.desc)}</small>` : ""}</span>
        <b class="lh-price">$${Math.round(s.price)}</b>
        <button type="button" class="lh-btn lh-btn-s" data-act="buy" data-arg="${esc(s.type)}"${cant || out ? ` aria-disabled="true"` : ""}>${out ? "Sold out" : cant ? "Too dear" : "Buy"}</button></div>`;
    }).join("");
    return panel((data.site && data.site.name) || "Roadside shop", `
      ${rows || `<p class="lh-empty">Nothing for sale here.</p>`}
      <p class="lh-msg" role="status" aria-live="polite">${esc(message)}</p>
      <p class="lh-help">Small items go to your pockets. Bulky items are placed on the counter for you to carry out.</p>`, {
      cls: "lh-over lh-narrow", backLabel: "Leave",
      headExtra: `<span class="lh-money" aria-label="Your money">$${money}</span>`,
      foot: `<div class="lh-keys" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> Select</span><span><kbd>Enter</kbd> Buy</span><span><kbd>Esc</kbd> Leave</span></div>`,
    });
  },

  gameover() {
    const rows = statRows(data.stats);
    return `<section class="lh-panel lh-over lh-narrow lh-end" role="dialog" aria-label="Journey over">
      <header class="lh-endhead"><div class="lh-kicker">Journey over</div><h1 class="lh-h1">End of the road</h1><div class="lh-lines" aria-hidden="true"><i></i><i></i></div></header>
      <div class="lh-scroll"><p class="lh-lead">${esc(data.cause || "Your journey has ended.")}</p>${rows.length ? kv(rows) : ""}
      <div class="lh-btns"><button type="button" class="lh-btn lh-primary" data-act="newjourney" data-autofocus>New Journey</button>
      <button type="button" class="lh-btn" data-act="mainmenu">Main Menu</button></div></div></section>`;
  },

  sleep: () => `<div class="lh-sleep" role="status">${icon("moon")}<p>${esc(data.text || "Sleeping…")}</p></div>`,
};
const dlgChoices = () => (Array.isArray(data.choices) ? data.choices.filter((c) => c && c.id != null) : []);
// Answer the open dialogue. Fires onDialogueChoice at most once per show()/refresh(); disabled replies only explain why.
function choose(id) {
  if (rootName !== "dialogue" || stack.length) return;
  const c = dlgChoices().find((x) => String(x.id) === String(id));
  if (!c || dlgPicked || performance.now() < dlgReadyAt) return;
  if (c.disabled) { sfx("error"); return; }
  dlgPicked = true;
  sfx(c.id === "back" ? "ui_back" : "ui_click");
  call("onDialogueChoice", c.id);
}
const invOpts = () => ({
  cls: "lh-over", backLabel: "Close",
  tabs: tabsBar("inventory", [["pockets", "Pockets"], ["vehicle", "Vehicle"], ["journey", "Journey"]]),
  foot: `<div class="lh-keys" aria-hidden="true"><span><kbd>←</kbd><kbd>→</kbd> Tab</span><span>${k("inventory")} / <kbd>Esc</kbd> Close</span></div>`,
});
const glyph = (g) => (hasIcon(g) ? icon(g) : esc(g || "•"));
function meta(it) {
  const bits = [];
  if (it.count > 1) bits.push(`×${it.count}`);
  if (it.qty != null && it.qty !== "") bits.push(typeof it.qty === "number" ? (Number.isInteger(it.qty) ? String(it.qty) : it.qty.toFixed(1)) : String(it.qty));
  if (it.cond != null) bits.push(`${Math.round(it.cond)}%`);
  return bits.length ? `<small>${esc(bits.join(" · "))}</small>` : "";
}
function needBars(n) {
  return [["health", "heart", "Health"], ["hunger", "food", "Food"], ["thirst", "thirst", "Water"], ["energy", "energy", "Energy"]].map(([key, ic, label]) => {
    const v = Math.round(Math.max(0, Math.min(100, n[key] ?? 0)));
    return `<div class="lh-part${v < 28 ? " bad" : ""}"><span class="lh-pn">${icon(ic)}${label}</span><span class="lh-bar"><i style="--v:${v / 100}"></i></span><b>${v}%</b><em>${v < 12 ? "Critical" : v < 28 ? "Low" : ""}</em></div>`;
  }).join("");
}

// ── rendering, focus, navigation ──────────────────────────────────────────
const focusables = () => [...root.querySelectorAll("button:not([disabled]), input:not([disabled]), [tabindex='0']")].filter((e) => e.offsetParent !== null);
const fkey = (e) => `${e.dataset.act || e.id || e.tagName}:${e.dataset.arg || ""}:${e.dataset.pref || ""}:${e.dataset.val || ""}`;

function render(keep) {
  if (!root || !rootName) return;
  const name = screen();
  const prevKey = keep && root.contains(document.activeElement) ? fkey(document.activeElement) : null;
  const sc = keep ? root.querySelector(".lh-scroll") : null, top = sc ? sc.scrollTop : 0;
  root.hidden = false;
  root.dataset.screen = name;
  root.dataset.root = rootName;
  root.innerHTML = `<div class="lh-scrim"></div><div class="lh-stage">${SCREENS[name]()}</div>${name === "main" || name === "pause" ? npLine() : ""}`;
  if (name === "loading") updateLoading();
  if (name === "map") call("onMapCanvas", root.querySelector(".lh-mapcv"));
  const list = focusables();
  let target = prevKey ? list.find((e) => fkey(e) === prevKey) : null;
  if (!target) target = root.querySelector("[data-autofocus]") || list.find((e) => !e.classList.contains("lh-back") && e.getAttribute("role") !== "tab") || list[0];
  if (target) target.focus({ preventScroll: true });
  const sc2 = root.querySelector(".lh-scroll");
  if (sc2 && top) sc2.scrollTop = top;
}
function updateLoading() {
  const p = Math.max(0, Math.min(1, data.pct ?? 0)), bar = root.querySelector(".lh-loadbar i");
  if (!bar) return;
  bar.style.setProperty("--v", String(p));
  root.querySelector(".lh-load").setAttribute("aria-valuenow", String(Math.round(p * 100)));
  root.querySelector(".lh-loadlabel").textContent = data.label || "Loading";
  const tips = ["Keep fuel, oil and coolant topped up before a long drive.", "Stop beside a hitchhiker and press E to talk.", "A paid roadblock gives you safe passage.", "Bring food and water before leaving a station.", "A spare wheel and a wrench can save a long walk."];
  const tip = root.querySelector(".lh-loading-tip");
  if (tip) tip.textContent = data.error ? "" : "Tip · " + tips[Math.min(tips.length - 1, Math.floor((data.pct || 0) * tips.length))];

  root.querySelector(".lh-loadpct").textContent = data.error ? "" : `${Math.round(p * 100)}%`;
  root.querySelector(".lh-load").classList.toggle("lh-loaderr", !!data.error);
}
function push(name) { stack.push(name); if (name === "newjourney") ui.nj.confirm = false; sfx("ui_click"); render(); }
function back() {
  if (stack.length) {
    if (screen() === "gate") return;
    if (screen() === "newjourney" && ui.nj.confirm) ui.nj.confirm = false; else stack.pop();
    sfx("ui_back"); render();
    return;
  }
  if (rootName === "dialogue") { if (dlgChoices().some((c) => c.id === "back" && !c.disabled)) choose("back"); return; }
  if (rootName === "pause") { sfx("ui_back"); call("onResume"); }
  else if (rootName === "inventory" || rootName === "shop" || rootName === "map") { sfx("ui_back"); call("onCloseOverlay"); }
}
function move(dir) {
  const list = focusables();
  if (!list.length) return;
  const i = list.indexOf(document.activeElement);
  const n = list[(i < 0 ? (dir > 0 ? 0 : list.length - 1) : i + dir + list.length) % list.length];
  n.focus({ preventScroll: true });
  n.scrollIntoView({ block: "nearest" });
}
function seedFrom(textv) {
  const t = String(textv || "").trim();
  if (!t) return (Math.floor(Math.random() * 0xfffffffe) + 1) >>> 0;
  if (/^\d{1,15}$/.test(t)) return (Number(t) % 4294967296) >>> 0;
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.toLowerCase().charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function startJourney() {
  const nj = ui.nj;
  sfx("ui_click");
  call("onNewJourney", { difficulty: nj.difficulty, hostile: nj.hostile, seed: seedFrom(nj.seed), seedText: nj.seed.trim() });
}

function act(e, a) {
  const arg = e ? e.dataset.arg : undefined;
  switch (a) {
    case "gate": firstGesture(); break;
    case "continue": sfx("ui_click"); call("onContinue"); break;
    case "continuecloud": sfx("ui_click"); call("onContinueCloud"); break;
    case "newjourney": case "settings": case "controls": case "credits": case "whatsnew": push(a); break;
    case "play": push(a); break;
    case "career": case "leaderboard": data.cloud = undefined; push("leaderboard"); call("onOpenCareer"); call("onOpenBoard", ui.tabs.board); break;
    case "convoy": push(a); call("onOpenConvoy"); break;
    case "account": push(a); call("onOpenAccount"); break;
    case "signin": {
      sfx("ui_click");
      const L = ui.login, p = call("onSignIn", L.id, L.pass);
      L.pass = "";                     // never kept around after an attempt
      if (p && p.then) p.then((ok) => { if (ok) L.id = ""; });
      break;
    }
    case "signout": sfx("ui_click"); call("onSignOut"); break;
    case "convoyhost": sfx("ui_click"); call("onConvoyHost"); break;
    case "convoyjoin": sfx("ui_click"); call("onConvoyJoin", ui.code); break;
    case "convoyleave": sfx("ui_back"); call("onConvoyLeave"); break;
    case "voiceon": sfx("ui_click"); call("onVoice", "on"); break;
    case "voiceoff": sfx("ui_back"); call("onVoice", "off"); break;
    case "voicemute": sfx("ui_click"); call("onVoice", "mute"); break;
    case "voicemode": sfx("ui_click"); call("onVoice", "mode"); break;
    case "download": sfx("ui_click"); window.open("https://beta.xorbit.org/longhaul/download/", "_blank", "noopener,noreferrer"); break;
    case "host": sfx("ui_click"); call("onReturnToHost"); break;
    case "devmap": sfx("ui_click"); call("onDevMap"); break;
    case "back": back(); break;
    case "resume": sfx("ui_click"); call("onResume"); break;
    case "savemenu": sfx("ui_click"); call("onSaveAndMenu"); break;
    case "mainmenu": sfx("ui_click"); if (handlers.onMainMenu) call("onMainMenu"); else call("onSaveAndMenu"); break;
    case "tab": { const [id, tid] = arg.split(":"); if (ui.tabs[id] !== tid) { ui.tabs[id] = tid; sfx("ui_click"); render(true); if (id === "board") call("onOpenBoard", tid); } break; }
    case "seg": setPref(e.dataset.pref, e.dataset.val); sfx("ui_click"); render(true); break;
    case "toggle": setPref(e.dataset.pref, !getPref(e.dataset.pref)); sfx("ui_click"); render(true); break;
    case "fullscreen":
      sfx("ui_click");
      try {
        const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
        if (p && p.catch) p.catch(() => {});
      } catch { /* not allowed here */ }
      break;
    case "radionext": sfx("ui_click"); call("onRadioNext"); break;
    case "hostile": ui.nj.hostile = !ui.nj.hostile; sfx("ui_click"); render(true); break;
    case "choice": choose(arg); break;
    case "diff": ui.nj.difficulty = arg; sfx("ui_click"); render(true); break;
    case "randseed": ui.nj.seed = String(Math.floor(Math.random() * 900000) + 100000); sfx("ui_click"); render(true); break;
    case "start": if (data.save || data.cloudSave) { ui.nj.confirm = true; sfx("ui_click"); render(); } else startJourney(); break;
    case "confirmstart": startJourney(); break;
    case "cancelconfirm": back(); break;
    case "use": call("onUseSlot", Number(arg)); break;
    case "drop": call("onDropSlot", Number(arg)); break;
    case "buy": if (e.getAttribute("aria-disabled") === "true") { sfx("error"); menus.setMessage(e.textContent === "Sold out" ? "Sold out." : "You cannot afford that."); } else call("onBuy", arg); break;
  }
}

function onClick(ev) {
  const e = ev.target.closest("[data-act]");
  if (e && root.contains(e) && !e.disabled) act(e, e.dataset.act);
}
function onInput(ev) {
  const e = ev.target;
  if (e.id === "lh-seed") { ui.nj.seed = e.value; return; }
  if (e.id === "lh-user") { ui.login.id = e.value; return; }
  if (e.id === "lh-pass") { ui.login.pass = e.value; return; }
  if (e.id === "lh-code") { ui.code = e.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5); if (e.value !== ui.code) e.value = ui.code; return; }
  if (e.type !== "range" || !e.dataset.pref) return;
  const v = Number(e.value), txt = FMT[e.dataset.fmt](v);
  setPref(e.dataset.pref, v);
  e.setAttribute("aria-valuetext", txt);
  const out = root.querySelector(`[data-out="${e.id}"]`);
  if (out) out.textContent = txt;
}
function onKey(ev) {
  if (!rootName || !root || root.hidden) return;
  const name = screen();
  if (name === "gate" || name === "loading" || name === "sleep") return;   // the gate is handled by the first-gesture listener
  const t = ev.target, isText = t.tagName === "INPUT" && (t.type === "text" || t.type === "password"), isRange = t.tagName === "INPUT" && t.type === "range";
  const stop = () => { ev.preventDefault(); ev.stopPropagation(); };
  if (name === "dialogue") {
    if (/^[1-9]$/.test(ev.key) && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      stop();
      const c = dlgChoices()[Number(ev.key) - 1];
      if (c && !ev.repeat) {
        const b = [...root.querySelectorAll(".lh-choice")][Number(ev.key) - 1];
        if (b) b.focus({ preventScroll: true });
        choose(c.id);
      }
      return;
    }
    if ((ev.key === "Enter" || ev.key === " ") && ev.repeat) { stop(); return; }   // a held key answers once
  }
  switch (ev.key) {
    case "Escape": stop(); if (!ev.repeat) back(); return;
    case "Tab":
      stop();
      if (rootName === "inventory" && !stack.length) { if (!ev.repeat) back(); } else move(ev.shiftKey ? -1 : 1);
      return;
    case "ArrowDown": stop(); move(1); return;
    case "ArrowUp": stop(); move(-1); return;
    case "ArrowLeft": case "ArrowRight": {
      if (isText || isRange) { ev.stopPropagation(); return; }
      const dir = ev.key === "ArrowRight" ? 1 : -1;
      stop();
      const bar = t.closest(".lh-tabs") || t.closest(".lh-pane")?.querySelector(".lh-tabs") || root.querySelector(".lh-tabs");
      const tabs = bar ? [...bar.querySelectorAll(".lh-tab")] : [];
      const group = t.closest ? t.closest(".lh-seg, .lh-cards") : null;
      if (group) {
        const opts = [...group.querySelectorAll("button")], n = opts[opts.indexOf(t) + dir];
        if (n) { n.focus(); act(n, n.dataset.act); }
      } else if (tabs.length && (t.classList.contains("lh-tab") || !t.closest(".lh-btns"))) {
        const i = tabs.findIndex((x) => x.getAttribute("aria-selected") === "true"), n = tabs[(i + dir + tabs.length) % tabs.length];
        const wasTab = t.classList.contains("lh-tab");
        act(n, "tab");
        if (wasTab) { const again = root.querySelector('.lh-tab[aria-selected="true"]'); if (again) again.focus(); }
      } else move(dir);
      return;
    }
    case "Enter":
      if (isText && t.id === "lh-code") { stop(); act(t, "convoyjoin"); return; }
      if (isText && t.id === "lh-user") { stop(); const pw = root.querySelector("#lh-pass"); if (pw) pw.focus(); return; }
      if (isText && t.id === "lh-pass") { stop(); act(t, "signin"); return; }
      if (isText) { stop(); const b = root.querySelector('[data-act="start"]'); if (b) b.focus(); } else ev.stopPropagation(); return;
    case "i": case "I": if (rootName === "inventory" && !stack.length && !isText) { stop(); if (!ev.repeat) back(); } return;
    case "m": case "M": if (rootName === "map" && !stack.length && !isText) { stop(); if (!ev.repeat) back(); } return;
    case "c": case "C": if (rootName === "map" && !isText) { stop(); call("onMapCentre"); } return;
    case "+": case "=": if (rootName === "map") { stop(); call("onMapZoom", 1.25); } return;
    case "-": case "_": if (rootName === "map") { stop(); call("onMapZoom", 0.8); } return;
    default: ev.stopPropagation();
  }
}

let gateFading = false;
function firstGesture() {
  if (gateFading || screen() !== "gate") return;
  gateFading = true;
  if (!gestureDone) { gestureDone = true; call("onFirstGesture"); }
  call("onStudioStart");
  root.classList.add("lh-splash-exit");
  setTimeout(() => {
    root.classList.remove("lh-splash-exit");
    gateFading = false;
    call("onStudioContinue");
  }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450);
}

function onAnyGesture(ev) {
  if (document.getElementById("splash")) return;      // the opening handles its own keys (main.js → menus.gesture)
  if (ev.type === "keydown" && (["Shift", "Control", "Alt", "Meta", "Escape", "Tab"].includes(ev.key) || ev.metaKey || ev.ctrlKey || ev.altKey)) return;
  if (screen() !== "gate") return;
  if (!root) return;
  if (screen() === "gate") { ev.preventDefault(); ev.stopPropagation(); }
  firstGesture();
}

export const menus = {
  init({ prefs: p, handlers: h, difficulties } = {}) {
    if (Array.isArray(difficulties) && difficulties.length) initDiffs = difficulties;
    prefs = p || prefs || {};
    handlers = h || {};
    prefs.vol = prefs.vol || { master: 0.8, music: 0.6, sfx: 0.8, ambience: 0.7 };
    prefs.hud = prefs.hud || { scale: 1, opacity: 1, show: "full", critical: true, help: true };
    prefs.a11y = prefs.a11y || { reduceMotion: false, highContrast: false };
    if (!root) {
      root = document.getElementById("menus");
      if (!root) { root = document.createElement("div"); root.id = "menus"; document.body.appendChild(root); }
      root.className = "lh-menus";
      root.hidden = true;
      root.addEventListener("click", onClick);
      root.addEventListener("input", onInput);
      document.addEventListener("keydown", onKey, true);
      addEventListener("pointerdown", onAnyGesture, true);
      addEventListener("keydown", onAnyGesture, true);
      document.addEventListener("fullscreenchange", () => { if (screen() === "settings") render(true); });
      const boot = document.getElementById("boot");
      if (boot) boot.remove();
    }
    applyOwnPrefs();
    return menus;
  },
  // name: "gate" | "loading" | "main" | "pause" | "gameover" | "inventory" | "shop" | "sleep"
  //     | "dialogue" { speaker, role, lines: [string], note?, choices: [{ id, label, detail?, cost?, disabled?, danger? }] }
  //       → handlers.onDialogueChoice(id), once. refresh({ note, choices, … }) updates it in place and re-arms it.
  show(name, d = {}) {
    if (!root || !SCREENS[name]) return;
    if (name === "loading" && rootName === "loading" && !stack.length) { data = d || {}; updateLoading(); return; }
    data = d || {};
    rootName = name;
    stack = [];
    message = "";
    if (name === "dialogue") { dlgPicked = false; dlgReadyAt = performance.now() + 200; }
    // The studio splash appears once per page load, including after earlier loading-screen input.
    // The opening prompt is owned by index.html. Never insert another gate.
    document.documentElement.dataset.lhMenu = name;
    render();
  },
  // Re-render the current screen with new data (shallow-merged), keeping focus, tab and scroll position.
  refresh(d) {
    if (!rootName) return;
    data = { ...data, ...(d || {}) };
    if (rootName === "dialogue") { if (dlgPicked) dlgReadyAt = performance.now() + 200; dlgPicked = false; }
    if (screen() === "loading") updateLoading(); else render(true);
  },
  hide() {
    if (!root) return;
    const had = root.contains(document.activeElement);
    rootName = null; stack = [];
    root.hidden = true;
    root.innerHTML = "";
    delete root.dataset.screen;
    delete document.documentElement.dataset.lhMenu;
    if (had) { const c = document.getElementById("game"); if (c) c.focus({ preventScroll: true }); }
  },
  setMessage(textv) {
    message = textv || "";
    const m = root && root.querySelector(".lh-msg");
    if (m) m.textContent = message;
  },
  setNowPlaying(np) {
    nowPlaying = np && np.title ? { title: String(np.title), cover: np.cover, artist: np.artist ? String(np.artist) : "" } : null;
    if (!root) return;
    for (const n of root.querySelectorAll(".lh-np")) {
      n.hidden = !nowPlaying;
      n.innerHTML = npContents();
    }
  },
  // The player has pressed a key or clicked (the opening): sound may start, and no start gate is needed
  gesture() { firstGesture(); },
  get current() { return rootName; },   // the name passed to show(), or null
  get screen() { return rootName ? screen() : null; },   // includes sub-screens: "settings", "controls", "credits", "whatsnew", "newjourney", "play", "leaderboard", "convoy", "account", "gate"
};
export default menus;
