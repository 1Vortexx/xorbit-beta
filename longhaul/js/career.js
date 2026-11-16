// Long Haul – career: lifetime totals across journeys and achievements. Kept on this browser, one per account
// (`who`: the X-ORBIT handle, or nothing when signed out); js/online.js mirrors it to the account.
// Pure logic plus storage, no DOM, so tests run it in Node.
const KEY = "longhaul-career";
export const TRIP_MIN = 500;          // metres a journey needs before it counts as a trip (same rule as the leaderboard)

let store = null;
try { store = globalThis.localStorage || null; } catch (e) { store = null; }
export function setStorage(s) { store = s; }

const isNum = (v) => typeof v === "number" && isFinite(v);
const COUNTS = ["distance", "trips", "days", "sites", "litres", "playTime", "escapes", "rides"];
const zero = () => Object.fromEntries(COUNTS.map((k) => [k, 0]));

// One journey's numbers, from the game state main.js keeps
export function tripOf(game) {
  const s = game.stats || {};
  return {
    id: game.tripId, distance: s.distance || 0, days: game.day || 1, sites: s.sites || 0, litres: s.litres || 0,
    playTime: game.playTime || 0, escapes: s.escapes || 0, rides: s.rides || 0, diff: game.diff || "normal", hostile: game.hostile !== false,
  };
}

export function newCareer() { return { v: 1, done: zero(), best: { km: 0, days: 0 }, live: null, ach: {} }; }

const keyOf = (who) => (who ? `${KEY}:${who}` : KEY);
export function loadCareer(who) {
  const c = newCareer();
  try {
    const d = store && JSON.parse(store.getItem(keyOf(who)) || "null");
    if (!d || d.v !== 1) return c;
    for (const k of COUNTS) if (isNum(d.done?.[k])) c.done[k] = d.done[k];
    if (isNum(d.best?.km)) c.best.km = d.best.km;
    if (isNum(d.best?.days)) c.best.days = d.best.days;
    if (d.live && typeof d.live === "object") c.live = d.live;
    if (d.ach && typeof d.ach === "object") for (const [id, t] of Object.entries(d.ach)) if (ACH_IDS.has(id)) c.ach[id] = t;
  } catch (e) {}
  return c;
}
export function saveCareer(c, who) { try { store && store.setItem(keyOf(who), JSON.stringify(c)); return true; } catch (e) { return false; } }

// The journey being played. Only one exists at a time, so it simply replaces the last one.
export function track(c, trip) {
  c.live = trip;
  if (trip.distance / 1000 > c.best.km) c.best.km = trip.distance / 1000;
  if (trip.days > c.best.days) c.best.days = trip.days;
}
// The journey is over (death, or replaced by a new one): its numbers join the lifetime totals
export function endTrip(c) {
  const t = c.live;
  c.live = null;
  if (!t) return null;
  for (const k of COUNTS) if (k !== "trips" && isNum(t[k])) c.done[k] += t[k];
  if (t.distance >= TRIP_MIN) c.done.trips++;
  return t;
}
export function totals(c) {
  const t = { ...c.done }, l = c.live;
  if (l) {
    for (const k of COUNTS) if (k !== "trips" && isNum(l[k])) t[k] += l[k];
    if (l.distance >= TRIP_MIN) t.trips++;
  }
  return t;
}

// test(trip, totals) → true once earned. Trip values are this journey; totals include it.
export const ACHIEVEMENTS = [
  { id: "get_me_out", name: "Found the Demo", desc: "Discover Michael Lester’s Get Me Out Of Here on the title screen." },
  { id: "first_km",     name: "Rolling",            desc: "Drive your first kilometre.",                 test: (t) => t.distance >= 1000 },
  { id: "trip_50",      name: "Out of Town",        desc: "Drive 50 km in one journey.",                 test: (t) => t.distance >= 50e3 },
  { id: "trip_200",     name: "Long Haul",          desc: "Drive 200 km in one journey.",                test: (t) => t.distance >= 200e3 },
  { id: "trip_500",     name: "Iron Butt",          desc: "Drive 500 km in one journey.",                test: (t) => t.distance >= 500e3 },
  { id: "hard_100",     name: "Hardcore Hauler",    desc: "Drive 100 km in one Hardcore journey.",       test: (t) => t.diff === "hard" && t.distance >= 100e3 },
  { id: "day_3",        name: "Weekend Trip",       desc: "Reach day 3.",                                test: (t) => t.days >= 3 },
  { id: "day_7",        name: "A Week on the Road", desc: "Reach day 7.",                                test: (t) => t.days >= 7 },
  { id: "day_14",       name: "Desert Rat",         desc: "Reach day 14.",                               test: (t) => t.days >= 14 },
  { id: "sites_10",     name: "Sightseer",          desc: "Discover 10 places in one journey.",          test: (t) => t.sites >= 10 },
  { id: "escape",       name: "Getaway Driver",     desc: "Escape a pursuit.",                           test: (t, a) => a.escapes >= 1 },
  { id: "escape_5",     name: "Untouchable",        desc: "Escape 5 pursuits.",                          test: (t, a) => a.escapes >= 5 },
  { id: "ride",         name: "Good Samaritan",     desc: "Drop a hitchhiker off where they're going.",  test: (t, a) => a.rides >= 1 },
  { id: "rides_10",     name: "Rideshare",          desc: "Deliver 10 passengers.",                      test: (t, a) => a.rides >= 10 },
  { id: "total_1000",   name: "Thousand Clicks",    desc: "Drive 1,000 km across all your journeys.",    test: (t, a) => a.distance >= 1000e3 },
  { id: "total_5000",   name: "Road Warrior",       desc: "Drive 5,000 km across all your journeys.",    test: (t, a) => a.distance >= 5000e3 },
  { id: "fuel_200",     name: "Thirsty Truck",      desc: "Buy 200 litres of fuel.",                     test: (t, a) => a.litres >= 200 },
  { id: "trips_10",     name: "Regular",            desc: "Take 10 journeys.",                           test: (t, a) => a.trips >= 10 },
  { id: "hours_10",     name: "Lifer",              desc: "Play for 10 hours.",                          test: (t, a) => a.playTime >= 36000 },
];
const ACH_IDS = new Set(ACHIEVEMENTS.map((a) => a.id));
export const achievement = (id) => ACHIEVEMENTS.find((a) => a.id === id) || null;

// Checks the current journey; returns the achievements it just earned
export function unlock(c, now = Date.now()) {
  const trip = c.live || tripOf({}), all = totals(c), got = [];
  for (const a of ACHIEVEMENTS) {
    if (c.ach[a.id] || !a.test?.(trip, all)) continue;
    c.ach[a.id] = now;
    got.push(a);
  }
  return got;
}
// Unlocks from another device (the X-ORBIT account) join this browser's set
export function mergeAchievements(c, ids) {
  for (const id of ids || []) if (ACH_IDS.has(id) && !c.ach[id]) c.ach[id] = Date.now();
}
