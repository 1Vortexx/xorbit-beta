// Long Haul – people: procedural poses. Pure math (no THREE, no DOM): a pose is a flat array of joint angles
// (radians) plus two body offsets (metres at scale 1). figure.js applies it to the bones.
//
// Conventions (figure faces +z, left is +x, y up; limbs hang along −y in the bind pose):
//   leg/arm Rx  < 0 swings the limb forward, > 0 backward        knee  > 0 bends the shin back
//   elbow       < 0 bends the forearm forward                    arm Rz: left +, right − lifts the arm sideways
//   arm Ry      twist about the arm's own axis (applied first)   spine/hips Rx > 0 leans forward

export const J = {
  rootRx: 0, rootY: 1, hipsY: 2, hipsRx: 3, hipsRy: 4, hipsRz: 5,
  spineRx: 6, spineRy: 7, spineRz: 8, headRx: 9, headRy: 10,
  armLRx: 11, armLRy: 12, armLRz: 13, elbL: 14, handLRx: 15,
  armRRx: 16, armRRy: 17, armRRz: 18, elbR: 19, handRRx: 20,
  legLRx: 21, legLRz: 22, kneeL: 23, footL: 24,
  legRRx: 25, legRRz: 26, kneeR: 27, footR: 28,
  N: 29,
};
export const LEG = 0.82;                       // hip joint → ankle at scale 1 (thigh 0.42 + shin 0.40)
export const HIP_Y = 0.90;                     // hip joint height above the soles at scale 1

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Ground covered by one full gait cycle (two steps) at a given speed. The gait phase advances by
// 2π · distance / cycleLength, so the feet are tied to the ground actually covered, not to time.
export function cycleLength(speed) { return 1.1 + 0.3 * Math.min(speed, 7); }
// Hip swing amplitude that makes a straight stance leg cover half a cycle of ground (capped: runs have a flight phase)
export function strideAngle(speed) { return Math.min(0.74, Math.asin(Math.min(0.95, cycleLength(speed) / 4 / LEG))); }

// s = {
//   mode: "stand" | "sit" | "down",
//   speed (m/s over the ground), phase (gait, rad), t (seconds, for idle motion), seed (0..1 personal offset),
//   sit: 0..1 blend from standing to sitting (enter / exit transitions), recline (rad, seated back angle),
//   talk: bool, hitch: 0 | 1 (right arm) | -1 (left arm), signal: bool (raised "stop" hand),
//   threat: bool, armed: bool, strike: -1 | 0..1 (progress of a swing; impact at STRIKE_HIT),
//   lookYaw, lookPitch (rad, relative to the body; already limited by the caller)
// }
export const STRIKE_TIME = 0.62, STRIKE_HIT = 0.5;   // seconds for one swing; fraction at which it lands

