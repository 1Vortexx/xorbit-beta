// Long Haul – registry of things the player can look at and act on (one raycast system for everything).
// See ARCHITECTURE.md §Interaction for the Target / Action shapes.
const roots = new Set();      // Object3D roots that carry (or contain) targets
const occluders = new Set();  // Object3D roots that only block line of sight (walls, bodies, terrain proxies)

// Make `object` (and its descendants) resolve to `target` when hit.
export function addTarget(object, target) {
  object.userData.target = target;
  roots.add(object);
  return target;
}
export function removeTarget(object) { roots.delete(object); delete object.userData.target; }
export function addOccluder(object) { occluders.add(object); }
export function removeOccluder(object) { occluders.delete(object); }
// Drop everything registered under `ancestor` (call when a chunk, vehicle or prop is disposed)
export function removeAllUnder(ancestor) {
  const under = (o) => { for (let p = o; p; p = p.parent) if (p === ancestor) return true; return false; };
  for (const o of [...roots]) if (under(o)) removeTarget(o);
  for (const o of [...occluders]) if (under(o)) occluders.delete(o);
}

const list = [];
// First thing along the ray within maxDist. Returns { target, object, point (render space), distance } or null
// when nothing is hit or an occluder is in front. `ignore` = Object3D whose subtree is skipped (the held prop).
export function raycastTargets(raycaster, maxDist, ignore = null) {
  list.length = 0;
  for (const o of roots) if (o.visible && o.parent) list.push(o);
  for (const o of occluders) if (o.visible && o.parent) list.push(o);
  const far = raycaster.far;
  raycaster.far = maxDist;
  const hits = raycaster.intersectObjects(list, true);
  raycaster.far = far;
  for (const h of hits) {
    let target = null, skip = false, hidden = false;
    for (let p = h.object; p; p = p.parent) {
      if (p === ignore) { skip = true; break; }
      if (!p.visible) { hidden = true; break; }
      if (!target && p.userData.target) target = p.userData.target;
    }
    if (skip || hidden) continue;
    if (!target) return null; // occluder first
    return { target, object: h.object, point: h.point, distance: h.distance };
  }
  return null;
}
