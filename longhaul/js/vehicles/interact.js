// Long Haul – interaction targets of a vehicle (doors, hood, fillers, wheels, components, cargo floor).
// pourInto() is pure logic (used by tests); registerTargets() wires the rig's meshes into js/core/targets.js.
import { addTarget, addOccluder, removeAllUnder } from "../core/targets.js";
import { sfx, notify } from "../core/bus.js";
import { COMPONENT_ITEMS, FLUID_ITEMS, fitProblem, partNote } from "./components.js";
import { WHEEL_SLOTS, SLOT_LABEL } from "./defs.js";
import { batteryCharge } from "./powertrain.js";

export const POUR_RATE = { fuel: 1.5, oil: 0.25, coolant: 0.8 };   // litres per second
const ACCEPTS = { fuel: ["fuel"], oil: ["oil"], coolant: ["coolant", "water"] };
const TIMES = { engine: [6, 6], battery: [2.5, 2.5], radiator: [4, 4], wheel: [4, 3] };   // [remove, install] seconds

// Why `item` cannot be poured into `port` of the vehicle (null = fine)
export function pourProblem(v, item, port) {
  const info = item && FLUID_ITEMS[item.type];
  if (!info || !ACCEPTS[port].includes(info.fluid)) return port === "fuel" ? "Needs a fuel can" : port === "oil" ? "Needs engine oil" : "Needs coolant or water";
  if ((item.qty ?? info.cap) <= 0) return "That container is empty";
  if (port === "coolant" && !v.slots.radiator) return "There is no radiator";
  if (port === "oil" && !v.slots.engine) return "There is no engine";
  const d = v.def;
  const room = port === "fuel" ? d.tank - v.fuel : port === "oil" ? d.oilCap - v.oil : d.coolantCap - v.coolant;
  if (room <= 1e-6) return port === "fuel" ? "The tank is full" : port === "oil" ? "The oil is at the full mark" : "The radiator is full";
  return null;
}

// Move up to rate·dt litres from the container instance into the vehicle. Returns false when nothing (more) can be
// poured, otherwise the fill level 0..1 of what is being filled. Litres are conserved exactly.
export function pourInto(v, item, port, dt) {
  if (pourProblem(v, item, port)) return false;
  const info = FLUID_ITEMS[item.type];
  if (item.qty === undefined) item.qty = info.cap;
  const took = v.addFluid(info.fluid, Math.min(POUR_RATE[port] * dt, item.qty));
  if (!(took > 0)) return false;
  item.qty -= took;
  if (item.qty < 1e-9) item.qty = 0;
  const d = v.def;
  return port === "fuel" ? v.fuel / d.tank : port === "oil" ? v.oil / d.oilCap : v.coolant / d.coolantCap;
}

const hasTool = (ctx, type) => ctx.held?.type === type || !!ctx.hasTool?.(type);
const say = (ctx, text, level) => (ctx.notify || notify)(text, { level: level || "info", key: "veh:act" });
const play = (ctx, name, v) => (ctx.sfx || sfx)(name, { pos: v.pos });
const pct = (x) => Math.round(x) + "%";

function pourAction(v, ctx, port, label) {
  const why = pourProblem(v, ctx.held, port);
  if (why) return { key: "use", label, blocked: why };
  return {
    key: "use", label,
    tick(c, dt) {
      const item = c.held;
      if (!item) return false;
      const p = pourInto(v, item, port, dt);
      if (p === false) { if (v._pourT > 0) { v._pourT = 0; play(c, "pour_stop", v); } return false; }
      if (!(v._pourT > 0)) play(c, "pour_start", v);
      v._pourT = 0.25;       // vehicle.update() plays pour_stop when ticks stop arriving
      return p;
    },
  };
}

// Give a removed part to the player: hands first, otherwise drop it beside the vehicle
function handOver(v, ctx, item, lx, lz) {
  if (ctx.giveHeld && ctx.giveHeld(item)) return;
  const p = v.localToWorld(lx, 0.3, lz);
  if (ctx.dropItem) ctx.dropItem(item, p);
}

