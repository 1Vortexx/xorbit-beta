// Long Haul – synthesized sound: engine, wind, rain, thunder, horn, starter
let ctx = null, master, eng1, eng2, engGain, engFilter, windGain, windFilter, rainGain, hornOsc, hornGain;
let volume = 0.8, muted = false;

function noiseBuffer(c, seconds) {
  const b = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function loopNoise(c, buf) {
  const s = c.createBufferSource();
  s.buffer = buf; s.loop = true; s.start();
  return s;
}

function init() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.connect(ctx.destination);
  applyVolume();

  eng1 = ctx.createOscillator(); eng1.type = "sawtooth";
  eng2 = ctx.createOscillator(); eng2.type = "square";
  engFilter = ctx.createBiquadFilter(); engFilter.type = "lowpass"; engFilter.frequency.value = 380;
  engGain = ctx.createGain(); engGain.gain.value = 0;
  eng1.connect(engFilter); eng2.connect(engFilter); engFilter.connect(engGain); engGain.connect(master);
  eng1.start(); eng2.start();

  const buf = noiseBuffer(ctx, 2);
  windFilter = ctx.createBiquadFilter(); windFilter.type = "bandpass"; windFilter.frequency.value = 500; windFilter.Q.value = 0.6;
  windGain = ctx.createGain(); windGain.gain.value = 0;
  loopNoise(ctx, buf).connect(windFilter); windFilter.connect(windGain); windGain.connect(master);

  const rainFilter = ctx.createBiquadFilter(); rainFilter.type = "highpass"; rainFilter.frequency.value = 2500;
  rainGain = ctx.createGain(); rainGain.gain.value = 0;
  loopNoise(ctx, buf).connect(rainFilter); rainFilter.connect(rainGain); rainGain.connect(master);

  hornOsc = ctx.createOscillator(); hornOsc.type = "square"; hornOsc.frequency.value = 330;
  const h2 = ctx.createOscillator(); h2.type = "square"; h2.frequency.value = 415;
  const hf = ctx.createBiquadFilter(); hf.type = "lowpass"; hf.frequency.value = 1400;
  hornGain = ctx.createGain(); hornGain.gain.value = 0;
  hornOsc.connect(hf); h2.connect(hf); hf.connect(hornGain); hornGain.connect(master);
  hornOsc.start(); h2.start();
}

function applyVolume() { if (master) master.gain.value = muted ? 0 : volume; }

export const audio = {
  start() { try { if (!ctx) init(); ctx.resume(); } catch (e) {} },
  suspend() { try { ctx && ctx.suspend(); } catch (e) {} },
  setVolume(v) { volume = v; applyVolume(); },
  setMuted(m) { muted = m; applyVolume(); },

  // s: { running, speed, throttle, inCab, wind (0..1), rain (0..1), horn, active }
  update(s) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const sp = Math.abs(s.speed);
    const gear = Math.min(4, Math.floor(sp / 9));
    const rev = (sp - gear * 9) / 9;
    const f = 42 + rev * 55 + gear * 7 + s.throttle * 14;
    eng1.frequency.setTargetAtTime(f, t, 0.05);
    eng2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    const engVol = !s.active || !s.running ? 0 : (0.035 + s.throttle * 0.03) * (s.inCab ? 1 : 0.45);
    engGain.gain.setTargetAtTime(engVol, t, 0.08);
    const wind = s.active ? Math.min(0.09, sp * 0.0018 * (s.inCab ? 0.6 : 0) + s.wind * 0.07 + 0.004) : 0;
    windGain.gain.setTargetAtTime(wind, t, 0.3);
    windFilter.frequency.setTargetAtTime(380 + sp * 12 + s.wind * 400, t, 0.3);
    rainGain.gain.setTargetAtTime(s.active ? s.rain * (s.inCab ? 0.05 : 0.035) : 0, t, 0.4);
    hornGain.gain.setTargetAtTime(s.active && s.horn ? 0.05 : 0, t, 0.02);
  },

  thunder() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 3);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 180;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
    src.connect(lp); lp.connect(g); g.connect(master);
    src.start(); src.stop(t + 3);
  },

  // Short starter-motor whirr while cranking
  crank() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = "sawtooth";
    o.frequency.setValueAtTime(18, t);
    o.frequency.linearRampToValueAtTime(30, t + 0.8);
    const lfo = ctx.createGain(); lfo.gain.value = 0;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.05);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.9);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 300;
    o.connect(lp); lp.connect(g); g.connect(master);
    o.start(); o.stop(t + 1);
  },

  click() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.frequency.value = 660;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.03, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g); g.connect(master); o.start(); o.stop(t + 0.1);
  },
};
