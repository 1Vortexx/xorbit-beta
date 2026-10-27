// Long Haul – weather: clear, haze, overcast, rain, storms and sandstorms, plus air temperature
import * as THREE from "three";

export const TYPES = {
  clear:     { label: "Clear",     fog: 1,    cloud: 0,    rain: 0,   sand: 0, temp: 0,   light: 1 },
  hazy:      { label: "Hazy",      fog: 0.7,  cloud: 0.2,  rain: 0,   sand: 0, temp: 1,   light: 0.85 },
  overcast:  { label: "Overcast",  fog: 0.65, cloud: 0.75, rain: 0,   sand: 0, temp: -5,  light: 0.55 },
  rain:      { label: "Rain",      fog: 0.45, cloud: 0.9,  rain: 0.6, sand: 0, temp: -9,  light: 0.4 },
  storm:     { label: "Storm",     fog: 0.32, cloud: 1,    rain: 1,   sand: 0, temp: -11, light: 0.25 },
  sandstorm: { label: "Sandstorm", fog: 0.12, cloud: 0.35, rain: 0,   sand: 1, temp: 2,   light: 0.45 },
};
// Which weather tends to follow which
const NEXT = {
  clear: { clear: 3, hazy: 3, overcast: 2, sandstorm: 1.2 },
  hazy: { clear: 3, overcast: 2, sandstorm: 1.5 },
  overcast: { clear: 2, hazy: 1, rain: 3, storm: 1 },
  rain: { overcast: 3, storm: 1.5, clear: 1 },
  storm: { rain: 3, overcast: 2 },
  sandstorm: { hazy: 3, clear: 2 },
};
const KEYS = ["fog", "cloud", "rain", "sand", "temp", "light"];

const pick = (weights) => {
  let t = Math.random() * Object.values(weights).reduce((a, b) => a + b, 0);
  for (const [k, w] of Object.entries(weights)) { if ((t -= w) <= 0) return k; }
  return "clear";
};

const RAIN_BOX = 70, RAIN_H = 34;

export class Weather {
  constructor(scene) {
    this.scene = scene;
    this.current = "clear";
    this.target = "clear";
    this.blend = 1;
    this.hoursLeft = 5;
    this.p = { ...TYPES.clear };
    this.baseFar = 450;
    this.flash = 0;
    this.nextBolt = 8;
    this.onThunder = null;

    // Rain: short line segments that fall around the camera
    this.rainCount = 1400;
    const rg = new THREE.BufferGeometry();
    this.rainPos = new Float32Array(this.rainCount * 6);
    this.rainSeed = new Float32Array(this.rainCount * 3);
    for (let i = 0; i < this.rainCount; i++) {
      this.rainSeed.set([Math.random() * RAIN_BOX, Math.random() * RAIN_H, Math.random() * RAIN_BOX], i * 3);
    }
    rg.setAttribute("position", new THREE.BufferAttribute(this.rainPos, 3));
    this.rainMat = new THREE.LineBasicMaterial({ color: 0xa9b8cc, transparent: true, opacity: 0, depthWrite: false });
    this.rain = new THREE.LineSegments(rg, this.rainMat);
    this.rain.frustumCulled = false;
    scene.add(this.rain);

    // Sand: blowing grains
    this.sandCount = 1600;
    const sg = new THREE.BufferGeometry();
    this.sandPos = new Float32Array(this.sandCount * 3);
    this.sandSeed = new Float32Array(this.sandCount * 3);
    for (let i = 0; i < this.sandCount; i++) {
      this.sandSeed.set([Math.random() * RAIN_BOX, Math.random() * 12, Math.random() * RAIN_BOX], i * 3);
    }
    sg.setAttribute("position", new THREE.BufferAttribute(this.sandPos, 3));
    this.sandMat = new THREE.PointsMaterial({ color: 0xd9a066, size: 0.12, transparent: true, opacity: 0, depthWrite: false });
    this.sand = new THREE.Points(sg, this.sandMat);
    this.sand.frustumCulled = false;
    scene.add(this.sand);

    this.t = 0;
    this.tint = new THREE.Color();
    this.cloudCol = new THREE.Color(0x7b838d);
    this.sandCol = new THREE.Color(0xc0844e);
  }

  get label() { return TYPES[this.blend > 0.5 ? this.target : this.current].label; }
  get wet() { return this.p.rain; }

  setLite(lite) {
    this.rain.geometry.setDrawRange(0, (lite ? 500 : this.rainCount) * 2);
    this.sand.geometry.setDrawRange(0, lite ? 600 : this.sandCount);
  }

