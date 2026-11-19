// Long Haul – convoy: drive the same road with friends. Everyone with the same world seed builds the same road, so
// only positions travel over the network (js/net/realtime.js, a Supabase broadcast channel named after the code).
// Each player's world is still their own: loot, strangers, wrecks and damage are not shared. Other players are drawn
// as ghosts – their vehicle with them at the wheel, or their body on foot, plus a name tag. Ghost trucks and people
// are solid: each player's own truck crashes into the others on their own screen (main.js passes ghostCars() to the
// vehicle step and colliders() to everything else). A player can ride in another's truck: they send "ride" with the
// driver and seat, sit in that seat on every screen, and the driver's game holds the seat for them.
// A paused player stays in the convoy: they keep sending where they are, flagged as paused, and their tag shows a
// pause sign. A player on foot also sends where they left their truck (pk), so it stays parked on every screen.
// Time of day and weather follow one clock: the lowest id among the players who aren't paused on this road (the
// leader) sends its own in every message and everyone else adopts it. Sleep skips ahead only once everyone on the road
// is asleep (in a cab or a bed) or paused: each sleeper sends the hours they want (zz), and when the leader sees all of
// them asleep it sends "zz" with the longest, and the sleepers wake up that many hours later. Paused players only get
// the new time (through the leader's clock), not the rest.
import * as THREE from "three";
import { Channel } from "./net/realtime.js";
import { Vehicle } from "./vehicles/vehicle.js";
import { buildVisual } from "./vehicles/models.js";
import { VEHICLES } from "./vehicles/defs.js";
import { Body } from "./body.js";
import { addTarget, removeTarget } from "./core/targets.js";
import { Voice } from "./net/voice.js";
import { heightAt } from "./world/terrain.js";
import { esc, fmtDist } from "./ui/icons.js";

export const MAX_MEMBERS = 6;
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";     // no 0/O, 1/I/L
const DELAY = 0.35;            // seconds other players are drawn behind real time, so there is always a next position
const STALE = 12;              // seconds without news before someone is dropped…
const STALE_PAUSED = 180;      // …or, when their last word was that they paused (a background tab may only wake once a minute)
const PAUSED_EVERY = 2000;     // ms between "still here, paused" messages
const FAR = 1500;              // metres beyond which ghosts are hidden
const JOIN_TIMEOUT = 10000;

export function newCode() {
  const a = crypto.getRandomValues(new Uint8Array(5));
  return [...a].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}
export const cleanCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);

const now = () => performance.now() / 1000;     // real seconds: keeps counting while the tab is in the background
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;

