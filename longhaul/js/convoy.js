// Long Haul – convoy: drive the same road with friends. Everyone with the same world seed builds the same road, so
// only positions travel over the network (js/net/realtime.js, a Supabase broadcast channel named after the code).
// Each player's world is still their own: loot, strangers, wrecks and damage are not shared. Other players are drawn
// as ghosts – their vehicle or their body plus a name tag – that nothing collides with.
import * as THREE from "three";
import { Channel } from "./net/realtime.js";
import { Vehicle } from "./vehicles/vehicle.js";
import { buildVisual } from "./vehicles/models.js";
import { VEHICLES } from "./vehicles/defs.js";
import { buildPerson, pose } from "./npc/model.js";
import { hashStr, heightAt } from "./world/terrain.js";
import { esc, fmtDist } from "./ui/icons.js";

export const MAX_MEMBERS = 6;
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";     // no 0/O, 1/I/L
const DELAY = 0.35;            // seconds other players are drawn behind real time, so there is always a next position
const STALE = 12;              // seconds without news before someone is dropped
const FAR = 1500;              // metres beyond which ghosts are hidden
const JOIN_TIMEOUT = 10000;

export function newCode() {
  const a = crypto.getRandomValues(new Uint8Array(5));
  return [...a].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}
export const cleanCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);

const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;

// A name tag that keeps its size on screen
function makeTag(name) {
  const c = document.createElement("canvas"), g = c.getContext("2d");
  c.width = 256; c.height = 64;
  g.font = "600 30px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  const w = Math.min(248, g.measureText(name).width + 28);
  g.fillStyle = "rgba(13,10,7,0.72)"; g.beginPath(); g.roundRect((256 - w) / 2, 10, w, 44, 10); g.fill();
  g.fillStyle = "#f2aa2e"; g.fillText(name, 128, 33, 230);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  s.scale.set(0.16, 0.04, 1); s.renderOrder = 10;
  return s;
}
function disposeTag(t) { t.material.map.dispose(); t.material.dispose(); }

class Ghost {
  constructor(root, id, name) {
    this.root = root; this.id = id; this.name = name;
    this.snaps = [];           // { t (local seconds), s (message) }
    this.car = null; this.carKey = ""; this.person = null; this.phase = 0;
    this.tag = makeTag("@" + name);
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
    this.car = v; this.carKey = key;
    return v;
  }
  // The rig owns what it built; shared vehicle geometry and materials stay alive for the real vehicles
  dropCar() { if (this.car) { this.car.rig?.dispose(); this.root.remove(this.car.mesh); this.car = null; } }
  personMesh() {
    if (!this.person) { this.person = buildPerson(hashStr(this.name) || 1, "walker"); this.root.add(this.person.mesh); }
    return this.person;
  }
  update(t, dt, focus) {
    const st = this.sample(t);
    if (!st) return null;
    const far = focus && st.p.distanceTo(focus) > FAR;
    if (st.m === "car") {
      if (this.person) this.person.mesh.visible = false;
      const v = this.carFor(st.s);
      v.pos.copy(st.p); if (st.q) v.quat.copy(st.q);
      v.steer = st.s.st || 0; v.lights = !!st.s.l; v.speed = st.s.sp || 0;
      for (const w of v.wheels) w.spin += (v.speed / v.def.wheelR) * dt;
      v.update(dt);
      v.mesh.visible = !far;
      this.tag.position.set(st.p.x, st.p.y + 2.2, st.p.z);
    } else {
      if (this.car) this.car.mesh.visible = false;
      const pr = this.personMesh();
      const moving = st.speed > 0.3;
      this.phase += dt * (st.speed > 4 ? 10 : 6.5) * (moving ? 1 : 0);
      pr.mesh.position.set(st.p.x, heightAt(st.p.x, st.p.z), st.p.z);
      pr.mesh.rotation.y = st.yaw;
      pose(pr, moving ? "walk" : "idle", this.phase, moving, "walker");
      pr.mesh.visible = !far;
      this.tag.position.set(st.p.x, pr.mesh.position.y + 2.15, st.p.z);
    }
    this.tag.visible = !far;
    return st;
  }
  dispose() {
    this.dropCar();
    if (this.person) { this.root.remove(this.person.mesh); this.person = null; }
    this.root.remove(this.tag); disposeTag(this.tag);
  }
}

