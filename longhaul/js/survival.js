// Long Haul – the driver's needs: health, hunger, thirst, energy
const clamp = (v) => Math.max(0, Math.min(100, v));

export class Needs {
  constructor() { this.reset(); }

  reset() {
    this.health = 100;
    this.hunger = 85;
    this.thirst = 80;
    this.energy = 90;
    this.cause = null; // what's hurting most, for the game-over screen
  }

  get dead() { return this.health <= 0; }

  // hours: in-game hours passed. ctx: { temp, sprinting, sleeping, rate }
  update(hours, ctx) {
    const r = ctx.rate;
    const slow = ctx.sleeping ? 0.5 : 1;
    const heat = 0.6 + Math.max(0, ctx.temp - 15) / 25;
    this.hunger = clamp(this.hunger - 3 * r * slow * hours);
    this.thirst = clamp(this.thirst - 4.5 * heat * r * slow * hours);
    if (ctx.sleeping) this.energy = clamp(this.energy + 14 * hours);
    else this.energy = clamp(this.energy - (4.2 + (ctx.sprinting ? 9 : 0) + (ctx.temp < 10 ? 1.5 : 0)) * r * hours);

    // Damage when a need runs out
    const hurts = [
      [this.thirst <= 0 ? 8 : 0, "Dehydration"],
      [this.hunger <= 0 ? 5 : 0, "Starvation"],
      [this.energy <= 0 ? 2 : 0, "Exhaustion"],
      [ctx.temp > 40 && this.thirst < 20 ? 2 : 0, "Heatstroke"],
    ];
    let total = 0, worst = 0;
    for (const [dmg, cause] of hurts) {
      total += dmg;
      if (dmg > worst) { worst = dmg; this.cause = cause; }
    }
    if (total > 0) this.health = clamp(this.health - total * hours);
    else if (this.hunger > 40 && this.thirst > 40 && this.energy > 20) this.health = clamp(this.health + 2 * hours);
  }

  hurt(amount, cause) {
    this.health = clamp(this.health - amount);
    if (this.health <= 0) this.cause = cause;
  }

  serialize() {
    const { health, hunger, thirst, energy } = this;
    return { health, hunger, thirst, energy };
  }
  restore(d) { if (d) Object.assign(this, d); }
}
