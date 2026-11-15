// Long Haul – roadblock rules: every probability, price, damage range and distance used by js/encounters/*, and
// the one function that rolls a new roadblock. No THREE, no DOM. Change numbers here, not in the state machine.
// See ARCHITECTURE.md §14.6.
//
// ── What a roadblock is ───────────────────────────────────────────────────────────────────────────────────────
// Type: encRng(id + ":type")() < 0.5 → "robbery", otherwise "toll" (exactly 50/50, rolled once, stored).
// A toll wants a fixed price for passage. A robbery wants a share of what the player carries. Either way, paying
// what was shown ends it for good: the barricade opens and nobody follows.
// With hostile encounters off, every roadblock is a peaceful checkpoint: the gate is open, the fee is optional,
// and there is no robbery, pursuit or capture. (The stored type is not changed by that.)
// Every roll has its own stream (":type", ":demand", ":crew", ":fee", ":negotiate", ":capture"), so changing
// one table never changes another outcome.
//
// ── Capture outcomes (rolled once from encRng(id + ":capture"), stored, applied once) ─────────────────────────
//   difficulty | killed | robbed | ransom | beaten
//   easy       |   2 %  |  50 %  |  23 %  |  25 %
//   normal     |   8 %  |  42 %  |  22 %  |  28 %
//   hard       |  16 %  |  34 %  |  20 %  |  30 %
// robbed  = stock.strip(RULES.strip[diff]) – a share of the cash plus some supplies – then release.
//           easy 60 % cash + up to 4 food/drink · normal 80 % + up to 6 food/drink/med · hard 100 % + up to 8 incl. fluids
// ransom  = pay the stated amount for release; refusing (or not having it) means a beating.
// beaten  = the blows below; each one is needs.hurt(dmg, "A beating"). Fatal only if health runs out.
//
// ── Beating (blows × damage per blow, health is 0..100) ───────────────────────────────────────────────────────
//   easy   2–3 blows ×  6–10  (12–30 total)
//   normal 2–4 blows ×  9–15  (18–60 total)
//   hard   3–4 blows × 13–20  (39–80 total)
//
// ── Toll (rolled at creation, frozen) ─────────────────────────────────────────────────────────────────────────
//   price = (base + perKm × km travelled) × 0.85..1.15, pulled 35 % towards 40 % of the player's cash,
//           clamped to [min, cap], rounded to $5.
//   easy   base 25, +0.5/km, $20..$80      normal base 40, +0.8/km, $30..$130      hard base 55, +1.1/km, $40..$190
//   form: 55 % money only · 20 % food only (2–4 items, +1 on hard) · 25 % both (65 % of the price + 1–2 food).
//   A toll never asks for fuel, water or tools.
//
// ── Robbery (plan rolled at creation; exact quantities frozen from stock.list() when the demand is shown) ─────
//   cash share: easy 35–50 % · normal 50–65 % · hard 65–80 %     food share: 50 % (rounded up), at most 6 items
//   extra (30 %): one fuel container, one water container or one tool – only if the player carries one.
//
// ── Negotiation (one attempt per roadblock, rolled from encRng(id + ":negotiate"), stored) ────────────────────
//   toll:    45 % lower (×0.65, one food less) · 35 % unchanged · 20 % angry (×1.3, one food more)
//   robbery: 25 % lower (×0.65, no extra item) · 40 % unchanged · 35 % angry (×1.3, capped at what you carry)
//
// ── Ransom ────────────────────────────────────────────────────────────────────────────────────────────────────
//   max(floor, 60 % of the player's cash at capture) rounded to $5: floor easy $40 · normal $60 · hard $90.
//
// ── Space and time ────────────────────────────────────────────────────────────────────────────────────────────
//   created / loaded within 500 m, unloaded beyond 700 m (never while live) · seen from 250 m · guarded zone:
//   within 45 m of the line and 40 m of the road centre (challenge) · after a challenge, crossing the line within
//   70 m of the road centre is running the block · more than 80 m away = backed off · mobilise 5 s · capture:
//   player < 2 m/s, hostile person on foot within 3 m with line of sight, held for 2.5 s of warning · a refused
//   robbery gives 8 s to leave before the group closes in · release grace 90 s (and that group never acts again).
import { encRng, encSeed } from "../core/encgen.js";
import { tollDemand, robberyPlan, freezeRobbery, feeDemand } from "./demand.js";
import { rollCapture } from "./capture.js";
import { findSite, coords, relative } from "./layout.js";

