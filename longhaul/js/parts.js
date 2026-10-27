// Long Haul – truck condition: engine, tyres, cooling, battery, body
import { onRoad } from "./world.js";

const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
export const OVERHEAT = 115, CUTOUT = 128;

export class Parts {
  constructor() { this.reset(); }

  reset() {
    this.engine = 100;
    this.body = 100;
    this.tyres = [100, 100, 100, 100];
    this.flat = [false, false, false, false];
    this.coolant = 100;
    this.battery = 100;
    this.temp = 70;          // °C
    this.running = false;
    this.crank = 0;          // seconds left in a start attempt
    this.event = null;       // message for the HUD, read once
  }

  // Try to start the engine (when you get in, or press W after a stall)
  tryStart(fuel) {
    if (this.running || this.crank > 0) return;
    if (this.battery < 6) { this.event = "Battery's dead. The engine won't turn over."; return; }
    this.battery -= 3;
    this.crank = 0.9;
    this._fuel = fuel;
  }

  stop() { this.running = false; this.crank = 0; }

  canRun(fuel) { return fuel > 0 && this.engine > 0 && this.temp < CUTOUT; }

  // env: { ambient, sand (0..1), wear (difficulty), lights, throttle, handbrake }
  update(dt, car, env) {
    const sp = Math.abs(car.speed);
    const dKm = (sp * dt) / 1000;
    const wear = env.wear;

    // Starting
    if (this.crank > 0) {
      this.crank -= dt;
      if (this.crank <= 0) {
        const chance = this.engine <= 0 ? 0 : 0.5 + this.engine / 200;
        if (this.canRun(car.fuel) && Math.random() < chance) this.running = true;
        else this.event = car.fuel <= 0 ? "No fuel. The engine won't start." : this.engine <= 0 ? "The engine is wrecked. It needs a repair kit." : "The engine coughed but didn't catch. Try again.";
      }
    }
    if (this.running && !this.canRun(car.fuel)) {
      this.running = false;
      this.event = car.fuel <= 0 ? "Out of fuel" : this.temp >= CUTOUT ? "The engine overheated and cut out" : "The engine died";
    }
    // Worn engines stall now and then
    if (this.running && this.engine < 35 && Math.random() < ((35 - this.engine) / 35) * 0.015 * dt) {
      this.running = false;
      this.event = "The engine stalled. Press W to restart.";
    }

    // Cooling
    const heat = this.running ? 0.6 + env.throttle * 1.6 + env.sand * 0.4 : 0;
    const cool = (0.15 + (this.coolant / 100) * (1.05 + (sp / 36))) * Math.max(0, this.temp - env.ambient) / 60;
    this.temp = Math.max(env.ambient, this.temp + (heat - cool) * 8 * dt);
    if (this.temp > OVERHEAT) this.engine = clamp(this.engine - (this.temp - OVERHEAT) * 0.06 * dt);

    // Wear
    this.engine = clamp(this.engine - dKm * 0.05 * wear * (1 + env.sand * 2 + (this.temp > 105 ? 1 : 0)));
    this.coolant = clamp(this.coolant - dKm * (0.25 + (this.body < 40 ? 1.2 : 0)) * wear);
    const paved = onRoad(car.pos.x, car.pos.z);
    for (let i = 0; i < 4; i++) {
      if (this.flat[i]) continue;
      const rate = (paved ? 0.3 : 1.1) * (env.handbrake && i >= 2 && sp > 3 ? 4 : 1);
      this.tyres[i] = clamp(this.tyres[i] - dKm * rate * wear);
      if (this.tyres[i] < 25 && Math.random() < ((25 - this.tyres[i]) / 25) * 0.4 * dKm) this.puncture(i);
    }

    // Battery: charges while running, drains with the lights on otherwise
    if (this.running) this.battery = clamp(this.battery + 1.5 * dt);
    else if (env.lights) this.battery = clamp(this.battery - 0.12 * dt);
  }

  puncture(i) {
    if (this.flat[i]) return;
    this.flat[i] = true;
    this.tyres[i] = 0;
    this.event = `Flat tyre (${["front left", "front right", "rear left", "rear right"][i]})`;
  }

  // Crash damage. Returns how hard it was (for the driver's health)
  impact(sev) {
    if (sev < 1) return 0;
    this.body = clamp(this.body - sev * 1.2);
    this.engine = clamp(this.engine - sev * 0.45);
    this.coolant = clamp(this.coolant - sev * 0.5);
    const t = (Math.random() * 4) | 0;
    this.tyres[t] = clamp(this.tyres[t] - sev * 0.8);
    if (sev > 18 && Math.random() < 0.35) this.puncture(t);
    if (sev > 6) this.event = sev > 25 ? "That was a bad crash" : "Crunch. The truck took some damage.";
    return sev;
  }

  // What the truck's condition does to the driving
  mods(wet) {
    const power = this.running ? (0.45 + 0.55 * Math.min(1, this.engine / 60)) * (this.temp > OVERHEAT ? 0.7 : 1) : 0;
    return {
      power,
      grip: this.tyres.map((t, i) => (this.flat[i] ? 0.45 : 0.62 + 0.38 * (t / 100))),
      flat: this.flat,
      wet: 1 - wet * 0.22,
      leak: this.body < 35 ? ((35 - this.body) / 35) * 0.004 : 0,
    };
  }

  worstTyre() {
    let w = 0;
    for (let i = 1; i < 4; i++) if (this.tyres[i] < this.tyres[w]) w = i;
    return w;
  }

  serialize() {
    const { engine, body, tyres, flat, coolant, battery, temp, running } = this;
    return { engine, body, tyres, flat, coolant, battery, temp, running };
  }
  restore(d) {
    if (!d) return;
    Object.assign(this, d, { tyres: [...d.tyres], flat: [...d.flat], crank: 0, event: null });
  }
}
