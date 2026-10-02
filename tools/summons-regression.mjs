import * as THREE from '../vendor/three.module.js';
import { World } from '../src/game/world.js';
import { Combat } from '../src/game/combat.js';
import { SummonSystem, BEASTS } from '../src/game/summons.js';
import { segmentHitCharacter } from '../src/game/combat-volumes.js';
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const assert = (ok, why) => { if (!ok) throw new Error(why); };
function hero(team, x = 0, y = 0, z = 0) {
  const f = { id: team, name: team === 1 ? '昧光' : '目标', team, pos: V(x,y,z), yaw: 0, pitch: 0, vel: V(), onGround: true,
    height: 1.8, collisionHeight: 1.8, radius: .28, effects: [], cls: { look: {} }, clsId: team === 1 ? 'summoner' : 'swordmaster',
    hp: 3000, alive: true, aimDir: V(0,0,1), stats: { dmgDealt: 0, hits: 0, kills: 0 }, damageMul: () => 1 };
  f.eyePos = (out = V()) => out.copy(f.pos).add(V(0,1.6,0)); f.center = (out = V()) => out.copy(f.pos).add(V(0,.9,0));
  f.forward = (out = V()) => out.set(Math.sin(f.yaw),0,Math.cos(f.yaw)); f.hasEffect = type => f.effects.some(e => e.type === type);
  f.receiveHit = (src,h) => { f.hp -= h.dmg; if (h.effect) f.effects.push(h.effect); return 'hit'; };
  return f;
}
function setup(colliders = []) {
  const owner = hero(1), target = hero(2,0,0,7), world = new World(); owner.target = target;
  world.setLevel({ colliders, bounds: { minX:-30,maxX:30,minZ:-30,maxZ:30 }, floorAt: () => 0 });
  const events = [], g = { time:0, fighters:[owner,target], scene:new THREE.Scene(), world, camera: new THREE.PerspectiveCamera(),
    hud:{floatText(){}}, onFire(){}, onHit:(...args)=>events.push(args), onWhiff(){}, vfx:{ring(){},fire(){},burst(){},projectileStep(){},projectileMesh:()=>new THREE.Group()} };
  g.combat = new Combat(g); g.summons = new SummonSystem(g);
  const tick = seconds => { for(let i=0;i<Math.ceil(seconds*60);i++){g.time+=1/60;g.summons.tick(1/60);g.combat.updateMelee(1/60);g.combat.updateProjectiles(1/60);} };
  return {g,owner,target,system:g.summons,tick,events};
}
export function runSummonRegression() {
  const tests = [], test = (name,fn)=>{try{fn();tests.push({name,passed:true});}catch(e){tests.push({name,passed:false,error:e.message});}};
  test('four types are persistent entities outside hero roster',()=>{const {g,owner,system}=setup();for(const kind in BEASTS)system.cast(owner,{kind});assert(system.units.length===4&&g.fighters.length===2,'roster polluted');assert(new Set(system.units.map(p=>p.beastKind)).size===4,'types');});
  test('resummon replaces same beast instead of stacking',()=>{const {owner,system}=setup();system.cast(owner,{kind:'cat'});const old=system.units[0];system.cast(owner,{kind:'cat'});assert(system.units.length===1&&old!==system.units[0]&&!old.rig.root.parent,'replacement');});
  test('incomplete four-beast formation is unavailable',()=>{const {owner,system}=setup();system.cast(owner,{kind:'cat'});assert(!system.canUse(owner,{command:'formation'}),'free ultimate');});
  test('formation seals resummoning and ends with all beasts gone',()=>{const {owner,system,tick,target}=setup();target.alive=false;for(const kind in BEASTS)system.cast(owner,{kind});assert(system.cast(owner,{command:'formation'}),'formation rejected');assert(!system.canUse(owner,{kind:'cat'}),'resummoning not sealed');tick(12.1);assert(!system.units.length,'beasts survived formation');});
  test('formation does not allow distant fourth beast',()=>{const {owner,system}=setup();for(const kind in BEASTS)system.cast(owner,{kind});system.units[3].pos.z=25;assert(!system.canUse(owner,{command:'formation'}),'distant formation');});
  test('natural lifetime removes pets and graphics',()=>{const {owner,system,tick,target}=setup();target.alive=false;system.cast(owner,{kind:'cat'});const p=system.units[0];tick(32.1);assert(!system.units.length&&!p.rig.root.parent,'lifetime leak');});
  test('owner death clears living pets before they attack',()=>{const {owner,system,tick}=setup();system.cast(owner,{kind:'eagle'});owner.alive=false;tick(.1);assert(!system.units.length,'orphan pets');});
  test('recall stops attacking and follow walks toward owner',()=>{const {owner,system,tick,target}=setup();system.cast(owner,{kind:'cat'});const p=system.units[0];p.pos.set(8,0,8);system.cast(owner,{command:'follow'});const before=p.pos.distanceTo(owner.pos);tick(1);assert(p.pos.distanceTo(owner.pos)<before&&target.hp===3000,'recall');});
  test('follow toggles back to autonomous attacks',()=>{const {owner,system}=setup();system.cast(owner,{kind:'cat'});system.cast(owner,{command:'follow'});system.cast(owner,{command:'follow'});assert(system.order(owner).mode==='free','toggle');});
  test('mark selects a visible enemy by real ray',()=>{const {owner,target,system}=setup();owner.isPlayer=true;owner.aimDir.copy(target.center().sub(owner.eyePos()).normalize());system.cast(owner,{kind:'cat'});system.cast(owner,{command:'focus'});assert(system.order(owner).target===target&&system.order(owner).mode==='focus','ray target');});
  test('mark on ally orders escort instead of friendly attack',()=>{const {owner,target,system}=setup();target.team=owner.team;owner.isPlayer=true;owner.aimDir.copy(target.center().sub(owner.eyePos()).normalize());system.cast(owner,{kind:'cat'});system.cast(owner,{command:'focus'});assert(system.order(owner).target===target&&system.order(owner).mode==='escort','ally mark');});
  test('mark cannot acquire an enemy behind a wall',()=>{const {owner,target,system}=setup([{min:[-2,0,3],max:[2,4,3.2]}]);owner.isPlayer=true;owner.aimDir.copy(target.center().sub(owner.eyePos()).normalize());system.cast(owner,{kind:'eagle'});system.cast(owner,{command:'focus'});assert(!system.order(owner).target&&system.order(owner).mode==='guard','wall bypass');});
  test('free targeting respects solid cover',()=>{const {owner,system,tick,target}=setup([{min:[-25,0,3],max:[25,6,3.2]}]);system.cast(owner,{kind:'eagle'});tick(3);assert(target.hp===3000,'through-wall damage');});
  test('ground cat attacks real low body contacts',()=>{const {owner,system,tick,target}=setup();target.pos.z=3;system.cast(owner,{kind:'cat'});tick(4);assert(target.hp<3000,'cat never bites');});
  test('wolf bites apply its slowing effect',()=>{const {owner,system,tick,target}=setup();target.pos.z=3;system.cast(owner,{kind:'wolf'});tick(4);assert(target.hp<3000&&target.effects.some(e=>e.type==='slow'),'wolf no slow');});
  test('ground pets cannot bite a target high above them',()=>{for(const kind of ['cat','wolf']){const {owner,system,tick,target}=setup();target.pos.set(0,5,3);system.cast(owner,{kind});tick(4);assert(target.hp===3000,kind+' vertical phantom damage');}});
  test('cat and wolf bite from the visible mouth after world movement and turning',()=>{for(const kind of ['cat','wolf']){const {owner,system,target,events}=setup();system.cast(owner,{kind});const pet=system.units[0];pet.pos.set(3,0,-2);pet.yaw=Math.PI/2;target.pos.set(3.7,0,-2);system.bite(pet,target);const hit=events.at(-1)?.[3],socket=pet.visual.mouth.getWorldPosition(V());assert(target.hp<3000&&hit?.origin.distanceTo(socket)<1e-8,kind+' bite detached from model mouth');}});
  test('flying beast projectiles begin at the visible mouth socket',()=>{for(const kind of ['eagle','dragon']){const {owner,system,target,g}=setup();system.cast(owner,{kind});const pet=system.units[0];pet.pos.set(3,1,-2);pet.yaw=Math.PI/2;target.pos.set(10,0,-2);system.shoot(pet,target);const shot=g.combat.projectiles.at(-1),socket=pet.visual.mouth.getWorldPosition(V());assert(shot&&shot.origin.distanceTo(socket)<1e-8,kind+' emitter detached from model mouth');}});
  test('eagle uses traveling projectile to hit at range',()=>{const {owner,system,tick,target}=setup();system.cast(owner,{kind:'eagle'});tick(4);assert(target.hp<3000,'eagle no projectile hit');});
  test('dragon traveling fire applies burn',()=>{const {owner,system,tick,target}=setup();system.cast(owner,{kind:'dragon'});tick(5);assert(target.hp<3000&&target.effects.some(e=>e.type==='burn'),'dragon no burn');});
  test('beasts have hittable physical volumes',()=>{const {owner,system}=setup();system.cast(owner,{kind:'cat'});const p=system.units[0],c=p.center();assert(segmentHitCharacter(c.clone().add(V(0,0,-2)),c.clone().add(V(0,0,2)),p),'pet intangible');assert(!segmentHitCharacter(c.clone().add(V(0,3,-2)),c.clone().add(V(0,3,2)),p),'pet infinite height');});
  test('pet kill does not increment hero kill count',()=>{const {owner,system,target,tick}=setup();system.cast(owner,{kind:'cat'});const p=system.units[0];p.receiveHit(target,{dmg:9999});tick(.1);assert(!system.units.length&&target.stats.kills===0,'pet is hero');});
  test('pet included in hostile combat targets only',()=>{const {owner,system,target,g}=setup();system.cast(owner,{kind:'cat'});const p=system.units[0];assert(g.combat.enemiesOf(target).includes(p)&&!g.combat.enemiesOf(owner).includes(p),'combat filtering');});
  test('freeze arrests motion and wing animation',()=>{const {owner,system,tick}=setup();system.cast(owner,{kind:'eagle'});const p=system.units[0];p.addEffect({type:'frozen',t:1500,debuff:true});const age=p.age;tick(.5);assert(p.age===age&&!p.target,'frozen pet animated or attacked');});
  test('LAN snapshot creates four visible replicas and interpolates',()=>{const host=setup(),guest=setup();for(const kind in BEASTS)host.system.cast(host.owner,{kind});const a=host.system.snapshot();host.tick(.4);const b=host.system.snapshot();guest.system.applySnapshot(b,a,.5,id=>guest.g.fighters.find(f=>f.id===id),1/60);assert(guest.system.units.length===4&&guest.owner.summonState.count===4,'missing replicas');assert(guest.system.units.every(p=>p.rig.root.parent===guest.g.scene),'missing scene models');});
  test('LAN later empty snapshot destroys previous replicas',()=>{const host=setup(),guest=setup();host.system.cast(host.owner,{kind:'cat'});const a=host.system.snapshot();guest.system.applySnapshot(a,null,1,id=>guest.g.fighters.find(f=>f.id===id),1/60);const p=guest.system.units[0];guest.system.applySnapshot({units:[],owners:[]},a,1,id=>guest.g.fighters.find(f=>f.id===id),1/60);assert(!guest.system.units.length&&!p.rig.root.parent,'ghost pet');});
  test('delayed LAN hit can still resolve removed pet identity',()=>{const {owner,system}=setup();system.cast(owner,{kind:'cat'});const p=system.units[0];system.remove(p);assert(system.lookup(p.id)===p,'late hit lookup lost');system.clear();assert(!system.lookup(p.id),'stale identity across matches');});
  return {passed:tests.filter(t=>t.passed).length,total:tests.length,tests};
}
if(typeof process!=='undefined'&&process.argv[1]?.endsWith('summons-regression.mjs')){const result=runSummonRegression();console.log(JSON.stringify(result,null,2));if(result.passed!==result.total)process.exitCode=1;}