// A name tag that keeps its size on screen. paused: a pause sign after the name; talking: green, with a speaker
function makeTag(name, paused, talking) {
  const c = document.createElement("canvas"), g = c.getContext("2d");
  c.width = 256; c.height = 64;
  g.font = "600 30px system-ui, sans-serif"; g.textBaseline = "middle";
  const icon = (paused ? 30 : 0) + (talking ? 34 : 0), tw = Math.min(228 - icon - 28, g.measureText(name).width);
  const w = tw + icon + 28, x0 = (256 - w) / 2;
  g.fillStyle = talking ? "rgba(14,40,20,0.85)" : "rgba(13,10,7,0.72)"; g.beginPath(); g.roundRect(x0, 10, w, 44, 10); g.fill();
  if (talking) { g.strokeStyle = "#7fdc8f"; g.lineWidth = 4; g.stroke(); }
  g.fillStyle = talking ? "#b9f5c3" : paused ? "#c9bfae" : "#f2aa2e"; g.textAlign = "left"; g.fillText(name, x0 + 14, 33, tw);
  let px = x0 + 14 + tw + 10;
  if (paused) { g.fillStyle = "#f1e9d8"; g.fillRect(px, 21, 6, 24); g.fillRect(px + 11, 21, 6, 24); px += 30; }
  if (talking) {                               // a speaker with two sound waves
    g.fillStyle = "#7fdc8f"; g.beginPath(); g.moveTo(px, 27); g.lineTo(px + 6, 27); g.lineTo(px + 13, 20); g.lineTo(px + 13, 46); g.lineTo(px + 6, 39); g.lineTo(px, 39); g.closePath(); g.fill();
    g.strokeStyle = "#7fdc8f"; g.lineWidth = 3;
    for (const r of [7, 13]) { g.beginPath(); g.arc(px + 13, 33, r, -0.8, 0.8); g.stroke(); }
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  s.scale.set(0.16, 0.04, 1); s.renderOrder = 10;
  return s;
}
function disposeTag(t) { t.material.map.dispose(); t.material.dispose(); }

class Ghost {
  constructor(root, id, name, convoy) {
    this.root = root; this.id = id; this.name = name; this.convoy = convoy;
    this.snaps = [];           // { t (local seconds), s (message) }
    this.car = null; this.carKey = ""; this.body = new Body(root, name);
    this.paused = false; this.talking = false;
    this.tag = makeTag("@" + name, false, false);
    root.add(this.tag);
  }
  push(t, s) {
    this.snaps.push({ t, s });
    if (this.snaps.length > 12) this.snaps.shift();
  }
  // Interpolated state at local time t: { m, p: Vector3, q?: Quaternion, yaw?, speed, s (latest message) }
  sample(t) {
    const S = this.snaps;
    if (!S.length) return null;
    let a = S[0], b = null;
    for (let i = 1; i < S.length; i++) { if (S[i].t <= t) a = S[i]; else { b = S[i]; break; } }
    const p = new THREE.Vector3().fromArray(a.s.p);
    let q = a.s.q ? new THREE.Quaternion().fromArray(a.s.q) : null, yaw = a.s.yaw || 0;
    if (b && b.s.m === a.s.m) {
      const k = Math.min(1, Math.max(0, (t - a.t) / Math.max(1e-3, b.t - a.t)));
      p.lerp(new THREE.Vector3().fromArray(b.s.p), k);
      if (q && b.s.q) q.slerp(new THREE.Quaternion().fromArray(b.s.q), k);
      if (b.s.yaw !== undefined) { let d = b.s.yaw - yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); yaw += d * k; }
    } else if (a.s.v) {
      // Nothing newer yet: carry on along the last velocity for a moment
      const e = Math.min(0.6, Math.max(0, t - a.t));
      p.x += a.s.v[0] * e; p.y += a.s.v[1] * e; p.z += a.s.v[2] * e;
    }
    const last = S[S.length - 1].s;
    return { m: a.s.m, p, q, yaw, speed: Math.abs(a.s.sp || 0), s: last };
  }
  carFor(s) {
    const key = `${s.vt}|${s.pa}|${s.vs}|${s.w}`;
    if (this.car && this.carKey === key) return this.car;
    this.dropCar();
    const v = new Vehicle({ id: "convoy:" + this.id, type: VEHICLES[s.vt] ? s.vt : "pickup", seed: s.vs || 1, paint: s.pa, wearLook: s.w });
    v.rig = buildVisual(v);
    this.root.add(v.mesh);
    // "Ride with @name" when you walk up to it
    const target = this.convoy.rideTarget && this.convoy.rideTarget(this.id);
    if (target) addTarget(v.mesh, target);
    this.car = v; this.carKey = key;
    return v;
  }
  // The rig owns what it built; shared vehicle geometry and materials stay alive for the real vehicles
  dropCar() {
    if (!this.car) return;
    if (this.body.mesh.parent === this.car.mesh) this.root.add(this.body.mesh);
    removeTarget(this.car.mesh);
    this.car.rig?.dispose(); this.root.remove(this.car.mesh); this.car = null;
  }
  // The truck this member left behind (s.pk), standing where they parked it; hidden if they sent none
  park(s, focus) {
    const k = s.pk;
    if (!k) { if (this.car) this.car.mesh.visible = false; return; }
    const v = this.carFor(k);
    if (this.body.mesh.parent === v.mesh) this.root.add(this.body.mesh);
    v.pos.fromArray(k.p); v.quat.fromArray(k.q); v.vel.set(0, 0, 0);
    v.speed = 0; v.steer = k.st || 0; v.lights = !!k.l;
    v.update(0);
    v.mesh.visible = !(focus && v.pos.distanceTo(focus) > FAR);
  }
  setTag(paused, talking) {
    if (paused === this.paused && talking === this.talking) return;
    this.paused = paused; this.talking = talking;
    const old = this.tag;
    this.tag = makeTag("@" + this.name, paused, talking); this.tag.position.copy(old.position); this.tag.visible = old.visible;
    this.root.add(this.tag); this.root.remove(old); disposeTag(old);
  }
  update(t, dt, focus) {
    const st = this.sample(t);
    if (!st) return null;
    const far = focus && st.p.distanceTo(focus) > FAR;
    this.setTag(!!st.s.ps, !!this.convoy.voice.state(this.id)?.speaking);
    if (st.m === "ride") {
      // Sitting in someone's truck: theirs on this screen (a ghost), or this player's own
      this.park(st.s, focus);
      const host = this.convoy.vehicleOf(st.s.h), seat = host && host.def.seats[st.s.se] ? st.s.se : null;
      if (!seat) { this.body.show("hidden"); this.tag.visible = false; return st; }
      this.body.update(dt, { vehicle: host, seat });
      const sp = host.seatPos(seat);
      this.tag.position.set(sp.x, sp.y + 1.45, sp.z);
      this.body.show(far ? "hidden" : "full"); this.tag.visible = !far;
      return st;
    }
    if (st.m === "car") {
      const v = this.carFor(st.s);
      v.pos.copy(st.p); if (st.q) v.quat.copy(st.q);
      if (st.s.v) v.vel.fromArray(st.s.v);
      v.steer = st.s.st || 0; v.lights = !!st.s.l; v.speed = st.s.ps ? 0 : st.s.sp || 0;
      for (const w of v.wheels) w.spin += (v.speed / v.def.wheelR) * dt;
      v.update(dt);
      v.mesh.visible = !far;
      this.body.update(dt, { vehicle: v, seat: "driver", steer: v.steer });
      this.tag.position.set(st.p.x, st.p.y + 2.2, st.p.z);
    } else {
      this.park(st.s, focus);
      st.p.y = heightAt(st.p.x, st.p.z);
      this.body.update(dt, { pos: st.p, yaw: st.yaw, speed: st.s.ps ? 0 : st.speed, crawl: !!st.s.cr });
      this.tag.position.set(st.p.x, st.p.y + 2.15, st.p.z);
    }
    this.body.show(far ? "hidden" : "full");
    this.tag.visible = !far;
    return st;
  }
  dispose() {
    this.dropCar();
    this.body.dispose();
    this.root.remove(this.tag); disposeTag(this.tag);
  }
}

