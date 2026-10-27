// Long Haul – items, inventory, wreck loot
import { rng } from "./world.js";
import { TANK } from "./car.js";

const up = (v, n) => Math.min(100, v + n);
const down = (v, n) => Math.max(0, v - n);

// use(ctx) returns a message; throw a string to refuse
export const ITEMS = {
  water:     { name: "Water bottle",    icon: "💧", price: 4,  desc: "Thirst +35",
    use: ({ needs }) => { needs.thirst = up(needs.thirst, 35); return "Cold enough. Thirst +35"; } },
  beans:     { name: "Canned beans",    icon: "🥫", price: 6,  desc: "Hunger +40",
    use: ({ needs }) => { needs.hunger = up(needs.hunger, 40); needs.thirst = down(needs.thirst, 4); return "Hunger +40"; } },
  jerky:     { name: "Beef jerky",      icon: "🥩", price: 4,  desc: "Hunger +22, a little salty",
    use: ({ needs }) => { needs.hunger = up(needs.hunger, 22); needs.thirst = down(needs.thirst, 8); return "Hunger +22, thirst −8"; } },
  coffee:    { name: "Iced coffee",     icon: "☕", price: 3,  desc: "Energy +22",
    use: ({ needs }) => { needs.energy = up(needs.energy, 22); needs.thirst = up(needs.thirst, 5); return "Wide awake. Energy +22"; } },
  medkit:    { name: "First aid kit",   icon: "🩹", price: 25, desc: "Health +45",
    use: ({ needs }) => { if (needs.health >= 100) throw "You're not hurt"; needs.health = up(needs.health, 45); return "Patched up. Health +45"; } },
  repairkit: { name: "Repair kit",      icon: "🔧", price: 35, desc: "Engine +30, body +30. Use at the truck.",
    use: (ctx) => { atTruck(ctx); const p = ctx.parts; if (p.engine >= 100 && p.body >= 100) throw "The truck doesn't need it";
      p.engine = up(p.engine, 30); p.body = up(p.body, 30); return "Engine and body repaired"; } },
  tyre:      { name: "Spare tyre",      icon: "🛞", price: 40, desc: "Replaces the worst tyre. Use at the truck.",
    use: (ctx) => { atTruck(ctx); const p = ctx.parts, i = p.worstTyre(); if (p.tyres[i] > 90) throw "The tyres are fine";
      p.tyres[i] = 100; p.flat[i] = false; return "Tyre changed"; } },
  coolant:   { name: "Coolant",         icon: "🧪", price: 10, desc: "Refills the radiator. Use at the truck.",
    use: (ctx) => { atTruck(ctx); if (ctx.parts.coolant > 95) throw "The radiator is full"; ctx.parts.coolant = 100; return "Radiator topped up"; } },
  fuelcan:   { name: "Fuel can (10 L)", icon: "⛽", price: 18, desc: "Pour 10 L into the tank. Use at the truck.",
    use: (ctx) => { atTruck(ctx); if (ctx.car.fuel > TANK - 1) throw "The tank is full"; ctx.car.fuel = Math.min(TANK, ctx.car.fuel + 10); return "Poured 10 L into the tank"; } },
  battery:   { name: "Battery pack",    icon: "🔋", price: 22, desc: "Charges the truck battery. Use at the truck.",
    use: (ctx) => { atTruck(ctx); if (ctx.parts.battery > 95) throw "The battery is charged"; ctx.parts.battery = 100; return "Battery charged"; } },
};
export const SHOP_ORDER = ["water", "beans", "jerky", "coffee", "medkit", "coolant", "fuelcan", "battery", "repairkit", "tyre"];

function atTruck(ctx) {
  if (!ctx.nearTruck) throw "You need to be at the truck";
  if (!ctx.truckStopped) throw "Stop the truck first";
}

export class Inventory {
  constructor() { this.items = {}; this.money = 0; }
  count(id) { return this.items[id] || 0; }
  add(id, n = 1) { this.items[id] = this.count(id) + n; }
  use(id, ctx) {
    if (!this.count(id)) return { ok: false, msg: "You don't have any" };
    try {
      const msg = ITEMS[id].use(ctx);
      this.items[id]--;
      if (!this.items[id]) delete this.items[id];
      return { ok: true, msg };
    } catch (e) {
      return { ok: false, msg: String(e) };
    }
  }
  buy(id) {
    const it = ITEMS[id];
    if (this.money < it.price) return { ok: false, msg: "Not enough cash" };
    this.money -= it.price;
    this.add(id);
    return { ok: true, msg: `Bought ${it.name}` };
  }
  serialize() { return { items: { ...this.items }, money: this.money }; }
  restore(d) { if (d) { this.items = { ...d.items }; this.money = d.money; } }
}

// What's in a wreck: decided by the world seed, so it's the same every time
const LOOT = { water: 25, beans: 14, jerky: 14, coffee: 10, coolant: 8, fuelcan: 9, medkit: 5, repairkit: 5, tyre: 4, battery: 5 };
export function lootFor(seed, id) {
  let h = seed >>> 0;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0;
  const rand = rng(h);
  const out = { money: 0, items: [] };
  if (rand() < 0.2) return out; // picked clean
  if (rand() < 0.6) out.money = 3 + Math.floor(rand() * 35);
  const n = 1 + Math.floor(rand() * 3);
  const total = Object.values(LOOT).reduce((a, b) => a + b, 0);
  for (let i = 0; i < n; i++) {
    let t = rand() * total;
    for (const [k, w] of Object.entries(LOOT)) { if ((t -= w) <= 0) { out.items.push(k); break; } }
  }
  return out;
}
