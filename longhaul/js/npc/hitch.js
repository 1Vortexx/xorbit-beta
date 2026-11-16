// Roadside rides. All decisions that affect the player belong to a saved encounter and its own random stream.
import { encountersBetween, encRng } from "../core/encgen.js";
import { ws } from "../core/worldstate.js";
import { emit } from "../core/bus.js";
import { nextSiteAfter } from "../world/sites.js";
import { ROAD_HALF } from "../world/terrain.js";
import { pathBlocked } from "../core/collide.js";

export const HITCH_RULES = {
  betray: { easy:.04, normal:.18, hard:.28 }, blow:[9,22],
  // Of the betrayals, this share pull a knife to kill rather than rob. Stabs land every stabEvery seconds in the cab
  // (stab damage), or every footEvery seconds within reach on foot. Out-running them past giveUp metres ends it.
  killShare:.45, stab:[7,13], stabEvery:[2.2,3.4], footEvery:[1.2,1.8], reach:1.5, giveUp:90,
  boardRange:8, arriveRange:120, abandonRange:300, warningGap:23
};
const activeRide = r => ["boarding","riding","threat","attack"].includes(r.state);
const dist = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);
const km = d => (d/1000).toFixed(1)+" km";

function makeRecord(e) {
  const site=nextSiteAfter(e.z+3000);
  if (site.zRoad>e.z+12000) return null;
  const offset=e.side*(ROAD_HALF+2);
  const x=e.x+offset*Math.cos(e.yaw), z=e.z-offset*Math.sin(e.yaw);
  const R=encRng(e.id+":offer");
  const money=12+Math.floor(R()*32);
  const items=R()<.38?[{type:"jerky",n:1}]:[];
  return {id:e.id,kind:"hitch",state:"waiting",x,z,seed:e.seed,people:[],
    dest:{name:site.name,x:site.x,z:site.z},reward:{money,items},warnings:0,rideSeconds:0};
}
const fare = r => "$"+r.reward.money+(r.reward.items.length?" and some beef jerky":"");
export class Hitchhikers {
  constructor(ctx) { this.ctx=ctx; this.live=new Map(); this.clear(); }
  clear() {
    for(const {npc} of this.live.values()) this.ctx.npcs.remove(npc);
    this.live.clear(); this.scanIn=0; this.resumeRides=true; this.plate=null;
  }
  flush() { for(const entry of this.live.values()) this.save(entry); }
  save({r,npc}) { r.people=[npc.serialize()]; ws.enc.set(r.id,r); }
  hud() { return this.plate; }
  load(r) {
    if(!r||this.live.has(r.id)) return;
    const rec=r.people?.[0];
    const npc=this.ctx.npcs.spawn({id:r.id+":p0",role:"hitchhiker",seed:r.seed,x:r.x,z:r.z});
    if(rec) npc.restore(rec);
    const entry={r,npc};
    this.live.set(r.id,entry);
    if(r.state==="waiting") npc.setTarget({name:npc.name,info:()=>({note:"Looking for a ride"}),actions:()=>[
      {key:"use",label:"Talk",run:()=>this.offer(entry)}
    ]});
    this.save(entry);
  }
  scan(p) {
    if(this.resumeRides) {
      this.resumeRides=false;
      for(const r of ws.enc.values()) if(r.kind==="hitch" && activeRide(r)) this.load(r);
    }
    for(const e of encountersBetween(p.pos.z-350,p.pos.z+350)) {
      if(e.kind!=="hitch" || this.live.has(e.id) || dist(p.pos,e)>350) continue;
      const r=ws.enc.get(e.id)||makeRecord(e);
      if(r?.state==="waiting") this.load(r);
    }
  }
  rideCar(p) {
    if(p.vehicle) return p.vehicle;
    return this.ctx.vehicles.list.filter(v=>dist(v.pos,p.pos)<=8 && Math.abs(v.speed)<1)
      .sort((a,b)=>dist(a.pos,p.pos)-dist(b.pos,p.pos))[0];
  }
  open(spec) { this.ctx.dialogue(spec); }
  offer(entry) {
    const {r,npc}=entry, p=this.ctx.player();
    if(r.state!=="waiting"||npc.state==="down"||Math.abs(p.speed)>=1||dist(p.pos,npc.pos)>HITCH_RULES.boardRange) return;
    const v=this.rideCar(p);
    const openSeat=()=>v && Object.keys(v.seats).find(s=>s!=="driver" && v.seatFree(s));
    npc.lookAt(p.pos); npc.state="talk";
    this.open({speaker:npc.name,role:"Hitchhiker",lines:[
      `Can you drop me at ${r.dest.name}? It's ${km(dist(npc.pos,r.dest))} down the road.`,
      `I'll give you ${fare(r)} when we get there.`],
      choices:[{id:"ride",label:"Offer a ride",disabled:!v?"Bring a vehicle alongside":!openSeat()?"The passenger seats are full":undefined},
        {id:"decline",label:"Decline"},{id:"back",label:"Maybe later"}],
      onChoose:id=>{
        if(r.state!=="waiting") return;
        npc.idle();
        if(id==="ride" && openSeat() && npc.enterVehicle(v,openSeat())) {
          const trust=encRng(r.id+":trust");
          r.state="boarding"; r.car=v.id; r.betray=this.ctx.hostile() && trust()<HITCH_RULES.betray[this.ctx.diff()];
          r.intent=r.betray ? (trust()<HITCH_RULES.killShare ? "kill" : "rob") : null;
          npc.setTarget(null); npc.say("Thanks. Give me a second to get in.");
        } else if(id==="decline") {
          r.state="declined"; npc.setTarget(null); npc.say("Fair enough. Safe travels.");
        }
        this.save(entry);
      }
    });
  }
  drop(entry,state) {
    const {r,npc}=entry;
    if(!npc.exitVehicle()) {
      this.ctx.notify("Pull over with room beside the passenger door.", {key:"hitch-door"}); return false;
    }
    r.state=state; this.save(entry);
    return true;
  }
  threaten(entry) {
    const {r,npc}=entry;
    r.state="threat"; npc.hostile=true;
    const R=encRng(r.id+":demand");
    const cost={money:15+Math.floor(R()*29)}, damage=HITCH_RULES.blow[0]+Math.floor(R()*(HITCH_RULES.blow[1]-HITCH_RULES.blow[0]+1));
    this.save(entry);
    this.open({speaker:npc.name,role:"Passenger",lines:["Pull over. Hand me your cash and I'll walk."],
      choices:[{id:"pay",label:"Hand over the cash",cost:"$"+cost.money,disabled:this.ctx.stock.check(cost)},
        {id:"refuse",label:"Refuse",detail:"They may hit you.",danger:true},{id:"out",label:"Order them out"},
        this.fightChoice()],
      onChoose:id=>{
        if(r.state!=="threat") return;
        if(id==="fight") { this.fightBack(entry); return; }
        if(id==="pay" && this.ctx.stock.check(cost)) return;
        if(!this.drop(entry,"resolved")) return;
        if(id==="pay") this.ctx.stock.pay(cost);
        if(id==="refuse") { this.ctx.sfx("punch",{pos:npc.pos}); this.ctx.needs.hurt(damage,"Struck by a passenger"); }
        npc.flee(this.ctx.player().pos);
      }
    });
  }
  // ── fighting back (the knife everyone starts with, or a gun) ──
  weaponOnHand() {
    const has=t=>this.ctx.stock.check({items:[{type:t,n:1}]})===null;
    return ["ak47","handgun","knife"].find(has)||null;
  }
  fightChoice() {
    const w=this.weaponOnHand();
    return {id:"fight",label:w==="knife"?"Fight back with your knife":w?"Pull your gun on them":"Fight back",
      detail:w==="knife"?"Risky in a cramped cab.":w?"They won't see it coming.":undefined,
      disabled:w?undefined:"You have nothing to fight with",danger:true};
  }
  fightBack(entry) {
    const {r,npc}=entry, w=this.weaponOnHand(), R=encRng(r.id+":fight"+(r.fights=(r.fights||0)+1));
    if(!w) return;
    const hurtNpc=dmg=>{ if(this.ctx.combat) this.ctx.combat.damage(npc,dmg,w); else npc.wound(dmg); };
    if(w!=="knife") {
      this.ctx.sfx("gunshot",{pos:npc.pos,big:w==="ak47"}); hurtNpc(100);
    } else if(R()<.65) {
      this.ctx.sfx("knife_hit",{pos:npc.pos}); hurtNpc(45+Math.floor(R()*30));
    } else {
      this.ctx.sfx("punch",{pos:npc.pos}); this.ctx.needs.hurt(this.stabDamage(r),"Stabbed by a passenger");
      this.ctx.notify(npc.name+" turned the knife on you.",{level:"crit"});
      if(r.state==="threat") this.attack(entry);
      return;
    }
    if(npc.state==="down") { this.finish(entry,"dead"); this.ctx.notify(npc.name+" won't be bothering anyone again.",{level:"warn"}); return; }
    // Wounded: they want out, and they're no longer a threat
    npc.hostile=false; r.state="fled"; this.save(entry);
    npc.say("Okay! Okay! I'm getting out!");
    if(npc.seat && !npc.exitVehicle()) { r.bail=true; return; }   // gets out at the next stop
    npc.flee(this.ctx.player().pos);
  }
  stabDamage(r) {
    const R=encRng(r.id+":stab"+(r.stabs=(r.stabs||0)+1)), [a,b]=HITCH_RULES.stab;
    return a+Math.floor(R()*(b-a+1));
  }
  finish(entry,state) { entry.r.state=state; entry.npc.hostile=false; this.save(entry); }
  attack(entry) {
    const {r,npc}=entry;
    r.state="attack"; npc.hostile=true; r.strikeIn=1.2; this.save(entry);
    npc.say("Pull over. This is as far as you go.");
    this.ctx.sfx("threat",{pos:npc.pos});
    this.ctx.notify(`${npc.name} pulled a knife! Stop and get out, or press E to fight back.`,{level:"crit",key:"hitch-attack"});
  }
  attackMenu(entry) {
    const {r,npc}=entry, p=this.ctx.player();
    this.open({speaker:npc.name,role:"Passenger",lines:["You picked up the wrong stranger."],
      choices:[this.fightChoice(),
        {id:"bail",label:"Jump out",disabled:Math.abs(p.speed)>=1?"Stop the truck first":undefined},
        {id:"back",label:"Keep driving"}],
      onChoose:id=>{
        if(r.state!=="attack") return;
        if(id==="fight") this.fightBack(entry);
        else if(id==="bail") this.ctx.ejectPlayer();
      }});
  }
  // Knife attack: in the cab while the player is in it, then on foot once either of you gets out
  assault(entry,p,dt,talk) {
    const {r,npc}=entry, H=HITCH_RULES;
    if(npc.state==="down" || npc.health<=0) {
      this.finish(entry,"dead"); this.ctx.notify(`${npc.name} is down.`,{level:"warn",key:"hitch-attack"}); return;
    }
    const near=dist(p.pos,npc.pos);
    this.plate={title:npc.name+" · Attacking you",text:npc.seat?"Stop and get out, or fight back":"Fight back or get away",level:"crit",
      prompt:npc.seat && p.vehicle?.id===r.car?"Fight back":null};
    if(npc.seat) {
      if(p.vehicle?.id===r.car) {
        if(talk) { this.attackMenu(entry); return; }
        if((r.strikeIn-=dt)<=0) this.stab(entry,"Stabbed by a passenger",H.stabEvery);
        return;
      }
      if(!npc.exitVehicle()) return;                   // you jumped out: they climb out after you
      npc.say("You can't run from me.");
    }
    if(near>H.giveUp) {
      this.finish(entry,"escaped"); npc.idle();
      this.ctx.notify(`You got away from ${npc.name}.`,{key:"hitch-attack"}); return;
    }
    if(npc.state!=="strike") npc.follow(()=>this.chaseStep(npc,r),{run:true,keep:1.05});
    if(!p.vehicle && near<=H.reach) {
      if((r.strikeIn-=dt)<=0) this.stab(entry,"Stabbed by a stranger",H.footEvery);
    } else r.strikeIn=Math.max(r.strikeIn,.4);
  }
  // Where an attacker on foot heads next: straight at the player, or round the nearer corner of the ride when the
  // vehicle stands between you (people only side-step, they don't path-find).
  chaseStep(npc,r) {
    const to=this.ctx.player().pos, v=this.ctx.vehicles.get(r.car);
    if(!v || !pathBlocked(npc.pos.x,npc.pos.z,to.x,to.z,.3,v.colliders(),npc.pos.y+.2,npc.pos.y+1.5)) return to;
    const d=v.def, cols=v.colliders();
    let best=to, cost=Infinity;
    for(const z of [d.zFront+1,d.zRear-1]) for(const x of [d.halfW+.8,-(d.halfW+.8)]) {
      const c=v.localToWorld(x,0,z), ox=c.x-v.pos.x, oz=c.z-v.pos.z, ol=Math.hypot(ox,oz)||1;
      c.x+=ox/ol*1.1; c.z+=oz/ol*1.1;                  // they stop `keep` short of it: aim past the corner
      if(dist(npc.pos,c)<1.4 || pathBlocked(npc.pos.x,npc.pos.z,c.x,c.z,.3,cols,npc.pos.y+.2,npc.pos.y+1.5)) continue;
      // a corner with a clear line on to the player beats one that only leads to another corner
      const k=dist(npc.pos,c)+dist(c,to)+(pathBlocked(c.x,c.z,to.x,to.z,.3,cols,npc.pos.y+.2,npc.pos.y+1.5)?50:0);
      if(k<cost) { cost=k; best=c; }
    }
    return best;
  }
  stab(entry,cause,[a,b]) {
    const {r,npc}=entry;
    npc.lookAt(this.ctx.player().pos); npc.strike();
    this.ctx.sfx("knife_hit",{pos:npc.pos}); this.ctx.needs.hurt(this.stabDamage(r),cause);
    r.strikeIn=a+(b-a)*encRng(r.id+":swing"+r.stabs)();
    this.save(entry);
  }
  passengerMenu(entry) {
    const {r,npc}=entry;
    this.open({speaker:npc.name,role:"Passenger",lines:[`I'm bound for ${r.dest.name}. The fare is ${fare(r)}.`],
      choices:[{id:"back",label:"Keep going"},{id:"out",label:"This is where you get out"}],
      onChoose:id=>{ if(id==="out" && r.state==="riding" && this.drop(entry,"left")) npc.say("I'll walk from here."); }});
  }
  ride(entry,p,dt,talk) {
    const {r,npc}=entry;
    const v=this.ctx.vehicles.get(r.car);
    if(r.state==="attack") { this.assault(entry,p,dt,talk); return; }   // the fight follows you out of the cab
    if(!npc.seat) {
      r.state=r.state==="boarding" && npc.state!=="down"?"waiting":"left";
      this.save(entry);
      if(r.state==="waiting") {
        this.ctx.npcs.remove(npc); this.live.delete(r.id); this.load(r);
        this.ctx.notify("The passenger couldn't board. Stop beside them to try again.");
      }
      return;
    }
    if(p.vehicle?.id!==r.car) {
      const saved=ws.vehicles.get(r.car);
      const at=v?.pos || (saved?{x:saved.pos[0],z:saved.pos[2]}:npc.pos);
      if(dist(p.pos,at)>HITCH_RULES.abandonRange || (!v&&!saved)) {
        // A streamed-out vehicle still owns its saved seat. Release that claim before retiring the rider.
        if(v && !npc.exitVehicle()) return;
        if(!v) {
          if(saved?.seats?.[npc.seat.seat]===npc.id) saved.seats[npc.seat.seat]=null;
          npc.seat=null; npc.standAt(at);
        }
        r.state="left"; this.save(entry); this.ctx.notify(npc.name+" found another way.");
      }
      return;
    }
    if(!v) return;
    if(r.state==="boarding" && npc.state==="sit") {
      r.state="riding"; this.save(entry); npc.say(`Next stop, ${r.dest.name}.`);
    }
    const remaining=dist(v.pos,r.dest), stopped=Math.abs(v.speed)<1;
    this.plate={title:npc.name+" · Passenger",text:r.state==="boarding"?"Wait for your passenger to board.":r.dest.name+" · "+km(remaining),
      level:r.state==="threat"?"warn":"info",prompt:stopped && r.state==="riding"?"Talk to your passenger":null};
    if(r.state==="boarding") return;
    if(stopped && remaining<=HITCH_RULES.arriveRange && r.state!=="threat") {
      if(this.drop(entry,"arrived")) {
        this.ctx.stock.give(r.reward); this.ctx.sfx("pay",{pos:npc.pos}); npc.say("Right here is perfect. Thanks for the lift!");
        this.ctx.notify(`Dropped off ${npc.name} at ${r.dest.name}. Received ${fare(r)}.`);
        emit("hitch:arrived", { name: npc.name });
      }
      return;
    }
    r.rideSeconds+=dt;
    if(r.betray && this.ctx.hostile()) {
      if(r.warnings<2 && r.rideSeconds>=(r.warnings+1)*HITCH_RULES.warningGap) {
        npc.say(["How often do other cars come through here?","That's a quiet stretch ahead. Keep both hands on the wheel."][r.warnings++]);
        this.save(entry);
      } else if(r.warnings===2 && r.intent==="kill" && r.rideSeconds>=3*HITCH_RULES.warningGap) {
        this.attack(entry); return;                    // a killer doesn't wait for you to stop
      } else if(r.warnings===2 && stopped && r.rideSeconds>=3*HITCH_RULES.warningGap) {
        this.threaten(entry); return;
      }
    }
    if(talk && stopped) this.passengerMenu(entry);
  }
  update(dt,{talk=false}={}) {
    const p=this.ctx.player(); this.plate=null;
    if((this.scanIn-=dt)<=0) { this.scanIn=.4; this.scan(p); }
    for(const [id,entry] of this.live) {
      const {r,npc}=entry;
      if(activeRide(r)) { this.ride(entry,p,dt,talk); talk=false; continue; }
      if(r.state==="fled" && npc.seat && npc.exitVehicle()) npc.flee(p.pos);   // a wounded attacker bails at the first stop
      const distance=dist(p.pos,npc.pos);
      if(distance>380) {
        this.save(entry); this.ctx.npcs.remove(npc); this.live.delete(id);
      } else if(r.state==="waiting" && npc.state!=="down") {
        if(distance<32) npc.lookAt(p.pos);
        if(distance<=HITCH_RULES.boardRange && Math.abs(p.speed)<1) {
          this.plate={title:npc.name,text:"Looking for a ride",level:"info",prompt:"Talk to the hitchhiker"};
          if(talk) { this.offer(entry); talk=false; }
        }
      }
    }
  }
  dispose() { this.clear(); }
}
