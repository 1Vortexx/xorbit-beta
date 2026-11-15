// All positions are metres above the soles. Limbs pivot at their joints so sitting works in the same rig as walking.
import * as THREE from "three";
import { rng } from "../world/terrain.js";

const shape = {
  oval: new THREE.SphereGeometry(1, 10, 8),
  boot: new THREE.BoxGeometry(1, 1, 1),
  sleeve: new THREE.CylinderGeometry(0.88, 1, 1, 8),
};
const palette = new Map();
function cloth(color) {
  if (!palette.has(color)) palette.set(color, new THREE.MeshStandardMaterial({color, roughness: 0.94}));
  return palette.get(color);
}
function joint(parent, x, y, z) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  parent.add(group);
  return group;
}
function part(parent, kind, color, x,y,z, w,h,d) {
  const mesh = new THREE.Mesh(shape[kind], cloth(color));
  mesh.position.set(x,y,z);
  mesh.scale.set(w,h,d);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}
export function buildPerson(seed, role) {
  const R = rng(seed), pick = a => a[Math.floor(R()*a.length)];
  const skin = pick([0x875a42,0xb87956,0xd6a17b,0x704e3f,0xd6aa89]);
  const shirt = pick([0x546458,0x855142,0x555f71,0xac8864,0x776e5f]);
  const pants = pick([0x484844,0x405263,0x595645]);
  const hair = pick([0x332b28,0x695143,0x786556,0x383332]);
  const mesh = new THREE.Group(), body = joint(mesh,0,0,0);
  const height = 0.92 + R()*0.14;
  body.scale.set(0.90+R()*0.20,height,height);
  part(body,"sleeve",shirt,0,1.14,0,.215,.53,.147);
  part(body,"sleeve",pants,0,.9,0,.194,.11,.137);
  part(body,"sleeve",skin,0,1.44,0,.067,.13,.069);
  const head = joint(body,0,1.585,0);
  part(head,"oval",skin,0,0,.014,.117,.153,.117);
  part(head,"oval",skin,0,.005,.124,.030,.037,.027);
  part(head,"oval",hair,0,.077,-.018,.121,.09,.121);
  if (R()<.62) {
    part(head,"sleeve",pants,0,.121,-.01,.134,.07,.136);
    part(head,"oval",pants,0,.093,.064,.142,.015,.147);
  }
  if (role === "hitchhiker") {
    part(body,"oval",pants,0,1.17,-.157,.165,.225,.096);
    for (const s of [-1,1]) part(body,"boot",pants,s*.12,1.24,.123,.035,.32,.023);
  }
  const arms=[], legs=[], knees=[];
  for (const s of [-1,1]) {
    const shoulder=joint(body,s*.216,1.36,0);
    part(shoulder,"sleeve",shirt,s*.008,-.122,0,.068,.265,.07);
    part(shoulder,"oval",skin,s*.011,-.351,.02,.049,.133,.053);
    part(shoulder,"oval",skin,s*.012,-.476,.029,.048,.068,.042);
    const hip=joint(body,s*.103,.888,0), knee=joint(hip,0,-.42,0);
    part(hip,"sleeve",pants,0,-.213,0,.094,.44,.098);
    part(knee,"sleeve",pants,0,-.193,0,.076,.4,.081);
    part(knee,"boot",0x392f29,0,-.405,.039,.152,.116,.241);
    arms.push(shoulder); legs.push(hip); knees.push(knee);
  }
  // Knife in the right hand, shown while the person is hostile (rig.armed, set by Npc.update)
  const knife = new THREE.Group();
  knife.position.set(.016,-.5,.06); knife.rotation.x = Math.PI/2; knife.visible = false;
  const steel = new THREE.Mesh(shape.boot, new THREE.MeshStandardMaterial({color:0xc9ced4, roughness:.25, metalness:.9}));
  steel.scale.set(.006,.03,.17); steel.position.z = .1; knife.add(steel);
  const grip = new THREE.Mesh(shape.boot, cloth(0x3a2416)); grip.scale.set(.024,.028,.1); knife.add(grip);
  arms[1].add(knife);
  return {mesh,body,head,arms,legs,knees,height,knife};
}
export function pose(p, state, phase, moving, role) {
  const sit = state === "sit", down = state === "down";
  if (p.knife) p.knife.visible = !!p.armed && !down;
  p.body.rotation.x = down ? -1.45 : 0;
  p.body.position.y = down ? .17 : sit ? -.888*p.height : moving ? .018*Math.abs(Math.sin(phase)) : 0;
  for(let i=0;i<2;i++) {
    const stride = moving ? Math.sin(phase+i*Math.PI) : 0;
    p.legs[i].rotation.x = sit ? -1.48 : stride*.59;
    p.knees[i].rotation.x = sit ? 1.48 : Math.max(0,-stride)*.45;
    p.arms[i].rotation.x = sit ? -.56 : -stride*.5;
    p.arms[i].rotation.z = (i===0?-1:1)*.085;
  }
  if (!moving && !sit && !down) {
    if (role==="hitchhiker" && state==="idle") p.arms[1].rotation.z=1.30+.08*Math.sin(phase);
    if (state==="threaten" || state==="strike") p.arms[1].rotation.x=state==="strike"?-1.7:-.94;
    if (state==="talk") p.arms[0].rotation.x=-.42-.18*Math.sin(phase);
  }
}