export class Convoy {
  // root: the world root (ghosts use absolute coordinates). onChange(): the member list or connection changed.
  // localVehicle(): the vehicle this player drives (riders sit in it); rideTarget(memberId): the interaction target
  // for a member's truck; onNotice(text): someone got in or out; onClock({ tm, wx }): adopt the leader's time of day
  // and weather; onSleep(hours): everyone is asleep, skip ahead
  constructor({ root, onChange, localVehicle, rideTarget, onNotice, onClock, onSleep } = {}) {
    this.root = root; this.onChange = onChange || (() => {});
    this.onClock = onClock || (() => {}); this.onSleep = onSleep || (() => {});
    this.localVehicle = localVehicle || (() => null); this.rideTarget = rideTarget || null; this.onNotice = onNotice || (() => {});
    this.claims = new Map();     // memberId → { v, seat }: seats held in this player's vehicle for riders
    // Voice chat (js/net/voice.js): its signalling rides on this channel as "rtc" messages addressed to one member
    this.voice = new Voice((to, data) => this.channel && this.channel.send("rtc", { ...data, id: this.me.id, to }));
    this._levelT = 0;
    this.code = null; this.channel = null; this.me = null; this.status = "off";   // off | connecting | joined | reconnecting
    this.members = new Map();    // id → { id, name, seed, ghost, last, st }
    this.getInfo = null; this._join = null; this._sendT = 0; this.mySeed = null;
    this._last = null; this._liveAt = 0; this._sentAt = 0; this._keep = null;
    this.panel = null;
  }
  get active() { return !!this.channel; }

