// Long Haul – the player's weapons: the knife, the handgun and the AK-47 (item defs carry `weapon`, js/items.js).
// A weapon works while it is in the hands on foot: LMB attacks (held = automatic fire), R reloads a gun from the
// matching ammo boxes in the pockets or lying within reach. Hits land on people (js/npc) only; walls, buildings and
// vehicles stop bullets. Damaged people emit "npc:wounded" and, at zero health, go down and emit "npc:killed".
import * as THREE from "three";
import { ITEMS } from "./items.js";
import { emit, notify, sfx } from "./core/bus.js";
import { circleFree } from "./core/collide.js";

const _eye = new THREE.Vector3(), _dir = new THREE.Vector3(), _mz = new THREE.Vector3(), _end = new THREE.Vector3();
const NPC_R = 0.34;
const TRACER_T = 0.09, FLASH_T = 0.05, PUFF_T = 0.45;           // seconds each effect stays visible
const DUST = 0xb7a483, BLOOD = 0x6e1010;

// Soft four-pointed muzzle flash with a hot core
function flashTexture() {
  const S = 64, c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d"), h = S / 2;
  const core = g.createRadialGradient(h, h, 0, h, h, h);
  core.addColorStop(0, "rgba(255,255,240,1)"); core.addColorStop(0.25, "rgba(255,210,120,0.9)"); core.addColorStop(1, "rgba(255,140,40,0)");
  g.fillStyle = core; g.beginPath(); g.arc(h, h, h * 0.6, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 4; i++) {
    g.save(); g.translate(h, h); g.rotate(i * Math.PI / 2 + 0.3);
    const ray = g.createLinearGradient(0, 0, h, 0);
    ray.addColorStop(0, "rgba(255,230,160,0.9)"); ray.addColorStop(1, "rgba(255,150,50,0)");
    g.fillStyle = ray; g.beginPath(); g.moveTo(0, -4); g.lineTo(h, 0); g.lineTo(0, 4); g.fill(); g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Combat {
  // deps: { player, npcs, pockets, props, interaction, getColliders(x, z, r), root (render-space parent for the flash) }
  constructor(deps) {
    Object.assign(this, deps);
    this.cool = 0;              // seconds until the next attack
    this.reloading = 0;         // seconds left of a reload
    this.flashT = 0;
    // Always in the scene at zero intensity: adding or hiding a light mid-fight would recompile every shader
    this.flash = null;
    if (this.root) { this.flash = new THREE.PointLight(0xffc070, 0, 9, 2); this.flash.castShadow = false; this.root.add(this.flash); }
    this.fx = this.root ? this._makeFx() : null;
  }
  // Visible shots: a muzzle-flash sprite, a few pooled tracer streaks and impact puffs (dust, or blood on a person).
  // Everything stays in the scene at zero opacity so the first shot does not stall on shader compiles.
  _makeFx() {
    const add = (o) => { o.frustumCulled = false; o.renderOrder = 3; this.root.add(o); return o; };
    const basic = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
    const flashMat = new THREE.SpriteMaterial({ map: flashTexture(), color: 0xffd08a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const flash = add(new THREE.Sprite(flashMat));
    const tg = new THREE.CylinderGeometry(0.011, 0.011, 1, 5, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    const tracers = [], puffs = [];
    for (let i = 0; i < 4; i++) {
      const m = basic(0xffe2a8); m.blending = THREE.AdditiveBlending;
      tracers.push({ mesh: add(new THREE.Mesh(tg, m)), t: 0 });
    }
    const pg = new THREE.IcosahedronGeometry(0.1, 1);
    for (let i = 0; i < 6; i++) puffs.push({ mesh: add(new THREE.Mesh(pg, basic(DUST))), t: 0 });
    return { flash, flashT: 0, tracers, puffs, ti: 0, pi: 0, geos: [tg, pg] };
  }
  _shotFx(from, to, hitNpc, hitSomething) {
    const fx = this.fx;
    if (!fx) return;
    fx.flash.position.copy(from).addScaledVector(_dir, 0.05); fx.flash.scale.setScalar(0.13 + Math.random() * 0.06);
    fx.flash.material.rotation = Math.random() * Math.PI; fx.flash.material.opacity = 1; fx.flashT = FLASH_T;
    const len = from.distanceTo(to);
    if (len > 0.3) {
      const tr = fx.tracers[fx.ti++ % fx.tracers.length];
      tr.mesh.position.copy(from); tr.mesh.lookAt(to); tr.mesh.scale.set(1, 1, len);
      tr.mesh.material.opacity = 0.85; tr.t = TRACER_T;
    }
    if (hitSomething) {
      const pf = fx.puffs[fx.pi++ % fx.puffs.length];
      pf.mesh.position.copy(to); pf.mesh.scale.setScalar(0.6); pf.mesh.material.color.setHex(hitNpc ? BLOOD : DUST);
      pf.mesh.material.opacity = 0.8; pf.t = PUFF_T;
    }
  }
  _fadeFx(dt) {
    const fx = this.fx;
    if (!fx) return;
    if (fx.flashT > 0 && (fx.flashT -= dt) <= 0) fx.flash.material.opacity = 0;
    for (const tr of fx.tracers) if (tr.t > 0) { tr.t -= dt; tr.mesh.material.opacity = tr.t > 0 ? 0.85 * tr.t / TRACER_T : 0; }
    for (const pf of fx.puffs) if (pf.t > 0) {
      pf.t -= dt; const k = Math.max(0, pf.t / PUFF_T);
      pf.mesh.material.opacity = 0.8 * k; pf.mesh.scale.setScalar(0.6 + (1 - k) * 2.4); pf.mesh.position.y += dt * 0.25;
    }
  }
  get weapon() { const h = this.interaction.held; return h && ITEMS[h.type]?.weapon ? h : null; }

  // Per frame on foot, after the interaction update. input: the foot() frame (pressed / held action sets).
  update(dt, input) {
    this.cool = Math.max(0, this.cool - dt);
    if (this.flashT > 0 && (this.flashT -= dt) <= 0 && this.flash) this.flash.intensity = 0;
    this._fadeFx(dt);
    const item = this.weapon;
    if (!item) { this.reloading = 0; return; }
    const w = ITEMS[item.type].weapon;
    if (this.reloading > 0) {
      if ((this.reloading -= dt) <= 0) this._finishReload(item);
      return;
    }
    if (input.pressed?.has("rotate") && w.kind === "gun") { this.reload(item); return; }
    const trigger = w.auto ? input.held?.has("grab") : input.pressed?.has("grab");
    if (!trigger || this.cool > 0) return;
    this.cool = w.rate;
    if (w.kind === "melee") this._stab(w);
    else this._fire(item, w);
  }

  // HUD hints for the held weapon (interaction.js shows them in place of the drop / rotate hints)
  hints(item) {
    const w = ITEMS[item.type].weapon;
    if (w.kind === "melee") return ["LMB stab"];
    if (this.reloading > 0) return ["Reloading…"];
    return [w.auto ? "Hold LMB fire" : "LMB fire", "R reload"];
  }

  // ── melee ──
  _stab(w) {
    sfx("knife_swing");
    this.interaction.kick?.("melee");
    const n = this._aimNpc(w.range, 0.5);
    if (!n) return;
    sfx("knife_hit", { pos: n.pos });
    this.damage(n.npc, w.dmg, "knife");
  }

  // ── guns ──
  _fire(item, w) {
    if (!(item.qty > 0)) {
      sfx("gun_empty");
      notify(`Empty. ${this.ammoLeft(w.ammo) ? "Press R to reload." : "No " + ITEMS[w.ammo].name.toLowerCase() + " on you."}`, { key: "ammo", level: "warn" });
      return;
    }
    item.qty--;
    sfx("gunshot", { big: !!w.big });
    emit("gunshot", { pos: this.player.pos.clone(), weapon: item.type });
    this._muzzle();
    this.player.eye(_eye); this.player.dir(_dir);
    _dir.x += (Math.random() - 0.5) * w.spread * 2; _dir.y += (Math.random() - 0.5) * w.spread * 2; _dir.z += (Math.random() - 0.5) * w.spread * 2;
    _dir.normalize();
    const hit = this._rayNpc(_eye, _dir, w.range);
    if (hit) this.damage(hit.npc, w.dmg, item.type);
    // Where the round stops (person, wall / vehicle, ground or out of range), for the tracer and the impact puff
    this._hitKind = null;
    const stop = hit ? hit.t : this._wallAt(_eye, _dir, w.range, null);
    _end.copy(_eye).addScaledVector(_dir, stop >= 0 ? stop : w.range);
    if (hit) sfx("bullet_flesh", { pos: _end.clone() });
    else if (stop >= 0) sfx(this._hitKind === "ground" ? "bullet_dirt" : "ricochet", { pos: _end.clone() });
    this.interaction.muzzle ? this.interaction.muzzle(_mz) : _mz.copy(_eye);
    this._shotFx(_mz, _end, !!hit, stop >= 0);
    this.interaction.kick?.("gun");
  }

  reload(item) {
    const w = ITEMS[item.type].weapon, cap = ITEMS[item.type].cap;
    if ((item.qty || 0) >= cap) { notify("Already full", { key: "ammo" }); return; }
    if (!this.ammoLeft(w.ammo)) { sfx("gun_empty"); notify(`No ${ITEMS[w.ammo].name.toLowerCase()} on you or within reach`, { key: "ammo", level: "warn" }); return; }
    this.reloading = w.auto ? 2.2 : 1.5;
    sfx("reload");
  }
  _finishReload(item) {
    const w = ITEMS[item.type].weapon, cap = ITEMS[item.type].cap;
    let need = cap - (item.qty || 0);
    for (const box of this._ammoBoxes(w.ammo)) {
      if (need <= 0) break;
      const take = Math.min(need, box.item.qty || 0);
      box.item.qty -= take; item.qty = (item.qty || 0) + take; need -= take;
      if (box.prop) this.props.touch?.(box.prop);
    }
    notify(`${ITEMS[item.type].name}: ${item.qty} / ${cap} · ${this.ammoLeft(w.ammo)} spare`, { key: "ammo", icon: "🔫" });
  }
  // Ammo boxes the player can reach: pockets first, then boxes lying within 3.5 m
  _ammoBoxes(type) {
    const out = [];
    for (const s of this.pockets.slots) if (s) for (const it of s.items) if (it.type === type && it.qty > 0) out.push({ item: it });
    const pp = this.player.pos;
    for (const p of this.props.list) {
      if (p.item.type !== type || !(p.item.qty > 0) || p.held) continue;
      const w = this.props.pose(p).pos, x = Array.isArray(w) ? w[0] : w.x, z = Array.isArray(w) ? w[2] : w.z;
      if (Math.hypot(x - pp.x, z - pp.z) < 3.5) out.push({ item: p.item, prop: p });
    }
    return out;
  }
  ammoLeft(type) { return this._ammoBoxes(type).reduce((n, b) => n + (b.item.qty || 0), 0); }

  // ── targeting ──
  // Nearest standing person in front within range and the cone (cos of the half angle), with a clear line
  _aimNpc(range, cosMin) {
    this.player.eye(_eye); this.player.dir(_dir);
    let best = null;
    for (const npc of this.npcs.list) {
      if (npc.seat || npc.state === "down") continue;
      const dx = npc.pos.x - _eye.x, dz = npc.pos.z - _eye.z, d = Math.hypot(dx, dz);
      if (d > range || d < 1e-3) continue;
      const c = (dx * _dir.x + dz * _dir.z) / (d * Math.hypot(_dir.x, _dir.z) || 1);
      if (c < cosMin || (best && d >= best.d)) continue;
      best = { npc, d, pos: npc.pos };
    }
    return best;
  }
  // First person the ray meets before any wall / vehicle / building in the way
  _rayNpc(o, d, range) {
    let best = null;
    for (const npc of this.npcs.list) {
      if (npc.state === "down") continue;
      const top = npc.state === "sit" ? 1.25 : 1.75;
      // closest approach of the ray to the person's vertical axis, in the ground plane
      const px = npc.pos.x - o.x, pz = npc.pos.z - o.z, hh = d.x * d.x + d.z * d.z;
      if (hh < 1e-6) continue;
      const tc = (px * d.x + pz * d.z) / hh;                 // ray parameter (metres along d) at closest approach
      const cx = o.x + d.x * tc - npc.pos.x, cz = o.z + d.z * tc - npc.pos.z;
      const miss2 = cx * cx + cz * cz;
      if (miss2 > NPC_R * NPC_R) continue;
      const t = tc - Math.sqrt(NPC_R * NPC_R - miss2) / Math.sqrt(hh);   // where the ray enters the body
      if (t <= 0 || t > range) continue;
      const y = o.y + d.y * t;
      if (y < npc.pos.y || y > npc.pos.y + top) continue;
      if (!best || t < best.t) best = { npc, t };
    }
    if (best && this._wallAt(o, d, best.t - 0.3, best.npc) >= 0) return null;
    return best;
  }
  // Distance along the ray to the first wall / vehicle / building or the ground within len, or −1. npc: a target
  // whose own vehicle does not count (someone shot through their open window).
  _wallAt(o, d, len, npc) {
    const cols = this.getColliders((o.x + d.x * len / 2), (o.z + d.z * len / 2), len / 2 + 2)
      .filter((c) => !c.npc && !(npc && npc.seat && c.vehicle && c.vehicle.id === npc.seat.vehicle));
    const ground = this.props.heightAt ? (x, z) => this.props.heightAt(x, z) : null;
    for (let t = 0.4; t < len; t += t < 20 ? 0.2 : 0.4) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (ground && y < ground(x, z)) { this._hitKind = "ground"; return t; }
      if (!circleFree(x, z, 0.02, cols, y - 0.02, y + 0.02)) { this._hitKind = "solid"; return t; }
    }
    return -1;
  }

  // Wound a person. Anyone can call this (hitchhikers fighting back, tests).
  damage(npc, dmg, by) {
    if (npc.state === "down") return;
    sfx("punch", { pos: npc.pos, vol: 0.6 });
    if (npc.wound(dmg)) emit("npc:killed", { npc, by });
    else emit("npc:wounded", { npc, by, dmg });
  }

  _muzzle() {
    if (!this.flash) return;
    this.player.eye(_eye); this.player.dir(_dir);
    this.flash.position.copy(_eye).addScaledVector(_dir, 0.9);      // worldRoot children use absolute coordinates
    this.flash.intensity = 30; this.flashT = 0.05;
  }
  dispose() {
    if (this.flash) { this.flash.parent?.remove(this.flash); this.flash.dispose(); this.flash = null; }
    if (this.fx) {
      const fx = this.fx;
      fx.flash.material.map.dispose();
      for (const o of [fx.flash, ...fx.tracers.map((t) => t.mesh), ...fx.puffs.map((p) => p.mesh)]) { o.parent?.remove(o); o.material.dispose(); }
      for (const g of fx.geos) g.dispose();
      this.fx = null;
    }
  }
}
