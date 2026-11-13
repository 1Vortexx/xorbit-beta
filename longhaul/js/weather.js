// Long Haul – weather: clear, haze, overcast, rain, thunderstorms and dust storms, plus air temperature.
// Atmospheric but always playable: fog never closes in below MIN_VIS metres.
import * as THREE from "three";

export const TYPES = {
  //                               fog = fraction of baseFar
  clear:     { label: "Clear",      fog: 1,    cloud: 0,    rain: 0,   sand: 0, temp: 0,   light: 1 },
  hazy:      { label: "Hazy",       fog: 0.55, cloud: 0.15, rain: 0,   sand: 0.06, temp: 1, light: 0.9 },
  overcast:  { label: "Overcast",   fog: 0.6,  cloud: 0.85, rain: 0,   sand: 0, temp: -5,  light: 0.5 },
  rain:      { label: "Rain",       fog: 0.3,  cloud: 0.95, rain: 0.6, sand: 0, temp: -9,  light: 0.36 },
  storm:     { label: "Storm",      fog: 0.18, cloud: 1,    rain: 1,   sand: 0, temp: -11, light: 0.24 },
  sandstorm: { label: "Dust storm", fog: 0.04, cloud: 0.3,  rain: 0,   sand: 1, temp: 2,   light: 0.5 },
};
const NEXT = {
  clear: { clear: 3, hazy: 3, overcast: 2, sandstorm: 1.2 },
  hazy: { clear: 3, overcast: 2, sandstorm: 1.5 },
  overcast: { clear: 2, hazy: 1, rain: 3, storm: 1 },
  rain: { overcast: 3, storm: 1.5, clear: 1 },
  storm: { rain: 3, overcast: 2 },
  sandstorm: { hazy: 3, clear: 2 },
};
const KEYS = ["fog", "cloud", "rain", "sand", "temp", "light"];
export const MIN_VIS = 90;     // metres: fog far never drops below this (objects stay readable to ~60 m)
const pick = (weights) => {
  let t = Math.random() * Object.values(weights).reduce((a, b) => a + b, 0);
  for (const [k, w] of Object.entries(weights)) { if ((t -= w) <= 0) return k; }
  return "clear";
};
const BOX = 60, BOX_H = 30;
const mod = (a, m) => ((a % m) + m) % m;

