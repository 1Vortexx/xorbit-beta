// Long Haul – synthesized sound. One AudioContext, three buses under the master:
//   master → sfx (engine, tyres, tools, UI) / ambience (wind, rain, thunder) / music (soundtrack elements, see music.js)
// Other modules never touch WebAudio: they call sfx(name) on the bus, and main feeds update() every frame.
// A one-shot with opts.pos (absolute world position) is attenuated by its distance to the listener (setListener).
import { on } from "./core/bus.js";

let ctx = null, master, busSfx, busAmb, busMusic, cabFilter;
let noise = null;
const vol = { master: 0.8, music: 0.6, sfx: 0.8, ambience: 0.7 };
let muted = false;

// Continuous voices
let eng = null, road = null, wind = null, rain = null, horn = null, pour = null;
let rattleT = 0;
let others = [];             // engine voices of nearby NPC-driven vehicles (created lazily, dropped on suspend)

// Positioned one-shots: full volume within NEAR metres, smooth roll-off, nothing beyond FAR.
const NEAR = 6, FAR = 120;
let listener = null, listenerInCab = false;
let dest = null;             // where tone()/burst() connect while a one-shot is being built (null = the sfx bus)
const lastPlayed = new Map();   // "name@x,z" → ms: the same sound from the same spot at most every RATE_MS
const RATE_MS = 60;
function distTo(pos) {
  if (!pos || !listener) return 0;
  const dx = (pos.x || 0) - listener.x, dy = (pos.y || 0) - listener.y, dz = (pos.z || 0) - listener.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
// 1 inside NEAR, about 0.2 at 30 m, 0.07 at 60 m, 0 from FAR on.
export function attenuation(d) {
  if (!(d > NEAR)) return 1;
  if (d >= FAR) return 0;
  return (NEAR / d) ** 0.75 * (1 - (d - NEAR) / (FAR - NEAR)) ** 1.5;
}

function noiseBuffer(c, seconds) {
  const b = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function loopNoise() {
  const s = ctx.createBufferSource();
  s.buffer = noise; s.loop = true; s.loopStart = Math.random(); s.start();
  return s;
}
const gain = (v, to) => { const g = ctx.createGain(); g.gain.value = v; if (to) g.connect(to); return g; };
const filter = (type, f, q, to) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; if (to) b.connect(to); return b; };
const osc = (type, f, to) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; if (to) o.connect(to); o.start(); return o; };
const set = (param, v, tc = 0.06) => param.setTargetAtTime(v, ctx.currentTime, tc);

function init() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = gain(1, ctx.destination);
  busSfx = gain(1, master);
  busMusic = gain(1, master);
  // Ambience passes through a low-pass that closes when you sit in a cab or stand indoors
  cabFilter = filter("lowpass", 18000, 0.3, master);
  busAmb = gain(1, cabFilter);
  noise = noiseBuffer(ctx, 2.5);
  applyVolume();

  // Engine: firing-frequency saw + sub square through a soft clipper and a low-pass that opens with load,
  // plus a band of intake/exhaust noise.
  {
    const out = gain(0, busSfx);
    const lp = filter("lowpass", 300, 1.2, out);
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(257);
    for (let i = 0; i < 257; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(2.2 * x); }
    shaper.curve = curve; shaper.connect(lp);
    const mix = gain(0.5, shaper);
    const o1 = osc("sawtooth", 40, mix), o2 = osc("square", 20, gain(0.6, mix)), o3 = osc("sawtooth", 60, gain(0.25, mix));
    const nf = filter("bandpass", 200, 1.4, gain(0.5, lp));
    loopNoise().connect(nf);
    // Slow wobble so an idle never sounds like a pure tone
    const lfo = osc("sine", 5.5), lfoGain = gain(1.5);
    lfo.connect(lfoGain); lfoGain.connect(o1.frequency); lfoGain.connect(o2.frequency);
    eng = { out, lp, o1, o2, o3, nf, lfo };
  }
  // Tyres on the surface
  {
    const out = gain(0, busSfx);
    const bp = filter("bandpass", 400, 0.7, out);
    loopNoise().connect(bp);
    const crackle = gain(0, out), hp = filter("highpass", 1800, 0.5, crackle);
    loopNoise().connect(hp);
    road = { out, bp, crackle };
  }
  { const out = gain(0, busAmb), bp = filter("bandpass", 500, 0.6, out); loopNoise().connect(bp); wind = { out, bp }; }
  { const out = gain(0, busAmb), hp = filter("highpass", 2500, 0.4, out); loopNoise().connect(hp); rain = { out }; }
  { const out = gain(0, busSfx), lp = filter("lowpass", 1400, 0.5, out); osc("square", 330, lp); osc("square", 415, lp); horn = { out }; }
  { const out = gain(0, busSfx), bp = filter("bandpass", 900, 2.5, out); loopNoise().connect(bp); const l = osc("sine", 7), lg = gain(260); l.connect(lg); lg.connect(bp.frequency); pour = { out, bp }; }
}

