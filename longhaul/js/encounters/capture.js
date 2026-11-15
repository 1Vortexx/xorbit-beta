// Long Haul – capture: who may be caught, and what happens to them. Pure functions (collide.js only).
import { pathBlocked } from "../core/collide.js";
import { RULES, diffOf } from "./rules.js";

export const CAPTURE_STATES = new Set(["pursuing", "refused"]);
export const OUTCOMES = ["killed", "robbed", "ransom", "beaten"];

// o: { state, confronted (refused only: the group has closed in), playerSpeed (m/s), playerPos {x, z},
//      members: [{ id, pos {x, z}, onFoot, hostile, down }], colliders (already without the player's own vehicle
//      and the people themselves), now, graceUntil }
// → { ok, reason: null | "state" | "grace" | "speed" | "nobody" | "far" | "sight", by: member | null }
export function captureEligible(o, rules = RULES) {
  const C = rules.capture, no = (reason) => ({ ok: false, reason, by: null });
  if (!CAPTURE_STATES.has(o.state) || (o.state === "refused" && !o.confronted)) return no("state");
  if (o.graceUntil && o.now < o.graceUntil) return no("grace");
  if (!(Math.abs(o.playerSpeed) < C.speed)) return no("speed");
  const p = o.playerPos;
  let seen = "nobody";
  for (const m of o.members || []) {
    if (!m || !m.hostile || !m.onFoot || m.down) continue;
    const dx = p.x - m.pos.x, dz = p.z - m.pos.z, d = Math.hypot(dx, dz);
    if (d > C.dist) { if (seen === "nobody") seen = "far"; continue; }
    // Line of sight: a thin walk from just in front of them to just short of the player
    const a = Math.min(0.45, d * 0.4), b = Math.max(0, d - 0.3), ux = d > 1e-6 ? dx / d : 0, uz = d > 1e-6 ? dz / d : 0;
    if (b > a && pathBlocked(m.pos.x + ux * a, m.pos.z + uz * a, m.pos.x + ux * b, m.pos.z + uz * b, 0.12, o.colliders || [])) { seen = "sight"; continue; }
    return { ok: true, reason: null, by: m };
  }
  return no(seen);
}

// roll: one number 0..1. The table order is fixed, so a stored roll always maps to the same outcome.
export function captureOutcome(roll, diff, rules = RULES) {
  const t = rules.capture[diffOf(diff)];
  let acc = 0;
  for (const k of OUTCOMES) { acc += t[k]; if (roll < acc) return k; }
  return "beaten";
}

// The blows of a beating, rolled together so they can be stored before the first one lands.
export function rollBeating(R, diff, rules = RULES) {
  const b = rules.beating[diffOf(diff)];
  const n = b.blows[0] + Math.floor(R() * (b.blows[1] - b.blows[0] + 1));
  const out = [];
  for (let i = 0; i < n; i++) out.push(Math.round((b.dmg[0] + R() * (b.dmg[1] - b.dmg[0])) * 10) / 10);
  return out;
}

export function ransomAmount(diff, money, rules = RULES) {
  const r = rules.ransom;
  return Math.max(r.floor[diffOf(diff)], Math.round((Math.max(0, money || 0) * r.share) / 5) * 5);
}

// Everything a capture needs, rolled in one go from encRng(id + ":capture") and stored in the record.
export function rollCapture(R, diff, money, rules = RULES, forced = null) {
  const roll = R();
  return {
    outcome: OUTCOMES.includes(forced) ? forced : captureOutcome(roll, diff, rules),
    diff: diffOf(diff), blows: rollBeating(R, diff, rules), done: 0, ransom: ransomAmount(diff, money, rules),
    stage: "begin", applied: false, taken: null, paid: 0,
  };
}
