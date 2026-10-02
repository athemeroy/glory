import * as THREE from 'three';
import { CLASSES } from '../src/data/classes.js';
import { World } from '../src/game/world.js';
import { input } from '../src/engine/input.js';
import { hurtCapsules } from '../src/game/combat-volumes.js';

export function checkGunplayLive(app) {
  const g=app.game,saved={fighters:g.fighters,player:g.player,mode:g.mode,world:g.world,assist:g.settings.aimAssist,onHit:g.onHit};
  const results=[],errors=[],check=(ok,name,data={})=>(ok?results:errors).push({name,...data});
  g.fighters=[];g.mode=null;g.world=new World();g.world.bounds={minX:-100,maxX:100,minZ:-100,maxZ:100};g.manual=true;
  const target=g.spawn({cls:CLASSES.swordmaster,clsId:'swordmaster',kind:'dummy',team:2,pos:[0,0,10]});let hits=[];
  g.onHit=(att,t,res,h,def,...rest)=>{if(t===target)hits.push({res,region:h.contact?.region});saved.onHit.call(g,att,t,res,h,def,...rest)};
  const tick=(f,sec)=>{for(let i=0;i<Math.round(sec*120);i++){g.time+=1/120;f.update(1/120);target.updateModel(1/120);g.combat.updateMelee(1/120);g.combat.updateProjectiles(1/120);g.vfx.update(1/120)}};
  try {
    for(const id of ['sharpshooter','launcher','unspecialized']){
      const f=g.spawn({cls:CLASSES[id],clsId:id,team:1,pos:[0,0,0]});g.player=f;f.isPlayer=true;
      const reset=(y=0)=>{f.resetState();f.pos.set(0,y,0);f.onGround=y===0;f.state=y?'jump':'idle';f.yaw=f.pitch=g.viewYaw=g.viewPitch=0;f.aimDir.set(0,0,1);g.world.colliders=[];g.combat.clear();target.resetState();target.hp=target.maxHp;hits=[];if(id==='unspecialized')f.setForm('gun',true)};
      for(const distance of [5,10]){
        reset();target.pos.set(0,0,distance);for(let i=0;i<20;i++){f.updateModel(1/60);target.updateModel(1/60)}
        const torso=hurtCapsules(target).find(c=>c.region==='torso'),wanted=torso.a.clone().lerp(torso.b,.5);
        f.aimDir.copy(wanted).sub(f.eyePos()).normalize();f.pitch=Math.asin(f.aimDir.y);f.yaw=Math.atan2(f.aimDir.x,f.aimDir.z);g.viewPitch=f.pitch;
        f.startAction(f.chain[0],'atk',{chainIdx:0});tick(f,1.1);
        check(hits.some(h=>['hit','armor'].includes(h.res)),`${id} ${distance}米直接瞄准躯干仍命中`,{hits});
      }
      reset(3);target.pos.set(20,0,20);f.pitch=-.3;f.aimDir.set(0,Math.sin(-.3),Math.cos(-.3));g.viewPitch=f.pitch;
      f.startAction(f.chain[0],'atk',{chainIdx:0});tick(f,.3);
      check(f.knockVel.z<-.5&&f.pos.z<-.08,`${id}真实动作出膛向后飞行`,{z:f.pos.z,impulse:f.knockVel.z});
      check(g.viewPitch>-.3,`${id}真实出膛抬枪反馈`,{pitch:g.viewPitch});
      check(Object.values(f.mocapBody?.bones||{}).every(b=>b.matrixWorld.elements.every(Number.isFinite)),`${id}射击姿态无非有限骨骼`);
      reset(3);g.world.colliders=[{min:[-5,0,-1],max:[5,12,-.8]}];f.startAction(f.chain[0],'atk',{chainIdx:0});tick(f,.6);
      check(f.pos.z>=-.8+f.radius-.001,`${id}飞枪后退不能穿墙`,{z:f.pos.z,radius:f.radius});
      g.removeFighter(f);
    }
    const f=g.spawn({cls:CLASSES.sharpshooter,clsId:'sharpshooter',team:1,pos:[0,0,0]});g.player=f;f.isPlayer=true;g.world.colliders=[];target.pos.set(4,0,8);target.resetState();f.yaw=f.pitch=g.viewYaw=g.viewPitch=0;input.clear();
    g.lockTarget=target;g.settings.aimAssist=false;g.handleLook(.1);check(g.viewYaw===0,'观察目标默认不转动实际视角');
    g.settings.aimAssist=true;g.handleLook(.1);check(g.viewYaw>0,'主动开启练习辅助后才跟随视角');g.lockTarget=null;
    g.removeFighter(f);g.removeFighter(target);
  } finally {
    for(const f of [...g.fighters])g.removeFighter(f);g.fighters=saved.fighters;g.player=saved.player;g.mode=saved.mode;g.world=saved.world;g.settings.aimAssist=saved.assist;g.onHit=saved.onHit;g.combat.clear();g.vfx.clear();input.clear();
  }
  return{passed:results.length,total:results.length+errors.length,results,errors};
}