function applyVolume() {
  if (!ctx) return;
  set(master.gain, muted ? 0 : vol.master, 0.03);
  set(busSfx.gain, vol.sfx, 0.03);
  set(busAmb.gain, vol.ambience, 0.03);
  set(busMusic.gain, vol.music, 0.03);
}

// ── One-shots ──────────────────────────────────────────
function tone(f, dur, o = {}) {
  const t = ctx.currentTime + (o.delay || 0);
  const s = ctx.createOscillator(); s.type = o.type || "sine";
  s.frequency.setValueAtTime(f, t);
  if (o.to) s.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(o.vol || 0.1, t + (o.attack || 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(g); g.connect(o.bus || dest || busSfx);
  s.onended = () => { s.disconnect(); g.disconnect(); };
  s.start(t); s.stop(t + dur + 0.05);
}
function burst(dur, o = {}) {
  const t = ctx.currentTime + (o.delay || 0);
  const s = ctx.createBufferSource(); s.buffer = noise; s.loopStart = 0; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = o.type || "bandpass"; f.Q.value = o.q || 0.8;
  f.frequency.setValueAtTime(o.f || 800, t);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(o.vol || 0.15, t + (o.attack || 0.004));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(o.bus || dest || busSfx);
  s.onended = () => { s.disconnect(); f.disconnect(); g.disconnect(); };
  s.start(t, Math.random() * 2); s.stop(t + dur + 0.05);
}

const STEP = {
  asphalt: { f: 900, q: 0.9, vol: 0.05, dur: 0.07 }, concrete: { f: 1100, q: 1, vol: 0.05, dur: 0.06 },
  gravel: { f: 2600, q: 0.5, vol: 0.08, dur: 0.16 }, dirt: { f: 500, q: 0.7, vol: 0.06, dur: 0.11 },
  sand: { f: 320, q: 0.5, vol: 0.07, dur: 0.18 }, rock: { f: 1500, q: 1.2, vol: 0.05, dur: 0.06 },
  wood: { f: 260, q: 2.5, vol: 0.09, dur: 0.09 },
};
const vol01 = (v, d) => Math.max(0, Math.min(1, v ?? d));
const SFX = {
  jump: () => burst(0.12, { f: 650, vol: 0.09, to: 1300 }),
  bandage: () => { burst(0.24, { f: 2200, vol: 0.08 }); burst(0.13, { f: 1300, vol: 0.07, delay: 0.2 }); },
  inventory: () => burst(0.15, { f: 950, vol: 0.1, to: 1600 }),
  switch: () => { burst(0.025, { f: 2400, q: 3, vol: 0.12 }); tone(340, 0.035, { vol: 0.04 }); },
  ignition_key: () => { burst(0.045, { f: 3000, q: 3, vol: 0.13 }); tone(800, 0.055, { vol: 0.025, to: 500 }); },
  starter_click: () => { for (let i = 0; i < 3; i++) burst(0.025, { f: 1800, q: 3, vol: 0.16, delay: i * 0.1 }); },
  engine_catch: () => { burst(0.22, { type: "lowpass", f: 420, vol: 0.25 }); tone(55, 0.35, { type: "sawtooth", vol: 0.06, to: 95 }); },
  engine_stop: () => { tone(85, 0.32, { type: "sawtooth", vol: 0.06, to: 18 }); burst(0.15, { f: 250, vol: 0.12, delay: 0.12 }); },
  engine_blow: (o) => {   // the engine letting go: a crack, a deep low blow, metal clattering and a long hiss
    const v = vol01(o.vol, 1);
    burst(0.05, { f: 1600, q: 0.5, vol: 0.3 * v });
    tone(46, 1.1, { vol: 0.45 * v, to: 24 });
    tone(68, 0.6, { type: "triangle", vol: 0.18 * v, to: 30 });
    burst(0.9, { type: "lowpass", f: 280, vol: 0.5 * v, to: 60 });
    for (let i = 0; i < 6; i++) burst(0.05, { f: 800 + Math.random() * 1600, q: 5, vol: (0.1 - i * 0.012) * v, delay: 0.1 + i * 0.07 + Math.random() * 0.04 });
    burst(2.2, { f: 2600, q: 0.4, vol: 0.06 * v, delay: 0.3, attack: 0.2, to: 1400 });
  },
  engine_fail: () => { burst(0.15, { type: "lowpass", f: 330, vol: 0.18 }); tone(75, 0.2, { type: "triangle", vol: 0.07, to: 25 }); },
  parking_brake: () => { for (let i = 0; i < 4; i++) burst(0.025, { f: 1700 + i * 150, q: 3, vol: 0.11, delay: i * 0.035 }); },
  gear_shift: () => { burst(0.06, { f: 700, q: 2, vol: 0.12 }); tone(110, 0.08, { type: "triangle", vol: 0.06, to: 75 }); },
  crash: (o) => {
    const v = Math.max(0.05, Math.min(1, o.vol ?? 0.7));
    SFX.thud({ vol: v });
    burst(0.24, { f: 1400, q: 1.5, vol: 0.35 * v, to: 400 });
    tone(190, 0.32, { type: "triangle", vol: 0.13 * v, to: 70 });
    if (v > 0.55) burst(0.2, { f: 3800, vol: 0.16 * v, delay: 0.04 });
  },
  // Crash damage (vehicles/models.js): a panel folding, a body sliding along something, the windscreen going, bits falling
  metal_crunch: (o) => {
    const v = vol01(o.vol, 0.7);
    burst(0.3, { type: "lowpass", f: 520, vol: 0.34 * v, to: 160 });
    tone(140, 0.26, { type: "triangle", vol: 0.12 * v, to: 55 });
    for (let i = 0; i < 4 + v * 6; i++) {                   // the crumple: stuttering creaks and tears of sheet steel
      burst(0.04 + Math.random() * 0.05, { f: 700 + Math.random() * 1800, q: 4 + Math.random() * 6, vol: (0.07 + Math.random() * 0.08) * v, delay: Math.random() * 0.22 });
    }
    burst(0.18, { f: 2900, q: 1.2, vol: 0.08 * v, delay: 0.03, to: 1500 });
  },
  metal_scrape: (o) => {
    const v = vol01(o.vol, 0.6);
    burst(0.11, { f: 1900 + Math.random() * 900, q: 7, vol: 0.12 * v, attack: 0.01 });
    burst(0.11, { f: 4200 + Math.random() * 1500, q: 3, vol: 0.05 * v, attack: 0.01 });
    burst(0.1, { type: "lowpass", f: 300, vol: 0.12 * v });
  },
  glass_crack: (o) => {
    const v = vol01(o.vol, 0.9);
    burst(0.05, { f: 5200, q: 1.5, vol: 0.32 * v });
    burst(0.16, { f: 3200, q: 2.5, vol: 0.12 * v, delay: 0.02, to: 6000 });
    for (let i = 0; i < 7; i++) tone(3000 + Math.random() * 4200, 0.05 + Math.random() * 0.08, { vol: 0.025 * v, delay: 0.03 + Math.random() * 0.3 });
  },
  debris: (o) => {         // chips and trim pattering down
    const v = vol01(o.vol, 0.6);
    for (let i = 0; i < 5 + v * 7; i++) {
      const at = 0.18 + Math.random() * 0.55;
      burst(0.03, { f: 1600 + Math.random() * 2600, q: 5, vol: 0.06 * v, delay: at });
      if (Math.random() < 0.4) tone(1800 + Math.random() * 2400, 0.06, { vol: 0.012 * v, delay: at });
    }
  },
  // Where a bullet stops
  bullet_dirt: (o) => { const v = vol01(o.vol, 1); burst(0.09, { type: "lowpass", f: 600, vol: 0.2 * v }); burst(0.05, { f: 1500, q: 0.8, vol: 0.06 * v }); },
  bullet_flesh: (o) => { const v = vol01(o.vol, 1); burst(0.07, { type: "lowpass", f: 380, vol: 0.32 * v }); tone(90, 0.08, { vol: 0.12 * v, to: 50 }); },
  ricochet: (o) => {
    const v = vol01(o.vol, 1);
    burst(0.03, { f: 3400, q: 2, vol: 0.18 * v });
    tone(2600 + Math.random() * 1600, 0.32, { type: "sine", vol: 0.045 * v, to: 900 + Math.random() * 400, delay: 0.01 });
  },
  ui_click: () => tone(660, 0.07, { vol: 0.04 }),
  ui_back: () => tone(440, 0.08, { vol: 0.04, to: 330 }),
  error: () => { tone(180, 0.12, { type: "square", vol: 0.04 }); tone(140, 0.14, { type: "square", vol: 0.04, delay: 0.1 }); },
  door_open: () => { burst(0.05, { f: 1800, vol: 0.12, q: 2 }); tone(140, 0.25, { type: "triangle", vol: 0.05, to: 190, delay: 0.03 }); },
  door_close: () => { burst(0.12, { type: "lowpass", f: 420, vol: 0.4 }); tone(70, 0.16, { vol: 0.2, to: 45 }); burst(0.03, { f: 2400, vol: 0.08, q: 3, delay: 0.02 }); },
  hood_open: () => { burst(0.04, { f: 2200, vol: 0.1, q: 3 }); tone(210, 0.4, { type: "sawtooth", vol: 0.02, to: 320, delay: 0.04 }); },
  hood_close: () => { burst(0.16, { type: "lowpass", f: 300, vol: 0.45 }); tone(60, 0.2, { vol: 0.22, to: 40 }); },
  container: () => { burst(0.07, { f: 1300, vol: 0.1, q: 2 }); tone(240, 0.18, { type: "triangle", vol: 0.04, to: 300, delay: 0.03 }); },
  pickup: () => burst(0.08, { f: 1400, vol: 0.07, to: 2600 }),
  drop: () => burst(0.1, { type: "lowpass", f: 500, vol: 0.14 }),
  throw: () => burst(0.22, { f: 600, vol: 0.07, to: 1800, q: 0.5 }),
  thud: (o) => { const v = Math.min(1, o.vol === undefined ? 0.6 : o.vol); burst(0.14, { type: "lowpass", f: 260, vol: 0.3 * v }); tone(65, 0.15, { vol: 0.2 * v, to: 40 }); },
  bump: (o) => {
    const v = Math.max(0, Math.min(1, o.vol ?? 0.5));
    const metal = ["metal", "smooth", "chrome"].includes(o.material);
    if (metal) {
      // A short click followed by the hollow ring of a steel drum or panel.
      burst(0.035, { f: 2600, q: 2, vol: 0.16 * v });
      tone(185, 0.27, { type: "triangle", vol: 0.16 * v, to: 150 });
      tone(520, 0.17, { vol: 0.07 * v, to: 470 });
    } else if (o.material === "wood") {
      burst(0.075, { f: 650, q: 2.5, vol: 0.2 * v });
      tone(125, 0.1, { type: "triangle", vol: 0.12 * v, to: 85 });
    } else {
      burst(0.09, { type: "lowpass", f: o.material === "rubber" ? 180 : 450, vol: 0.2 * v });
      tone(75, 0.1, { vol: 0.09 * v, to: 45 });
    }
  },
  land: (o) => {
    const v = o.vol ?? 0.6, s = STEP[o.surface] || STEP.dirt;
    burst(0.15, { f: s.f, q: s.q, vol: 0.2 * v });
    tone(85, 0.13, { vol: 0.16 * v, to: 45 });
  },
  ratchet: () => { for (let i = 0; i < 5; i++) burst(0.025, { f: 3200, q: 4, vol: 0.09, delay: i * 0.07 }); },
  wheel_fit: () => { tone(90, 0.18, { vol: 0.2, to: 60 }); for (let i = 0; i < 4; i++) burst(0.03, { f: 2800, q: 5, vol: 0.09, delay: 0.15 + i * 0.09 }); },
  eat: () => { for (let i = 0; i < 3; i++) burst(0.07, { f: 1500, q: 1.5, vol: 0.06, delay: i * 0.16 }); },
  drink: () => { for (let i = 0; i < 3; i++) tone(300 + i * 60, 0.09, { vol: 0.05, to: 520 + i * 60, delay: i * 0.15 }); },
  cash: () => { tone(1320, 0.09, { vol: 0.05 }); tone(1760, 0.16, { vol: 0.05, delay: 0.08 }); },
  discover: () => { tone(392, 0.25, { type: "triangle", vol: 0.05 }); tone(587, 0.4, { type: "triangle", vol: 0.05, delay: 0.16 }); },
  footstep: (o) => {
    const s = STEP[o.surface] || STEP.dirt, v = o.vol ?? 1;
    burst(s.dur, { f: s.f * (0.85 + Math.random() * 0.3), q: s.q, vol: s.vol * v * 1.8 });
    tone(o.surface === "wood" ? 140 : 95, 0.075, { type: "triangle", vol: 0.055 * v, to: 55 });
  },
  crank: () => {
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), lp = filter("lowpass", 320, 0.5, g);
    o.type = "sawtooth"; o.frequency.setValueAtTime(16, t); o.frequency.linearRampToValueAtTime(30, t + 0.8);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.16, t + 0.05); g.gain.linearRampToValueAtTime(0.0001, t + 0.95);
    o.connect(lp); g.connect(dest || busSfx); o.start(t); o.stop(t + 1);
    o.onended = () => { o.disconnect(); lp.disconnect(); g.disconnect(); };
  },
  // ── strangers (§14.8) ──
  npc_step: (o) => {      // someone else's footstep: the player's, at roughly half the level
    const s = STEP[o.surface] || STEP.dirt, v = vol01(o.vol, 1);
    burst(s.dur, { f: s.f * (0.85 + Math.random() * 0.3), q: s.q, vol: s.vol * v * 0.9 });
    tone(o.surface === "wood" ? 140 : 95, 0.07, { type: "triangle", vol: 0.026 * v, to: 55 });
  },
  npc_talk: (o) => {      // two or three soft syllables; opts.rate sets the voice pitch
    const v = vol01(o.vol, 1), r = Math.max(0.5, Math.min(2, o.rate || 1)), n = 2 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const f = 165 * r * (0.92 + Math.random() * 0.2), d = i * 0.085;
      tone(f, 0.075, { type: "triangle", vol: 0.04 * v, to: f * (i === n - 1 ? 0.82 : 1.06), attack: 0.012, delay: d });
      burst(0.06, { f: 880 * r * (0.85 + Math.random() * 0.35), q: 5, vol: 0.03 * v, attack: 0.012, delay: d });
    }
  },
  threat: (o) => {        // low, tense: two saws a semitone apart beating against each other
    const v = vol01(o.vol, 1);
    tone(73.4, 1.1, { type: "sawtooth", vol: 0.06 * v, to: 69.3, attack: 0.09 });
    tone(77.8, 1.1, { type: "sawtooth", vol: 0.05 * v, to: 73.4, attack: 0.09 });
    burst(0.9, { type: "lowpass", f: 240, vol: 0.14 * v, to: 110, attack: 0.12 });
  },
  pursuit_alert: (o) => { // urgent, rising
    const v = vol01(o.vol, 1);
    [330, 440, 587].forEach((f, i) => tone(f, 0.16, { type: "square", vol: 0.035 * v, to: f * 1.12, delay: i * 0.11 }));
    tone(784, 0.4, { type: "triangle", vol: 0.06 * v, to: 880, delay: 0.33 });
    burst(0.5, { f: 500, q: 1.2, vol: 0.07 * v, to: 3200, attack: 0.3 });
  },
  pursuit_end: (o) => {   // release: a falling, settling figure
    const v = vol01(o.vol, 1);
    tone(659, 0.28, { type: "triangle", vol: 0.05 * v });
    tone(523, 0.32, { type: "triangle", vol: 0.05 * v, delay: 0.15 });
    tone(392, 0.8, { type: "triangle", vol: 0.06 * v, delay: 0.31 });
    burst(0.8, { f: 2200, q: 0.6, vol: 0.04 * v, to: 350, attack: 0.05 });
  },
  barricade_hit: (o) => { // wood crack, then loose boards clattering
    const v = vol01(o.vol, 0.8);
    burst(0.05, { f: 1900, q: 1.2, vol: 0.34 * v });
    burst(0.1, { f: 620, q: 2.5, vol: 0.3 * v });
    tone(135, 0.13, { type: "triangle", vol: 0.16 * v, to: 80 });
    let d = 0.09;
    for (let i = 0; i < 5; i++) {
      burst(0.045, { f: 480 + Math.random() * 520, q: 3.5, vol: (0.17 - i * 0.025) * v, delay: d });
      d += 0.06 + Math.random() * 0.1;
    }
  },
  barrel_hit: (o) => {    // hollow steel boom, then the drum rolling away
    const v = vol01(o.vol, 0.8);
    burst(0.04, { f: 2500, q: 2, vol: 0.2 * v });
    tone(92, 0.6, { type: "triangle", vol: 0.26 * v, to: 78 });
    tone(238, 0.42, { vol: 0.1 * v, to: 214 });
    tone(415, 0.25, { vol: 0.05 * v, to: 388 });
    for (let i = 0; i < 4; i++) {
      const d = 0.28 + i * 0.17, k = (1 - i * 0.2) * v;
      tone(118 - i * 5, 0.11, { type: "triangle", vol: 0.1 * k, to: 90, delay: d });
      burst(0.04, { f: 1500, q: 2, vol: 0.05 * k, delay: d });
    }
  },
  punch: (o) => {         // dull body impact
    const v = vol01(o.vol, 0.8);
    burst(0.09, { type: "lowpass", f: 330, vol: 0.36 * v });
    tone(110, 0.12, { vol: 0.17 * v, to: 50 });
    burst(0.03, { f: 1100, q: 1, vol: 0.06 * v });
  },
  gunshot: (o) => {       // sharp crack and a low boom; opts.big = rifle
    const v = vol01(o.vol, 1), big = !!o.big;
    burst(0.03, { f: 3200, q: 0.4, vol: 0.5 * v });
    burst(big ? 0.32 : 0.22, { type: "lowpass", f: big ? 700 : 950, vol: (big ? 0.62 : 0.5) * v, to: 140 });
    tone(big ? 70 : 95, big ? 0.28 : 0.18, { vol: 0.32 * v, to: 35 });
    burst(0.5, { type: "lowpass", f: 380, vol: 0.08 * v, delay: 0.06 });          // the desert answering
  },
  gun_empty: () => burst(0.025, { f: 2600, q: 4, vol: 0.12 }),
  reload: () => { burst(0.05, { f: 1900, q: 3, vol: 0.12 }); burst(0.06, { f: 1300, q: 3, vol: 0.13, delay: 0.32 }); burst(0.04, { f: 2600, q: 4, vol: 0.12, delay: 0.55 }); },
  knife_swing: () => burst(0.14, { f: 1800, q: 0.6, vol: 0.07, to: 3800 }),
  knife_hit: (o) => { const v = vol01(o.vol, 1); burst(0.07, { type: "lowpass", f: 420, vol: 0.3 * v }); burst(0.05, { f: 2400, q: 1.5, vol: 0.06 * v }); },
  pay: (o) => {           // notes counted out, a few coins
    const v = vol01(o.vol, 1);
    burst(0.11, { f: 3400, q: 0.7, vol: 0.05 * v, attack: 0.02 });
    burst(0.1, { f: 2900, q: 0.7, vol: 0.05 * v, attack: 0.02, delay: 0.13 });
    [2090, 2640, 1870].forEach((f, i) => tone(f, 0.09, { vol: 0.03 * v, delay: 0.24 + i * 0.07 }));
  },
  npc_horn: (o) => {      // another car's horn: opts.dur seconds (default 0.45), opts.rate shifts the pitch
    const v = vol01(o.vol, 1), r = Math.max(0.6, Math.min(1.6, o.rate || 1)), dur = Math.max(0.12, Math.min(1.5, o.dur || 0.45));
    const t = ctx.currentTime, g = ctx.createGain(), lp = filter("lowpass", 1500, 0.5, g);
    const a = ctx.createOscillator(), b = ctx.createOscillator();
    a.type = b.type = "square"; a.frequency.value = 370 * r; b.frequency.value = 466 * r;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.07 * v, t + 0.02);
    g.gain.setValueAtTime(0.07 * v, t + dur); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.06);
    a.connect(lp); b.connect(lp); g.connect(dest || busSfx);
    a.onended = () => { a.disconnect(); b.disconnect(); lp.disconnect(); g.disconnect(); };
    a.start(t); b.start(t); a.stop(t + dur + 0.1); b.stop(t + dur + 0.1);
  },
  tyre_skid: (o) => {     // short squeal
    const v = vol01(o.vol, 0.8);
    burst(0.45, { f: 1650, q: 9, vol: 0.2 * v, to: 1150, attack: 0.03 });
    burst(0.4, { f: 2300, q: 6, vol: 0.07 * v, to: 1700, attack: 0.03 });
    tone(1280, 0.4, { type: "sawtooth", vol: 0.012 * v, to: 980, attack: 0.03 });
  },
  rattle: (o) => { const v = o.vol || 0.5; burst(0.05, { f: 2100, q: 3, vol: 0.05 * v }); burst(0.09, { type: "lowpass", f: 220, vol: 0.2 * v }); },
  pour_start: () => { if (pour) set(pour.out.gain, 0.09, 0.05); },
  pour_stop: () => { if (pour) set(pour.out.gain, 0, 0.05); },
  thunder: () => {
    const t = ctx.currentTime, src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 3);
    const lp = filter("lowpass", 180), g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
    src.connect(lp); lp.connect(g); g.connect(busAmb); src.start(); src.stop(t + 3);
  },
};
export const SFX_NAMES = Object.keys(SFX);

