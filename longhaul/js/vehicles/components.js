// Long Haul – vehicle components: item definitions (merged into ITEMS by items.js), engine specs and
// compatibility rules. The meshes live in partmeshes.js (same mesh loose in the world and installed).
import { makePartMesh } from "./partmeshes.js";
import { VEHICLES } from "./defs.js";

// Engine specs. torque: [rpm, Nm] full-throttle curve. heat: °C/s added at idle / full load. oilUse: L per hour at
// cruise when healthy. fuel: L/h at idle and brake-specific consumption (L per kWh).
export const ENGINES = {
  engine_i6: {
    label: "4.9 L inline six", idle: 650, redline: 4200, inertia: 0.28,
    torque: [[400, 180], [650, 255], [1200, 310], [2000, 340], [2800, 322], [3400, 275], [4000, 205], [4400, 120], [4800, 0]],
    heat: [0.34, 1.55], oilUse: 0.05, fuelIdle: 1.3, bsfc: 0.36,
  },
  engine_v8: {
    label: "5.8 L V8", idle: 700, redline: 4800, inertia: 0.3,
    torque: [[400, 220], [700, 300], [1500, 380], [2400, 405], [3200, 385], [4000, 325], [4600, 245], [5000, 150], [5400, 0]],
    heat: [0.4, 1.8], oilUse: 0.06, fuelIdle: 1.8, bsfc: 0.4,
  },
  engine_i4: {
    label: "2.3 L inline four", idle: 800, redline: 5400, inertia: 0.16,
    torque: [[500, 90], [800, 122], [1500, 150], [2600, 170], [3600, 166], [4600, 146], [5200, 120], [5600, 80], [6000, 0]],
    heat: [0.26, 1.25], oilUse: 0.035, fuelIdle: 0.9, bsfc: 0.33,
  },
};

export function torqueAt(spec, rpm) {
  const c = spec.torque;
  if (rpm <= c[0][0]) return c[0][1] * Math.max(0, rpm / c[0][0]);
  for (let i = 1; i < c.length; i++) {
    if (rpm <= c[i][0]) { const t = (rpm - c[i - 1][0]) / (c[i][0] - c[i - 1][0]); return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t; }
  }
  return 0;
}

const mesh = (type) => (item) => makePartMesh(type, item);

export const COMPONENT_ITEMS = {
  engine_i6: {
    name: "Inline-six engine", icon: "⚙", kind: "part", mass: 210, size: [0.62, 0.74, 0.98], price: 620,
    pocket: false, slot: "engine", fits: ["pickup", "sedan"], makeMesh: mesh("engine_i6"),
  },
  engine_v8: {
    name: "V8 engine", icon: "⚙", kind: "part", mass: 250, size: [0.74, 0.74, 0.86], price: 950,
    pocket: false, slot: "engine", fits: ["pickup"], makeMesh: mesh("engine_v8"),
  },
  engine_i4: {
    name: "Four-cylinder engine", icon: "⚙", kind: "part", mass: 140, size: [0.56, 0.66, 0.7], price: 420,
    pocket: false, slot: "engine", fits: ["sedan"], makeMesh: mesh("engine_i4"),
  },
  battery: {
    name: "Battery", icon: "🔋", kind: "part", mass: 17, size: [0.19, 0.22, 0.28], price: 85,
    pocket: false, slot: "battery", fits: ["pickup", "sedan"], makeMesh: mesh("battery"),
  },
  radiator: {
    name: "Radiator", icon: "♨", kind: "part", mass: 11, size: [0.68, 0.5, 0.12], price: 140,
    pocket: false, slot: "radiator", fits: ["pickup", "sedan"], makeMesh: mesh("radiator"),
  },
  wheel_16: {
    name: "16\" truck wheel", icon: "⭕", kind: "part", mass: 29, size: [0.76, 0.26, 0.76], price: 110,
    pocket: false, slot: "wheel", fits: ["pickup"], radius: 0.38, width: 0.25, makeMesh: mesh("wheel_16"),
  },
  wheel_14: {
    name: "14\" car wheel", icon: "⭕", kind: "part", mass: 18, size: [0.62, 0.21, 0.62], price: 75,
    pocket: false, slot: "wheel", fits: ["sedan"], radius: 0.31, width: 0.2, makeMesh: mesh("wheel_14"),
  },
};

// Containers the vehicle targets accept: item type → what it pours and its capacity when the instance has no qty
export const FLUID_ITEMS = {
  fuelcan: { fluid: "fuel", cap: 10 }, jerrycan: { fluid: "fuel", cap: 20 },
  oil: { fluid: "oil", cap: 1 }, oiljug: { fluid: "oil", cap: 4 },
  coolant: { fluid: "coolant", cap: 4 }, water: { fluid: "water", cap: 0.5 }, waterjug: { fluid: "water", cap: 4 },
};

const slotKind = (slot) => (slot.startsWith("wheel") ? "wheel" : slot);

// null when `item` may be installed in `slot` of a vehicle of `vehicleType`, otherwise the reason it cannot
export function fitProblem(vehicleType, slot, item) {
  const def = item && COMPONENT_ITEMS[item.type];
  if (!def) return "That is not a vehicle part";
  if (def.slot !== slotKind(slot)) return `${def.name} does not go there`;
  if (!def.fits.includes(vehicleType)) return `${def.name} does not fit the ${VEHICLES[vehicleType]?.name || vehicleType}`;
  return null;
}
export const fits = (vehicleType, slot, item) => fitProblem(vehicleType, slot, item) === null;

let uid = 1;
// Fresh component instance. Engines/radiators/wheels carry cond 0..100; batteries also carry charge 0..100;
// wheels carry flat.
export function makeComponent(type, cond = 100, extra = {}) {
  const it = { id: extra.id || "C" + (uid++).toString(36), type, cond };
  if (type === "battery") it.charge = extra.charge ?? 100;
  if (COMPONENT_ITEMS[type]?.slot === "wheel") it.flat = !!extra.flat;
  return it;
}

export function partNote(item) {
  if (!item) return "missing";
  const def = COMPONENT_ITEMS[item.type];
  const c = item.cond ?? 100;
  if (def.slot === "wheel") return item.flat ? "flat" : c < 25 ? "bald" : c < 55 ? "worn" : "good tread";
  if (def.slot === "battery") {
    const ch = Math.min(item.charge ?? 100, c);
    return ch < 8 ? "dead" : ch < 30 ? `weak (${Math.round(ch)}%)` : `charge ${Math.round(ch)}%`;
  }
  if (def.slot === "radiator") return c < 20 ? "leaking badly" : c < 50 ? "seeping" : "sound";
  return c <= 0 ? "seized" : c < 25 ? "knocking" : c < 55 ? "tired" : "healthy";
}
