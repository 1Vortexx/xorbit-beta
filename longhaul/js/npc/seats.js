// Long Haul – people: thin, feature-detecting wrapper around the vehicle seat hooks of ARCHITECTURE §14.5.
// A vehicle that implements seatFree / claimSeat / releaseSeat / seatOf / seatPos / doorSpot is used as is; anything
// missing falls back to a `vehicle.seats` map kept here, so mocks and older vehicles never crash the people code.
import * as THREE from "three";

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
const has = (v, m) => v && typeof v[m] === "function";

function ensure(v) {
  if (!v.seats) {
    v.seats = {};
    for (const n of (v.def && v.def.seats ? Object.keys(v.def.seats) : ["driver", "passenger"])) v.seats[n] = null;
  }
  return v.seats;
}
export function seatNames(v) { return Object.keys(ensure(v)); }
export function seatFree(v, name) {
  const seats = ensure(v);
  if (!(name in seats)) return false;
  if (has(v, "seatFree")) return !!v.seatFree(name);
  return seats[name] == null && !(name === "driver" && v.occupied);
}
export function seatOf(v, who) {
  if (!v || !who) return null;
  if (has(v, "seatOf")) return v.seatOf(who) || null;
  const seats = ensure(v);
  for (const k in seats) if (seats[k] === who) return k;
  return null;
}
// Claim a seat for `who`. Never succeeds on an occupied seat; claiming the seat one already holds is a no-op success.
export function claimSeat(v, name, who) {
  if (!v || !who) return false;
  const seats = ensure(v);
  if (!(name in seats)) return false;
  if (seats[name] === who) return true;
  if (seats[name] != null || seatOf(v, who)) return false;
  if (has(v, "claimSeat")) return !!v.claimSeat(name, who);
  if (!seatFree(v, name)) return false;
  seats[name] = who;
  return true;
}
// Release `name` only if `who` is the one sitting there (so nobody can free the player's or another person's seat).
export function releaseSeat(v, name, who) {
  if (!v) return false;
  const seats = ensure(v);
  if (seats[name] !== who) return false;
  if (has(v, "releaseSeat")) v.releaseSeat(name); else seats[name] = null;
  return true;
}
// First free seat that is not the driver's, in order of preference. null when the vehicle is full.
export function freePassengerSeat(v, prefer = ["passenger", "rearR", "rearL"]) {
  if (!v) return null;
  const names = seatNames(v);
  for (const n of prefer) if (names.includes(n) && seatFree(v, n)) return n;
  for (const n of names) if (n !== "driver" && seatFree(v, n)) return n;
  return null;
}
export function doorName(v, name) {
  const d = v.def && v.def.seats && v.def.seats[name] && v.def.seats[name].door;
  if (d) return d;
  return name === "driver" || name === "rearL" ? "driver" : "passenger";
}
// Vehicle-local hip point of a seat → out ([x, y, z])
export function seatLocal(v, name, out = [0, 0, 0]) {
  const s = v.def && v.def.seats && v.def.seats[name];
  if (s && s.pos) { out[0] = s.pos[0]; out[1] = s.pos[1]; out[2] = s.pos[2]; return out; }
  if (has(v, "seatPos") && v.pos && v.quat) {
    v.seatPos(name, _v).sub(v.pos).applyQuaternion(_q.copy(v.quat).invert());
    out[0] = _v.x; out[1] = _v.y; out[2] = _v.z; return out;
  }
  const b = (v.def && v.def.body) || {}, left = name === "driver" || name === "rearL", rear = name.startsWith("rear");
  out[0] = (left ? 1 : -1) * (b.seatX || 0.4); out[1] = (b.seatY || 0.6) - ((v.def && v.def.comH) || 0.6);
  out[2] = rear ? -0.9 : (b.seatZ || -0.2);
  return out;
}
const _l = [0, 0, 0];
// Absolute hip point of a seat
export function seatWorld(v, name, out = new THREE.Vector3()) {
  if (has(v, "seatPos")) return v.seatPos(name, out);
  seatLocal(v, name, _l);
  out.set(_l[0], _l[1], _l[2]);
  if (v.quat) out.applyQuaternion(v.quat);
  return out.add(v.pos);
}
// Standing spot outside the door of a seat
export function doorSpot(v, name) {
  if (has(v, "doorSpot")) return v.doorSpot(name);
  seatLocal(v, name, _l);
  const hw = (v.def && v.def.halfW) || 1;
  _v.set(Math.sign(_l[0] || 1) * (hw + 0.85), 0, _l[2]);
  if (v.quat) _v.applyQuaternion(v.quat);
  return { x: v.pos.x + _v.x, z: v.pos.z + _v.z };
}
export function vehicleYaw(v) {
  if (typeof v.yaw === "number") return v.yaw;
  if (!v.quat) return 0;
  _v.set(0, 0, 1).applyQuaternion(v.quat);
  return Math.atan2(_v.x, _v.z);
}
export function vehicleSpeed(v) {
  if (v.vel) return Math.hypot(v.vel.x, v.vel.z);
  return Math.abs(v.speed || 0);
}