function play(name, opts = {}) {
  if (!ctx) return;
  if (ctx.state === "suspended" && ["ui_click", "ui_back", "error"].includes(name)) {
    // Menu input is a user gesture; pause must not make its buttons silent.
    ctx.resume().then(() => play(name, opts)).catch(() => {});
    return;
  }
  if (ctx.state !== "running") return;
  const fn = SFX[name];
  if (!fn) return;
  const pos = opts.pos || null;
  if (!STATEFUL.has(name)) {   // a caller bug must not machine-gun a sound: one per name and spot every RATE_MS
    const key = pos ? `${name}@${Math.round((pos.x || 0) / 2)},${Math.round((pos.z || 0) / 2)}` : name;
    const now = performance.now(), last = lastPlayed.get(key);
    if (last !== undefined && now - last < RATE_MS) return;
    if (lastPlayed.size > 200) for (const [k, t] of lastPlayed) if (now - t > 1000) lastPlayed.delete(k);
    lastPlayed.set(key, now);
  }
  const d = pos && listener ? distTo(pos) : 0, a = attenuation(d);
  if (a < 0.003) return;
  let node = null;
  if (a < 1 || (pos && listener && listenerInCab)) {
    // Distance takes level and a little top end; sitting in a cab muffles what happens outside.
    node = gain(a);
    const lp = filter("lowpass", Math.min(listenerInCab ? 2600 : 18000, 16000 * a ** 0.5 + 1400), 0.3, busSfx);
    node.connect(lp);
    setTimeout(() => { try { node.disconnect(); lp.disconnect(); } catch (e) {} }, 4000);
  }
  dest = node;
  try { fn(opts); } catch (e) {}
  dest = null;
}
const STATEFUL = new Set(["pour_start", "pour_stop"]);

