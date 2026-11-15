// Headless gameplay loop, using a real terrain seed, NPCs, barrier and all three cars' physics.
import assert from "node:assert/strict";
import { Group } from "three";
import { Vehicles, setGround } from "../js/vehicles/index.js";
import * as terrain from "../js/world/terrain.js";
import { encountersBetween } from "../js/core/encgen.js";
import { Encounters } from "../js/encounters/index.js";
import { coords, relative } from "../js/encounters/rules.js";
import { Npcs } from "../js/npc/index.js";
import { ws } from "../js/core/worldstate.js";

terrain.setSeed(1978); setGround(terrain);
const site = encountersBetween(0,200000).find(s=>s.kind==="roadblock");
const root = new Group();
let enc, npc, time=0;
const cars = new Vehicles({getColliders:(x,z,r)=>enc.colliders(x,z,r)});
function getColliders(x,z,r) {
  const out=enc.colliders(x,z,r);
  npc.colliders(x,z,r,out);
  for(const c of cars.list) if(Math.hypot(c.pos.x-x,c.pos.z-z)<r+4) out.push(...c.colliders());
  return out;
}
npc = new Npcs({root,getColliders,getVehicle:id=>cars.get(id)});
let pickup = cars.spawn({...coords(site,0,-95), id:"starter",type:"pickup",yaw:site.yaw,pristine:true});
pickup.claimSeat("driver","player");
const who = () => ({pos:pickup.pos,vel:pickup.vel,speed:pickup.speed,vehicle:pickup});
let captured=false, resumed=false;
enc = new Encounters({root,vehicles:cars,npcs:npc,player:who,getColliders,diff:()=>"easy",progress:()=>({km:46,day:2,money:80}),hostile:()=>true,now:()=>time,
  sfx(){},notify(){},stock:{pay:()=>true,strip:()=>({money:1,items:[]})},
  needs:{health:100,hurt(n){this.health-=n;}},ejectPlayer(){captured=true;return true;},kill(){},releasePlayer(){}});
const seen=new Set(), drivers=new Set(), startCars=new Map(), moves=new Map();
for(let frame=0; frame<3600 && !captured; frame++){
  time+=1/60; enc.update(1/60); npc.update(1/60,{playerPos:pickup.pos});
  const along=relative(site,pickup.pos).along;
  const input = along<85 ? {throttle:1,steer:Math.max(-1,Math.min(1, (site.yaw-pickup.yaw)*1.5-relative(site,pickup.pos).across*.05))} :
    {throttle:pickup.speed>0.5?-1:0,steer:0,handbrake:true};
  for(let i=0;i<2;i++)cars.step(1/120,pickup,input,{ambient:28,wear:1});
  cars.update(1/60);
  if(enc.rec)seen.add(enc.rec.state);
  // Simulate closing the app in a live chase and restoring the JSON save.
  if(!resumed && drivers.size===2 && Math.max(...moves.values())>20) {
    enc.flush(); cars.flush();
    const json=JSON.stringify(ws.serialize());
    enc.clear(); npc.clear(); cars.clear();
    ws.restore(JSON.parse(json)); pickup=cars.ensure("starter");
    resumed=true;
  }
  for(const c of enc.crew) {
    if(!startCars.has(c.car.id)) startCars.set(c.car.id,c.car.pos.clone());
    if(c.ai)drivers.add(c.car.id);
    moves.set(c.car.id, Math.max(moves.get(c.car.id)||0,startCars.get(c.car.id).distanceTo(c.car.pos)));
  }
}
const rec=ws.enc.get(site.id);
const diagnostic=JSON.stringify({seen:[...seen],drivers:[...drivers],moves:[...moves],npcs:enc.crew.map(c=>[c.npc.state,c.npc.pos,c.car.pos,c.car.speed,c.car.ign]),player:pickup.pos});
assert.ok(seen.has("challenged") && seen.has("mobilizing") && seen.has("pursuing"),diagnostic);
assert.ok(rec.broken.length, "impact opened the barrier");
assert.equal(drivers.size,2,diagnostic);
assert.ok([...moves.values()].every(m=>m>25),diagnostic);
assert.ok(resumed && captured,diagnostic);
console.log("roadblock drive-through, boarding, physical pursuit and capture ok");