export { coords, relative };

export const RULES = {
  typeSplit: 0.5,                       // P(robbery); the rest are tolls
  spawnDist: 500, despawnDist: 700,
  maxPursuitVehicles: 2, maxPursuers: 3,
  mobilizeSeconds: 5,
  releaseGrace: 90,
  refuseLeave: 8,                       // seconds a refused robbery gives the player to leave before closing in

  guard: {
    sight: 250,                         // "spotted" – nothing hostile
    approach: 45,                       // challenge zone: this far before / after the line …
    radius: 40,                         // … and this far from the road centre
    evadeRadius: 70,                    // after a challenge, crossing the line inside this is running the block
    cross: 3,                           // metres past the line that count as crossed
    leave: 80,                          // further than this from the block = backed away, group relaxes
    talkDist: 18, talkSpeed: 2.5,       // slow / stopped this close to the leader opens the talk by itself
    talkKey: 30,                        // Talk key works this close
    ramSpeed: { saw: 3, sign: 2, barrel: 2.5, fire: 2.5 },   // pieces break above this closing speed (m/s)
  },

  crew: { guardsMin: 2, guardsMax: 3 },

  toll: {
    easy: { base: 25, perKm: 0.5, min: 20, cap: 80 },
    normal: { base: 40, perKm: 0.8, min: 30, cap: 130 },
    hard: { base: 55, perKm: 1.1, min: 40, cap: 190 },
    jitter: [0.85, 1.15], cashPull: 0.35, cashShare: 0.4,
    form: { money: 0.55, food: 0.2 },   // remainder: both
    foodOnly: [2, 4], foodBoth: [1, 2], bothMoney: 0.65,
  },

  robbery: {
    cash: { easy: [0.35, 0.5], normal: [0.5, 0.65], hard: [0.65, 0.8] },
    foodShare: 0.5, maxFood: 6,
    extraChance: 0.3,
    extra: {                            // first type the player actually carries is asked for
      fuel: ["jerrycan", "fuelcan"],
      water: ["waterjug", "water"],
      tool: ["repairkit", "flashlight", "wrench"],
    },
  },

  negotiate: {
    allowed: { toll: true, robbery: true },
    toll: { lower: 0.45, same: 0.35 },      // remainder: angry
    robbery: { lower: 0.25, same: 0.4 },
    lowerFactor: 0.65, angryFactor: 1.3,
  },

  peaceful: { fee: [5, 15] },           // optional road-fund donation at a peaceful checkpoint

  capture: {
    speed: 2, dist: 3, warn: 2.5,       // eligibility and the warning before the pull-out
    dismountDist: 16,                   // pursuers holding this close to a slow player get out
    remountDist: 30, remountSpeed: 5,   // player drove off: back to the cars
    beat: 1.2,                          // seconds between capture and its outcome / between blows
    easy: { killed: 0.02, robbed: 0.5, ransom: 0.23, beaten: 0.25 },
    normal: { killed: 0.08, robbed: 0.42, ransom: 0.22, beaten: 0.28 },
    hard: { killed: 0.16, robbed: 0.34, ransom: 0.2, beaten: 0.3 },
  },
  beating: {
    easy: { blows: [2, 3], dmg: [6, 10] },
    normal: { blows: [2, 4], dmg: [9, 15] },
    hard: { blows: [3, 4], dmg: [13, 20] },
  },
  strip: {                              // stock.strip() options when the outcome is "robbed"
    easy: { money: 0.6, kinds: ["food", "drink"], max: 4 },
    normal: { money: 0.8, kinds: ["food", "drink", "med"], max: 6 },
    hard: { money: 1, kinds: ["food", "drink", "med", "fluid"], max: 8 },
  },
  ransom: { share: 0.6, floor: { easy: 40, normal: 60, hard: 90 } },

  // What breaking a piece costs the vehicle that hits it (factor on collision response + impact damage)
  pieces: {
    saw: { factor: 0.14, sfx: "barricade_hit" },
    sign: { factor: 0.08, sfx: "barricade_hit" },
    barrel: { factor: 0.3, sfx: "barrel_hit" },
    fire: { factor: 0.35, sfx: "barrel_hit" },
  },
};