// Engine of another vehicle: the main voice without the shaper, noise band and wobble.
function otherVoice() {
  const out = gain(0, busSfx), lp = filter("lowpass", 260, 1, out), mix = gain(0.5, lp);
  const o1 = osc("sawtooth", 40, mix), o2 = osc("square", 20, gain(0.55, mix));
  return { out, lp, mix, o1, o2 };
}
function dropOthers() {
  for (const v of others) {
    try { v.o1.stop(); v.o2.stop(); v.o1.disconnect(); v.o2.disconnect(); v.mix.disconnect(); v.lp.disconnect(); v.out.disconnect(); } catch (e) {}
  }
  others = [];
}
on("sfx", ({ name, opts }) => play(name, opts));

// Dying: two recorded clips (audio/sfx) on their own <audio> elements, since main suspends the WebAudio context the
// moment you die. A hard crash crunches the moment it happens (crunch()); a death flatlines once that has finished.
const CRUNCH_MS = 2400;
let deathClips = [], crunchAt = -1e9;
function deathClip(src, delay, level) {
  const a = new Audio(src);
  a.volume = Math.max(0, Math.min(1, (muted ? 0 : vol.master * vol.sfx) * level));
  const t = setTimeout(() => { a.play().catch(() => {}); }, delay);
  deathClips.push({ a, t });
}

