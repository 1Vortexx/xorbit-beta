// Each live roadblock owns one saved record. Crew cars are ordinary vehicles and use the same collisions/fuel as the player.
import { ws } from "../core/worldstate.js";
import { emit } from "../core/bus.js";
import { encSeed, encRng, encountersBetween } from "../core/encgen.js";
import { captureEligible } from "./capture.js";
import { feeDemand, settle, costText, cannotPay } from "./demand.js";
import { disableCheck, Pursuer } from "../pursuit/index.js";
import { Barrier } from "./barrier.js";
import { makeComponent } from "../vehicles/components.js";
import { RULES, captureTerms, coords, newBlock, quoteRobbery, relative } from "./rules.js";

export { RULES };
const terminal = new Set(["paid", "complied", "escaped", "released", "dead"]);
const chase = new Set(["mobilizing", "pursuing"]);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class Encounters {
  constructor(ctx) {
    this.ctx = ctx;
    this.crew = [];
    this.cooldown = 0;
    this.dev = { next: () => encountersBetween(ctx.player().pos.z, ctx.player().pos.z + 200000).find(e => e.kind === "roadblock") };
  }
  get active() { return this.rec || null; }
  load(rec) {
    this.rec = rec;
    this.barrier = terminal.has(rec.state) ? null : new Barrier(this.ctx, rec);
    this.crew = rec.drivers.map((saved, i) => {
      const carId = rec.id + ":v" + i;
      const parked = coords(rec, rec.side * 6, i === 0 ? 7 : 16);
      let car = this.ctx.vehicles.get(carId) || this.ctx.vehicles.ensure(carId);
      if (!car) {
        car = this.ctx.vehicles.spawn({ ...parked, id: carId, type: i ? "pickup" : "sedan", pristine: true, seed: encSeed(carId), yaw: rec.yaw });
        // Crew cars run a big-block so they can actually catch a stock Brazos
        car.remove("engine"); car.install("engine", makeComponent("engine_bigblock"));
      }
      const id = rec.id + ":p" + i;
      // Start beside the driver's door, giving the crew a short and unobstructed run back to the car.
      const start = i === 0 ? coords(rec, rec.side * 5.2, -3) : car.doorSpot("driver");
      const npc = this.ctx.npcs.spawn({ ...start, id, seed: encSeed(id), yaw: rec.yaw + Math.PI, role: i ? "guard" : "leader" });
      if (rec.people[i]) npc.restore(rec.people[i]);
      if (saved.onFoot) npc.follow(() => this.ctx.player().pos, { run: true, keep: 1.2 });
      car.pinned = true;
      if (!chase.has(rec.state) && car.seats.driver !== "player") car.parkingBrake = true;
      return { car, npc, saved, ai: null };
    });
    if (rec.state === "negotiating") rec.state = "challenged";
  }
  unload() {
    if (!this.rec) return;
    this.flush();
    for (const { npc, car, ai } of this.crew) {
      ai?.dispose();
      car.pinned = false;
      if (terminal.has(this.rec.state) && car.seatOf(npc.id) === "driver") car.releaseSeat("driver");
      this.ctx.npcs.remove(npc);
    }
    this.crew = [];
    this.barrier?.dispose(); this.barrier = null;
    this.rec = null;
  }
  clear() { this.unload(); this.cooldown = 0; this.result = null; }
  dispose() { this.clear(); }
  flush() {
    if (!this.rec) return;
    this.rec.people = this.crew.map(c => c.npc.serialize());
    for (const c of this.crew) if (c.ai) c.saved.ai = c.ai.serialize();
  }
  focusPoints(out = []) {
    if (this.rec && chase.has(this.rec.state)) for (const { car, saved } of this.crew) if (!saved.disabled) out.push(car.pos);
    return out;
  }
  colliders(x, z, r, out = []) {
    for (const c of this.barrier?.solids || []) if (c.solid && Math.abs(c.x - x) < r + 2 && Math.abs(c.z - z) < r + 2) out.push(c);
    return out;
  }
  find(p) {
    // Rejoin a chase first, including one saved while far from its original roadblock.
    for (const rec of ws.enc.values()) if (rec.kind === "roadblock" && chase.has(rec.state)) return rec;
    // A crew which stood down still exists at its saved location. Restore its people along with any occupied seats.
    for (const rec of ws.enc.values()) if (rec.kind === "roadblock" && terminal.has(rec.state) &&
      rec.people.some(n => n.pos && Math.hypot(n.pos[0] - p.x, n.pos[2] - p.z) < 65)) return rec;
    const site = encountersBetween(p.z - RULES.load, p.z + RULES.load).find(e => e.kind === "roadblock" && distance(e, p) < RULES.load);
    if (!site) return;
    let rec = ws.enc.get(site.id);
    if (!rec) {
      rec = newBlock(site, this.ctx.diff(), this.ctx.progress());
      if (!this.ctx.hostile()) {
        rec.type = "peaceful";
        rec.demand = feeDemand(encRng(site.id + ":donation"));
      }
      ws.enc.set(rec.id, rec);
    }
    if (!terminal.has(rec.state)) return rec;
  }
  update(dt, { talk = false } = {}) {
    const p = this.ctx.player();

    if (!this.rec) {
      this.cooldown -= dt;
      if (this.cooldown > 0) return;
      this.cooldown = .4;
      const rec = this.find(p.pos);
      if (rec) this.load(rec);
      else return;
    }
    const r = this.rec;
    if (terminal.has(r.state)) {
      for (const c of this.crew) if (c.npc.seat && Math.abs(c.car.speed) < 1) c.npc.exitVehicle();
      if (this.crew.every(c => distance(c.npc.pos, p.pos) > 75)) this.unload();
      return;
    }
    if (!chase.has(r.state) && distance(p.pos, r) > RULES.load + 65) { this.unload(); return; }
    if (chase.has(r.state)) { this.pursue(dt, p); return; }
    const { along, across } = relative(r, p.pos);
    if (r.state === "spotted" && Math.abs(along) <= RULES.challenge && Math.abs(across) <= 18) {
      r.approach = Math.sign(along) || -1;
      r.state = "challenged";
      const leader = this.crew[0].npc;
      leader.lookAt(p.pos); leader.threaten(r.type === "robbery");
      if (r.type === "peaceful") leader.say("You're welcome through. Stop if you can spare some change.");
      else {
        leader.say(r.type === "robbery" ? "Stop there. Hand over the goods." : "Pull up. There's a toll for this stretch.");
        if (r.type !== "robbery") this.ctx.sfx("threat", { pos: leader.pos });
      }
    }
    if (r.state !== "challenged" && r.state !== "refused") return;
    if (r.type === "peaceful" && Math.abs(along) < 20) {
      this.barrier?.dispose(); this.barrier = null;
    }
    if (along * r.approach < 0) {
      if (r.type === "peaceful") { r.state = "paid"; this.finish("Safe passage", "The road is clear."); return; }
      r.state = "mobilizing"; r.elapsed = 0;
      for (const c of this.crew) { c.npc.hostile = true; c.npc.enterVehicle(c.car, "driver"); }
      this.ctx.sfx("pursuit_alert"); this.ctx.notify("They’re making for their cars.", { level: "warn" });
    } else if (along * r.approach > RULES.retreat) {
      r.state = "spotted"; this.crew[0].npc.threaten(false);
    } else if (talk && this.canTalk(p)) this.negotiate();
  }
  canTalk(p) { return distance(this.crew[0].npc.pos, p.pos) < 16 && Math.abs(p.speed) < RULES.negotiateSpeed; }
  negotiate() {
    const r = this.rec, ctx = this.ctx, robbery = r.type === "robbery";
    const leader = this.crew[0].npc;
    r.state = "negotiating";
    if (robbery) quoteRobbery(r, ctx.stock);
    const cost = costText(r.demand);
    const friendly = r.type === "peaceful";
    ctx.dialogue({
      speaker: leader.name, role: friendly ? "Road volunteer" : robbery ? "Roadside robber" : "Toll keeper",
      lines: [friendly ? "We keep this stretch clear. Spare a few dollars?" : robbery ? "Leave the supplies here and nobody gets hurt." : "Pay the toll and we’ll clear the lane."],
      note: friendly ? "Donations are optional. The road is open." : "You can turn back. Cross the line without paying and they'll give chase.",
      choices: [
        { id: "pay", label: friendly ? "Make a donation" : robbery ? "Hand it over" : "Pay toll", cost, disabled: cannotPay(ctx.stock, r.demand) },
        { id: "back", label: friendly ? "Continue for free" : "Refuse and leave" },
      ],
      onChoose: id => {
        if (this.rec !== r || r.state !== "negotiating") return;
        if (id === "pay" && settle(r, ctx.stock, ctx.now()).ok) {
          r.state = robbery ? "complied" : "paid";
          leader.threaten(false); leader.say("Go on through.");
          ctx.sfx("pay"); this.finish("Safe passage", "The crew has opened the road.");
        } else if (friendly) { r.state = "paid"; this.finish("Safe passage", "The road is clear."); }
        else { r.state = "refused"; leader.say("Turn around, then."); }
      },
    });
  }
  driver(c, p, dt) {
    const { npc, car, saved } = c;
    if (saved.disabled) return;
    const damage = c.ai && npc.state === "sit" ? null : disableCheck(car);
    if (damage || npc.state === "down" || (!c.ai && car.seats.driver === "player")) {
      saved.disabled = damage || (npc.state === "down" ? "driver incapacitated" : "vehicle taken");
      c.ai?.dispose(); c.ai = null;
      if (npc.seat && Math.abs(car.speed) < 1) npc.exitVehicle();
      return;
    }
    if (!c.ai && npc.seat?.vehicle === car.id && npc.state === "sit") {
      c.ai = new Pursuer({ id: car.id, vehicle: car, seed: encSeed(car.id + ":ai"), diff: this.ctx.diff(),
        getColliders: this.ctx.getColliders, getVehicles: () => this.ctx.vehicles.list });
      c.ai.setTarget(() => this.ctx.player());
      if (saved.ai) c.ai.restore(saved.ai);
      if (!car.running && car.ign !== "cranking") car.toggleIgnition();
    }
    if (saved.onFoot) {
      if (this.canCapture(npc, p)) {
        this.capture(npc); return;
      }
      if (distance(npc.pos, p.pos) > 12 && distance(npc.pos, car.pos) < distance(npc.pos, p.pos)) {
        if (npc.enterVehicle(car, "driver")) { saved.onFoot = false; saved.returning = true; }
      } else if (npc.state !== "pursue") npc.follow(() => this.ctx.player().pos, { run: true, keep: 1.2 });
      return;
    }
    if (saved.returning && npc.state !== "sit") {
      if (!npc.seat) { saved.returning = false; saved.onFoot = true; }
      return;
    }
    saved.returning = false;
    if (!c.ai) {
      if (!npc.seat && npc.state !== "enter") npc.enterVehicle(car, "driver");
      return;
    }
    if (npc.seat && Math.abs(car.speed) < 1 && Math.abs(p.speed) < RULES.capture.speed && distance(car.pos, p.pos) < 11) {
      if (npc.exitVehicle()) {
        saved.onFoot = true; car.ai = null; car.parkingBrake = true;
        npc.follow(() => this.ctx.player().pos, { run: true, keep: 1.2 });
        return;
      }
    }
    car.parkingBrake = false;
    c.ai.update(dt);
    if (!c.ai.canContinue) {
      saved.disabled = c.ai.disabledReason || "wrecked";
      c.ai.dispose(); c.ai = null;
      if (Math.abs(car.speed) < 1) npc.exitVehicle();
      this.ctx.notify("Pursuer disabled: " + saved.disabled, { level: "info" });
    }
  }
  canCapture(npc, p) {
    if (distance(npc.pos, p.pos) > RULES.capture.dist || Math.abs(p.speed) >= RULES.capture.speed) return false;
    const blockers = this.ctx.getColliders(npc.pos.x, npc.pos.z, 8).filter(c => !c.npc && (!p.vehicle || c.vehicle !== p.vehicle));
    return captureEligible({ state: this.rec.state, playerSpeed: p.speed, playerPos: p.pos, now: this.ctx.now(),
      graceUntil: this.rec.graceUntil, members: [{ pos: npc.pos, hostile: npc.hostile, onFoot: !npc.seat, down: npc.state === "down" }],
      colliders: blockers.filter(c => !(c.y0 > npc.pos.y + 1.6 || c.y1 < npc.pos.y + .5)) }).ok;
  }
  pursue(dt, p) {
    const r = this.rec;
    r.elapsed += dt;
    if (r.state === "mobilizing" && r.elapsed < RULES.mobilize) return;
    r.state = "pursuing";
    for (const c of this.crew) {
      this.driver(c, p, dt);
      if (r.state !== "pursuing") return;
    }
    if (this.crew.every(c => c.saved.disabled)) {
      r.state = "escaped";
      this.finish("Escaped", "Every pursuit vehicle is disabled.");
      this.ctx.sfx("pursuit_end");
    }
  }
  capture(npc) {
    const r = this.rec, ctx = this.ctx;
    if (r.state !== "pursuing") return;
    const p = ctx.player();
    if (p.vehicle && !ctx.ejectPlayer()) return;
    r.capture ||= captureTerms(r.id, ctx.diff(), ctx.stock.money);
    const t = r.capture;
    r.state = "released"; r.graceUntil = ctx.now() + RULES.releaseGrace;
    let text;
    if (t.outcome === "killed") {
      ctx.needs.hurt(100, "Killed by a roadblock crew");
    } else if (t.outcome === "robbed") {
      const loot = ctx.stock.strip({ money: .8, kinds: ["food", "drink"], max: 6 });
      text = 'They took $' + loot.money + ' and ' + loot.items.reduce((sum, it) => sum + it.n, 0) + ' supplies.';
    } else if (t.outcome === "ransom" && ctx.stock.pay({ money: t.ransom })) {
      text = 'They took $' + t.ransom + ' for your release.';
    } else {
      npc.strike(); ctx.sfx("punch", { pos: npc.pos });
      const damage = Math.round(t.blows.reduce((sum, blow) => sum + blow, 0));
      ctx.needs.hurt(damage, "Beaten by a roadblock crew");
      text = 'The beating cost you ' + damage + ' health.';
    }
    if (ctx.needs.health <= 0) {
      r.state = "dead";
      this.flush();
      ctx.kill(ctx.needs.cause || "Killed by a roadblock crew", [["Encounter", r.type], ["Roadblock", r.id]]);
      return;
    }
    ctx.releasePlayer(ctx.player().pos);
    this.finish("Released", text);
  }
  finish(title, text) {
    this.barrier?.dispose(); this.barrier = null;
    for (const c of this.crew) {
      c.ai?.dispose(); c.ai = null; c.npc.hostile = false;
      if (c.npc.seat && Math.abs(c.car.speed) < 1) c.npc.exitVehicle();
      c.npc.idle();
    }
    this.result = { title, text, until: this.ctx.now() + 6 };
    this.ctx.notify(text);
    emit("encounter:end", { state: this.rec.state });
  }
  hud() {
    const r = this.rec;
    if (this.result && this.ctx.now() < this.result.until) return { ...this.result, level: "info" };
    if (!r || terminal.has(r.state)) return null;
    if (chase.has(r.state)) {
      const able = this.crew.filter(c => !c.saved.disabled).length;
      return { title: r.state === "mobilizing" ? "Roadblock breached" : "In pursuit", text: "Wreck or disable the pursuing cars to escape.", level: "crit", pursuers: { able, total: this.crew.length } };
    }
    const canTalk = r.state !== "spotted" && this.canTalk(this.ctx.player());
    if (r.type === "peaceful") return { title: "Roadside checkpoint", text: "Pass through for free or stop to donate.", level: "info",
      prompt: canTalk ? "Talk to the road volunteer" : null };
    return { title: r.state === "spotted" ? "Roadblock ahead" : r.type === "robbery" ? "Hold-up" : "Road toll",
      text: r.state === "spotted" ? "Strangers have blocked the road." : "Stop near the leader to negotiate, turn back, or break through.",
      level: "warn", prompt: canTalk ? "Talk to the roadblock leader" : null };
  }
}
