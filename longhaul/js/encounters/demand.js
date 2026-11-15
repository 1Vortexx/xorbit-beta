// Long Haul – what a roadblock asks for, and the one place a demand is turned into a payment.
// Pure: no THREE, no DOM, no globals. R is always a () => 0..1 stream from encRng (never Math.random).
// Demand = { money, items: [{ kind, n } | { type, name, n }] } – plain JSON, frozen in the encounter record.
import { RULES, diffOf } from "./rules.js";

const round5 = (v) => Math.max(0, Math.round(v / 5) * 5);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const span = (R, [a, b]) => a + Math.floor(R() * (b - a + 1));   // integer in [a, b]
const num = (v, d = 0) => (typeof v === "number" && isFinite(v) ? v : d);

// Toll: rolled when the roadblock is created. progress: { km, day, money }.
export function tollDemand(R, diff, progress = {}, rules = RULES) {
  const T = rules.toll, t = T[diffOf(diff)];
  const jit = T.jitter[0] + R() * (T.jitter[1] - T.jitter[0]), form = R(), fa = R(), fb = R();
  let price = (t.base + t.perKm * Math.max(0, num(progress.km))) * jit;
  if (typeof progress.money === "number" && isFinite(progress.money)) price += (progress.money * T.cashShare - price) * T.cashPull;
  price = round5(clamp(price, t.min, t.cap));
  const pick = (r, [a, b]) => a + Math.floor(r * (b - a + 1));
  if (form < T.form.money) return { money: price, items: [] };
  if (form < T.form.money + T.form.food) return { money: 0, items: [{ kind: "food", n: pick(fa, T.foodOnly) + (diffOf(diff) === "hard" ? 1 : 0) }] };
  return { money: Math.max(5, round5(price * T.bothMoney)), items: [{ kind: "food", n: pick(fb, T.foodBoth) }] };
}

// Optional donation at a peaceful checkpoint.
export function feeDemand(R, rules = RULES) { return { money: span(R, rules.peaceful.fee), items: [] }; }

// Robbery: the plan (shares) is rolled at creation …
export function robberyPlan(R, diff, rules = RULES) {
  const B = rules.robbery, [a, b] = B.cash[diffOf(diff)];
  const cashShare = Math.round((a + R() * (b - a)) * 100) / 100, ex = R(), which = R();
  const cats = Object.keys(B.extra);
  return { cashShare, foodShare: B.foodShare, maxFood: B.maxFood, extra: ex < B.extraChance ? cats[Math.min(cats.length - 1, Math.floor(which * cats.length))] : null };
}
// … and turned into exact quantities from what the player carries at the moment the demand is made.
// list: stock.list() → [{ type, name, kind, count }], money: stock.money, factor: negotiation result (1 = none).
export function freezeRobbery(plan, list = [], money = 0, factor = 1, rules = RULES) {
  const cash = Math.floor(Math.max(0, num(money)));
  const d = { money: Math.min(cash, Math.floor(cash * clamp(plan.cashShare * factor, 0, 1))), items: [] };
  const food = list.filter((e) => e.kind === "food" && e.count > 0).map((e) => ({ ...e, take: 0 }))
    .sort((p, q) => q.count - p.count || (p.type < q.type ? -1 : 1));
  const total = food.reduce((s, e) => s + e.count, 0);
  let want = Math.min(total, plan.maxFood, Math.ceil(total * clamp(plan.foodShare * factor, 0, 1)));
  while (want > 0) {                      // spread over the types, largest stack first
    let any = false;
    for (const e of food) if (want > 0 && e.take < e.count) { e.take++; want--; any = true; }
    if (!any) break;
  }
  for (const e of food) if (e.take) d.items.push({ type: e.type, name: e.name || e.type, n: e.take });
  if (plan.extra && factor >= 1) {
    for (const type of rules.robbery.extra[plan.extra] || []) {
      const e = list.find((x) => x.type === type && x.count > 0);
      if (e) { d.items.push({ type, name: e.name || type, n: 1 }); break; }
    }
  }
  return d;
}

// One negotiation attempt. roll: a single number from encRng(id + ":negotiate").
export function negotiationOutcome(roll, type, rules = RULES) {
  const o = rules.negotiate[type === "toll" ? "toll" : "robbery"];
  return roll < o.lower ? "lower" : roll < o.lower + o.same ? "same" : "angry";
}
export function negotiationFactor(outcome, rules = RULES) {
  return outcome === "lower" ? rules.negotiate.lowerFactor : outcome === "angry" ? rules.negotiate.angryFactor : 1;
}
// New toll after a negotiation (robberies are re-frozen with the factor instead).
export function negotiateToll(demand, outcome, rules = RULES) {
  if (outcome === "same") return { money: demand.money, items: demand.items.map((i) => ({ ...i })) };
  const f = negotiationFactor(outcome, rules), step = outcome === "lower" ? -1 : 1;
  const money = demand.money ? Math.max(5, round5(demand.money * f)) : 0;
  const items = demand.items.map((i) => ({ ...i, n: Math.max(money ? 0 : 1, i.n + step) })).filter((i) => i.n > 0);
  return { money, items };
}

export const isEmpty = (d) => !d || (!(d.money > 0) && !(d.items || []).some((i) => i.n > 0));
const itemText = (i) => `${i.n} ${i.type ? String(i.name || i.type).toLowerCase() : i.kind}`;
const parts = (d) => [...(d && d.money > 0 ? ["$" + d.money] : []), ...((d && d.items) || []).filter((i) => i.n > 0).map(itemText)];
// "$85 and 2 food" – spoken form
export function demandText(d) {
  const p = parts(d);
  return !p.length ? "nothing" : p.length === 1 ? p[0] : p.slice(0, -1).join(", ") + " and " + p[p.length - 1];
}
// "$85 + 2 food" – the cost shown on the choice (ARCHITECTURE §14.6)
export function costText(d) { return parts(d).join(" + ") || "nothing"; }

// The request handed to stock.check / stock.pay.
export function payment(d) {
  return { money: Math.max(0, Math.round((d && d.money) || 0)), items: ((d && d.items) || []).filter((i) => i.n > 0).map((i) => (i.type ? { type: i.type, n: i.n } : { kind: i.kind, n: i.n })) };
}

// Why the player cannot meet this demand right now (null = they can).
export function cannotPay(stock, demand) { return stock.check(payment(demand)) || null; }

// Take exactly the demand, once. `rec.settled` is the guard: a second call never touches the stock again.
// → { ok: true, already? } | { ok: false, reason }
export function settle(rec, stock, at = 0) {
  if (rec.settled) return { ok: true, already: true };
  const req = payment(rec.demand);
  const reason = stock.check(req);
  if (reason) return { ok: false, reason };
  if (!stock.pay(req)) return { ok: false, reason: "You can't cover that" };
  rec.settled = { at, money: req.money, items: req.items };
  return { ok: true };
}