export const audio = {
  get ready() { return !!ctx; },
  get context() { return ctx; },
  get musicBus() { return busMusic; },
  // Must be called from a user gesture the first time (browser autoplay rules)
  start() { try { if (!ctx) init(); if (ctx.state !== "running") ctx.resume(); } catch (e) {} },
  suspend() { try { if (pour) pour.out.gain.value = 0; dropOthers(); ctx && ctx.suspend(); } catch (e) {} },
  // A bone-crunching hit, played on impact (a hard crash, survived or not)
  crunch() {
    if (performance.now() - crunchAt < 700) return;
    crunchAt = performance.now();
    deathClip("audio/sfx/death_crunch.mp3", 0, 1);
  },
  // violent: a crash, fall, beating or stabbing. The flatline waits for the crunch to finish: the one already playing
  // from the impact, or one played now
  death(violent) {
    for (const { a, t } of deathClips) if (!/death_crunch/.test(a.src)) { clearTimeout(t); try { a.pause(); a.src = ""; } catch (e) {} }
    deathClips = deathClips.filter(({ a }) => /death_crunch/.test(a.src));
    const since = performance.now() - crunchAt;
    if (violent && since > 20000) { this.crunch(); deathClip("audio/sfx/flatline.mp3", CRUNCH_MS, 0.85); }      // not crunched on impact
    else deathClip("audio/sfx/flatline.mp3", since < CRUNCH_MS ? CRUNCH_MS - since : 0, 0.85);
  },
  // Leaving the game-over screen cuts the flatline off
  stopDeath() {
    for (const { a, t } of deathClips) { clearTimeout(t); try { a.pause(); a.src = ""; } catch (e) {} }
    deathClips = []; crunchAt = -1e9;
  },
  // Where the player's ears are (absolute world position); main calls this every frame.
  setListener(pos) {
    if (!pos) { listener = null; return; }
    if (!listener) listener = { x: 0, y: 0, z: 0 };
    listener.x = pos.x || 0; listener.y = pos.y || 0; listener.z = pos.z || 0;
  },
  setVolumes(v, isMuted) { Object.assign(vol, v); muted = !!isMuted; applyVolume(); },
  play,

  // s: { active, tel (Telemetry|null: the vehicle you sit in or stand next to), inCab, dist (m to that vehicle),
  //      indoors, wind 0..1, rain 0..1, horn, rough (0..1 suspension activity),
  //      others: [{ tel, dist }] (at most 2: engines of nearby NPC-driven vehicles; keep the order stable) }
  update(s, dt = 0.016) {
    listenerInCab = !!(s.active && s.inCab);
    if (!ctx) return;
    const tel = s.active ? s.tel : null;
    const near = tel ? (s.inCab ? 1 : Math.max(0, 1 - (s.dist || 0) / 45) ** 2) : 0;
    const running = tel && tel.ignition === "running";
    if (running) {
      const rpm = Math.max(500, tel.rpm), load = Math.max(0, Math.min(1, tel.load || 0));
      const f = (rpm / 60) * (tel.cyl || 6) / 2; // four-stroke firing frequency (a six unless the engine says)
      set(eng.o1.frequency, f, 0.04); set(eng.o2.frequency, f / 2, 0.04); set(eng.o3.frequency, f * 1.5, 0.04);
      set(eng.lp.frequency, 180 + rpm * 0.12 + load * 900 * (s.inCab ? 0.7 : 1), 0.08);
      set(eng.nf.frequency, 120 + rpm * 0.1, 0.1);
      set(eng.out.gain, (0.05 + load * 0.07 + (rpm / (tel.redline || 5000)) * 0.03) * near * (s.inCab ? 1 : 0.8), 0.08);
      eng.lfo.frequency.value = 4 + rpm / 400;
    } else set(eng.out.gain, 0, 0.12);
    // Ignition one-shots come from drivetrain transitions, including failed starts.

    // Other engines: audible further out than your own idling truck, duller from inside a cab
    const list = s.active && Array.isArray(s.others) ? s.others : null;
    for (let i = 0; i < 2; i++) {
      const o = list && list[i], t = o && o.tel;
      if (t && t.ignition === "running" && (o.dist || 0) < FAR) {
        const v = others[i] || (others[i] = otherVoice());
        const rpm = Math.max(500, t.rpm || 0), load = Math.max(0, Math.min(1, t.load || 0)), f = (rpm / 60) * (t.cyl || 6) / 2;
        const a = Math.max(0, 1 - (o.dist || 0) / FAR) ** 2;
        set(v.o1.frequency, f, 0.05); set(v.o2.frequency, f / 2, 0.05);
        set(v.lp.frequency, (160 + rpm * 0.1 + load * 700) * (s.inCab ? 0.6 : 1), 0.1);
        set(v.out.gain, (0.05 + load * 0.07 + (rpm / (t.redline || 5000)) * 0.03) * a * (s.inCab ? 0.6 : 1), 0.1);
      } else if (others[i]) set(others[i].out.gain, 0, 0.15);
    }


    // Tyre noise by surface; loose surfaces add crackle
    const sp = tel ? Math.abs(tel.speed) : 0;
    const loose = tel && (tel.surface === "gravel" || tel.surface === "dirt" || tel.surface === "sand");
    const roll = tel && tel.grounded !== 0 ? Math.min(1, sp / 30) : 0;
    set(road.out.gain, roll * (loose ? 0.11 : 0.06) * near + (tel ? (tel.slip || 0) * 0.05 * near : 0), 0.12);
    set(road.bp.frequency, (loose ? 520 : 300) + sp * (loose ? 26 : 14), 0.15);
    set(road.crackle.gain, loose ? roll * 0.5 : (tel ? (tel.slip || 0) * 0.6 : 0), 0.1);

    // Suspension rattles on rough ground
    rattleT -= dt;
    if (tel && s.inCab && s.rough > 0.25 && rattleT <= 0) { play("rattle", { vol: Math.min(1, s.rough) }); rattleT = 0.12 + Math.random() * 0.3; }

    const gust = s.active ? Math.min(0.2, (s.inCab ? sp * 0.0022 : 0) + s.wind * 0.14 + 0.012) : 0;
    set(wind.out.gain, gust, 0.3);
    set(wind.bp.frequency, 360 + sp * 12 + s.wind * 420, 0.3);
    set(rain.out.gain, s.active ? s.rain * 0.09 : 0, 0.4);
    set(cabFilter.frequency, s.inCab ? 1500 : s.indoors ? 2600 : 18000, 0.25);
    set(horn.out.gain, s.active && s.horn ? 0.09 * Math.max(near, 0.3) : 0, 0.02);
    if (!s.active) set(pour.out.gain, 0, 0.05);
  },
};
