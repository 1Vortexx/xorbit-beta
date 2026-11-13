// Long Haul – synthesized sound. One AudioContext, three buses under the master:
//   master → sfx (engine, tyres, tools, UI) / ambience (wind, rain, thunder) / music (soundtrack elements, see music.js)
// Other modules never touch WebAudio: they call sfx(name) on the bus, and main feeds update() every frame.
import { on } from "./core/bus.js";

let ctx = null, master, busSfx, busAmb, busMusic, cabFilter;
let noise = null;
const vol = { master: 0.8, music: 0.6, sfx: 0.8, ambience: 0.7 };
let muted = false;

// Continuous voices
let eng = null, road = null, wind = null, rain = null, horn = null, pour = null;
let rattleT = 0, lastRpm = 0;

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
  s.connect(g); g.connect(o.bus || busSfx);
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
  s.connect(f); f.connect(g); g.connect(o.bus || busSfx);
  s.onended = () => { s.disconnect(); f.disconnect(); g.disconnect(); };
  s.start(t, Math.random() * 2); s.stop(t + dur + 0.05);
}

const STEP = {
  asphalt: { f: 900, q: 0.9, vol: 0.05, dur: 0.07 }, concrete: { f: 1100, q: 1, vol: 0.05, dur: 0.06 },
  gravel: { f: 2600, q: 0.5, vol: 0.08, dur: 0.16 }, dirt: { f: 500, q: 0.7, vol: 0.06, dur: 0.11 },
  sand: { f: 320, q: 0.5, vol: 0.07, dur: 0.18 }, rock: { f: 1500, q: 1.2, vol: 0.05, dur: 0.06 },
  wood: { f: 260, q: 2.5, vol: 0.09, dur: 0.09 },
};
const SFX = {
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
    o.connect(lp); g.connect(busSfx); o.start(t); o.stop(t + 1);
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
  if (!ctx || ctx.state !== "running") return;
  const fn = SFX[name];
  if (fn) { try { fn(opts); } catch (e) {} }
}
on("sfx", ({ name, opts }) => play(name, opts));

export const audio = {
  get ready() { return !!ctx; },
  get context() { return ctx; },
  get musicBus() { return busMusic; },
  // Must be called from a user gesture the first time (browser autoplay rules)
  start() { try { if (!ctx) init(); if (ctx.state !== "running") ctx.resume(); } catch (e) {} },
  suspend() { try { if (pour) pour.out.gain.value = 0; ctx && ctx.suspend(); } catch (e) {} },
  setVolumes(v, isMuted) { Object.assign(vol, v); muted = !!isMuted; applyVolume(); },
  play,

  // s: { active, tel (Telemetry|null: the vehicle you sit in or stand next to), inCab, dist (m to that vehicle),
  //      indoors, wind 0..1, rain 0..1, horn, rough (0..1 suspension activity) }
  update(s, dt = 0.016) {
    if (!ctx) return;
    const tel = s.active ? s.tel : null;
    const near = tel ? (s.inCab ? 1 : Math.max(0, 1 - (s.dist || 0) / 45) ** 2) : 0;
    const running = tel && tel.ignition === "running";
    if (running) {
      const rpm = Math.max(500, tel.rpm), load = Math.max(0, Math.min(1, tel.load || 0));
      const f = (rpm / 60) * 3; // six-cylinder four-stroke firing frequency
      set(eng.o1.frequency, f, 0.04); set(eng.o2.frequency, f / 2, 0.04); set(eng.o3.frequency, f * 1.5, 0.04);
      set(eng.lp.frequency, 180 + rpm * 0.12 + load * 900 * (s.inCab ? 0.7 : 1), 0.08);
      set(eng.nf.frequency, 120 + rpm * 0.1, 0.1);
      set(eng.out.gain, (0.05 + load * 0.07 + (rpm / (tel.redline || 5000)) * 0.03) * near * (s.inCab ? 1 : 0.8), 0.08);
      eng.lfo.frequency.value = 4 + rpm / 400;
    } else set(eng.out.gain, 0, 0.12);
    if (tel && tel.ignition === "cranking" && lastRpm !== "cranking") play("crank");
    lastRpm = tel ? tel.ignition : null;

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
