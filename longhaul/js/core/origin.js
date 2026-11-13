// Long Haul – floating origin.
// Simulation uses absolute world coordinates (JS doubles) everywhere. Rendering stays precise because every
// world object – chunks, vehicles, props, the camera, lights, sky – is a descendant of `worldRoot`, which is
// offset by −origin. Matrices are composed in doubles, so what reaches the GPU is always near zero.
// Rules: never add world objects straight to the scene; keep vertex/instance data local to a nearby parent.
import * as THREE from "three";

export const origin = new THREE.Vector3();
export const worldRoot = new THREE.Group();
worldRoot.name = "worldRoot";

const SNAP = 200, LIMIT = 1500;
// Call once per frame with the focus position (absolute). Returns true when the origin moved.
export function rebase(focus) {
  if (Math.abs(focus.x - origin.x) < LIMIT && Math.abs(focus.z - origin.z) < LIMIT) return false;
  origin.set(Math.round(focus.x / SNAP) * SNAP, 0, Math.round(focus.z / SNAP) * SNAP);
  worldRoot.position.copy(origin).multiplyScalar(-1);
  worldRoot.updateMatrixWorld(true);
  return true;
}
export function resetOrigin() { origin.set(0, 0, 0); worldRoot.position.set(0, 0, 0); worldRoot.updateMatrixWorld(true); }

// Raycaster hits, getWorldPosition() etc. are in render space; these convert to and from absolute coordinates.
export function toWorld(renderPoint, out = renderPoint) { return out.copy(renderPoint).add(origin); }
export function toRender(worldPoint, out = worldPoint) { return out.copy(worldPoint).sub(origin); }