  // Air temperature in °C for a time of day (0..1)
  ambient(time) {
    const d = Math.sin(((time - 0.29) / 0.52) * Math.PI);
    return 16 + 26 * Math.max(0, time > 0.29 && time < 0.81 ? d : 0) + this.p.temp;
  }

  // Advance by in-game hours (also used when skipping time while sleeping)
  advance(hours) {
    this.hoursLeft -= hours;
    if (this.blend < 1) this.blend = Math.min(1, this.blend + hours / 0.6);
    if (this.hoursLeft <= 0 && this.blend >= 1) {
      this.current = this.target;
      this.target = pick(NEXT[this.current]);
      this.blend = this.target === this.current ? 1 : 0;
      this.hoursLeft = 3 + Math.random() * 6;
    }
    const a = TYPES[this.current], b = TYPES[this.target], f = this.blend;
    for (const k of KEYS) this.p[k] = a[k] + (b[k] - a[k]) * f;
  }

  update(dt, hours, camera, sky) {
    this.advance(hours);
    this.t += dt;
    const p = this.p;

    // Sky and fog
    const dayLight = Math.max(0.15, Math.min(1, (sky.sunDir.y + 0.1) / 0.4));
    this.tint.copy(this.cloudCol).multiplyScalar(dayLight);
    sky.color.lerp(this.tint, p.cloud * 0.75);
    sky.color.lerp(this.tint.copy(this.sandCol).multiplyScalar(dayLight), p.sand * 0.85);
    this.scene.fog.color.copy(sky.color);
    this.scene.fog.far = this.baseFar * p.fog;
    this.scene.fog.near = Math.min(this.scene.fog.far * 0.15, 60);
    sky.sun.intensity *= p.light;
    sky.sunDisc.visible = sky.moonDisc.visible = p.cloud < 0.7 && p.sand < 0.5;
    sky.starMat.opacity *= 1 - p.cloud;

    // Lightning
    if (this.target === "storm" || this.current === "storm") {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0 && p.rain > 0.7) {
        this.flash = 1;
        this.nextBolt = 6 + Math.random() * 16;
        const delay = 0.4 + Math.random() * 2.5;
        if (this.onThunder) setTimeout(() => this.onThunder(), delay * 1000);
      }
    }
    this.flash = Math.max(0, this.flash - dt * 3.5);
    sky.hemi.intensity += this.flash * 2.5;

    // Particles around the camera
    const cx = camera.position.x - RAIN_BOX / 2, cy = camera.position.y - 8, cz = camera.position.z - RAIN_BOX / 2;
    this.rainMat.opacity = p.rain * 0.55;
    this.rain.visible = p.rain > 0.02;
    if (this.rain.visible) {
      const fall = this.t * 26;
      for (let i = 0; i < this.rainCount; i++) {
        const sx = this.rainSeed[i * 3], sy = this.rainSeed[i * 3 + 1], sz = this.rainSeed[i * 3 + 2];
        const x = cx + mod(sx - camera.position.x, RAIN_BOX);
        const z = cz + mod(sz - camera.position.z, RAIN_BOX);
        const y = cy + mod(sy - fall, RAIN_H);
        this.rainPos.set([x, y, z, x + 0.12, y + 0.9, z + 0.05], i * 6);
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    this.sandMat.opacity = p.sand * 0.8;
    this.sand.visible = p.sand > 0.02;
    if (this.sand.visible) {
      const blow = this.t * 18;
      for (let i = 0; i < this.sandCount; i++) {
        const sx = this.sandSeed[i * 3], sy = this.sandSeed[i * 3 + 1], sz = this.sandSeed[i * 3 + 2];
        this.sandPos[i * 3] = cx + mod(sx + blow - camera.position.x, RAIN_BOX);
        this.sandPos[i * 3 + 1] = camera.position.y - 4 + sy + Math.sin(this.t * 3 + i) * 0.3;
        this.sandPos[i * 3 + 2] = cz + mod(sz + blow * 0.3 - camera.position.z, RAIN_BOX);
      }
      this.sand.geometry.attributes.position.needsUpdate = true;
    }
  }

  serialize() { return { current: this.current, target: this.target, blend: this.blend, hoursLeft: this.hoursLeft }; }
  restore(d) {
    if (!d || !TYPES[d.current] || !TYPES[d.target]) return;
    Object.assign(this, d);
    this.advance(0);
  }
}

function mod(a, m) { return ((a % m) + m) % m; }
