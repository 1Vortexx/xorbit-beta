// Long Haul – the player's weapons: the knife, the handgun and the AK-47 (item defs carry `weapon`, js/items.js).
// A weapon works while it is in the hands on foot: LMB attacks (held = automatic fire), R reloads a gun from the
// matching ammo boxes in the pockets or lying within reach. Hits land on people (js/npc) only; walls, buildings and
// vehicles stop bullets. Damaged people emit "npc:wounded" and, at zero health, go down and emit "npc:killed".
import * as THREE from "three";
import { ITEMS } from "./items.js";
import { emit, notify, sfx } from "./core/bus.js";
import { circleFree } from "./core/collide.js";

const _eye = new THREE.Vector3(), _dir = new THREE.Vector3();
const NPC_R = 0.34;

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
  }
  get weapon() { const h = this.interaction.held; return h && ITEMS[h.type]?.weapon ? h : null; }

  // Per frame on foot, after the interaction update. input: the foot() frame (pressed / held action sets).
  update(dt, input) {
    this.cool = Math.max(0, this.cool - dt);
    if (this.flashT > 0 && (this.flashT -= dt) <= 0 && this.flash) this.flash.intensity = 0;
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
    if (best && this._blocked(o, d, best.t, best.npc)) return null;
    return best;
  }
  _blocked(o, d, len, npc) {
    const cols = this.getColliders((o.x + d.x * len / 2), (o.z + d.z * len / 2), len / 2 + 2)
      .filter((c) => !c.npc && !(npc.seat && c.vehicle && c.vehicle.id === npc.seat.vehicle));
    for (let t = 0.4; t < len - 0.3; t += 0.2) {
      const y = o.y + d.y * t;
      if (!circleFree(o.x + d.x * t, o.z + d.z * t, 0.02, cols, y - 0.02, y + 0.02)) return true;
    }
    return false;
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
  dispose() { if (this.flash) { this.flash.parent?.remove(this.flash); this.flash.dispose(); this.flash = null; } }
}
