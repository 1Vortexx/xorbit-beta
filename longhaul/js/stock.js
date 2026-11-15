// Long Haul – what the player has on them, as one ledger for anyone who trades with or robs them
// (roadblocks, hitchhikers). Counts cash, pockets, the item in the hands and the cargo secured in the vehicle the
// player is using or standing by. Every change goes through here so payments are checked first and applied once.
// See ARCHITECTURE.md §14.7. No THREE, no DOM: collaborators are injected, so it runs in Node tests with mocks.

// deps: { wallet: { money }, pockets: Pockets, interaction: { held, consumeHeld() }, props: { list, remove(p) },
//         vehicle: () => Vehicle | null (whose secured cargo counts), defs: ITEMS, makeItem(type), drop(item) }
export function makeStock(deps) {
  const { wallet, pockets, defs } = deps;
  const def = (type) => defs[type] || { name: type, kind: "misc" };

  // Every single item the player could hand over, cheapest-to-lose first: cargo, then hands, then pockets.
  function units() {
    const out = [];
    const v = deps.vehicle ? deps.vehicle() : null;
    if (v && deps.props) {
      for (const p of deps.props.list) {
        if (p.secured && p.secured.vehicle === v && !p.dead) out.push({ type: p.item.type, src: "cargo", ref: p });
      }
    }
    const held = deps.interaction ? deps.interaction.held : null;
    if (held) out.push({ type: held.type, src: "held", ref: held });
    pockets.slots.forEach((s, i) => { if (s) for (const it of s.items) out.push({ type: it.type, src: "pocket", ref: it, slot: i }); });
    return out;
  }
  const matches = (u, want) => (want.type ? u.type === want.type : def(u.type).kind === want.kind);
  const wantName = (want, n) => (want.type ? def(want.type).name : want.kind) + (n > 1 && !want.type ? "" : "");

  // Pick the exact units for a request. → { units } or { reason }
  function plan(req = {}) {
    const money = Math.max(0, Math.round(req.money || 0));
    if (money > wallet.money) return { reason: `You only have $${Math.floor(wallet.money)}` };
    const pool = units(), chosen = [];
    for (const want of req.items || []) {
      const n = Math.max(0, Math.round(want.n || 0));
      const got = [];
      for (const u of pool) { if (got.length >= n) break; if (!chosen.includes(u) && matches(u, want)) got.push(u); }
      if (got.length < n) return { reason: `You only have ${got.length} ${wantName(want, n)}, they want ${n}` };
      chosen.push(...got);
    }
    return { units: chosen, money };
  }

  function removeUnit(u) {
    if (u.src === "cargo") return !!deps.props.remove(u.ref);
    if (u.src === "held") return !!deps.interaction.consumeHeld();
    const s = pockets.slots[u.slot];
    const i = s ? s.items.indexOf(u.ref) : -1;
    if (i < 0) return false;
    s.items.splice(i, 1);
    if (!s.items.length) pockets.slots[u.slot] = null;
    return true;
  }
  function tally(us) {
    const m = new Map();
    for (const u of us) m.set(u.type, (m.get(u.type) || 0) + 1);
    return [...m].map(([type, n]) => ({ type, n }));
  }

  return {
    get money() { return wallet.money; },
    // [{ type, name, kind, count }]
    list() {
      const m = new Map();
      for (const u of units()) m.set(u.type, (m.get(u.type) || 0) + 1);
      return [...m].map(([type, count]) => ({ type, name: def(type).name, kind: def(type).kind, count }));
    },
    count(type) { return units().filter((u) => u.type === type).length; },
    countKind(kind) { return units().filter((u) => def(u.type).kind === kind).length; },

    // null when the request can be met in full, otherwise the reason in plain words
    check(req) { return plan(req).reason || null; },
    // All or nothing. true = exactly the requested cash and items are gone; false = nothing changed.
    pay(req) {
      const p = plan(req);
      if (p.reason) return false;
      wallet.money -= p.money;
      for (const u of p.units) removeUnit(u);
      return true;
    },
    // Robbery: take a share of the cash and up to `max` items of the given kinds. Returns exactly what was taken.
    // opts: { money: fraction 0..1, kinds: ["food", "drink", …] | null (anything), max: items, types: [...] extra }
    strip(opts = {}) {
      const cash = Math.max(0, Math.min(wallet.money, Math.round(wallet.money * (opts.money ?? 1))));
      wallet.money -= cash;
      const kinds = opts.kinds || null, max = opts.max ?? Infinity, taken = [];
      for (const u of units()) {
        if (taken.length >= max) break;
        if (kinds && !kinds.includes(def(u.type).kind) && !(opts.types || []).includes(u.type)) continue;
        if (removeUnit(u)) taken.push(u);
      }
      return { money: cash, items: tally(taken) };
    },
    // Rewards: pockets first, otherwise the item lands at the player's feet.
    give(what = {}) {
      if (what.money) wallet.money += Math.round(what.money);
      for (const g of what.items || []) {
        for (let i = 0; i < (g.n || 1); i++) {
          if (!defs[g.type] || !deps.makeItem) continue;
          const item = deps.makeItem(g.type);
          if (!pockets.add(item) && deps.drop) deps.drop(item);
        }
      }
    },
    // "$45 + 2 food" – one wording for demands everywhere
    describe(req = {}) {
      const parts = [];
      if (req.money) parts.push("$" + Math.round(req.money));
      for (const w of req.items || []) parts.push(`${w.n} ${w.type ? def(w.type).name.toLowerCase() : w.kind}`);
      return parts.join(" + ") || "nothing";
    },
  };
}
