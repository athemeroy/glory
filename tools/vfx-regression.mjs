// Effects own their lifetimes. Exercise cleanup and aim without a GPU.
import * as THREE from '../vendor/three.module.js';
import { VFX } from '../src/game/vfx.js';
const context = new Proxy({}, { get: (target, name) => name === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
globalThis.document = { createElement: () => ({ width: 128, height: 128, getContext: () => context }) };
globalThis.matchMedia=()=>({matches:false});
const {installRecorder}=await import('../src/game/netmodes.js');
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const v = new VFX(new THREE.Scene()), tests = [];
const test = (name, fn) => { fn(); v.clear(); tests.push({ name, passed: true }); };
const actor = { id: 'actor', clsId: 'swordmaster', name: 'QA', pos: new THREE.Vector3(), yaw: .85, pitch: .45, scale: 1, height: 1.8, alive: true, effects: [], action: { aimYaw: .85, aimPitch: .45 } };

test('local and remote sword visuals have the same attack aim', () => {
  const directions = [];
  for (const isPlayer of [true, false]) {
    v.slash({ ...actor, isPlayer }, 'slashR', '#84bbcf', 2.4, 1);
    const g = v.items.at(-1).obj, dir = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion); directions.push(dir); v.clear();
  }
  assert(directions[0].distanceTo(directions[1]) < 1e-10 && directions[0].y > .4, 'remote aim differs');
});
test('turning during a strike follows the current pose on both peers', () => {
  for(const isPlayer of [true,false]) {
    const f={...actor,isPlayer,pos:new THREE.Vector3(),yaw:0,pitch:0,action:{aimYaw:0,aimPitch:0}};
    v.slash(f,'slashR','#84bbcf',2.4,1);const g=v.items[0].obj;
    f.yaw=Math.PI/2;f.pitch=.3;f.pos.set(1,0,0);v.update(.05);
    const expected=new THREE.Vector3(Math.cos(.3),Math.sin(.3),0),dir=new THREE.Vector3(0,0,1).applyQuaternion(g.quaternion);
    assert(dir.distanceTo(expected)<1e-8&&Math.abs(g.position.x-1)<1e-8,'blade keeps its starting aim');v.clear();
    v.skills.dragon(f,{active:500,hits:[{range:3.4}]},'#d6b473');f.yaw=-Math.PI/2;v.update(.05);
    const dragon=v.items[0].obj,dd=new THREE.Vector3(0,0,1).applyQuaternion(dragon.quaternion);
    assert(dd.x<-.9&&dd.y>.29,'directional skill keeps starting aim');v.clear();
  }
});
test('status refresh reuses its display and cleanse removes it', () => {
  actor.effects = [{ type: 'frozen', t: 2000 }]; v.statusTarget(actor, actor.effects[0]);
  for (let i = 0; i < 100; i++) v.statusTarget(actor, actor.effects[0]);
  assert(v.items.length === 1 && v.skills.statuses.size === 1, 'refresh duplicates');
  actor.effects = []; v.update(.02);
  assert(v.items.length === 0 && v.skills.statuses.size === 0, 'cleanse leaves marker');
});
test('mixed combos use the current limb and shield charges use the physical shield', () => {
  const root=new THREE.Group(),right=new THREE.Object3D(),left=new THREE.Object3D(),shield=new THREE.Group();
  right.position.set(.4,.2,.7);left.position.set(-.5,1.3,.8);shield.position.set(-.6,1,.5);root.add(right,left,shield);root.updateMatrixWorld(true);
  const f={...actor,clsId:'thug',rig:{bones:{ftR:right,haL:left}},effects:[],action:{animIdx:2}},d={name:'流氓连环',anim:'slash1',altAnims:['slash1','slash2','kick','slash3'],hits:[{range:2.4}],vfx:'ult_fists'};
  v.skillEvent(f,'swing',{def:d,i:0});v.update(.01);
  assert(v.items[0].obj.position.distanceTo(right.getWorldPosition(new THREE.Vector3()))<1e-8,'mixed club/kick combo uses a fist');v.clear();
  f.clsId='unspecialized';f.action={animIdx:1};v.skillEvent(f,'swing',{def:{...d,name:'千机·百式',altAnims:['spearThrust','palm']},i:0});v.update(.01);
  assert(v.items[0].obj.position.distanceTo(left.getWorldPosition(new THREE.Vector3()))<1e-8,'umbrella palm draws a blade');v.clear();
  f.weapon={type:'axe'};f.leftWeapon=shield;v.skills.impact(f,{anim:'thrust',vfx:'bash'},{range:2.4},'shoulder','#d6b473');v.update(.01);
  assert(v.items[0].obj.position.distanceTo(shield.localToWorld(new THREE.Vector3(0,.1,.1)))<1e-8,'shield charge follows a fist');
});
test('death removes persistent status visuals', () => {
  actor.effects = [{ type: 'poison', t: 5000 }]; actor.alive = true; v.statusTarget(actor, actor.effects[0]); actor.alive = false; v.update(.02);
  assert(v.items.length === 0 && v.skills.statuses.size === 0, 'death leaves marker'); actor.alive = true;
});
test('palm and grab visuals attach to the acting hands', () => {
  const root=new THREE.Group(),left=new THREE.Object3D(),right=new THREE.Object3D();left.position.set(-.5,1.25,.45);right.position.set(.6,1.15,.35);root.add(left,right);root.updateMatrixWorld(true);
  const f={...actor,rig:{bones:{haL:left,haR:right}},effects:[]};
  v.skills.impact(f,{anim:'palm'},{range:2.4},'palm','#d6b473');v.update(.01);
  assert(v.items[0].obj.position.distanceTo(left.getWorldPosition(new THREE.Vector3()))<1e-8,'palm uses the wrong hand');v.clear();
  v.skills.grapple(f,'#d6b473');v.update(.01);
  const brackets=v.items[0].obj.children;
  assert(brackets[0].position.distanceTo(left.getWorldPosition(new THREE.Vector3()))<1e-8 && brackets[1].position.distanceTo(right.getWorldPosition(new THREE.Vector3()))<1e-8,'grab hands collapsed');
});
test('spinning kick uses the kicking left foot and low sweep the right foot', () => {
  const root=new THREE.Group(),left=new THREE.Object3D(),right=new THREE.Object3D();left.position.set(-.6,.85,1.1);right.position.set(.2,.12,0);root.add(left,right);root.updateMatrixWorld(true);
  const f={...actor,rig:{bones:{ftL:left,ftR:right}},effects:[]};
  for(const [anim,profile,expected] of [['spinkick','spin-kick',left],['lowSweep','low-kick',right]]){
    v.skills.impact(f,{anim},{range:2.4},profile,'#d6b473');v.update(.01);
    assert(v.items[0].obj.position.distanceTo(expected.getWorldPosition(new THREE.Vector3()))<1e-8,anim+' attaches to the support leg');v.clear();
  }
});
test('repeated region ticks share the continuous cloud', () => {
  const d = { name: '混乱之雨' }, a = { radius: 3, vfx: 'zone', ticks: 6, interval: 600 };
  for (let i = 1; i <= 6; i++) v.areaEvent(actor, a, d, new THREE.Vector3(2, 0, 2), i);
  assert(v.skills.zones.size === 1, 'zone duplicated');
  v.update(5); assert(v.skills.zones.size === 0 && v.items.length === 0, 'zone did not expire');
});
test('delayed first strike follows its hit time and cancellation clears it', () => {
  const d={name:'扫堂腿',anim:'lowSweep',hits:[{t:60,range:2.4,arc:360}]},f={...actor,action:{stage:'active',t:0}};
  v.skillEvent(f,'active',{def:d});assert(v.drawableCount===0,'first strike draws before its hit time');
  v.update(.04);assert(v.drawableCount===0,'first strike fires too early');v.update(.021);assert(v.drawableCount>0,'first strike never draws');v.clear();
  v.skillEvent(f,'active',{def:d});f.action=null;v.update(.1);assert(v.items.length===0 && v.drawableCount===0,'cancelled first strike still draws');
  f.action={stage:'active',t:100};v.skillEvent(f,'active',{def:d});assert(v.drawableCount>0,'late LAN event waits twice');
});
test('LAN recorder sends the action once without duplicating delayed strike effects', () => {
  const events=[],game={vfx:v,onFighterEvent:(f,type,data)=>v.skillEvent(f,type,data)};
  for(const name of ['onHit','onFire','spawnTelegraph','shake','voice'])game[name]=()=>{};
  const originalUpdate=v.update,uninstall=installRecorder(game,{announce(){},bigCenter(){}},event=>events.push(event));
  try {
    const f={...actor,action:{stage:'active',t:0}},d={name:'扫堂腿',anim:'lowSweep',hits:[{t:60,range:2.4,arc:360}]};
    game.onFighterEvent(f,'active',{def:d});v.update(.07);
    assert(events.length===1&&events[0][0]==='G'&&v.drawableCount>0,'deferred local callback gets replayed twice');
    v.burst(new THREE.Vector3(),'#c5a56c',1);assert(events.length===2&&events[1][0]==='V','real outside event was suppressed');
  } finally {uninstall();}
  assert(v.update===originalUpdate,'leaving the room does not restore effect updates');
});
test('budget pressure remains bounded while effects spawn during update', () => {
  const max = v.maxItems; v.maxItems = 12;
  v.add(new THREE.Group(), .8, () => { for (let i = 0; i < 30; i++) v.sprite(new THREE.Vector3(), '#bd9770', .1, .1); });
  v.update(.05);
  assert(v.items.length <= 12 && v.drawableCount <= v.maxDrawables && v.items.every(it => !it.ended), 'mutation exceeds budget');
  v.update(1); assert(v.items.length === 0 && v.drawableCount === 0, 'pressure cleanup'); v.maxItems = max;
});
test('clear cancels delayed bursts and resets particle visibility', () => {
  v.ultAura(new THREE.Vector3(), '#94b9cc'); v.skills.dragon(actor, { hits: [{ range: 4 }] }, '#d9b674');
  v.particle(0, 1, 0, 1, 1, 1, '#cccccc', .1, 3); v.clear(); v.update(1);
  assert(v.items.length === 0 && v.drawableCount === 0 && v.pSize.every(n => n === 0) && v.flash.intensity === 0, 'clear leaves orphan display');
});
console.log(JSON.stringify({ tests, passed: true, final: v.getStats() }, null, 2));