export const diffOf = (d) => (d === "easy" || d === "hard" ? d : "normal");

// States (ARCHITECTURE §14.6). "cleared" is the peaceful pass-through; "bypassed" is written and left at once.
export const LIVE = new Set(["challenged", "negotiating", "backedOff", "refused", "bypassed", "mobilizing", "pursuing", "captured"]);
export const DONE = new Set(["paid", "complied", "cleared", "escaped", "released", "dead"]);
export const CHASE = new Set(["mobilizing", "pursuing"]);

const NAMES = ["Rourke", "Dallas", "Vega", "Mack", "Sorrel", "Briggs", "Tully", "Odell", "Cruz", "Hask", "Marlow", "Pike", "Juno", "Reyes", "Stokes", "Wren"];

// "robbery" | "toll", exactly 50/50, the same answer for the same journey seed and id forever.
export function roadblockType(id) { return encRng(id + ":type")() < RULES.typeSplit ? "robbery" : "toll"; }

// The record of a roadblock, created once when the player first comes near. Every roll that defines the group is
// made here, each from its own stream, and stored: type, site, toll / robbery plan, optional peaceful fee, crew.
// site: a schedule entry { id, z, x, side, yaw, seed }. opts: { type (dev), fixed (keep the given position) }
export function newBlock(site, diff = "normal", progress = {}, opts = {}) {
  const id = site.id, type = opts.type === "robbery" || opts.type === "toll" ? opts.type : roadblockType(id);
  const at = opts.fixed ? { x: site.x, z: site.z, yaw: site.yaw, moved: 0 } : findSite(site.z);
  const r = encRng(id + ":demand");
  const plan = type === "robbery" ? robberyPlan(r, diff) : null;
  const demand = plan ? null : tollDemand(r, diff, progress);
  const c = encRng(id + ":crew");
  const guards = RULES.crew.guardsMin + Math.floor(c() * (RULES.crew.guardsMax - RULES.crew.guardsMin + 1));
  const used = new Set(), crew = [];
  for (let n = 0; n <= guards; n++) {
    let name = NAMES[Math.floor(c() * NAMES.length)];
    while (used.has(name)) name = NAMES[(NAMES.indexOf(name) + 1) % NAMES.length];
    used.add(name);
    // p0 (leader) drives car 0, p1 drives car 1, the others ride along
    crew.push({ id: `${id}:p${n}`, role: n ? "guard" : "leader", name, seed: encSeed(`${id}:p${n}`), car: n % 2, seat: n < 2 ? "driver" : "passenger" });
  }
  return {
    ...site, x: at.x, z: at.z, yaw: at.yaw, moved: at.moved || 0, v: 2, kind: "roadblock",
    type, plan, demand, fee: feeDemand(encRng(id + ":fee")), diff: diffOf(diff),
    layoutSeed: encSeed(id + ":layout"), carTypes: [c() < 0.5 ? "sedan" : "pickup", c() < 0.6 ? "pickup" : "sedan"],
    state: "unseen", approach: 0, challenged: false, neg: null, settled: null, open: false, broken: [],
    crew, people: [], drivers: [{}, {}], carsMade: false, mobT: null, confront: null, capture: null, graceUntil: 0,
  };
}
// Robbery: exact quantities from what the player carries now, frozen in the record (factor = negotiation result).
export function quoteRobbery(rec, stock) {
  rec.demand = freezeRobbery(rec.plan, stock.list(), stock.money, rec.neg ? rec.neg.factor : 1);
  return rec.demand;
}
export function captureTerms(id, difficulty, money, forced = null) {
  return rollCapture(encRng(id + ":capture"), difficulty, money, RULES, forced);
}
