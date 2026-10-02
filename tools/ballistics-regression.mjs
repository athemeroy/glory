import * as THREE from '../vendor/three.module.js';
import { gunProfile, gunProjectile, applyGunRecoil } from '../src/game/ballistics.js';
import { Combat } from '../src/game/combat.js';
import { World } from '../src/game/world.js';
const v=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const results=[], assert=(ok,m)=>{if(!ok)throw Error(m)};
function test(name,fn){try{fn();results.push({name,passed:true})}catch(e){results.push({name,passed:false,error:e.message})}}
function fighter(clsId='sharpshooter') {
  const root=new THREE.Group(),muzzle=new THREE.Object3D();root.add(muzzle);muzzle.position.set(0,8,0);root.updateMatrixWorld(true);
  const f={clsId,cls:{},weapon:{type:clsId==='launcher'?'cannon':'pistol',muzzle,obj:root},rig:{root},pos:v(0,6.4,0),vel:v(),knockVel:v(),aimDir:v(0,0,1),moveInput:new THREE.Vector2(),onGround:false,team:1,alive:true,isPlayer:true,scale:1,height:1.8,radius:.28,state:'jump'};
  f.eyePos=(o=v())=>o.copy(f.pos).add(v(0,1.6,0));f.center=(o=v())=>o.copy(f.pos).add(v(0,.9,0));f.forward=(o=v())=>o.set(0,0,1);f.hasEffect=()=>false;f.movementLocked=()=>false;f.receiveHit=()=>{f.gotHit=true;return 'hit'};return f;
}
function game(f) {
  const world=new World();world.setLevel({colliders:[],bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100}});
  const g={time:1,world,scene:new THREE.Scene(),fighters:[f],player:f,viewPitch:0,viewYaw:0,onHit(){},sfx(){},shake(){},vfx:{projectileMesh:()=>new THREE.Group(),projectileStep(){},burst(){},sprite(){}}};
  g.onFire=(a,p,d,pos,dir)=>applyGunRecoil(g,a,p,d,dir,{physics:false});g.combat=new Combat(g);return g;
}
const bullet={kind:'bullet',gravity:0,speed:90,range:100,radius:.02,dmg:10};
test('枪弹参数是副本，不改写职业原始技能',()=>{const p=gunProjectile(fighter(),bullet,{});assert(p!==bullet&&p.gravity===9.8&&bullet.gravity===0,'mutated skill')});
test('禁用声音/画面回调后权威后坐物理仍然生效',()=>{const f=fighter(),g=game(f);g.onFire=()=>{};g.combat.fireProjectile(f,bullet,{},0);assert(f.knockVel.z< -2,'physics depended on visual callback')});
test('炮弹有独立重力而激光保持直线',()=>{const f=fighter('launcher');assert(gunProjectile(f,{...bullet,kind:'shell'},{}).gravity===4.5&&gunProfile(f,{kind:'beam'}).gravity===0,'profile mismatch')});
test('法术、炫纹、召唤兽、飞刀、手雷不被枪弹配置覆盖',()=>{for(const [f,p] of [[fighter('witch'),{kind:'magic',gravity:0}],[fighter(),{...bullet,chaser:'ice'}],[fighter('launcher'),{kind:'magic',summon:true}],[fighter('assassin'),{...bullet,fromHand:true,gravity:12}],[fighter(),{kind:'grenade',gravity:16}]])assert(gunProjectile(f,p,{})===p,'non gun changed')});
test('有效投射物真实按连续弹道下坠',()=>{const f=fighter(),g=game(f),pr=g.combat.fireProjectile(f,bullet,{},0);for(let i=0;i<30;i++)g.combat.updateProjectiles(1/60);assert(pr.pos.y<6.8&&pr.pos.y>6.7&&pr.pos.z>44,'no physical drop '+pr.pos.toArray())});
test('炮弹下坠与时间相关，不是只画弯曲尾迹',()=>{const f=fighter('launcher'),g=game(f),pr=g.combat.fireProjectile(f,{...bullet,kind:'shell',speed:30},{},0);for(let i=0;i<36;i++)g.combat.updateProjectiles(1/60);assert(pr.pos.y<7.2&&pr.pos.y>7.1&&pr.vel.y< -2.69,'shell drop wrong '+pr.pos.toArray())});
test('魔法投射物保持原定直线',()=>{const f=fighter('witch'),g=game(f),pr=g.combat.fireProjectile(f,{...bullet,kind:'magic'}, {},0);for(let i=0;i<30;i++)g.combat.updateProjectiles(1/60);assert(Math.abs(pr.pos.y-8)<1e-8,'magic has gravity')});
test('高速下坠弹丸仍被薄墙阻挡',()=>{const f=fighter(),g=game(f);g.world.colliders.push({min:[-3,0,5],max:[3,12,5.025]});g.combat.fireProjectile(f,bullet,{},0);g.combat.updateProjectiles(.1);assert(g.combat.projectiles.length===0,'wall tunneled')});
test('枪口在墙后时无法用眼睛出生穿墙',()=>{const f=fighter(),g=game(f);f.weapon.muzzle.position.z=2;g.world.colliders.push({min:[-3,0,.7],max:[3,12,.8]});const pr=g.combat.fireProjectile(f,bullet,{},0);assert(pr.obstructed,'muzzle not obstructed');g.combat.updateProjectiles(1/60);assert(!g.combat.projectiles.length,'blocked projectile alive')});
test('AI 补偿下坠仍可命中远处站立身体',()=>{const f=fighter('launcher'),t=fighter('swordmaster'),g=game(f);t.team=2;t.pos.set(0,7.1,20);f.isPlayer=false;f.target=t;f.ai={aimSpread:()=>0};g.fighters.push(t);g.combat.fireProjectile(f,{...bullet,kind:'shell',speed:30},{},0);for(let i=0;i<60&&!t.gotHit;i++)g.combat.updateProjectiles(1/60);assert(t.gotHit,'AI cannot compensate')});
test('空中射击产生射线反方向水平冲量',()=>{const f=fighter(),g=game(f);applyGunRecoil(g,f,bullet,{},v(.6,0,.8));assert(f.knockVel.x< -1.3&&f.knockVel.z< -1.7,'wrong recoil direction')});
test('向地面开枪上托，向天空开枪下压',()=>{const f=fighter(),g=game(f);applyGunRecoil(g,f,bullet,{},v(0,-1,0));assert(f.vel.y>1,'no lift');g.time+=.2;f.vel.y=0;applyGunRecoil(g,f,bullet,{},v(0,1,0));assert(f.vel.y< -1,'upshot lifts')});
test('飞炮冲量强于飞枪',()=>{const f=fighter(),g=game(f),c=fighter('launcher'),cg=game(c);applyGunRecoil(g,f,bullet,{},v(0,0,1));applyGunRecoil(cg,c,{kind:'shell'},{},v(0,0,1));assert(c.knockVel.length()>f.knockVel.length()*3,'cannon weak')});
test('地面摩擦与退步卸力降低位移',()=>{const f=fighter('launcher'),g=game(f);f.onGround=true;applyGunRecoil(g,f,{kind:'shell'},{},v(0,0,1));const unbraced=f.knockVel.length();f.knockVel.set(0,0,0);g.time+=1;f.moveInput.y=-1;applyGunRecoil(g,f,{kind:'shell'},{},v(0,0,1));assert(f.knockVel.length()<unbraced*.6,'bracing ineffective')});
test('同帧多弹只产生一次后坐，连发仍逐发反馈',()=>{const f=fighter(),g=game(f);applyGunRecoil(g,f,bullet,{},v(0,0,1));const z=f.knockVel.z,p=g.viewPitch;applyGunRecoil(g,f,bullet,{},v(0,0,1));assert(f.knockVel.z===z&&g.viewPitch===p,'double recoil');g.time+=.1;applyGunRecoil(g,f,bullet,{},v(0,0,1));assert(f.knockVel.z<z&&g.viewPitch>p,'new shot no recoil')});
test('空中冲量有水平/向上速度上限',()=>{const f=fighter('launcher'),g=game(f);for(let i=0;i<80;i++){g.time+=.1;applyGunRecoil(g,f,{kind:'shell'},{},v(0,-.5,.866))}assert(Math.hypot(f.knockVel.x,f.knockVel.z)<=18.001&&f.vel.y<=8.001,'uncapped movement')});
test('镜头抬枪是真实瞄准角度，可由鼠标压回',()=>{const f=fighter(),g=game(f);const kick=applyGunRecoil(g,f,bullet,{},v(0,0,1));assert(g.viewPitch>0&&g.shotHeat>0,'cosmetic only');g.viewPitch-=kick.pitch;assert(Math.abs(g.viewPitch)<1e-8,'uncompensatable')});
test('访客回放仅改变本地瞄准，不重复权威位移',()=>{const f=fighter(),g=game(f);g.netGuest=true;applyGunRecoil(g,f,bullet,{},v(0,-.5,.866));assert(g.viewPitch>0&&f.knockVel.length()===0&&f.vel.y===0,'guest duplicated physics')});
test('施法与召唤不会触发金属枪口反馈',()=>{const f=fighter('witch'),g=game(f);assert(applyGunRecoil(g,f,{kind:'magic'}, {},v(0,0,1))===null&&g.viewPitch===0,'magic recoiled')});
test('受束缚不能通过枪口反冲绕过控制',()=>{const f=fighter(),g=game(f);f.action={};f.movementLocked=()=>true;applyGunRecoil(g,f,bullet,{},v(0,-.5,.866));assert(f.knockVel.length()===0&&f.vel.y===0&&f.action.recoiled,'root bypass')});
const report={passed:results.filter(r=>r.passed).length,total:results.length,results};console.log(JSON.stringify(report,null,2));if(report.passed!==report.total)process.exitCode=1;
