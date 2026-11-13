// Items + pockets. Run: node --import <node-three-loader.mjs> tests/items.test.mjs
import assert from "node:assert";
import { ITEMS, FIXED_IDS, SHOP_STOCK, makeItem, itemLabel, itemMass, useItem, itemsReady, isStateless } from "../js/items.js";
import { Pockets } from "../js/pockets.js";
import { ws } from "../js/core/worldstate.js";

await itemsReady;
const KINDS = ["food", "drink", "med", "tool", "fluid", "part", "misc"];
for (const id of FIXED_IDS) {
  const d = ITEMS[id];
  assert(d, "missing item " + id);
  assert(typeof d.name === "string" && d.name, id + " name");
  assert(typeof d.icon === "string" && d.icon, id + " icon");
  assert(KINDS.includes(d.kind), id + " kind " + d.kind);
  assert(d.mass > 0, id + " mass");
  assert(Array.isArray(d.size) && d.size.length === 3 && d.size.every((v) => v > 0), id + " size");
  assert(typeof d.pocket === "boolean", id + " pocket");
  assert(typeof d.makeMesh === "function", id + " makeMesh");
  const item = makeItem(id);
  assert(item.id && item.type === id);
  const mesh = d.makeMesh(item);
  assert(mesh && mesh.isObject3D, id + " mesh");
  assert(itemLabel(item).startsWith(d.name));
}
for (const [id, cap, fluid] of [["fuelcan", 10, "fuel"], ["jerrycan", 20, "fuel"], ["oil", 1, "oil"], ["oiljug", 4, "oil"], ["coolant", 4, "coolant"], ["waterjug", 4, "water"]]) {
  assert.equal(ITEMS[id].cap, cap); assert.equal(ITEMS[id].unit, "L"); assert.equal(ITEMS[id].fluid, fluid);
  assert.equal(makeItem(id).qty, cap);
}
for (const s of SHOP_STOCK) assert(ITEMS[s.type] && s.price > 0, "shop " + s.type);
assert(new Set([makeItem("water").id, makeItem("water").id, ws.newId()]).size === 3);

// labels
assert.equal(itemLabel({ id: "a", type: "fuelcan", qty: 6 }), "Fuel can · 6.0 / 10 L");
assert(/72%$/.test(itemLabel({ id: "a", type: "wheel_16", cond: 72 })), itemLabel({ id: "a", type: "wheel_16", cond: 72 }));
assert(itemMass({ type: "fuelcan", qty: 10 }) > itemMass({ type: "fuelcan", qty: 0 }) + 7);

// use(): effects and refusals
const needs = { health: 50, hunger: 50, thirst: 50, energy: 50 };
const ctx = { needs };
let r = useItem(ctx, makeItem("water"));
assert(r.ok && r.consumed && needs.thirst === 85);
r = useItem(ctx, makeItem("beans")); assert(r.ok && needs.hunger === 90 && needs.thirst === 81);
r = useItem(ctx, makeItem("coffee")); assert(r.ok && needs.energy === 72);
r = useItem(ctx, makeItem("medkit")); assert(r.ok && needs.health === 100);
r = useItem(ctx, makeItem("medkit")); assert(!r.ok && r.msg === "You're not hurt" && !r.consumed);
r = useItem(ctx, makeItem("bandage")); assert(!r.ok && r.msg === "You're not hurt");
needs.hunger = 100; r = useItem(ctx, makeItem("jerky")); assert(!r.ok && /hungry/.test(r.msg));
needs.thirst = 10;
const jug = makeItem("waterjug");
r = useItem(ctx, jug); assert(r.ok && !r.consumed && jug.qty === 3.5 && needs.thirst === 45);
jug.qty = 0.2; needs.thirst = 10; r = useItem(ctx, jug); assert(r.ok && jug.qty === 0 && needs.thirst === 24);
r = useItem(ctx, jug); assert(!r.ok && /empty/.test(r.msg));
needs.thirst = 0; for (let i = 0; i < 9; i++) useItem(ctx, makeItem("water")); assert(needs.thirst <= 100);
r = useItem(ctx, makeItem("wrench")); assert(!r.ok && !r.consumed);
assert.throws(() => ITEMS.medkit.use({ needs: { health: 100 } }, {}), (e) => e === "You're not hurt");
// notify + sfx routed through ctx
const log = [];
needs.health = 20;
useItem({ needs, notify: (t) => log.push(t), sfx: (n) => log.push(n) }, makeItem("bandage"));
assert(log.length === 2 && needs.health === 38);

// pockets
const p = new Pockets();
assert(!p.add(makeItem("fuelcan")), "not pocketable");
assert(!p.add(makeItem("engine_i6")));
assert(isStateless(makeItem("beans")) && !isStateless(makeItem("oil")));
for (let i = 0; i < 4; i++) assert(p.add(makeItem("beans")));
assert.equal(p.view()[0].count, 4);
assert(p.add(makeItem("beans")), "fifth can starts a second stack");
assert.equal(p.view().filter(Boolean).length, 2);
assert(p.add(makeItem("oil", { qty: 0.4 })) && p.add(makeItem("oil")));
assert.equal(p.view().filter((s) => s && s.type === "oil").length, 2, "stateful items do not stack");
assert(p.add(makeItem("wrench")) && p.add(makeItem("flashlight")));
assert(p.view().every(Boolean) && p.view().length === 6);
assert(!p.add(makeItem("medkit")), "full");
assert(p.add(makeItem("beans")) && p.count("beans") === 6, "still stacks when all slots are used");
assert(p.has("wrench") && !p.has("jack"));
const v = p.view();
assert.deepEqual(Object.keys(v[0]).sort(), ["count", "icon", "name", "qty", "type"]);
assert(v.find((s) => s.type === "oil").qty.includes("/ 1 L"));
p.select(2);
assert.equal(p.selected, 2);
const taken = p.take();
assert(taken && taken.type === "oil" && p.slots[2] === null);
assert(p.add(makeItem("medkit")) && p.slots[2].type === "medkit", "goes to the selected empty slot");
const saved = JSON.parse(JSON.stringify(p.serialize()));
const q = new Pockets(); q.restore(saved);
assert.deepEqual(q.view(), p.view()); assert.equal(q.selected, 2);
assert(q.take(0).type === "beans" && q.count("beans") === 5 && p.count("beans") === 6, "restore copies");
for (let i = 0; i < 6; i++) while (q.take(i));
assert(q.empty && q.take() === null);
q.restore(null); assert(q.empty);
console.log("items ok");