function slotActions(v, ctx, slot, kind, side) {
  const item = v.slots[slot], out = [];
  const tool = kind === "wheel" ? "jack" : "wrench";
  const [tOut, tIn] = TIMES[kind];
  const noun = kind === "wheel" ? "wheel" : kind;
  const busy = Math.abs(v.speed) > 0.5 ? "The vehicle is moving" : kind !== "wheel" && v.ign !== "off" ? "Switch the engine off first" : kind === "engine" && v.temp > 95 ? "Too hot to touch. Let it cool." : null;
  if (item) {
    const a = { key: "use", label: `Remove ${noun}`, hold: tOut };
    if (!hasTool(ctx, tool)) a.blocked = tool === "jack" ? "Needs a jack" : "Needs a wrench";
    else if (busy) a.blocked = busy;
    else if (ctx.held && ctx.held.type !== tool) a.blocked = "Your hands are full";
    else a.run = (c) => {
      const it = v.remove(slot);
      if (!it) return;
      play(c, kind === "wheel" ? "wheel_fit" : "ratchet", v);
      handOver(v, c, it, side * (v.def.halfW + 0.7), kind === "wheel" ? v.def.wheels[WHEEL_SLOTS.indexOf(slot)].z : v.def.zFront + 0.6);
      if (slot === "radiator") say(c, "The coolant drains onto the ground.", "warn");
    };
    out.push(a);
    if (kind === "engine" && ctx.held?.type === "repairkit") {
      out.push({ key: "alt", label: "Repair engine", hold: 5, blocked: item.cond >= 99 ? "The engine is fine" : busy || undefined,
        run(c) { c.consumeHeld(); v.repair(40, "engine"); play(c, "ratchet", v); say(c, `Engine patched up: ${pct(v.slots.engine.cond)}`, "good"); } });
    }
  } else {
    const held = ctx.held, def = held && COMPONENT_ITEMS[held.type];
    const a = { key: "use", label: `Fit ${noun}`, hold: tIn };
    if (!def || def.slot !== kind) a.blocked = `Needs ${kind === "engine" ? "an engine" : "a " + noun} in your hands`;
    else if (fitProblem(v.type, slot, held)) a.blocked = fitProblem(v.type, slot, held);
    else if (!(ctx.hasTool ? ctx.hasTool(tool) : true)) a.blocked = tool === "jack" ? "Needs a jack" : "Needs a wrench";
    else if (busy) a.blocked = busy;
    else a.run = (c) => {
      const it = c.held;
      if (!it || fitProblem(v.type, slot, it)) return;
      c.consumeHeld();
      const why = v.install(slot, it);
      if (why) { handOver(v, c, it, side * (v.def.halfW + 0.7), 0); say(c, why, "warn"); return; }
      play(c, kind === "wheel" ? "wheel_fit" : "ratchet", v);
      say(c, `${COMPONENT_ITEMS[it.type].name} fitted.`, "good");
    };
    out.push(a);
  }
  return out;
}

function slotInfo(v, slot) {
  const item = v.slots[slot];
  if (!item) return { note: "missing" };
  return { cond: Math.round(item.cond ?? 100), note: partNote(item) };
}

