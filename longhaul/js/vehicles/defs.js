// Long Haul – vehicle definitions (pure data, importable in Node).
// Local frame: +z forward, +x left, +y up. The physics origin is the centre of mass, `comH` metres above the
// ground at rest. Everything under `body` is in MODEL coordinates (y measured from the ground at rest); the model
// group is shifted down by comH. All other vectors here are vehicle-local (origin = centre of mass).

export const GRAVITY = 9.81;
// Fuel burn is scaled up from real-world figures so a tank lasts a game-sized stretch of road, not 600 km.
export const FUEL_SCALE = 3;

export const WHEEL_SLOTS = ["wheelFL", "wheelFR", "wheelRL", "wheelRR"];
export const SLOTS = ["engine", "battery", "radiator", ...WHEEL_SLOTS];
export const SLOT_LABEL = {
  engine: "Engine", battery: "Battery", radiator: "Radiator",
  wheelFL: "Front left wheel", wheelFR: "Front right wheel", wheelRL: "Rear left wheel", wheelRR: "Rear right wheel",
};

function finish(d) {
  const b = d.body;
  d.halfW = b.hw + 0.01;
  d.zFront = b.zNose + 0.14; d.zRear = b.zTail - 0.14;
  d.height = b.roofY;
  d.wheelbase = d.axleF - d.axleR;
  // Box-ish inertia about the centre of mass: [pitch (x), yaw (y), roll (z)]
  const L = d.zFront - d.zRear, W = d.halfW * 2, H = b.roofY - b.rockerY;
  d.inertia = [d.mass * (L * L + H * H) / 12 * 0.9, d.mass * (L * L + W * W) / 12 * 0.95, d.mass * (W * W + H * H) / 12 * 1.25];
  // Static axle loads → springs sized from the ride frequency so the body sits level
  const wf = (-d.axleR) / d.wheelbase, wr = d.axleF / d.wheelbase;
  d.cornerMass = [d.mass * wf / 2, d.mass * wf / 2, d.mass * wr / 2, d.mass * wr / 2];
  d.spring = d.cornerMass.map((m, i) => m * Math.pow(2 * Math.PI * (i < 2 ? d.susp.freqF : d.susp.freqR), 2));
  d.damper = d.cornerMass.map((m, i) => 2 * d.susp.damp * Math.sqrt(d.spring[i] * m));
  d.sag = d.cornerMass.map((m, i) => (m * GRAVITY) / d.spring[i]);
  d.wheels = [
    { x: d.track / 2, z: d.axleF, front: true },
    { x: -d.track / 2, z: d.axleF, front: true },
    { x: d.track / 2, z: d.axleR, front: false },
    { x: -d.track / 2, z: d.axleR, front: false },
  ];
  const y = (my) => my - d.comH;
  d.seatEye = [b.seatX, y(b.eyeY), b.eyeZ];
  d.exits = [[d.halfW + 0.75, b.eyeZ - 0.1], [-(d.halfW + 0.75), b.eyeZ - 0.1], [0, d.zRear - 1.0], [0, d.zFront + 1.0]];
  // Rollover / belly contact points
  const lo = y(b.rockerY + 0.02), hi = y(b.roofY);
  d.hull = [
    [d.halfW, lo, d.zFront], [-d.halfW, lo, d.zFront], [d.halfW, lo, d.zRear], [-d.halfW, lo, d.zRear],
    [b.roofHw, hi, b.zRoofFront], [-b.roofHw, hi, b.zRoofFront], [b.roofHw, hi, b.zRoofRear], [-b.roofHw, hi, b.zRoofRear],
    [d.halfW, y(b.beltY), d.axleF + 0.5], [-d.halfW, y(b.beltY), d.axleF + 0.5], [d.halfW, y(b.beltY), d.axleR - 0.5], [-d.halfW, y(b.beltY), d.axleR - 0.5],
  ];
  d.cargoZone = { min: [b.cargo.x0, y(b.cargo.y0), b.cargo.z0], max: [b.cargo.x1, y(b.cargo.y1), b.cargo.z1] };
  return d;
}

