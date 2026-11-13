// Long Haul – the one authoritative record of how the player has changed the seeded world.
// Everything here is plain JSON-able data. The seed regenerates the untouched world; this stores the differences.
export const ws = {
  counter: 1,
  removed: new Set(),   // ids of seeded spawns (props, containers' contents) no longer at their spawn point
  props: new Map(),     // id → PropRecord for every item that is not sitting at its seeded spawn
  flags: new Map(),     // "door:<id>" → 1 (open), "site:<id>" → 1 (discovered), any other persistent toggle
  vehicles: new Map(),  // id → VehicleRecord for every vehicle that differs from its seeded spawn

  // Stable id for things created during play (bought, crafted, removed from a vehicle…)
  newId(prefix = "U") { return prefix + (this.counter++).toString(36); },

  flag(key) { return this.flags.get(key); },
  setFlag(key, value) { if (value === undefined || value === null || value === 0 || value === false) this.flags.delete(key); else this.flags.set(key, value); },

  reset() { this.counter = 1; this.removed.clear(); this.props.clear(); this.flags.clear(); this.vehicles.clear(); },
  serialize() {
    return { counter: this.counter, removed: [...this.removed], props: [...this.props], flags: [...this.flags], vehicles: [...this.vehicles] };
  },
  restore(d) {
    this.reset();
    if (!d) return;
    this.counter = d.counter || 1;
    (d.removed || []).forEach((id) => this.removed.add(id));
    (d.props || []).forEach(([k, v]) => this.props.set(k, v));
    (d.flags || []).forEach(([k, v]) => this.flags.set(k, v));
    (d.vehicles || []).forEach(([k, v]) => this.vehicles.set(k, v));
  },
};