// rig.parts: { doors: {name: Object3D}, fuelCap, oilCap, dipstick, radCap, hubs: [Object3D ×4], bays: {engine, battery, radiator},
//              cargo, shell: Object3D }
export function registerTargets(v, rig) {
  const P = rig.parts, d = v.def, id = (s) => `${v.id}:${s}`;
  addOccluder(v.mesh);

  const doorActs = (name, label, getIn) => (ctx) => {
    const open = v.doorTarget[name] > 0.5;
    const acts = [{ key: "use", label: `${open ? "Close" : "Open"} ${label}`, run: () => v.toggleDoor(name) }];
    if (getIn) acts.push({ key: "alt", label: "Get in", blocked: ctx.enterVehicle ? undefined : "Cannot get in", run: (c) => c.enterVehicle?.(v) });
    return acts;
  };
  addTarget(P.doors.driver, { id: id("door:driver"), name: () => `${d.name} – driver door`, reach: 2.8, actions: doorActs("driver", "door", true) });
  addTarget(P.doors.passenger, { id: id("door:passenger"), name: () => `${d.name} – passenger door`, reach: 2.8, actions: doorActs("passenger", "door", true) });
  addTarget(P.doors.hood, {
    id: id("hood"), name: "Hood", reach: 2.8,
    info: () => ({ cond: Math.round(v.bodyCond), note: v.bodyCond < 35 ? "body damaged, leaking fuel" : v.bodyCond < 70 ? "body dented" : "body sound" }),
    actions: (ctx) => {
      const acts = doorActs("hood", "hood", false)(ctx);
      if (ctx.held?.type === "repairkit") acts.push({ key: "alt", label: "Repair bodywork", hold: 5, blocked: v.bodyCond >= 99 ? "The body is fine" : undefined,
        run(c) { c.consumeHeld(); v.repair(45, "body"); play(c, "ratchet", v); say(c, `Bodywork patched: ${pct(v.bodyCond)}`, "good"); } });
      return acts;
    },
  });
  const rear = d.rearDoor;
  addTarget(P.doors[rear], { id: id(rear), name: rear === "trunk" ? "Trunk lid" : "Tailgate", reach: 2.8, actions: doorActs(rear, rear === "trunk" ? "trunk" : "tailgate", false) });

  addTarget(P.fuelCap, {
    id: id("fuel"), name: "Fuel filler", reach: 2.6,
    info: () => ({ qty: `${v.fuel.toFixed(1)} / ${d.tank} L`, cond: Math.round((v.fuel / d.tank) * 100) }),
    actions: (ctx) => [pourAction(v, ctx, "fuel", "Pour fuel")],
  });
  addTarget(P.oilCap, {
    id: id("oil"), name: "Oil filler cap", reach: 2.6,
    info: () => ({ qty: `${v.oil.toFixed(1)} / ${d.oilCap} L` }),
    actions: (ctx) => [pourAction(v, ctx, "oil", "Pour oil")],
  });
  const oilNote = () => { const f = v.oil / d.oilCap; return f < 0.2 ? "bone dry" : f < 0.4 ? "below the low mark" : f < 0.75 ? "between the marks" : "at the full mark"; };
  addTarget(P.dipstick, {
    id: id("dipstick"), name: "Dipstick", reach: 2.6,
    info: () => ({ qty: `${v.oil.toFixed(1)} / ${d.oilCap} L`, note: "oil " + oilNote() }),
    actions: () => [{ key: "use", label: "Check oil", run: (c) => say(c, `Oil ${oilNote()}: ${v.oil.toFixed(1)} of ${d.oilCap} L.`, v.oil / d.oilCap < 0.4 ? "warn" : "info") }],
  });
  addTarget(P.radCap, {
    id: id("coolant"), name: "Radiator cap", reach: 2.6,
    info: () => ({ qty: `${v.coolant.toFixed(1)} / ${d.coolantCap} L`, note: `${Math.round(v.temp)} °C${v.waterFrac > 0.4 ? ", mostly water" : ""}` }),
    actions: (ctx) => {
      const a = pourAction(v, ctx, "coolant", "Pour coolant");
      if (!a.blocked && v.temp > 100) return [{ key: "use", label: "Pour coolant", blocked: "Too hot to open. Let it cool." }];
      return [a];
    },
  });

  P.hubs.forEach((hub, i) => {
    const slot = WHEEL_SLOTS[i];
    addTarget(hub, {
      id: id(slot), name: () => (v.slots[slot] ? COMPONENT_ITEMS[v.slots[slot].type].name : "Bare wheel hub") + ` (${SLOT_LABEL[slot].replace(" wheel", "").toLowerCase()})`,
      reach: 2.6, info: () => slotInfo(v, slot),
      actions: (ctx) => slotActions(v, ctx, slot, "wheel", i % 2 ? -1 : 1),
    });
  });
  for (const kind of ["engine", "battery", "radiator"]) {
    addTarget(P.bays[kind], {
      id: id(kind), name: () => (v.slots[kind] ? COMPONENT_ITEMS[v.slots[kind].type].name : `Empty ${kind} ${kind === "engine" ? "bay" : kind === "battery" ? "tray" : "mount"}`),
      reach: 2.8,
      info: () => (kind === "battery" && v.slots.battery ? { cond: Math.round(v.slots.battery.cond), qty: `charge ${pct(batteryCharge(v))}`, note: partNote(v.slots.battery) } : slotInfo(v, kind)),
      actions: (ctx) => slotActions(v, ctx, kind, kind, 1),
    });
  }
  const cargoName = d.body.style === "pickup" ? "Truck bed" : "Trunk";
  const cargo = addTarget(P.cargo, {
    id: id("cargo"), name: cargoName, reach: 3.2,
    info: () => ({ note: v.cargo.items.length ? `${v.cargo.items.length} item${v.cargo.items.length > 1 ? "s" : ""} secured` : "empty" }),
    actions: () => [],
  });
  cargo.cargoOf = v;
  return () => removeAllUnder(v.mesh);
}

export function unregisterTargets(v) { removeAllUnder(v.mesh); }
