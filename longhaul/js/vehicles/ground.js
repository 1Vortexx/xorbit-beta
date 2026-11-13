// Long Haul – ground seam for the vehicle physics.
// The vehicle code never imports the terrain directly: it reads `ground`, which starts as a flat asphalt plane
// (so the physics is importable and deterministic in Node) and is pointed at js/world/terrain.js by
// vehicles/index.js prepare(). Tests inject slopes through setGround().
const flatNormal = (x, z, out) => out.set(0, 1, 0);

export const ground = {
  heightAt: (x, z) => 0,
  normalAt: flatNormal,
  surfaceAt: (x, z) => "asphalt",
  roadX: (z) => 0,
  roadY: (z) => 0,
  roadDir: (z) => ({ x: 0, z: 1 }),
};

// Replace any subset of the ground functions. When only heightAt is given, normalAt is derived from it.
export function setGround(g) {
  if (!g) return ground;
  if (g.heightAt) {
    ground.heightAt = g.heightAt;
    if (!g.normalAt) {
      const h = g.heightAt;
      ground.normalAt = (x, z, out) => {
        const e = 0.4;
        return out.set(-(h(x + e, z) - h(x - e, z)) / (2 * e), 1, -(h(x, z + e) - h(x, z - e)) / (2 * e)).normalize();
      };
    }
  }
  if (g.normalAt) ground.normalAt = g.normalAt;
  if (g.surfaceAt) ground.surfaceAt = g.surfaceAt;
  else if (g.onRoad && g.heightAt) ground.surfaceAt = (x, z) => (g.onRoad(x, z) ? "asphalt" : "sand");
  if (g.roadX) ground.roadX = g.roadX;
  if (g.roadY) ground.roadY = g.roadY;
  if (g.roadDir) ground.roadDir = g.roadDir;
  return ground;
}

export function resetGround() {
  ground.heightAt = () => 0; ground.normalAt = flatNormal; ground.surfaceAt = () => "asphalt";
  ground.roadX = () => 0; ground.roadY = () => 0; ground.roadDir = () => ({ x: 0, z: 1 });
}

// Grip, rolling resistance, slip-angle at peak grip, small-scale roughness (m) and wet grip loss per surface
export const SURFACES = {
  asphalt:  { mu: 1.0,  roll: 0.013, peak: 0.13, rough: 0.0,   wet: 0.28 },
  concrete: { mu: 0.95, roll: 0.014, peak: 0.13, rough: 0.0,   wet: 0.25 },
  wood:     { mu: 0.8,  roll: 0.02,  peak: 0.15, rough: 0.004, wet: 0.35 },
  gravel:   { mu: 0.72, roll: 0.032, peak: 0.2,  rough: 0.012, wet: 0.15 },
  dirt:     { mu: 0.68, roll: 0.04,  peak: 0.21, rough: 0.016, wet: 0.38 },
  rock:     { mu: 0.8,  roll: 0.03,  peak: 0.17, rough: 0.028, wet: 0.2 },
  sand:     { mu: 0.56, roll: 0.085, peak: 0.24, rough: 0.018, wet: 0.05 },
};

// Smooth deterministic 2D value noise in −1..1 (wavelength 1 unit) for surface roughness under the tyres
function h2(i, j) {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 2147483648 - 1;
}
export function bumpNoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z);
  let fx = x - i, fz = z - j;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const a = h2(i, j), b = h2(i + 1, j), c = h2(i, j + 1), d = h2(i + 1, j + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

// Small seeded RNG (mulberry32) – used for deterministic defects and engine hiccups
export function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