export class Convoy {
  // root: the world root (ghosts use absolute coordinates). onChange(): the member list or connection changed.
  constructor({ root, onChange } = {}) {
    this.root = root; this.onChange = onChange || (() => {});
    this.code = null; this.channel = null; this.me = null; this.status = "off";   // off | connecting | joined | reconnecting
    this.members = new Map();    // id → { id, name, seed, ghost, last, st }
    this.getInfo = null; this._join = null; this._sendT = 0; this.clock = 0; this.mySeed = null;
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
    this.channel.close();
    this.channel = null; this.code = null; this.status = "off"; this._join = null;
    for (const m of this.members.values()) m.ghost && m.ghost.dispose();
    this.members.clear();
    this.onChange();
  }

  member(id, name) {
    let m = this.members.get(id);
    if (!m) {
      m = { id, name: String(name || "driver").slice(0, 24), seed: null, ghost: null, last: this.clock, st: null };
      this.members.set(id, m);
      this.onChange();
    }
    m.last = this.clock;
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
      if (this.mySeed != null && p.seed !== this.mySeed) { if (m.ghost) { m.ghost.dispose(); m.ghost = null; } return; }
      if (!m.ghost && this.root) m.ghost = new Ghost(this.root, m.id, m.name);
      if (m.ghost) m.ghost.push(this.clock, p);
    } else if (ev === "bye") {
      const m = this.members.get(p.id);
      if (m) { m.ghost && m.ghost.dispose(); this.members.delete(p.id); this.onChange(); }
    }
  }

  // Every frame while a journey is loaded. local: this player's state (see main.js convoyLocal); focus: Vector3
  tick(dt, local, focus) {
    this.clock += dt;
    if (!this.channel) return;
    this.mySeed = local ? local.seed : this.mySeed;
    // Send 4×/s while moving, once a second when standing still
    this._sendT -= dt;
    if (local && this._sendT <= 0) {
      const moving = Math.abs(local.sp || 0) > 0.3;
      this._sendT = moving ? 0.25 : 1;
      this.channel.send("st", this.pack(local));
    }
    let changed = false;
    for (const m of [...this.members.values()]) {
      if (this.clock - m.last > STALE) { m.ghost && m.ghost.dispose(); this.members.delete(m.id); changed = true; continue; }
      if (m.ghost) m.st = m.ghost.update(this.clock - DELAY, dt, focus);
    }
    if (changed) this.onChange();
    this.updatePanel(focus);
  }

  pack(l) {
    const o = { id: this.me.id, n: this.me.name, seed: l.seed, m: l.m, p: [r2(l.p.x), r2(l.p.y), r2(l.p.z)], v: [r2(l.v.x), r2(l.v.y), r2(l.v.z)], sp: r2(l.sp) };
    if (l.m === "car") Object.assign(o, { q: [r4(l.q.x), r4(l.q.y), r4(l.q.z), r4(l.q.w)], vt: l.vt, pa: l.pa, vs: l.vs, w: r2(l.w), st: r2(l.st), l: l.l ? 1 : 0 });
    else o.yaw = r2(l.yaw);
    return o;
  }

  // For menus and the HUD: [{ name, where }] – where: "1.2 km ahead", "on a different road", "connecting"
  list(focus, units) {
    return [...this.members.values()].map((m) => {
      let where = "joining…";
      if (m.seed != null && this.mySeed != null && m.seed !== this.mySeed) where = "on a different road";
      else if (m.st && focus) {
        const d = m.st.p.z - focus.z, dist = m.st.p.distanceTo(focus);
        where = dist < 40 ? "with you" : `${fmtDist(dist, units)} ${d > 0 ? "ahead" : "behind"}`;
      }
      return { name: m.name, where };
    });
  }

  // A small panel under the top-left plate while playing
  showPanel(on, units) { this._units = units; if (this.panel) this.panel.hidden = !on || !this.channel; }
  updatePanel(focus) {
    if (typeof document === "undefined") return;
    if (!this.panel) {
      this.panel = document.createElement("div");
      this.panel.id = "lh-convoy"; this.panel.className = "lh-convoy"; this.panel.hidden = true;
      this.panel.setAttribute("aria-live", "polite");
      document.body.appendChild(this.panel);
    }
    if (!this.channel) { this.panel.hidden = true; return; }
    this._pt = (this._pt || 0) - 1;
    if (this._pt > 0) return;          // text refreshes every ~20 frames
    this._pt = 20;
    const rows = this.list(focus, this._units);
    const head = this.status === "joined" ? `Convoy <b>${esc(this.code)}</b> · ${rows.length + 1} ${rows.length ? "drivers" : "driver – share the code"}`
      : `Convoy <b>${esc(this.code)}</b> · ${this.status === "reconnecting" ? "reconnecting…" : "connecting…"}`;
    this.panel.innerHTML = `<div class="lh-convoy-head">${head}</div>` + rows.map((r) => `<div><span>@${esc(r.name)}</span><em>${esc(r.where)}</em></div>`).join("");
  }
}
