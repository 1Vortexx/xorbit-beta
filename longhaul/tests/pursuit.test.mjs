import assert from "node:assert/strict";
import { Pursuer } from "../js/pursuit/index.js";
import { Vehicle, Vehicles } from "../js/vehicles/index.js";
import { ws } from "../js/core/worldstate.js";
import { on } from "../js/core/bus.js";

const manager = new Vehicles();
const car = manager.spawn({id:"guardcar",type:"sedan",x:0,z:0,pristine:true});
assert.ok(car.claimSeat("passenger","hiker"));
assert.ok(!car.claimSeat("rearR","hiker"), "cannot duplicate a passenger");
assert.ok(car.claimSeat("driver","guard"));
const p = new Pursuer({id:"guard",vehicle:car,seed:4,diff:"normal"});
const target = { pos: {x:0,z:120}, vel: {x:0,z:0}, vehicle:null };
p.setTarget(() => target);
const env = {ambient:30,wear:1};
for (let i=0;i<2400;i++) { p.update(1/120); manager.step(1/120,null,null,env); }
assert.ok(car.pos.z > 108 && car.pos.z < 124, 'driver closed 120 m using drivetrain: '+car.pos.z);
assert.equal(p.state,'holding');
manager.sync([{x:1000,z:1000}]); assert.equal(manager.get(car.id),car);
const saved = car.serialize(), brain = p.serialize();
p.dispose(); manager.remove(car,false); ws.vehicles.set(car.id,saved);
const copy = manager.ensure(car.id), resumed = new Pursuer({id:"guard",vehicle:copy,seed:4});
resumed.restore(brain); resumed.setTarget(()=>target);
assert.deepEqual(copy.pos.toArray(),saved.pos);
assert.equal(copy.seats.passenger,'hiker');
assert.equal(resumed.state,'holding');
target.pos.z = 10000; resumed.update(1);
assert.ok(resumed.canContinue, 'target distance never counts as defeat');
copy.remove("engine"); resumed.update(1/60);
assert.equal(resumed.disabledReason,"engine");
copy.install("engine",car.slots.engine); resumed.update(1/60);
assert.ok(!resumed.canContinue, 'defeated driver stays out');
assert.equal(copy.seats.driver,null);
manager.clear(); ws.reset();

// A yielding barricade gets a single hit and affects momentum according to its resistance.
function ram(resistance) {
  let hits = 0;
  const barrier = {kind:"box",x:0,z:8,hx:4,hz:0.2,yaw:0,
    hit() { hits++; this.solid=false; return resistance; }};
  const v = new Vehicle({getColliders:()=>[barrier]}).place(0,0,0);
  v.vel.z=22;
  for(let i=0;i<60;i++)v.step(1/120,{throttle:0,steer:0},env);
  assert.equal(hits,1); return v;
}
assert.ok(ram(0).bodyCond > ram(0.35).bodyCond);

// A parked guard rammed by a MOVING player also receives impact telemetry and crash audio.
const guard = new Vehicle({id:"g"}).place(0,10);
const attacker = new Vehicle({id:"a"}).place(0,0);
const ai = new Pursuer({id:"g",vehicle:guard,seed:1});
const crashes=[], unsub = on("pursuer:crash", d=>crashes.push(d));
attacker.vel.z=24;
for(let i=0;i<75;i++){attacker.step(1/120,{throttle:0,steer:0},env,[guard]);guard.step(1/120,null,env,[attacker]);ai.update(1/120);}
unsub(); assert.ok(crashes.length); assert.ok(guard.bodyCond<100 && attacker.bodyCond<100);
console.log("pursuit, seats, pinned restore, guard ramming and breakable collision ok");
