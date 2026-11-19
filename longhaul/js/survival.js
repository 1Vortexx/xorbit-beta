// Long Haul – the driver's needs: health, hunger, thirst, energy.
// Tuned so a day (20 real minutes) asks for roughly two meals, three drinks and one sleep – driving and
// exploring should fill the time, not meter-watching.
const clamp = (v) => Math.max(0, Math.min(100, v));

// Below this much health you can't stand and have to crawl; you get back up once you've healed past STAND_AT
export const CRAWL_BELOW = 25, STAND_AT = 35;

// Health lost in a crash of this severity (vehicle impact units: (closing speed m/s − 2.5) × 2.2). Bumps sting; past
// about 70 km/h into something solid it gets serious fast: about 45 at 100 km/h, 85 at 130, fatal from about 150.
export function crashInjury(sev) {
  const kmh = (sev / 2.2 + 2.5) * 3.6, t = Math.max(0, Math.min(1, (kmh - 70) / 100));
  return sev * 0.45 + 100 * Math.pow(t, 1.3);
}
// Health lost landing at this speed (m/s) on foot: a jump never hurts, a roof hurts, a cliff kills
export function fallInjury(speed) { return speed > 11 ? (speed - 11) * 7 : 0; }

export class Needs {
  constructor() { this.reset(); }

  reset() {
    this.health = 100;
    this.hunger = 85;
    this.thirst = 85;
    this.energy = 90;
    this.cause = null; // what's hurting most, for the game-over screen
  }

  get dead() { return this.health <= 0; }

  // hours: in-game hours passed. ctx: { temp, sprinting, sleeping, shade (in a cab or indoors), rate }
  update(hours, ctx) {
    if (this.dead) return;          // nothing brings you back: healing here used to lift a fatal blow off zero before
                                    // main.js checked for death, so you could never die
    const r = ctx.rate;
    const slow = ctx.sleeping ? 0.45 : 1;
    const heat = 0.7 + Math.max(0, ctx.temp - 18) / 30 * (ctx.shade ? 0.6 : 1);
    this.hunger = clamp(this.hunger - 2.1 * r * slow * hours);
    this.thirst = clamp(this.thirst - 2.9 * heat * r * slow * hours * (ctx.sprinting ? 1.6 : 1));
    if (ctx.sleeping) this.energy = clamp(this.energy + 13 * hours);
    else this.energy = clamp(this.energy - (3.6 + (ctx.sprinting ? 7 : 0) + (ctx.temp < 8 ? 1.2 : 0)) * r * hours);

    // Damage when a need runs out
    const hurts = [
      [this.thirst <= 0 ? 7 : 0, "Dehydration"],
      [this.hunger <= 0 ? 4 : 0, "Starvation"],
      [this.energy <= 0 ? 1.5 : 0, "Exhaustion"],
      [ctx.temp > 41 && this.thirst < 15 && !ctx.shade ? 2 : 0, "Heatstroke"],
    ];
    let total = 0, worst = 0;
    for (const [dmg, cause] of hurts) {
      total += dmg;
      if (dmg > worst) { worst = dmg; this.cause = cause; }
    }
    if (total > 0) this.health = clamp(this.health - total * hours);
    else if (this.hunger > 35 && this.thirst > 35 && this.energy > 15) this.health = clamp(this.health + 2.5 * hours);
  }

  // Sudden damage (crashes, blows, knives). onHurt(amount, cause), if set, hears about each one (the HUD flashes).
  hurt(amount, cause) {
    this.health = clamp(this.health - amount);
    if (this.health <= 0) this.cause = cause;
    if (amount > 0 && this.onHurt) this.onHurt(amount, cause);
  }

  serialize() {
    const { health, hunger, thirst, energy } = this;
    return { health, hunger, thirst, energy };
  }
  restore(d) {
    if (!d) return;
    for (const k of ["health", "hunger", "thirst", "energy"]) if (typeof d[k] === "number" && isFinite(d[k])) this[k] = clamp(d[k]);
  }
}
