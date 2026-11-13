import assert from "node:assert";
import { resolveCircle, circleFree } from "../js/core/collide.js";
let p = { x: 0.5, z: 0 };
resolveCircle(p, 0.35, [{ kind: "circle", x: 0, z: 0, r: 1 }]);
assert(Math.abs(Math.hypot(p.x, p.z) - 1.35) < 1e-6);
// wall along x at z=2, 0.2 thick, rotated 90° → runs along z at x=2
const wall = { kind: "box", x: 2, z: 0, hx: 3, hz: 0.1, yaw: Math.PI / 2 };
p = { x: 1.8, z: 1 };
const c = resolveCircle(p, 0.35, [wall]);
assert(c && Math.abs(p.x - (2 - 0.1 - 0.35)) < 1e-6 && Math.abs(p.z - 1) < 1e-6, JSON.stringify(p));
assert(Math.abs(c.nx + 1) < 1e-6);
assert(circleFree(0, 0, 0.35, [wall]));
assert(!circleFree(2, 2.9, 0.35, [wall]));
assert(circleFree(2, 3.5, 0.35, [wall]));
assert(circleFree(2, 0, 0.35, [{ ...wall, solid: false }]));
assert(circleFree(2, 0, 0.35, [{ ...wall, y0: 5, y1: 6 }], 0, 1.8));
console.log("collide ok");
