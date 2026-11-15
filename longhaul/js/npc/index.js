import * as THREE from "three";
import { heightAt, surfaceAt } from "../world/terrain.js";
import { circleFree, resolveCircle } from "../core/collide.js";
import { addTarget, removeTarget } from "../core/targets.js";
import { emit, sfx } from "../core/bus.js";
import { buildPerson, pose } from "./model.js";
export { HITCH_RULES } from "./hitch.js";

export async function prepare(report = () => {}) { report(1, "Roadside travellers ready"); }
const names = ["Mara","Wes","Sam","Jo","Rosa","Eli","Val","Jess","Ruth","Dev","Avery","Kit"];
const distance = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);
class Npc {
  constructor(manager, spec) {
    this.manager=manager;
    const {id,role,seed=1,x=0,z=0,yaw=0} = spec;
    Object.assign(this,{id,role,seed,yaw,state:"idle",health:100,seat:null,hostile:false,arrived:true});
    this.name = spec.name || names[(seed>>>0)%names.length];
    this.pos = new THREE.Vector3(x,heightAt(x,z),z);
    this.rig = buildPerson(seed,role);
    this.mesh = this.rig.mesh;
    this.mesh.name = id;
    manager.root.add(this.mesh);
    this.phase = (seed>>>0)%31;
    this.senseIn = (seed>>>0)%13/60;
    this.stepDistance = this.animAge = 0;
    this.sync();
  }
  around(p=this.pos) {
    return (this.manager.getColliders(p.x,p.z,4)||[]).filter(c=>c.npc!==this);
  }
  idle() { this.order=null; this.arrived=true; if(!this.seat && this.state!=="down") this.state="idle"; }
  lookAt(p) { if(p && this.state!=="sit") this.yaw=Math.atan2(p.x-this.pos.x,p.z-this.pos.z); }
  walkTo(x,z,{run=false,arrive=.24}={}) {
    if(this.seat || this.state==="down") return;
    this.order={x,z,run,keep:arrive}; this.arrived=false; this.state="walk";
  }
  follow(getPos,{run=true,keep=1.5}={}) {
    if(this.seat || this.state==="down") return;
    this.order={getPos,run,keep}; this.arrived=false; this.state="pursue";
  }
  flee(from) {
    const dx=this.pos.x-from.x,dz=this.pos.z-from.z,len=Math.hypot(dx,dz)||1;
    this.walkTo(this.pos.x+30*(dx||.1)/len,this.pos.z+30*dz/len,{run:true});
    if(this.order) this.state="flee";
  }
  threaten(on=true) {
    if(this.state==="down"||this.seat) return;
    if(on && this.state!=="threaten") sfx("threat",{pos:this.pos});
    this.idle(); this.hostile=on; this.state=on?"threaten":"idle";
  }
  strike() {
    if(this.striking) return this.striking.promise;
    this.state="strike";
    let finish;
    const promise=new Promise(resolve=>{finish=resolve;});
    this.striking={time:.25,finish,promise};
    return promise;
  }
  // Take dmg health. At zero they drop where they are (out of any seat) and stop being a threat. true = put down now.
  wound(dmg) {
    if(this.state==="down") return false;
    this.health=Math.max(0,this.health-dmg);
    if(this.health>0) return false;
    if(this.seat) { const v=this.manager.getVehicle(this.seat.vehicle); if(v) this.releaseClaim(v); else this.seat=null; this.standAt(this.pos); }
    this.state="down"; this.order=null; this.hostile=false; this.setTarget(null);
    return true;
  }
  setTarget(def) {
    removeTarget(this.mesh);
    if(def) addTarget(this.mesh,{id:this.id,reach:3,...def});
  }
  say(text,ms=4500) { emit("npc:say",{npc:this,name:this.name,text,ms}); sfx("npc_talk",{pos:this.pos}); }
  enterVehicle(v,seat) {
    if(this.seat||this.state==="down"||Math.abs(v.speed)>=1||!v.claimSeat(seat,this.id)) return false;
    this.seat={vehicle:v.id,seat}; this.state="enter"; this.order=null; this.arrived=false;
    this.doorAge=0; this.boardPath=null;
    return true;
  }
  releaseClaim(v) {
    if(this.seat && v?.seatOf(this.id)===this.seat.seat) v.releaseSeat(this.seat.seat);
    this.seat=null;
  }
  standAt(p) {
    this.manager.root.add(this.mesh);
    this.pos.set(p.x,heightAt(p.x,p.z),p.z);
    this.order=null; this.state="idle"; this.arrived=true; this.sync();
  }
  exitVehicle() {
    if(!this.seat) return false;
    const v=this.manager.getVehicle(this.seat.vehicle);
    if(!v||Math.abs(v.speed)>=1) return false;
    const seat=this.seat.seat, spot=v.doorSpot(seat);
    const choices=[spot,...v.exitSpots()];
    for(const base of [...choices]) {
      const dx=base.x-v.pos.x,dz=base.z-v.pos.z;
      choices.push({x:base.x+dx*.65,z:base.z+dz*.65});
    }
    const p=choices.find(q=>{
      const y=heightAt(q.x,q.z); return circleFree(q.x,q.z,.26,this.around(q),y+.12,y+1.6);
    });
    if(!p) return false;
    const door=v.def.seats[seat].door;
    v.setDoor(door,true); this.releaseClaim(v); this.standAt(p);
    this.closing={v,door,time:.5};
    emit("npc:exited",{npc:this}); return true;
  }
  move(dt,dest,keep,run) {
    // A player can park across a waiting person or restore a car overlapping them.
    // Resolve the existing penetration first so bounded walking steps work from there.
    const col=this.around();
    if(resolveCircle(this.pos,.26,col,this.pos.y+.12,this.pos.y+1.6)) this.pos.y=heightAt(this.pos.x,this.pos.z);
    const dist=distance(dest,this.pos);
    if(dist<=keep+.03) return true;
    this.lookAt(dest);
    const step=Math.min(dist-keep,(run?4.7:1.7)*dt);
    const old=this.pos.clone();
    // Try increasingly wide arcs around a blocked route, preserving the actual collision boundary.
    let moved=false;
    for(const turn of [0,.65,-.65,1.38,-1.38]) {
      const yaw=this.yaw+turn, p={x:old.x+Math.sin(yaw)*step,z:old.z+Math.cos(yaw)*step};
      const y=heightAt(p.x,p.z);
      resolveCircle(p,.26,col,y+.12,y+1.6);
      if(distance(p,old)<step*.5 || distance(p,old)>step+.08) continue;
      this.pos.set(p.x,heightAt(p.x,p.z),p.z); this.yaw=yaw; moved=true; break;
    }
    if(moved) {
      const travel=distance(this.pos,old); this.phase+=travel*4.5; this.stepDistance+=travel;
      if(this.stepDistance>.8) { this.stepDistance=0; sfx("npc_step",{pos:this.pos,surface:surfaceAt(this.pos.x,this.pos.z)}); }
    }
    return false;
  }
  attach(v) {
    const seat=this.seat.seat;
    v.mesh.add(this.mesh);
    this.mesh.position.fromArray(v.def.seats[seat].pos);
    this.mesh.rotation.set(0,0,0);
    v.seatPos(seat,this.pos);
    this.state="sit"; this.arrived=true;
    pose(this.rig,this.state,this.phase,false,this.role);
  }
  vehicleUpdate(dt) {
    const v=this.manager.getVehicle(this.seat.vehicle);
    if(!v) return; // An unloaded seat and its claim survive until the car streams in.
    const seat=this.seat.seat;
    if(v.seatOf(this.id)!==seat && !v.claimSeat(seat,this.id)) {
      this.seat=null;
      const spot=v.doorSpot(seat), y=heightAt(spot.x,spot.z);
      resolveCircle(spot,.27,this.around(spot),y+.12,y+1.6);
      this.standAt(spot); return;
    }
    if(this.state==="enter") {
      if(Math.abs(v.speed)>=1) {
        v.setDoor(v.def.seats[seat].door,false);
        this.releaseClaim(v); this.standAt(this.pos); return;
      }
      const doorSpot=v.doorSpot(seat);
      if(!this.boardPath) {
        this.boardPath=[];
        // When the door is on the far side, walk around the nearest bumper.
        const dx=this.pos.x-v.pos.x, dz=this.pos.z-v.pos.z;
        const localX=dx*Math.cos(v.yaw)-dz*Math.sin(v.yaw);
        const localZ=dx*Math.sin(v.yaw)+dz*Math.cos(v.yaw);
        const side=Math.sign(v.def.seats[seat].pos[0]);
        if(localX*side<0) {
          const z=localZ>(v.def.zFront+v.def.zRear)/2 ? v.def.zFront+1 : v.def.zRear-1;
          for(const s of [-side,side]) this.boardPath.push(v.localToWorld(s*(v.def.halfW+.9),0,z));
        }
      }
      const next=this.boardPath[0];
      if(next) { if(this.move(dt,next,.22,false)) this.boardPath.shift(); return; }
      if(!this.move(dt,doorSpot,.48,false)) return;
      const door=v.def.seats[seat].door;
      v.setDoor(door,true); this.doorAge=(this.doorAge||0)+dt;
      if(this.doorAge<.35) return;
      this.attach(v); v.setDoor(door,false); emit("npc:seated",{npc:this});
    } else {
      if(this.mesh.parent!==v.mesh) this.attach(v);
      else v.seatPos(seat,this.pos);
    }
  }
  dodgeCar(v) {
    if(!v || Math.abs(v.speed)<3) return false;
    const dx=this.pos.x-v.pos.x, dz=this.pos.z-v.pos.z;
    const vx=v.vel.x, vz=v.vel.z, speed2=vx*vx+vz*vz;
    if(speed2<9) return false;
    const t=(dx*vx+dz*vz)/speed2;
    if(t<=0 || t>.85 || Math.hypot(dx-vx*t,dz-vz*t)>v.def.halfW+.6) return false;
    const speed=Math.sqrt(speed2), side=dx*vz-dz*vx>=0?1:-1;
    this.walkTo(this.pos.x+side*vz*2.6/speed,this.pos.z-side*vx*2.6/speed,{run:true});
    return true;
  }
  sync() {
    if(this.mesh.parent===this.manager.root) { this.mesh.position.copy(this.pos); this.mesh.rotation.y=this.yaw; }
  }
  update(dt,frame) {
    if(this.closing && (this.closing.time-=dt)<=0) { this.closing.v.setDoor(this.closing.door,false); this.closing=null; }
    if(this.striking && (this.striking.time-=dt)<=0) { this.striking.finish(); this.striking=null; this.state=this.seat?"sit":"idle"; }
    if(this.seat) this.vehicleUpdate(dt);
    else if(this.state!=="down") {
      // Distant stationary people need fewer collision queries. Keep full rates for combat and moving orders.
      const nearPlayer=frame.playerPos && distance(this.pos,frame.playerPos)<35;
      this.senseIn-=dt;
      const sense=nearPlayer || !!this.order || this.senseIn<=0;
      if(sense) this.senseIn=.17;
      const nearby=sense ? this.around() : [];
      const hit=nearby.find(c=>c.vehicle && Math.abs(c.vehicle.speed)>3 && !circleFree(this.pos.x,this.pos.z,.25,[c],this.pos.y+.12,this.pos.y+1.6));
      if(hit) {
        const speed=Math.abs(hit.vehicle.speed);
        this.health=Math.max(0,this.health-speed*4); this.state="down"; this.order=null;
        emit("npc:hit",{npc:this,speed,vehicle:hit.vehicle});
      } else if(this.state==="idle" && !this.order && nearby.some(c=>this.dodgeCar(c.vehicle))) {
        this.state="walk";
      } else if(this.order) {
        const o=this.order,dest=o.getPos?o.getPos():o;
        if(dest && this.move(dt,dest,o.keep,o.run)) {
          if(!this.arrived) emit("npc:arrived",{npc:this});
          this.arrived=true;
          if(!o.getPos) this.idle();
        } else this.arrived=false;
      }
    }
    this.sync();
    this.rig.armed=this.hostile;
    const dist=frame.playerPos?distance(this.pos,frame.playerPos):0;
    this.animAge+=dt;
    if(this.animAge>=(dist>100?.22:frame.lite?.06:0)) {
      this.phase+=this.order?0:this.animAge*2;
      pose(this.rig,this.state,this.phase,(!!this.order&&!this.arrived)||this.state==="enter",this.role);
      this.animAge=0;
    }
  }
  serialize() {
    return {id:this.id,name:this.name,role:this.role,seed:this.seed,pos:this.pos.toArray(),yaw:this.yaw,
      state:this.state,seat:this.seat&&{...this.seat},health:this.health,hostile:this.hostile,
      order:this.order && !this.order.getPos ? {...this.order} : null};
  }
  restore(r) {
    if(r.pos) this.pos.fromArray(r.pos);
    this.state=r.state==="strike"?"idle":r.state||"idle"; this.seat=r.seat&&{...r.seat};
    this.yaw=r.yaw??this.yaw; this.health=r.health??100; this.hostile=!!r.hostile;
    this.order=r.order&&{...r.order}; this.arrived=!this.order;
    this.sync(); return this;
  }
}
export class Npcs {
  constructor({root,getColliders=()=>[],getVehicle=()=>null}) {
    Object.assign(this,{root,getColliders,getVehicle,list:[],byId:new Map()});
  }
  get(id) { return this.byId.get(id)||null; }
  spawn(spec) {
    if(this.get(spec.id)) return this.get(spec.id);
    const n=new Npc(this,spec);
    this.byId.set(n.id,n); this.list.push(n); return n;
  }
  remove(n) {
    if(!n||!this.byId.delete(n.id)) return;
    this.list.splice(this.list.indexOf(n),1);
    n.setTarget(null); n.mesh.removeFromParent();
    if(n.closing) n.closing.v.setDoor(n.closing.door,false);
    if(n.striking) n.striking.finish();
  }
  update(dt,frame={}) { for(const n of this.list) n.update(dt,frame); }
  colliders(x,z,r,out=[]) {
    for(const n of this.list) if(n.state!=="sit" && Math.hypot(n.pos.x-x,n.pos.z-z)<r+.3) {
      out.push({kind:"circle",r:.27,x:n.pos.x,z:n.pos.z,y0:n.pos.y,y1:n.pos.y+(n.state==="down"?.3:1.65),npc:n});
    }
    return out;
  }
  setQuality({lite}) { this.lite=lite; }
  clear() { for(const n of [...this.list]) this.remove(n); }
  dispose() { this.clear(); }
}