function softDot() {
  const c = document.createElement("canvas"); c.width = c.height = 32;
  const g = c.getContext("2d"), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export class Weather {
  constructor(root, scene) {
    this.root = root; this.scene = scene || root;
    this.current = "clear"; this.target = "clear"; this.blend = 1; this.hoursLeft = 5;
    this.p = { ...TYPES.clear };
    this.baseFar = (this.scene.fog && this.scene.fog.far) || 3600;
    this.flash = 0; this.nextBolt = 8; this.onThunder = null; this.thunderIn = -1;
    this.wetness = 0; this.t = 0; this.lite = false;
    this.cloudCol = new THREE.Color(0.62, 0.66, 0.72); this.sandCol = new THREE.Color(0.85, 0.62, 0.38); this.tint = new THREE.Color();

    // Rain: streaks in a box that follows the camera (vertex data stays local to the object)
    this.rainCount = 1800;
    this.rainPos = new Float32Array(this.rainCount * 6); this.rainSeed = new Float32Array(this.rainCount * 3);
    for (let i = 0; i < this.rainCount; i++) this.rainSeed.set([Math.random() * BOX, Math.random() * BOX_H, Math.random() * BOX], i * 3);
    const rg = new THREE.BufferGeometry(); rg.setAttribute("position", new THREE.BufferAttribute(this.rainPos, 3));
    this.rainMat = new THREE.LineBasicMaterial({ color: 0xb4c2d4, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.rain = new THREE.LineSegments(rg, this.rainMat); this.rain.frustumCulled = false; this.rain.visible = false; this.rain.renderOrder = 10;
    // Dust: soft blowing motes
    this.sandCount = 1400;
    this.sandPos = new Float32Array(this.sandCount * 3); this.sandSeed = new Float32Array(this.sandCount * 3);
    for (let i = 0; i < this.sandCount; i++) this.sandSeed.set([Math.random() * BOX, Math.random() * 14, Math.random() * BOX], i * 3);
    const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(this.sandPos, 3));
    this.dot = softDot();
    this.sandMat = new THREE.PointsMaterial({ color: 0xd9a66c, map: this.dot, size: 0.5, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.sand = new THREE.Points(sg, this.sandMat); this.sand.frustumCulled = false; this.sand.visible = false; this.sand.renderOrder = 10;
    root.add(this.rain, this.sand);
    this.setQuality({ lite: false });
  }
  get label() { return TYPES[this.blend > 0.5 ? this.target : this.current].label; }
  // 0..1 road wetness: builds up in rain, dries slowly afterwards
  get wet() { return this.wetness; }

  setQuality(q = {}) {
    if (q.lite !== undefined) this.lite = !!q.lite;
    this.rain.geometry.setDrawRange(0, (this.lite ? 600 : this.rainCount) * 2);
    this.sand.geometry.setDrawRange(0, this.lite ? 500 : this.sandCount);
  }
  setLite(lite) { this.setQuality({ lite }); }

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
    if (hours > 0) this.wetness = Math.min(1, Math.max(0, this.wetness + (this.p.rain > 0.05 ? this.p.rain * hours * 6 : -hours * 0.8)));
  }
  // Force a type immediately (dev tools, scripted moments)
  set(type) { if (TYPES[type]) { this.current = this.target = type; this.blend = 1; this.hoursLeft = 4; this.advance(0); this.wetness = this.p.rain > 0.05 ? 1 : 0; } }

  update(dt, hours, camera, sky) {
    this.advance(hours);
    this.t += dt;
    const p = this.p;
    // lightning
    if (p.rain > 0.7) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) { this.flash = 1; this.nextBolt = 6 + Math.random() * 16; this.thunderIn = 0.4 + Math.random() * 2.5; }
    }
    if (this.thunderIn >= 0) { this.thunderIn -= dt; if (this.thunderIn < 0 && this.onThunder) this.onThunder(); }
    this.flash = Math.max(0, this.flash - dt * 3.5);
    // hand the sky what it needs for the next frame
    if (sky && sky.wx) {
      const wx = sky.wx;
      wx.cloud = p.cloud; wx.sand = p.sand; wx.light = p.light; wx.flash = this.flash;
      wx.tint.copy(this.cloudCol).lerp(this.sandCol, Math.min(1, p.sand * 1.4));
      wx.haze = (1 - p.fog) * 0.25 * (1 - p.sand);
    }
    // fog: weather scales the clear-day distance; never closer than MIN_VIS
    const fog = this.scene.fog;
    if (fog) { fog.far = Math.max(MIN_VIS, this.baseFar * p.fog); fog.near = Math.min(fog.far * 0.1, 150) * (1 - 0.8 * p.sand); }

    const cp = camera.position;
    this.rain.visible = p.rain > 0.02;
    if (this.rain.visible) {
      this.rainMat.opacity = 0.25 + p.rain * 0.35;
      this.rain.position.set(cp.x, cp.y, cp.z);
      const fall = this.t * 28, n = this.lite ? 600 : this.rainCount, a = this.rainPos, sd = this.rainSeed, slant = 0.16 + p.rain * 0.1;
      for (let i = 0; i < n; i++) {
        const x = mod(sd[i * 3] - cp.x, BOX) - BOX / 2, z = mod(sd[i * 3 + 2] - cp.z, BOX) - BOX / 2, y = mod(sd[i * 3 + 1] - fall - cp.y, BOX_H) - 10;
        const o = i * 6;
        a[o] = x; a[o + 1] = y; a[o + 2] = z; a[o + 3] = x + slant; a[o + 4] = y + 1.1; a[o + 5] = z + slant * 0.4;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    this.sand.visible = p.sand > 0.02;
    if (this.sand.visible) {
      this.sandMat.opacity = Math.min(0.75, p.sand * 0.8);
      this.sand.position.set(cp.x, cp.y, cp.z);
      const blow = this.t * 16, n = this.lite ? 500 : this.sandCount, a = this.sandPos, sd = this.sandSeed;
      for (let i = 0; i < n; i++) {
        a[i * 3] = mod(sd[i * 3] + blow - cp.x, BOX) - BOX / 2;
        a[i * 3 + 1] = sd[i * 3 + 1] - 5 + Math.sin(this.t * 2.2 + i) * 0.4;
        a[i * 3 + 2] = mod(sd[i * 3 + 2] + blow * 0.35 - cp.z, BOX) - BOX / 2;
      }
      this.sand.geometry.attributes.position.needsUpdate = true;
    }
  }

  serialize() { return { current: this.current, target: this.target, blend: this.blend, hoursLeft: this.hoursLeft, wetness: this.wetness }; }
  restore(d) {
    if (!d || !TYPES[d.current] || !TYPES[d.target]) return;
    this.current = d.current; this.target = d.target; this.blend = d.blend === undefined ? 1 : d.blend; this.hoursLeft = d.hoursLeft === undefined ? 4 : d.hoursLeft;
    this.wetness = d.wetness || 0;
    this.advance(0);
  }
  dispose() {
    this.root.remove(this.rain, this.sand);
    this.rain.geometry.dispose(); this.sand.geometry.dispose(); this.rainMat.dispose(); this.sandMat.dispose(); this.dot.dispose();
  }
}
