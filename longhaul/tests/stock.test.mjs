// Inventory ledger checks (payments are exact and all-or-nothing). Run:
//   node --import <scratchpad>/tools/node-three-loader.mjs tests/stock.test.mjs
import assert from "node:assert";
import { makeStock } from "../js/stock.js";
import { Pockets } from "../js/pockets.js";
import { ITEMS, makeItem } from "../js/items.js";

function world(money = 100) {
  const wallet = { money }, pockets = new Pockets();
  const vehicle = { id: "v" };
  const props = { list: [], remove(p) { p.dead = true; this.list.splice(this.list.indexOf(p), 1); return p.item; } };
  const interaction = { held: null, consumeHeld() { const h = this.held; this.held = null; return h; } };
  const dropped = [];
  const stock = makeStock({ wallet, pockets, interaction, props, vehicle: () => vehicle, defs: ITEMS, makeItem, drop: (i) => dropped.push(i) });
  const cargo = (type) => props.list.push({ item: makeItem(type), secured: { vehicle } });
  return { wallet, pockets, props, interaction, stock, cargo, dropped };
}
const snap = (w) => JSON.stringify([w.wallet.money, w.pockets.serialize(), w.props.list.map((p) => p.item.type), w.interaction.held && w.interaction.held.type]);

// counts across pockets, hands and cargo
{
  const w = world();
  w.pockets.add(makeItem("beans")); w.pockets.add(makeItem("beans")); w.pockets.add(makeItem("water"));
  w.cargo("jerky"); w.cargo("fuelcan");
  w.interaction.held = makeItem("chips");
  assert.equal(w.stock.count("beans"), 2);
  assert.equal(w.stock.countKind("food"), 4);
  assert.equal(w.stock.countKind("drink"), 1);
}
// insufficient cash or goods: reason given, nothing changes
{
  const w = world(30);
  w.pockets.add(makeItem("beans"));
  const before = snap(w);
  assert.match(w.stock.check({ money: 45 }), /only have \$30/);
  assert.equal(w.stock.pay({ money: 45 }), false);
  assert.match(w.stock.check({ money: 10, items: [{ kind: "food", n: 2 }] }), /only have 1 food/);
  assert.equal(w.stock.pay({ money: 10, items: [{ kind: "food", n: 2 }] }), false);
  assert.equal(snap(w), before, "a failed payment changes nothing");
}
// success takes exactly the request, cargo before pockets
{
  const w = world(100);
  w.pockets.add(makeItem("beans")); w.pockets.add(makeItem("beans"));
  w.cargo("jerky");
  assert.equal(w.stock.check({ money: 45, items: [{ kind: "food", n: 2 }] }), null);
  assert.equal(w.stock.pay({ money: 45, items: [{ kind: "food", n: 2 }] }), true);
  assert.equal(w.wallet.money, 55);
  assert.equal(w.props.list.length, 0, "cargo goes first");
  assert.equal(w.pockets.count("beans"), 1);
  assert.equal(w.stock.pay({ money: 45, items: [{ kind: "food", n: 2 }] }), false, "the same demand cannot be met twice");
  assert.equal(w.wallet.money, 55);
}
// robbery reports exactly what it took
{
  const w = world(81);
  w.pockets.add(makeItem("beans")); w.pockets.add(makeItem("water")); w.pockets.add(makeItem("wrench"));
  w.cargo("jerky"); w.cargo("fuelcan");
  const t = w.stock.strip({ money: 0.5, kinds: ["food", "drink"], max: 2 });
  assert.equal(t.money, 41);
  assert.equal(w.wallet.money, 40);
  assert.equal(t.items.reduce((n, i) => n + i.n, 0), 2);
  assert.equal(w.stock.countKind("food") + w.stock.countKind("drink"), 1);
  assert.equal(w.stock.count("wrench"), 1, "tools are not food");
  assert.equal(w.stock.count("fuelcan"), 1);
}
// rewards
{
  const w = world(0);
  w.stock.give({ money: 25, items: [{ type: "water", n: 2 }, { type: "fuelcan", n: 1 }] });
  assert.equal(w.wallet.money, 25);
  assert.equal(w.pockets.count("water"), 2);
  assert.equal(w.dropped.length, 1, "what does not fit a pocket is dropped at the feet");
  assert.equal(w.stock.describe({ money: 85, items: [{ kind: "food", n: 2 }] }), "$85 + 2 food");
}
console.log("stock ok");
