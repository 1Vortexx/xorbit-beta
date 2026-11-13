// Long Haul – pockets: 6 quick slots for `pocket: true` items.
// Identical stateless items (a can of beans) stack up to def.stack; stateful ones (an oil bottle with a quantity)
// take a slot on their own. Plain data, no THREE – importable in Node.
import { ITEMS, isStateless, qtyText } from "./items.js";

export const SLOTS = 6;
const DEFAULT_STACK = 4;

export class Pockets {
  constructor() {
    this.slots = new Array(SLOTS).fill(null);   // null | { type, items: ItemInstance[] }
    this.selected = 0;
  }
  limit(type) { return ITEMS[type]?.stack || DEFAULT_STACK; }

  canAdd(item) {
    const def = ITEMS[item.type];
    if (!def || !def.pocket) return false;
    if (isStateless(item) && this.slots.some((s) => s && s.type === item.type && s.stack && s.items.length < this.limit(item.type))) return true;
    return this.slots.includes(null);
  }
  // Returns false when the item is not pocketable or there is no room
  add(item) {
    const def = ITEMS[item.type];
    if (!def || !def.pocket) return false;
    const stackable = isStateless(item);
    if (stackable) {
      const s = this.slots.find((s) => s && s.type === item.type && s.stack && s.items.length < this.limit(item.type));
      if (s) { s.items.push(item); return true; }
    }
    // prefer the selected slot when it is empty, otherwise the first free one
    const i = this.slots[this.selected] === null ? this.selected : this.slots.indexOf(null);
    if (i < 0) return false;
    this.slots[i] = { type: item.type, stack: stackable, items: [item] };
    return true;
  }
  // Look at the item a take() would return
  peek(slot = this.selected) {
    const s = this.slots[slot];
    return s ? s.items[s.items.length - 1] : null;
  }
  // Remove and return one item from a slot (default: the selected one); null when empty
  take(slot = this.selected) {
    const s = this.slots[slot];
    if (!s) return null;
    const item = s.items.pop();
    if (!s.items.length) this.slots[slot] = null;
    return item;
  }
  find(type) { return this.slots.findIndex((s) => s && s.type === type); }
  has(type) { return this.find(type) >= 0; }
  count(type) { return this.slots.reduce((n, s) => n + (s && s.type === type ? s.items.length : 0), 0); }
  // Remove one item of a type (tools consumed by another system); null when there is none
  takeType(type) { const i = this.find(type); return i < 0 ? null : this.take(i); }
  select(i) { if (i >= 0 && i < SLOTS) this.selected = i; return this.selected; }
  get empty() { return this.slots.every((s) => !s); }
  all() { return this.slots.flatMap((s) => (s ? s.items : [])); }

  // HUD: [{ icon, name, count, qty, type } | null ×6]. qty is a ready-made string ("0.6 / 1 L") or null.
  view() {
    return this.slots.map((s) => {
      if (!s) return null;
      const def = ITEMS[s.type] || { icon: "?", name: s.type };
      return { icon: def.icon, name: def.name, count: s.items.length, qty: qtyText(s.items[s.items.length - 1]), type: s.type };
    });
  }
  serialize() {
    return { selected: this.selected, slots: this.slots.map((s) => (s ? { type: s.type, items: s.items.map((i) => ({ ...i })) } : null)) };
  }
  restore(d) {
    this.slots.fill(null);
    this.selected = 0;
    if (!d) return;
    this.selected = Math.max(0, Math.min(SLOTS - 1, d.selected | 0));
    (d.slots || []).slice(0, SLOTS).forEach((s, i) => {
      if (!s || !s.items || !s.items.length || !ITEMS[s.type]) return;
      const items = s.items.map((it) => ({ ...it }));
      this.slots[i] = { type: s.type, stack: items.every(isStateless), items };
    });
  }
}
