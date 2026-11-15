import assert from "node:assert/strict";
import { Group } from "three";
import { Npcs } from "../js/npc/index.js";
import { Hitchhikers } from "../js/npc/hitch.js";
import { encountersBetween } from "../js/core/encgen.js";
import { Vehicle } from "../js/vehicles/vehicle.js";
import { setGround } from "../js/vehicles/ground.js";
import { ws } from "../js/core/worldstate.js";
import * as terrain from "../js/world/terrain.js";

terrain.setSeed(123);
setGround(terrain);
const schedule=encountersBetween(1000,50000).find(e=>e.kind==="hitch");
assert.ok(schedule);
const root=new Group();
const car=new Vehicle({id:"ride",type:"pickup",seed:3});
root.add(car.mesh);
car.place(schedule.x,schedule.z,schedule.yaw);
car.claimSeat("driver","player");
const npcs=new Npcs({root,getVehicle:id=>id===car.id?car:null,getColliders:()=>car.colliders()});
const player={vehicle:car,pos:car.pos,speed:0};
let menu,cash=0,hurt=0;
const ctx={npcs,vehicles:{list:[car],get:()=>car},player:()=>player,hostile:()=>false,diff:()=>"normal",
  dialogue:spec=>{menu=spec;}, stock:{give:r=>{cash+=r.money;},check:()=>null,pay:()=>true},
  notify:()=>{},sfx:()=>{},needs:{hurt:n=>{hurt+=n;}}};
const h=new Hitchhikers(ctx), record=()=>ws.enc.get(schedule.id);
function tick(n,talk=false) {
  for(let i=0;i<n;i++) { npcs.update(.025,{playerPos:player.pos}); h.update(.025,{talk:talk&&i===0}); }
}
tick(2,true);
assert.ok(menu.lines[0].includes(record().dest.name));
assert.ok(!menu.choices[0].disabled);
menu.onChoose("ride");
assert.equal(record().state,"boarding");
tick(800);
assert.equal(record().state,"riding");
assert.equal(car.seats.passenger,npcs.list[0].id);
assert.equal(npcs.list[0].mesh.parent,car.mesh);
assert.equal(car.seats.driver,"player");
// A v4 save during the ride restores the rider even kilometres from the spawn.
h.flush();
const saved=JSON.parse(JSON.stringify(ws.serialize()));
h.clear(); npcs.clear(); ws.restore(structuredClone(saved));
car.place(record().dest.x+150,record().dest.z,schedule.yaw); tick(3);
assert.equal(npcs.list.length,1);
assert.equal(npcs.list[0].mesh.parent,car.mesh);
assert.equal(record().state,"riding");
// A moving vehicle cannot complete the fare. Stopping delivers and pays it exactly once.
car.place(record().dest.x,record().dest.z,schedule.yaw);
car.speed=4; tick(3);
assert.equal(cash,0);
car.speed=0; tick(3);
assert.equal(record().state,"arrived");
assert.equal(cash,record().reward.money);
assert.equal(car.seats.passenger,null);
tick(80); assert.equal(cash,record().reward.money);
// Demand is gated by two timed warnings and speed. Reloading a paid fare or resolved demand must not apply it twice.
h.clear(); npcs.clear(); ws.restore(structuredClone(saved)); const r=record();
car.seats.passenger=r.people[0].id;
r.betray=true; r.rideSeconds=0;
ctx.hostile=()=>true;
car.place(r.dest.x+250,r.dest.z,schedule.yaw);
car.speed=8; player.speed=8;
tick(3000);
assert.equal(r.warnings,2); assert.equal(r.state,"riding");
car.speed=0; player.speed=0; tick(1); assert.equal(r.state,"threat");
menu.onChoose("refuse"); const damage=hurt;
assert.ok(damage>=9 && damage<=22);
menu.onChoose("refuse"); tick(10); assert.equal(hurt,damage); assert.equal(r.state,"resolved");
// A killer pulls a knife while you drive, keeps stabbing, follows you out of the cab and goes down when you fight back.
h.clear(); npcs.clear(); ws.restore(structuredClone(saved)); const k=record();
car.seats.passenger=k.people[0].id;
k.betray=true; k.intent="kill"; k.rideSeconds=0; hurt=0;
car.place(k.dest.x+250,k.dest.z,schedule.yaw);
car.speed=8; player.speed=8;
tick(3000);
assert.equal(k.state,"attack","attacks without waiting for a stop");
const cab=hurt; tick(200); assert.ok(hurt>cab,"stabbed while driving");
car.speed=0; player.speed=0; player.vehicle=null; car.releaseSeat("driver");
const door=car.doorSpot("driver"); player.pos={x:door.x+1.5,y:0,z:door.z};
tick(400);
const attacker=npcs.get(k.people[0].id);
assert.equal(attacker.seat,null,"climbs out after you");
const onFoot=hurt; tick(400); assert.ok(hurt>onFoot,"stabbed on foot");
h.fightBack(h.live.get(k.id));
assert.equal(attacker.state,"down"); assert.equal(k.state,"dead");
const settled=hurt; tick(200); assert.equal(hurt,settled,"no more stabs once they are down");
player.vehicle=car; player.pos=car.pos; car.claimSeat("driver","player");
// Someone parked partly over a waiting hitchhiker must still be able to offer the passenger seat.
ws.reset(); h.clear(); npcs.clear(); terrain.setSeed(73);
const shoulder=encountersBetween(0,50000).find(e=>e.kind==="hitch");
car.place(shoulder.x+shoulder.side*5,shoulder.z,shoulder.yaw);
tick(3,true); menu.onChoose("ride"); tick(280);
assert.equal(ws.enc.get(shoulder.id).state,"riding");
console.log("NPC rides: boarding, save/restore, seat ownership, single fare, timed threat, knife attack and damage passed.");