export function poseFor(out, s) {
  for (let i = 0; i < J.N; i++) out[i] = 0;
  const t = s.t || 0, ph = s.phase || 0, seed = (s.seed || 0) * 6.283;
  if (s.mode === "down") {
    out[J.rootRx] = -1.5; out[J.rootY] = 0.13;
    out[J.armLRz] = 0.95; out[J.armRRz] = -0.7; out[J.elbL] = -0.5; out[J.elbR] = -0.9;
    out[J.legLRz] = 0.16; out[J.legRRz] = -0.1; out[J.kneeR] = 0.35; out[J.legRRx] = -0.2;
    out[J.headRy] = 0.5; out[J.headRx] = -0.1;
    return out;
  }
  const sit = s.mode === "sit" ? 1 : clamp(s.sit || 0, 0, 1);
  const speed = sit > 0 ? 0 : (s.speed || 0);
  const move = smooth(0.15, 0.7, speed), run = smooth(2.4, 4.0, speed);
  const breath = Math.sin(t * 1.55 + seed);

  // ── standing base: breathing and a slow shift of weight from leg to leg
  const sway = Math.sin(t * 0.37 + seed) * (1 - move);
  out[J.hipsRz] = 0.035 * sway; out[J.spineRz] = -0.03 * sway;
  out[J.legLRz] = 0.035 - 0.035 * sway; out[J.legRRz] = -0.035 - 0.035 * sway;
  out[J.spineRx] = 0.02 + 0.012 * breath;
  out[J.headRx] = -0.02 - 0.008 * breath + 0.02 * Math.sin(t * 0.23 + seed * 2) * (1 - move);
  out[J.armLRz] = 0.075 + 0.006 * breath; out[J.armRRz] = -0.075 - 0.006 * breath;
  out[J.elbL] = -0.16; out[J.elbR] = -0.16;
  out[J.armLRx] = 0.03; out[J.armRRx] = 0.03;
  if (s.armed) out[J.handRRx] = 1.25;          // weapon hangs along the leg

  // ── gait
  if (move > 0) {
    const a = strideAngle(speed) * move, sn = Math.sin(ph), cs = Math.cos(ph);
    const swingL = Math.max(0, cs), swingR = Math.max(0, -cs);         // each leg swings forward for half a cycle
    const kBase = 0.06 + 0.22 * run, kAmp = 0.95 + 0.75 * run;
    out[J.legLRx] = -a * sn - 0.1 * run; out[J.legRRx] = a * sn - 0.1 * run;
    out[J.kneeL] = (kBase + kAmp * swingL * swingL) * move; out[J.kneeR] = (kBase + kAmp * swingR * swingR) * move;
    // stance foot stays flat on the ground, swinging foot relaxes toe-down
    out[J.footL] = swingL > 0 ? 0.25 * swingL : -(out[J.legLRx] + out[J.kneeL]) * 0.9;
    out[J.footR] = swingR > 0 ? 0.25 * swingR : -(out[J.legRRx] + out[J.kneeR]) * 0.9;
    // hips drop exactly as far as the straight stance leg shortens vertically; a run adds a bounce
    out[J.hipsY] = -LEG * (1 - Math.cos(a * sn)) - 0.02 * run + 0.035 * run * Math.abs(cs);
    out[J.hipsRy] = -0.09 * sn * move; out[J.spineRy] = 0.16 * sn * move;
    out[J.hipsRz] += 0.03 * cs * move;
    out[J.spineRx] = 0.04 + 0.17 * run;
    const arm = a * (0.62 + 0.25 * run);
    out[J.armLRx] = arm * sn; out[J.armRRx] = -arm * sn;
    out[J.elbL] = -(0.22 + 1.15 * run) - 0.18 * Math.max(0, -sn) * move;
    out[J.elbR] = -(0.22 + 1.15 * run) - 0.18 * Math.max(0, sn) * move;
    out[J.headRx] = -0.03 - 0.1 * run;
  }

  // ── seated (blends in during enter / out during exit)
  if (sit > 0) {
    const rec = s.recline === undefined ? 0.3 : s.recline;
    const k = sit, m = 1 - sit;
    const set = (j, v) => { out[j] = out[j] * m + v * k; };
    set(J.legLRx, -1.68); set(J.legRRx, -1.68); set(J.kneeL, 1.3); set(J.kneeR, 1.3);
    set(J.legLRz, 0.1); set(J.legRRz, -0.1); set(J.footL, 0.3); set(J.footR, 0.3);
    set(J.hipsRx, -rec * 0.55); set(J.spineRx, -rec * 0.45 + 0.01 * breath);
    set(J.hipsRz, 0); set(J.spineRz, 0); set(J.hipsY, 0);
    set(J.armLRx, -0.55); set(J.armRRx, -0.55); set(J.elbL, -0.75); set(J.elbR, -0.75);
    set(J.armLRz, 0.12); set(J.armRRz, -0.12);
    set(J.headRx, rec * 0.8);
    if (s.armed) set(J.handRRx, 0.2);
  }

  // ── gestures (upper body only, so they work standing, walking and seated)
  if (s.hitch) {
    const R = s.hitch > 0, bob = Math.sin(t * 2.1 + seed);
    out[R ? J.armRRz : J.armLRz] = (R ? -1 : 1) * (1.28 + 0.05 * bob);
    out[R ? J.armRRy : J.armLRy] = (R ? -1 : 1) * 1.45;          // twist so the thumb points up
    out[R ? J.armRRx : J.armLRx] = -0.3;
    out[R ? J.elbR : J.elbL] = -0.3 - 0.12 * bob;
    out[R ? J.handRRx : J.handLRx] = 0;
  }
  if (s.talk) {
    const g1 = Math.sin(t * 3.1 + seed), g2 = Math.sin(t * 2.3 + seed + 1.3);
    out[J.armRRx] = -0.3 - 0.08 * g2; out[J.elbR] = -1.25 - 0.3 * g1; out[J.armRRz] = -0.18; out[J.armRRy] = -0.5;
    if (!s.hitch) { out[J.armLRx] = -0.15; out[J.elbL] = -0.7 - 0.22 * g2; }
    out[J.headRx] += 0.05 * Math.sin(t * 2.7 + seed);
    out[J.spineRy] += 0.05 * g2;
  }
  if (s.signal) {                                 // flat hand raised: "stop"
    out[J.armRRx] = -2.55 + 0.04 * Math.sin(t * 1.3); out[J.armRRz] = -0.22; out[J.elbR] = -0.22; out[J.armRRy] = 0;
    out[J.handRRx] = s.armed ? 0.6 : -0.35;
    out[J.spineRx] += 0.03;
  }
  if (s.threat && !(s.strike >= 0)) {
    const tense = Math.sin(t * 5.3 + seed) * 0.03;
    out[J.armRRx] = -2.25 + tense; out[J.armRRz] = -0.4; out[J.elbR] = -1.35; out[J.armRRy] = 0; out[J.handRRx] = -0.35;
    if (sit < 0.5) {
      out[J.armLRx] = -0.95; out[J.elbL] = -1.05; out[J.armLRz] = 0.25;
      out[J.spineRx] += 0.1; out[J.spineRy] += 0.28;
      if (move < 0.5) { out[J.legLRz] += 0.1; out[J.legRRz] -= 0.1; out[J.kneeL] += 0.14; out[J.kneeR] += 0.14; out[J.legLRx] -= 0.07; out[J.legRRx] -= 0.07; out[J.hipsY] -= 0.012; }
    } else { out[J.spineRy] += 0.5; out[J.armRRx] = -1.9; }      // seated: turned toward the driver, arm cocked
  }
  if (s.strike >= 0) {
    const p = s.strike, wind = smooth(0, STRIKE_HIT * 0.6, p), swing = smooth(STRIKE_HIT * 0.62, STRIKE_HIT, p), rec = smooth(0.72, 1, p);
    const w = wind * (1 - swing), hit = swing * (1 - rec);
    out[J.armRRx] = -2.25 - 0.65 * w + 1.6 * hit - 0.9 * rec * 0; out[J.elbR] = -1.35 - 0.3 * w + 1.1 * hit;
    out[J.armRRz] = -0.4 + 0.3 * hit; out[J.armRRy] = 0; out[J.handRRx] = -0.35 + 0.5 * hit;
    out[J.spineRy] += 0.3 + 0.25 * w - 0.85 * hit; out[J.spineRx] += 0.06 + 0.22 * hit;
    if (sit < 0.5) { out[J.armLRx] = -0.8; out[J.elbL] = -1.0; out[J.legLRx] -= 0.2 * hit; out[J.kneeL] += 0.15 * hit; }
  }

  // ── looking: mostly the head, a little from the chest
  if (s.lookYaw || s.lookPitch) {
    const y = clamp(s.lookYaw || 0, -1.35, 1.35);
    out[J.headRy] += clamp(y * 0.68, -0.95, 0.95); out[J.spineRy] += clamp(y * 0.28, -0.38, 0.38);
    out[J.headRx] += clamp(s.lookPitch || 0, -0.5, 0.5);
  }
  return out;
}
