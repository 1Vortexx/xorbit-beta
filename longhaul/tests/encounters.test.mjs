// Exercises the same crew, seats, vehicle timesteps and encounter controller used by the game.
import assert from "node:assert/strict";
import * as THREE from "three";
import { Vehicles, setGround } from "../js/vehicles/index.js";
import { Npcs } from "../js/npc/index.js";
import { Encounters } from "../js/encounters/index.js";
import { coords, newBlock } from "../js/encounters/rules.js";
import { encountersBetween } from "../js/core/encgen.js";
import { ws } from "../js/core/worldstate.js";
import * as terrain from "../js/world/terrain.js";

terrain.setSeed(75);
setGround(terrain);
const sites = encountersBetween(0, 400000).filter(e => e.kind === "roadblock");
const road = sites.find(s => newBlock(s).type === "toll"), robbery = sites.find(s => newBlock(s).type === "robbery");
assert.ok(road && robbery);
function start(site, hostile = true) {
  ws.reset();
  const root = new THREE.Group();
  const pos = new THREE.Vector3();
  const p = {pos, vel:new THREE.Vector3(), vehicle:null, speed:0};
  const cars = new Vehicles({root});
  const get = (x,z,r) => [...cars.list.flatMap(v=>v.colliders()), ...enc.colliders(x,z,r), ...npcs.colliders(x,z,r)];
  const npcs = new Npcs({root, getColliders:get, getVehicle:id=>cars.get(id)});
  let now = 0;
  const ctx = { root, npcs, vehicles:cars, player:()=>p, hostile:()=>hostile, diff:()=>"normal", now:()=>now,
    progress:()=>({km:15,money:120}), getColliders:get, sfx(){}, notify(){}, dialogue(d){ctx.dialog=d;},
    ejectPlayer:()=>true, releasePlayer(){}, kill(){ctx.killed=true;},
    stock: {money:120,paid:0,list:()=>[],check:()=>null,pay(){this.paid++;return true;}},
    needs:{health:100,hurt(n){this.health=Math.max(0,this.health-n);}} };
  const enc = new Encounters(ctx);
  cars.getColliders=(x,z,r)=>enc.colliders(x,z,r);
  function place(across,along) {
    const {x,z}=coords(site,across,along);
    p.pos.set(x,terrain.heightAt(x,z),z);
  }
  function step(talk=false) {
    now+=1/60; enc.update(1/60,{talk});
    cars.step(1/60,null,null,{ambient:20,wet:0,sand:0,wear:1});
    npcs.update(1/60,{playerPos:p.pos});
  }
  place(0,-31); step();
  return {enc,ctx,place,step,cars,p,npcs,close(){enc.dispose();npcs.dispose();cars.dispose();}};
}
for (const site of [road,robbery]) {
  const t=start(site), rec=t.enc.active;
  assert.equal(rec.state,"challenged");
  t.place(0,-70); t.step(); assert.equal(rec.state,"spotted","turning back is safe");
  t.place(0,-6); t.step(true);
  const dialog=t.ctx.dialog;
  assert.ok(dialog.choices[0].cost);
  dialog.onChoose("pay"); dialog.onChoose("pay");
  assert.equal(t.ctx.stock.paid,1);
  assert.equal(rec.state,site===road?"paid":"complied");
  t.place(0,4); t.step();
  assert.equal(t.enc.colliders(site.x,site.z,12).length,0,"paid road remains open");
  t.close();
}
const peaceful=start(road,false);
peaceful.place(0,-8); peaceful.step(true); assert.equal(peaceful.enc.active.type,"peaceful");
peaceful.ctx.dialog.onChoose("back"); peaceful.place(0,8); peaceful.step();
assert.equal(peaceful.enc.active.state,"paid"); assert.equal(peaceful.ctx.stock.paid,0);
peaceful.close();
const t=start(road), r=t.enc.active;
const barrels=t.enc.colliders(road.x,road.z,12);
const drum=barrels.find(c=>c.kind==="circle");
assert.equal(drum.hit({pos:t.p.pos},1),1);
assert.ok(drum.hit({pos:t.p.pos},14)<.5); assert.equal(drum.solid,false);
assert.equal(r.broken.length,1);
t.place(0,-8); t.step(true); t.ctx.dialog.onChoose("back");
assert.equal(r.state,"refused");
t.place(13,7); t.step(); assert.equal(r.state,"mobilizing");
t.place(0,85);
for(let i=0;i<900;i++) t.step();
assert.equal(r.state,"pursuing");
assert.ok(t.enc.crew.every(c=>c.ai && c.car.running),"both real NPCs boarded and ignited their real cars");
assert.ok(t.enc.crew.some(c=>c.car.speed>2),"the pursuers physically accelerate");
t.enc.flush(); t.cars.flush(); const snapshot=JSON.parse(JSON.stringify(ws.serialize()));
t.enc.clear(); t.npcs.clear(); t.cars.clear(); ws.restore(snapshot);
t.place(0,500); t.step(); assert.equal(t.enc.active.state,"pursuing","restore outside load range preserves chase");
for(const c of t.enc.crew) c.car.bodyCond=0;
t.step(); assert.equal(t.enc.active.state,"escaped","wrecking both cars ends pursuit");
t.close();
const surrender=start(road), stopped=surrender.enc.active;
stopped.capture={outcome:"ransom",ransom:65};
surrender.place(13,5); surrender.step(); surrender.place(0,45);
for(let i=0;i<2400 && stopped.state!=="released";i++) surrender.step();
assert.equal(stopped.state,"released","a real pursuer stops, disembarks and reaches a stationary target");
assert.equal(surrender.ctx.stock.paid,1);
surrender.close();
const b=start(road), br=b.enc.active;
const guard=b.enc.crew[0].npc, obstacle={kind:"box",x:guard.pos.x,z:guard.pos.z+1,hx:1,hz:.1,yaw:0};
br.state="pursuing"; guard.hostile=true;
b.p.pos.copy(guard.pos); b.p.pos.z+=2;
b.ctx.getColliders=()=>[obstacle];
assert.equal(b.enc.canCapture(guard,b.p),false,"cannot capture through a wall");
b.ctx.getColliders=()=>[]; b.p.speed=5; assert.equal(b.enc.canCapture(guard,b.p),false);
b.p.speed=0; assert.equal(b.enc.canCapture(guard,b.p),true);
b.ctx.needs.health=9; br.capture={outcome:"beaten",blows:[10,12]};
b.enc.capture(guard); b.enc.capture(guard);
assert.equal(br.state,"dead"); assert.equal(b.ctx.killed,true);
b.close();
console.log("Roadblocks: toll/robbery, safe retreat, refusal/bypass, payment exactly once, real pursuit, distant reload, crash escape, capture and lethal low-health beating passed.");
