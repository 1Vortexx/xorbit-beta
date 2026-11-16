// Long Haul – engine smoke, for every loaded vehicle. A failing engine (under 25 %) smokes from under the hood, thicker
// as it gets worse; an overheating one puffs steam. When an engine dies (its condition reaches 0 – worn out, cooked or
// smashed) there is a low bang, a dark burst of smoke, and it smoulders for a while. Running engines that die are
// stopped by the powertrain itself ("The engine seized.").
import * as THREE from "three";
import { sfx } from "./core/bus.js";
import { OVERHEAT } from "./vehicles/powertrain.js";

const N = 96;                 // particles per vehicle plume
const FAILING = 25;           // engine condition below which it smokes
const SMOULDER = 25;          // seconds of dark smoke after it blows
const REANCHOR = 300;         // metres the vehicle may move from the plume's anchor before it is shifted (float precision)

const VERT = `
attribute float size; attribute float alpha; attribute vec3 tint;
uniform float uScale;
varying float vA; varying vec3 vC;
#include <fog_pars_vertex>
void main() {
  vA = alpha; vC = tint;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / max(0.1, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = `
uniform float uLight;
varying float vA; varying vec3 vC;
#include <fog_pars_fragment>
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  if (d > 0.5) discard;
  float a = vA * pow(1.0 - smoothstep(0.0, 0.5, d), 1.6);     // soft all the way to the edge
  gl_FragColor = vec4(vC * uLight, a);
  #include <fog_fragment>
}`;
let material = null;
function makeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 600 }, uLight: { value: 1 } }]),
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: true,
  });
}

const COLORS = { oil: [0.42, 0.43, 0.46], steam: [0.92, 0.92, 0.9], black: [0.13, 0.12, 0.12] };

class Plume {
  constructor(root) {
    this.root = root;
    this.group = new THREE.Group();
    root.add(this.group);
    this.pos = new Float32Array(N * 3); this.size = new Float32Array(N); this.alpha = new Float32Array(N); this.tint = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3); this.age = new Float32Array(N); this.life = new Float32Array(N); this.grow = new Float32Array(N); this.a0 = new Float32Array(N);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3)); g.setAttribute("size", new THREE.BufferAttribute(this.size, 1));
    g.setAttribute("alpha", new THREE.BufferAttribute(this.alpha, 1)); g.setAttribute("tint", new THREE.BufferAttribute(this.tint, 3));
    this.geo = g;
    this.points = new THREE.Points(g, material);
    this.points.frustumCulled = false; this.points.renderOrder = 4;
    this.group.add(this.points);
    this.next = 0; this.live = 0; this.anchored = false;
  }
  anchor(p) {
    if (!this.anchored) { this.group.position.copy(p); this.anchored = true; return; }
    const g = this.group.position, dx = p.x - g.x, dy = p.y - g.y, dz = p.z - g.z;
    if (dx * dx + dy * dy + dz * dz < REANCHOR * REANCHOR) return;
    for (let i = 0; i < N; i++) { this.pos[i * 3] -= dx; this.pos[i * 3 + 1] -= dy; this.pos[i * 3 + 2] -= dz; }
    g.copy(p);
  }
  // at: absolute world point; drift: inherited velocity; kind: oil | steam | black; strength 0..1;
  // burst: thrown out sideways and up (the moment it blows) instead of welling up from the hood gap
  emit(at, drift, kind, strength, burst = false) {
    const i = this.next, o = i * 3, g = this.group.position, c = COLORS[kind], r = Math.random;
    this.next = (this.next + 1) % N;
    const spread = burst ? 0.9 : 0.5;
    this.pos[o] = at.x - g.x + (r() - 0.5) * spread; this.pos[o + 1] = at.y - g.y + (burst ? r() * 0.3 : 0); this.pos[o + 2] = at.z - g.z + (r() - 0.5) * spread;
    const up = burst ? 1.8 + r() * 3 : kind === "black" ? 1.4 + r() * 1.2 : 0.8 + r() * 0.6, side = burst ? 2.6 : 0.6;
    this.vel[o] = drift.x * 0.35 + (r() - 0.5) * side; this.vel[o + 1] = up; this.vel[o + 2] = drift.z * 0.35 + (r() - 0.5) * side;
    const v = 0.8 + r() * 0.35;
    this.tint[o] = c[0] * v; this.tint[o + 1] = c[1] * v; this.tint[o + 2] = c[2] * v;
    this.age[i] = 0;
    this.life[i] = kind === "steam" ? 1.6 + r() : kind === "black" ? 3.5 + r() * 2.5 : 3 + r() * 1.6;
    this.size[i] = (burst ? 0.8 : kind === "black" ? 0.6 : 0.55) * (0.7 + r() * 0.6);
    this.grow[i] = (kind === "black" ? 0.9 : kind === "steam" ? 1.0 : 0.75) * (0.7 + r() * 0.6);
    this.a0[i] = (kind === "steam" ? 0.4 : kind === "black" ? (burst ? 0.55 : 0.4) : 0.62) * (0.5 + 0.5 * strength);
  }
  update(dt, wind) {
    let live = 0;
    for (let i = 0; i < N; i++) {
      if (this.age[i] >= this.life[i]) { this.alpha[i] = 0; continue; }
      live++;
      const o = i * 3, t = (this.age[i] += dt) / this.life[i];
      this.vel[o + 1] *= 1 - 0.55 * dt;                                   // slows as it rises and cools
      this.vel[o] += (wind.x - this.vel[o]) * 0.4 * dt; this.vel[o + 2] += (wind.z - this.vel[o + 2]) * 0.4 * dt;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = this.a0[i] * Math.min(1, t * 6) * (1 - t) * (1 - t);
    }
    this.live = live;
    for (const n of ["position", "size", "alpha", "tint"]) this.geo.attributes[n].needsUpdate = true;
  }
  dispose() { this.root.remove(this.group); this.geo.dispose(); }
}

const _at = new THREE.Vector3(), _wind = { x: 0.8, z: 0.3 };
export class EngineSmoke {
  constructor(root) { this.root = root; this.plumes = new Map(); }

  // vehicles: the Vehicles manager; view: { camera, height (px of the drawing buffer), light 0..1, wind? {x, z} }
  update(dt, vehicles, view) {
    if (!material) material = makeMaterial();
    material.uniforms.uScale.value = view.height / (2 * Math.tan(THREE.MathUtils.degToRad(view.camera.fov) / 2));
    material.uniforms.uLight.value = view.light ?? 1;
    const wind = view.wind || _wind;
    const seen = new Set();
    for (const v of vehicles.list) {
      seen.add(v);
      const e = v.slots.engine, cond = e ? e.cond : null;
      // st: { cond (last seen), smoulder (s left), acc (particles owed), said }
      let st = v._smoke;
      if (!st) st = v._smoke = { cond, smoulder: 0, acc: 0, said: false };
      // It blew: condition just reached zero
      if (st.cond !== null && st.cond > 0 && cond !== null && cond <= 0) this.blow(v, st);
      st.cond = cond;
      let rate = 0, kind = "oil", strength = 0;
      if (st.smoulder > 0) { st.smoulder -= dt; strength = Math.max(0.25, st.smoulder / SMOULDER); rate = 3 + 9 * strength; kind = "black"; }
      else if (e && cond > 0 && cond < FAILING && v.running) { strength = 1 - cond / FAILING; rate = 4 + 12 * strength; kind = "oil"; }
      if (v.temp > OVERHEAT - 3 && !(st.smoulder > 0)) { const s = Math.min(1, (v.temp - OVERHEAT + 3) / 15); if (s * 10 > rate) { rate = 2 + 8 * s; kind = "steam"; strength = s; } }
      if (kind === "oil" && rate > 0 && !st.said) { st.said = true; v.say?.("Smoke is pouring from under the hood. The engine is failing.", "warn", "smoke"); }
      if (cond >= FAILING) st.said = false;
      let p = this.plumes.get(v);
      if (rate > 0 || (p && p.live)) {
        if (!p) this.plumes.set(v, p = new Plume(this.root));
        p.anchor(v.pos);
        if (rate > 0) {
          st.acc += rate * dt;
          this.vent(v, _at);
          for (; st.acc >= 1; st.acc--) p.emit(_at, v.vel, kind, strength);
        }
        p.update(dt, wind);
      } else if (p) { p.dispose(); this.plumes.delete(v); }
    }
    // Vehicles that unloaded take their smoke with them
    for (const [v, p] of this.plumes) if (!seen.has(v)) { p.dispose(); this.plumes.delete(v); }
  }
  // Where smoke leaves the engine bay: the hood's back edge over the engine (the hood gap)
  vent(v, out) {
    const b = v.def.body, d = v.def;
    return v.localToWorld(0, (b.hoodYRear ?? 1.2) - d.comH + 0.04, b.engineZ ?? d.axleF, out);
  }
  blow(v, st) {
    st.smoulder = SMOULDER;
    sfx("engine_blow", { pos: v.pos.clone(), vol: 1 });
    let p = this.plumes.get(v);
    if (!p) this.plumes.set(v, p = new Plume(this.root));
    p.anchor(v.pos);
    this.vent(v, _at);
    for (let i = 0; i < 40; i++) p.emit(_at, v.vel, "black", 1, true);   // the puff
  }
  clear() { for (const p of this.plumes.values()) p.dispose(); this.plumes.clear(); }
}