export const VEHICLES = {
  pickup: finish({
    type: "pickup", name: "Brazos 150 pickup", year: 1978,
    mass: 1850, comH: 0.78,
    axleF: 1.55, axleR: -1.45, track: 1.66, wheelR: 0.38, wheelW: 0.25,
    susp: { freqF: 1.45, freqR: 1.65, damp: 0.34, travel: 0.25, arb: 9000, lever: 0.55 },
    steerLock: 0.6, brakeG: 1.05, brakeBias: 0.62,
    cdA: 0.78, drive: "rear",
    gears: [2.52, 1.52, 1.0], reverse: 2.0, final: 3.42, stall: 1900, convMult: 1.7, driveEff: 0.86,
    tank: 75, oilCap: 5.5, coolantCap: 14,
    engines: ["engine_i6", "engine_v8"], wheel: "wheel_16", defaultEngine: "engine_i6",
    rearDoor: "tailgate",
    doorHinge: { driver: { open: 1.15 }, passenger: { open: 1.15 }, hood: { open: 0.95 }, tailgate: { open: 1.5 } },
    body: {
      style: "pickup",
      hw: 0.97, rockerY: 0.42, creaseY: 0.99, beltY: 1.27, hoodYFront: 1.2, hoodYRear: 1.275, roofY: 1.8, roofHw: 0.8,
      zNose: 2.38, zHoodRear: 1.03, zCowl: 0.95, zRoofFront: 0.5, zDoorFront: 0.82, zDoorRear: -0.52,
      zRoofRear: -0.6, zCabBack: -0.62, zBedFront: -0.67, zTail: -2.42,
      floorY: 0.56, bedFloorY: 0.78, archR: 0.53, bumperY: 0.6,
      seatX: 0.42, eyeY: 1.5, eyeZ: -0.02, seatY: 0.8, seatZ: -0.2, dashZ: 0.72, wheelDia: 0.42,
      cargo: { x0: -0.8, x1: 0.8, y0: 0.79, y1: 1.7, z0: -2.36, z1: -0.74 },
      fuelCap: [0.975, 1.08, -0.95], engineZ: 1.5, engineY: 0.84, batteryPos: [0.62, 1.0, 1.95], radiatorZ: 2.17, radiatorY: 0.9,
      interior: 0x5b4030, dash: 0x33261d, headliner: 0xb9ad94,
    },
  }),
  sedan: finish({
    type: "sedan", name: "Corvina sedan", year: 1984,
    mass: 1380, comH: 0.56,
    axleF: 1.35, axleR: -1.4, track: 1.5, wheelR: 0.31, wheelW: 0.2,
    susp: { freqF: 1.3, freqR: 1.45, damp: 0.36, travel: 0.19, arb: 11000, lever: 0.6 },
    steerLock: 0.62, brakeG: 1.05, brakeBias: 0.66,
    cdA: 0.52, drive: "rear",
    gears: [2.45, 1.45, 1.0], reverse: 2.1, final: 3.08, stall: 1800, convMult: 1.8, driveEff: 0.87,
    tank: 60, oilCap: 4.2, coolantCap: 9,
    engines: ["engine_i4", "engine_i6"], wheel: "wheel_14", defaultEngine: "engine_i4",
    rearDoor: "trunk",
    doorHinge: { driver: { open: 1.12 }, passenger: { open: 1.12 }, hood: { open: 0.95 }, trunk: { open: 1.15 } },
    body: {
      style: "sedan",
      hw: 0.88, rockerY: 0.29, creaseY: 0.69, beltY: 0.93, hoodYFront: 0.86, hoodYRear: 0.935, roofY: 1.4, roofHw: 0.68,
      zNose: 2.2, zHoodRear: 0.98, zCowl: 0.9, zRoofFront: 0.32, zDoorFront: 0.76, zDoorRear: -0.2,
      zDoor2Rear: -1.02, zRoofRear: -1.02, zDeckFront: -1.5, zCabBack: -1.5, zTail: -2.3, deckY: 0.95,
      floorY: 0.38, archR: 0.42, bumperY: 0.47,
      seatX: 0.38, eyeY: 1.13, eyeZ: -0.1, seatY: 0.52, seatZ: -0.28, dashZ: 0.62, wheelDia: 0.38,
      cargo: { x0: -0.62, x1: 0.62, y0: 0.5, y1: 0.9, z0: -2.2, z1: -1.58 },
      fuelCap: [0.885, 0.78, -1.9], engineZ: 1.42, engineY: 0.55, batteryPos: [0.55, 0.72, 1.85], radiatorZ: 2.0, radiatorY: 0.58,
      interior: 0x3f4a55, dash: 0x23282d, headliner: 0xa9abaa,
    },
  }),
};

export const VEHICLE_TYPES = Object.keys(VEHICLES);

// Paint palette for seeded vehicles: sun-bleached period colours [name, hex]
export const PAINTS = [
  ["faded teal", 0x4f8f8c], ["oxide red", 0x8e3b2c], ["desert tan", 0xb49a6c], ["sky blue", 0x6f93ad],
  ["cream", 0xcfc5a3], ["avocado", 0x7c8450], ["mustard", 0xba8f2f], ["chalk white", 0xd4d1c6], ["rust brown", 0x70482f],
];