  // Start a new convoy on this road. getInfo() → what a joining player needs (seed, difficulty, time, position…)
  host(name, getInfo) { return this.open(newCode(), name, getInfo); }

  // → Promise<info> from whoever answers first; rejects with "notfound" | "full"
  join(code, name, getInfo) {
    this.open(cleanCode(code), name, getInfo);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this._join = null; this.leave(); reject(new Error("notfound")); }, JOIN_TIMEOUT);
      this._join = {
        done: (info) => { clearTimeout(timer); this._join = null; resolve(info); },
        fail: (why) => { clearTimeout(timer); this._join = null; this.leave(); reject(new Error(why)); },
      };
    });
  }

  open(code, name, getInfo) {
    this.leave();
    this.code = code;
    this.me = { id: Math.random().toString(36).slice(2, 10), name };
    this.getInfo = getInfo;
    this.status = "connecting";
    // While this player is paused (or the tab is hidden and frames stop) the convoy still hears from them
    this._keep = setInterval(() => this.keepAlive(), 1000);
    this.channel = new Channel("longhaul-convoy-" + code, {
      onMessage: (ev, p) => this.receive(ev, p),
      onStatus: (s) => {
        if (s === "closed") return;
        this.status = s;
        if (s === "joined") this.channel.send("hello", { id: this.me.id, n: this.me.name });
        this.onChange();
      },
    });
    this.onChange();
    return code;
  }

  leave() {
    if (!this.channel) return;
    this.channel.send("bye", { id: this.me.id });
    this.voice.stop();
    this.channel.close();
    clearInterval(this._keep); this._keep = null; this._last = null;
    for (const id of [...this.claims.keys()]) this.release(id);
    this.channel = null; this.code = null; this.status = "off"; this._join = null;
    for (const m of this.members.values()) m.ghost && m.ghost.dispose();
    this.members.clear();
    this.onChange();
  }

  member(id, name) {
    let m = this.members.get(id);
    if (!m) {
      m = { id, name: String(name || "driver").slice(0, 24), seed: null, ghost: null, last: now(), st: null, paused: false };
      this.members.set(id, m);
      this.onChange();
    }
    m.last = now();
    return m;
  }

  receive(ev, p) {
    if (!p || typeof p.id !== "string" || p.id === this.me.id) return;
    if (ev === "hello") {
      const m = this.member(p.id, p.n);
      const info = this.getInfo && this.getInfo();
      // Everyone answers; the newcomer takes the first reply
      if (info) this.channel.send("info", { to: p.id, id: this.me.id, n: this.me.name, count: this.members.size + 1, ...info });
    } else if (ev === "info") {
      if (p.to !== this.me.id) return;
      this.member(p.id, p.n).seed = p.seed;
      if (this._join) {
        if ((p.count || 1) >= MAX_MEMBERS) this._join.fail("full");
        else this._join.done(p);
      }
    } else if (ev === "st") {
      const m = this.member(p.id, p.n);
      m.seed = p.seed;
      if (!!p.ps !== m.paused) { m.paused = !!p.ps; this.onChange(); }
      if (!!p.vc !== m.voice) { m.voice = !!p.vc; this.onChange(); }
      const zz = p.zz || 0;
      if (zz && !m.zz && p.seed === this.mySeed) this.onNotice(`@${m.name} is asleep. Everyone has to sleep to skip ahead.`);
      m.zz = zz;
      if (this.mySeed != null && p.seed !== this.mySeed) { if (m.ghost) { m.ghost.dispose(); m.ghost = null; } return; }
      if (!m.ghost && this.root) m.ghost = new Ghost(this.root, m.id, m.name, this);
      if (m.ghost) m.ghost.push(now(), p);
      if (p.tm !== undefined && !p.ps && this.leader() === p.id) this.onClock(p);
    } else if (ev === "zz") {
      if (this.mySeed != null && p.seed === this.mySeed && p.h > 0) this.onSleep(p.h);
    } else if (ev === "rtc") {
      if (p.to === this.me.id) this.voice.receive(p.id, p);
    } else if (ev === "bye") {
      const m = this.members.get(p.id);
      if (m) { m.ghost && m.ghost.dispose(); this.members.delete(p.id); this.onChange(); }
    }
  }

  // Every frame while a journey is loaded. local: this player's state (see main.js convoyLocal), or null while
  // paused; focus: Vector3
  tick(dt, local, focus) {
    if (!this.channel) return;
    if (local) {
      this.mySeed = local.seed;
      this._last = this.pack(local);
      this._liveAt = performance.now();
      // 4×/s while moving, once a second when standing still
      this._sendT -= dt;
      if (this._sendT <= 0 || (local.zz || 0) !== this._zz) {     // falling asleep or getting up goes out at once
        this._zz = local.zz || 0;
        this._sendT = Math.abs(local.sp || 0) > 0.3 ? 0.25 : 1;
        this.post(this._last);
      }
    }
    const t = now();
    let changed = false;
    for (const m of [...this.members.values()]) {
      if (t - m.last > (m.paused ? STALE_PAUSED : STALE)) { m.ghost && m.ghost.dispose(); this.members.delete(m.id); changed = true; continue; }
      if (m.ghost) m.st = m.ghost.update(t - DELAY, dt, focus);
    }
    this.holdSeats();
    // Voice: connect to everyone else who has it on; refresh the talking indicators 6×/s
    this.voice.sync(this.me.id, new Set([...this.members.values()].filter((m) => m.voice).map((m) => m.id)));
    if ((this._levelT -= dt) <= 0) {
      this._levelT = 0.16; this.voice.levels();
      const talk = [...this.members.values()].map((m) => !!this.voice.state(m.id)?.speaking).join() + this.voice.speaking;
      if (talk !== this._talk) { this._talk = talk; this._pt = 0; this.onChange(); }
    }
    if (changed) this.onChange();
    this.updatePanel(focus);
  }

  // Who keeps the convoy's clock: the lowest id among players on this road who aren't paused (this one included,
  // while it's playing)
  leader() {
    let best = this._liveAt && performance.now() - this._liveAt < 800 ? this.me.id : null;
    for (const m of this.members.values()) {
      if (m.paused || !m.ghost || m.seed !== this.mySeed) continue;
      if (best === null || m.id < best) best = m.id;
    }
    return best;
  }
  // Other players on this road (ones on a different road don't share the clock)
  othersHere() { return [...this.members.values()].filter((m) => m.ghost && m.seed === this.mySeed); }
  // Sleep: { asleep, of, hours } for everyone on this road, this player included with the hours they want. Paused
  // players count as asleep but don't choose how long
  sleepers(mine) {
    const o = this.othersHere(), z = o.filter((m) => m.zz > 0 || m.paused);
    return { asleep: z.length + (mine > 0 ? 1 : 0), of: o.length + 1, hours: Math.max(mine || 0, ...z.map((m) => m.zz || 0)) };
  }
  // Everyone's asleep: wake them all after the same number of hours
  wakeAll(h) {
    if (this.channel && this.mySeed != null) this.channel.send("zz", { id: this.me.id, n: this.me.name, seed: this.mySeed, h });
  }

  post(o) { this._sentAt = performance.now(); this.channel.send("st", o); }
  // Paused: where this player stopped, flagged, every couple of seconds
  keepAlive() {
    if (!this.channel || !this._last) return;
    const t = performance.now();
    if (t - this._liveAt < 800 || t - this._sentAt < PAUSED_EVERY) return;
    this.post({ ...this._last, v: [0, 0, 0], sp: 0, ps: 1 });
  }

  pack(l) {
    const o = { id: this.me.id, n: this.me.name, seed: l.seed, m: l.m, p: [r2(l.p.x), r2(l.p.y), r2(l.p.z)], v: [r2(l.v.x), r2(l.v.y), r2(l.v.z)], sp: r2(l.sp) };
    if (this.voice.on) o.vc = 1;
    if (l.zz) o.zz = r2(l.zz);
    if (l.tm !== undefined) { o.tm = r4(l.tm); o.wx = l.wx; }
    if (l.pk) { const k = l.pk; o.pk = { p: [r2(k.pos.x), r2(k.pos.y), r2(k.pos.z)], q: [r4(k.quat.x), r4(k.quat.y), r4(k.quat.z), r4(k.quat.w)], vt: k.type, pa: k.paint, vs: k.seed, w: r2(k.wearLook), st: r2(k.steer || 0), l: k.lights ? 1 : 0 }; }
    if (l.m === "car") Object.assign(o, { q: [r4(l.q.x), r4(l.q.y), r4(l.q.z), r4(l.q.w)], vt: l.vt, pa: l.pa, vs: l.vs, w: r2(l.w), st: r2(l.st), l: l.l ? 1 : 0, fs: l.fs || [] });
    else if (l.m === "ride") Object.assign(o, { h: l.host, se: l.seat });
    else { o.yaw = r2(l.yaw); if (l.cr) o.cr = 1; }
    return o;
  }

  // ── Riding ──
  // The vehicle a member is in on this screen: this player's own, or a member's ghost truck while they drive it
  vehicleOf(id) {
    if (this.me && id === this.me.id) return this.localVehicle();
    const m = this.members.get(id);
    return m && m.ghost && m.ghost.car && m.st && m.st.m === "car" ? m.ghost.car : null;
  }
  // A seat a rider could take in a member's truck: one the driver reports free and no other rider has taken
  freeSeat(id) {
    const m = this.members.get(id);
    if (!m || !m.st || m.st.m !== "car") return null;
    const taken = new Set([...this.members.values()].filter((o) => o.st && o.st.m === "ride" && o.st.s.h === id).map((o) => o.st.s.se));
    return (m.st.s.fs || []).find((seat) => !taken.has(seat)) || null;
  }
  // Riders in this player's vehicle get their seat held (so hitchhikers can't take it); released when they leave
  holdSeats() {
    const v = this.localVehicle(), want = new Map();
    for (const m of this.members.values()) if (v && m.st && m.st.m === "ride" && m.st.s.h === this.me.id && v.def.seats[m.st.s.se]) want.set(m.id, m.st.s.se);
    for (const [id, c] of [...this.claims]) if (want.get(id) !== c.seat || c.v !== v) this.release(id);
    for (const [id, seat] of want) {
      if (this.claims.has(id)) continue;
      if (v.claimSeat(seat, "convoy:" + id)) { this.claims.set(id, { v, seat }); this.onNotice(`@${this.members.get(id).name} got in.`); }
    }
  }
  release(id) {
    const c = this.claims.get(id);
    if (!c) return;
    if (c.v.seats[c.seat] === "convoy:" + id) c.v.releaseSeat(c.seat);
    this.claims.delete(id);
    const m = this.members.get(id);
    if (m) this.onNotice(`@${m.name} got out.`);
  }

  // ── Collisions ──
  // Members' trucks near (x, z), for the vehicle step's vehicle-against-vehicle contacts
  ghostCars(x, z, r = 60) {
    const out = [];
    for (const m of this.members.values()) {
      const car = m.st && m.ghost && m.ghost.car;
      if (car && car.mesh.visible && Math.abs(car.pos.x - x) < r && Math.abs(car.pos.z - z) < r) out.push(car);
    }
    return out;
  }
  // Solid shapes near (x, z): members' trucks (boxes, unless cars = false: vehicles meet them through ghostCars,
  // fresh every step) and members on foot (circles)
  colliders(x, z, r, out, cars = true) {
    for (const m of this.members.values()) {
      if (!m.st || !m.ghost) continue;
      const p = m.st.p, car = m.ghost.car, near = (q) => Math.abs(q.x - x) <= r + 6 && Math.abs(q.z - z) <= r + 6;
      if (cars && car && car.mesh.visible && near(car.pos)) out.push(...car.colliders());
      if (m.st.m === "foot" && near(p)) out.push({ kind: "circle", x: p.x, z: p.z, r: 0.35, y0: p.y, y1: p.y + 1.8 });
    }
    return out;
  }

  // For menus and the HUD: [{ name, where, paused }] – where: "1.2 km ahead", "on a different road", "joining…"
  list(focus, units) {
    return [...this.members.values()].map((m) => {
      let where = "joining…";
      if (m.seed != null && this.mySeed != null && m.seed !== this.mySeed) where = "on a different road";
      else if (m.st && focus) {
        const d = m.st.p.z - focus.z, dist = m.st.p.distanceTo(focus);
        const far = units === "mi" ? dist >= 1609.344 : dist >= 1000;
        const near = units === "mi" ? `${Math.round(dist * 3.28084 / 10) * 10} ft` : `${Math.round(dist / 10) * 10} m`;
        where = dist < 40 ? "with you" : `${far ? fmtDist(dist, units) : near} ${d > 0 ? "ahead" : "behind"}`;
      }
      const vs = this.voice.state(m.id);
      return { name: m.name, where, paused: m.paused, voice: m.voice, connected: !!vs?.connected, speaking: !!vs?.speaking };
    });
  }

  // A small panel under the minimap while playing
  showPanel(on, units) { this._units = units; if (this.panel) this.panel.hidden = !on || !this.channel; }
  updatePanel(focus) {
    if (typeof document === "undefined") return;
    if (!this.panel) {
      this.panel = document.createElement("div");
      this.panel.id = "lh-convoy"; this.panel.className = "lh-convoy"; this.panel.hidden = true;
      this.panel.setAttribute("aria-live", "polite");
    }
    // In the HUD's top-left column, under the status plate and the minimap
    const host = document.querySelector("#hud .hud-tl") || document.body;
    if (this.panel.parentNode !== host) host.appendChild(this.panel);
    if (!this.channel) { this.panel.hidden = true; return; }
    this._pt = (this._pt || 0) - 1;
    if (this._pt > 0) return;          // text refreshes every ~20 frames
    this._pt = 20;
    const rows = this.list(focus, this._units);
    const v = this.voice;
    // Your own microphone: a bar that lights up while you're heard
    const me = !v.on ? "" : `<div class="lh-convoy-me${v.speaking ? " lh-talking" : ""}"><i class="lh-vc${v.muted ? " lh-vc-off" : v.speaking ? " lh-vc-talk" : v.transmitting ? "" : " lh-vc-ptt"}"></i><span>${
      v.muted ? "Mic muted" : !v.transmitting ? `Push to talk (${esc(this.talkKey || "V")})` : v.speaking ? "You're talking" : "Mic on"}</span></div>`;
    const head = (this.status === "joined" ? `Convoy <b>${esc(this.code)}</b> · ${rows.length + 1} ${rows.length ? "drivers" : "driver – share the code"}`
      : `Convoy <b>${esc(this.code)}</b> · ${this.status === "reconnecting" ? "reconnecting…" : "connecting…"}`);
    this.panel.innerHTML = `<div class="lh-convoy-head">${head}</div>` + me + rows.map((r) => `<div${r.speaking ? ' class="lh-talking"' : ""}><span>@${esc(r.name)}${r.paused ? ` <i class="lh-paused" role="img" aria-label="paused"></i>` : ""}${r.voice && v.on ? ` <i class="lh-vc${r.speaking ? " lh-vc-talk" : ""}${r.connected ? "" : " lh-vc-wait"}" role="img" aria-label="${r.speaking ? "talking" : "on voice"}"></i>` : ""}</span><em>${esc(r.where)}</em></div>`).join("");
  }
}
