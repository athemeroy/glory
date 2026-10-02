import * as THREE from 'three';
import { CLASS_VISUALS, visualFor } from '../data/skill-visuals.js';
import { attackKind } from './combat-volumes.js';

const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const TAU = Math.PI * 2;
const MAGIC = new Set(['dark', 'holy', 'arcane', 'ice']);
const FLASKS = new Set(['ice-flask', 'root-flask', 'poison-flask']);
const MELEE = /blade|thrust|spear|backstab|blood-storm|shadow-storm|umbrella-storm|brawl-storm/;

function dustTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  // Soft, non-additive dust. Deterministic puffs retain holes through the cloud.
  for (let i = 0; i < 18; i++) {
    const x = 64 + Math.sin(i * 5.1) * 35, y = 64 + Math.cos(i * 2.7) * 35, r = 16 + (i % 5) * 3;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,.14)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad; ctx.fillRect(x-r, y-r, r*2, r*2);
  }
  return new THREE.CanvasTexture(c);
}

function identity(f) {
  return CLASS_VISUALS[f.clsId] || CLASS_VISUALS[f.kind === 'boss' ? 'boss' : f.cls?.weapon === 'club' ? 'mob_thug' : 'skeleton'];
}

function forward(f) {
  if (f.forward) return f.forward(new THREE.Vector3());
  return new THREE.Vector3(Math.sin(f.yaw || 0), 0, Math.cos(f.yaw || 0));
}

function aim(f) {
  // The player may turn during an attack. Its visible pose and collision use
  // the current direction; an action only supplies a fallback for old puppets.
  const yaw=f.yaw ?? f.action?.aimYaw ?? 0,pitch=f.pitch ?? f.action?.aimPitch ?? 0,cp=Math.cos(pitch);
  return new THREE.Vector3(Math.sin(yaw)*cp,Math.sin(pitch),Math.cos(yaw)*cp);
}

function center(f, height = 1.1) {
  return new THREE.Vector3(f.pos.x, f.pos.y + height * (f.scale || 1), f.pos.z);
}

function socket(f, which = 'right') {
  if(which === 'body') {
    if(f.leftWeapon && ['axe','knight'].includes(f.weapon?.type))return f.leftWeapon.localToWorld(new THREE.Vector3(0,.1,.1));
    if(f.form==='shield' && f.weapon?.obj) {
      const canopy=f.weapon.obj.children.find(c=>c.material?.userData?.canopy);
      if(canopy)return canopy.localToWorld(new THREE.Vector3(0,.5,0));
    }
    return new THREE.Vector3(f.pos.x,f.pos.y+(f.height||1.8)*.65,f.pos.z).addScaledVector(aim(f),.16);
  }
  const foot = which === 'foot' || which === 'leftFoot', side = which === 'left' || which === 'leftFoot' ? 'Left' : 'Right';
  // Mocap and procedural models use the same actual world space hand or muzzle.
  const bone = f.mocapBody?.bones?.[`${side}Hand`] || f.rig?.bones?.[which === 'left' ? 'haL' : 'haR'];
  const obj = foot ? f.mocapBody?.bones?.[`${side}Foot`] || f.rig?.bones?.[side === 'Left' ? 'ftL' : 'ftR'] : bone;
  if (obj?.getWorldPosition) return obj.getWorldPosition(new THREE.Vector3());
  const p = center(f, foot ? .32 : 1.12);
  return p.addScaledVector(forward(f), foot ? .7 : .5);
}

function fade(k, peak = .18) {
  return Math.min(1, k / peak) * Math.pow(Math.max(0, 1-k), .7);
}

// This engine only draws. It never grants hits, movement, blindness or armor.
export class SkillEffects {
  constructor(vfx) {
    this.v = vfx;
    this.geo = {
      ring: new THREE.RingGeometry(.92, 1, 48),
      slimRing: new THREE.RingGeometry(.974, 1, 48),
      disk: new THREE.CircleGeometry(1, 40),
      box: new THREE.BoxGeometry(1,1,1),
      cone: new THREE.ConeGeometry(1,1,10),
      sphere: new THREE.IcosahedronGeometry(1,1),
      crystal: new THREE.OctahedronGeometry(1),
      pipe: new THREE.CylinderGeometry(1,1,1,8,1,true),
    };
    this.dustMap = dustTexture();
    this.projectileMats = new Map();
    this.statuses = new Map();
    this.zones = new Map();
    this.serial = 0;
    this.stats = { spawned: 0, rejected: 0, expired: 0 };
  }

  material(color, opacity = .65, additive = true) {
    return new THREE.MeshBasicMaterial({color, transparent:true, opacity, depthWrite:false,
      blending:additive ? THREE.AdditiveBlending : THREE.NormalBlending, side:THREE.DoubleSide});
  }

  mesh(group, geo, color, opacity = .65, additive = true) {
    const m = new THREE.Mesh(geo, this.material(color, opacity, additive));
    m.userData.alpha = opacity; m.renderOrder = 8; group.add(m); return m;
  }

  line(group, points, color, opacity = .65) {
    const geo = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)));
    const mat = new THREE.LineBasicMaterial({color, transparent:true, opacity, depthWrite:false, blending:THREE.AdditiveBlending});
    const m = new THREE.Line(geo, mat); m.userData.alpha = opacity;
    m.userData.ownedGeometry = true; group.add(m); return m;
  }

  dispose(group) {
    group.traverse(o => {
      if (o.userData.ownedGeometry) o.geometry?.dispose();
      if (o.material && !o.userData.sharedMaterial) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
    });
  }

  alpha(group, value) {
    group.traverse(o => { if(o.material && o.userData.alpha !== undefined) o.material.opacity = o.userData.alpha * value; });
  }

  add(group, dur, update, finish) {
    this.stats.spawned++;
    this.v.add(group, Math.max(.05, dur), (k, dt) => { update?.(k,dt); }, () => {
      this.stats.expired++; this.dispose(group); finish?.();
    });
    return group;
  }

  flatRing(group, radius, color, opacity = .6, slim = false) {
    const m = this.mesh(group, this.geo[slim ? 'slimRing' : 'ring'], color, opacity);
    m.rotation.x = -Math.PI/2; m.scale.setScalar(radius); return m;
  }

  glyph(group, radius, color, school, opacity = .55) {
    const ring = this.mesh(group, this.geo.slimRing, color, opacity); ring.scale.setScalar(radius);
    const count = school === 'holy' ? 4 : school === 'dark' ? 7 : 6;
    for(let i=0; i<count; i++) {
      const a = i/count*TAU, ca=Math.cos(a),sa=Math.sin(a);
      const bar = this.mesh(group, this.geo.box, color, opacity*.85);
      bar.position.set(ca*radius*.86,sa*radius*.86,0);
      bar.rotation.z = a; bar.scale.set(radius*.18,radius*.025,.008);
    }
    if(school === 'holy') {
      for(const [x,y] of [[.11,.48],[.4,.11]]) {
        const cross=this.mesh(group,this.geo.box,color,opacity);cross.scale.set(x*radius,y*radius,.012);
      }
    } else {
      const n=school==='dark'?7:3, pts=[];
      for(let i=0;i<=n;i++) {const a=i/n*TAU+Math.PI/2;pts.push([Math.cos(a)*radius*.65,Math.sin(a)*radius*.65,0]);}
      this.line(group,pts,color,opacity*.75);
    }
    return group;
  }

  wind(f, d, profile, slot) {
    // Normal attacks remain unobstructed; skills telegraph on the actual hands.
    if (slot === 'atk' && !d.ult) return;
    const theme=identity(f), group=new THREE.Group();
    const gun=/gun|shot|shell|gatling|sniper|laser|grenade/.test(profile);
    const school=theme.school;
    const mag=MAGIC.has(school) || /heal|shield|wings|flask|gate|meteor/.test(profile);
    const radius=d.ult ? .32 : gun ? .13 : mag ? .24 : .13;
    this.glyph(group,radius,theme.color,mag?school:'steel',mag ? .42 : .28);
    if (d.ult) {
      const ring=this.mesh(group,this.geo.slimRing,theme.color,.35);ring.scale.setScalar(radius*1.3);
      ring.rotation.x=.6;
    }
    const duration=clamp((d.wind||180)/1000,.075,1.5);
    const which=/kick/.test(profile)||profile==='stomp' ? d.anim==='spinkick'||d.hits?.[0]?.leg==='left'?'leftFoot':'foot' : profile==='shoulder'?'body':profile==='palm'||d.anim==='palm'||d.anim==='punchL'?'left':'right';
    const expected=f.action;
    this.add(group,duration,(k) => {
      // Cancelling a wind-up removes its visual instead of completing an orphan cast.
      if(expected && f.action !== expected) {group.visible=false; return;}
      const obj=gun?f.weapon?.tip:null;
      group.position.copy(obj?.getWorldPosition?obj.getWorldPosition(new THREE.Vector3()):socket(f,which));
      group.quaternion.setFromUnitVectors(Z,aim(f));
      group.rotateZ(k*1.2);
      group.scale.setScalar(.65+.35*k);
      this.alpha(group,Math.sin(Math.PI*.8*k)*.8+.12);
    });
  }

  skillEvent(f, type, data={}) {
    const d=data.def || f.action?.def || {};
    const p=visualFor(d,f), theme=identity(f), col=p==='poison-blade'?'#97bd6b':theme.color;
    if(type==='action') {this.wind(f,d,p,data.slot); return true;}
    if(type==='form') {
      if(!data.silent) this.wind(f,{wind:180},'combo-blade','form');
      return true;
    }
    if(type==='buff') {this.buff(f,data.def?.buff || d.buff,col);return true;}
    if(type==='shadowstep') {
      this.afterimages(f,data.duration || .5,col);return true;
    }
    if(type==='slam') {this.slam(f,d,p,col);return true;}
    if(type!=='active' && type!=='swing') return false;
    if(d.slamOnLand) return true;
    const i=type==='swing'?(data.i||0):0;
    const hit=d.hits?.[i] || d.hits?.[0];
    if(p==='sand') {
      // The projectile owns the cloud. Older melee-only sand definitions also work.
      if(!d.proj?.length) this.sandFan(socket(f),forward(f),hit?.range||4,.55);
      return true;
    }
    if(p==='dragon') { if(type==='active')this.dragon(f,d,col);return true; }
    if(p==='wings') {if(type==='active')this.wings(f);return true;}
    if(p==='broom-flight') {if(type==='active')this.flight(f,(d.active||450)/1000,col);return true;}
    if(p==='shadow-dash') {if(type==='active')this.afterimages(f,(d.active||220)/1000,col);}
    if(p==='fear-cone' || p==='fear-ring') {
      if(hit) this.fear(f,hit,p==='fear-ring',col);return true;
    }
    if(p==='holy-wave') {if(hit)this.radialWave(f,hit.range,col,.4);return true;}
    if(p==='frost-wave') {if(hit){this.radialWave(f,hit.range,'#9bbfcd',.45);this.crystals(f.pos,hit.range*.85,'#9bbfcd',12,.6);}return true;}
    if(p==='stomp') {this.stomp(f,hit,col);return true;}
    if(p==='grapple') {this.grapple(f,col);return true;}
    const activeTime=f.action?.stage==='active' ? f.action.t||0 : 0;
    if(type==='active' && hit && !data.deferred && hit.t>activeTime) {
      const expected=f.action,wait=(hit.t-activeTime)/1000;
      // First strikes may open later than the active stage. Keep this wait in
      // the effect timeline so cancellation/clear cannot emit an orphan slash.
      this.v.add(new THREE.Group(),wait,k=>{
        if(k===1 && f.alive!==false && (!expected || f.action===expected))this.skillEvent(f,type,{...data,deferred:true});
      });
      return true;
    }
    // A combo can switch from a club to a kick or from a spear to a palm.
    // Use the same segment kind as combat instead of one socket for its name.
    const strikeKind=hit ? attackKind(hit,d,f) : null;
    if(hit && ['fist','kick','stomp','body'].includes(strikeKind)) {
      if(strikeKind==='stomp')this.stomp(f,hit,col);
      else this.impact(f,d,hit,strikeKind==='body'?'shoulder':p,col,i);
      return true;
    }
    if(hit && (MELEE.test(p)|| /spin|dash|blade|thrust/.test(d.vfx||'') || d.vfx?.startsWith('slash') || d.vfx==='ring' || d.vfx==='ringWide')) {
      const arc=hit.arc || 110, range=(hit.range||2.4)*(f.scale||1);
      let kind=d.vfx || (arc>=300?'ring':arc<60?'thrust':'slashR');
      if(p==='cross-blade') kind=i?'slashDown':'slashR';
      else if(p==='rise-blade'||p==='spear-rise')kind='slashUp';
      else if(p==='storm-blade'||p==='blood-storm'||p==='shadow-storm'||p==='umbrella-storm')kind=i%3===2?'slashUp':i%2?'slashL':'slashR';
      else if(type==='swing' && p!=='repeat-thrust')kind=i%2?'slashL':'slashR';
      // Colored slashes stay within the real range; no fake flying waves on power attacks.
      this.v.slash(f,kind,col,range,d.ult?1.25:data.slot==='atk'?1:1.12);
      if(/dash|shadow/.test(p)&&type==='active')this.afterimages(f,Math.min(.35,(d.active||220)/1000),col);
      return true;
    }
    // Projectiles, target heals, beams and delayed areas draw from their actual event endpoints.
    return true;
  }

  impact(f,d,h,profile,col,index=0) {
    const group=new THREE.Group(),kind=attackKind(h,d,f),isKick=kind==='kick'||kind==='stomp';
    const anim=d.altAnims?.[f.action?.animIdx||0]||d.anim||'',which=isKick ? h.leg==='left'||h.leg!=='right'&&anim==='spinkick'?'leftFoot':'foot' : profile==='palm'||anim==='palm'||/L$/.test(anim)?'left':'right';
    const origin=()=>socket(f,kind==='body'||profile==='shoulder'?'body':which),pos=origin();
    group.position.copy(pos); group.quaternion.setFromUnitVectors(Z,aim(f));
    const radius=clamp((h.range||1.8)*.22,.18,.62);
    const ring=this.mesh(group,this.geo.ring,col,.55);ring.scale.setScalar(radius);
    ring.position.z=.12;
    for(let j=0;j<5;j++) {
      const a=j/5*TAU;
      this.line(group,[[Math.cos(a)*radius*.4,Math.sin(a)*radius*.4,-.18],[Math.cos(a)*radius,Math.sin(a)*radius,.12]],col,.45);
    }
    const duration=profile==='heavy-fist' ? .24 : .17;
    this.add(group,duration,k=>{
      ring.scale.setScalar(radius*(.55+.8*k));
      group.position.copy(origin());group.quaternion.setFromUnitVectors(Z,aim(f));
      this.alpha(group,1-k);
    });
    // The moving fist/foot itself remains readable; no camera-facing white disk.
    const n=profile==='heavy-fist'?12:5;
    this.v.burst(pos,col,n,1.4,.022,.2,2);
    if(profile==='spin-kick'||profile==='low-kick') {
      const s=new THREE.Group();s.position.copy(f.pos);s.position.y=pos.y;s.rotation.y=f.yaw??f.action?.aimYaw??0;
      const reach=Math.min(h.range||2.3,Math.hypot(pos.x-f.pos.x,pos.z-f.pos.z)+.25),angle=Math.min(TAU,(h.arc||160)*Math.PI/180);
      const arc=this.mesh(s,this.v.arcGeometry(.82,1,angle),col,.28);
      this.add(s,.25,k=>{s.position.copy(f.pos);s.position.y=origin().y;s.rotation.y=f.yaw??f.action?.aimYaw??0;arc.scale.setScalar(reach*(.65+.35*k));this.alpha(s,1-k);});
    }
  }

  stomp(f,h,col) {
    const pos=socket(f,'foot');pos.y=f.pos.y+.035;
    const g=new THREE.Group();g.position.copy(pos);
    const r=this.flatRing(g,.42,col,.55);
    this.add(g,.24,k=>{r.scale.setScalar(.15+.5*k);this.alpha(g,1-k);});
    this.smoke(pos,.65,'#988675',.45,4);
  }

  grapple(f,col) {
    const g=new THREE.Group(),hands=[];
    for(const [which,sign] of [['left',-1],['right',1]]) {
      const bracket=new THREE.Group();g.add(bracket);hands.push({which,bracket});
      this.line(bracket,[[sign*.06,.13,.03],[sign*.12,0,.14],[0,-.12,.19]],col,.62);
    }
    this.add(g,.18,k=>{for(const {which,bracket} of hands){bracket.position.copy(socket(f,which));bracket.quaternion.setFromUnitVectors(Z,aim(f));bracket.scale.setScalar(1-.35*k);}this.alpha(g,1-k);});
  }

  radialWave(f,r,col,dur=.42) {
    const g=new THREE.Group();g.position.copy(f.pos);g.position.y+=.05;
    const ring=this.flatRing(g,1,col,.5); const second=this.flatRing(g,1,col,.22,true);second.position.y=.15;
    this.add(g,dur,k=>{ring.scale.setScalar(Math.max(.08,r*k));second.scale.setScalar(Math.max(.04,r*Math.max(0,k-.12)));this.alpha(g,1-k);});
  }

  fear(f,h,full,col) {
    if(full) {this.radialWave(f,h.range||4,col,.44);return;}
    const g=new THREE.Group();g.position.copy(center(f,1));g.quaternion.setFromUnitVectors(Z,aim(f));
    const a=(h.arc||60)/180*Math.PI,range=h.range||6;
    for(let j=0;j<3;j++) {
      const pts=[];
      for(let i=0;i<=20;i++){const t=-a/2+a*i/20;pts.push([Math.sin(t)*range*(.3+j*.25),0,Math.cos(t)*range*(.3+j*.25)]);}
      this.line(g,pts,col,.34-j*.07);
    }
    this.add(g,.32,k=>{g.scale.setScalar(.6+.4*k);this.alpha(g,1-k);});
  }

  slam(f,d,profile,col) {
    const r=(d.hits?.[0]?.range||3)*(f.scale||1),g=new THREE.Group();g.position.copy(f.pos);g.position.y+=.025;
    const ring=this.flatRing(g,1,col,.55);
    for(let j=0;j<8;j++){
      const a=j/8*TAU,ca=Math.cos(a),sa=Math.sin(a);
      this.line(g,[[ca*.3,0,sa*.3],[ca*r*.4+.14,0,sa*r*.4-.12],[ca*r*.8,0,sa*r*.8]],col,.35);
    }
    this.add(g,.6,k=>{ring.scale.setScalar(r*Math.min(1,k*2.2));this.alpha(g,1-k);});
    this.smoke(f.pos,r*.6,'#928472',.75,7);
    if(profile==='slam-frost'||profile==='slam-star')this.crystals(f.pos,r*.7,col,10,.55);
    else this.v.burst(center(f,.08),col,18,2,.032,.4,6);
  }

  dragon(f,d,col) {
    const r=d.hits?.[0]?.range||3.6,g=new THREE.Group(),segs=[];
    for(let i=0;i<12;i++) {
      const m=this.mesh(g,this.geo.ring,col,.42*(.7+i/30));
      m.scale.setScalar(.1+i*.013);segs.push(m);
    }
    const head=new THREE.Group();g.add(head);
    this.line(head,[[-.1,0,-.15],[-.14,.08,.03],[0,.045,.25],[.14,.08,.03],[.1,0,-.15]],col,.7);
    this.line(head,[[-.12,-.035,-.06],[0,-.085,.22],[.12,-.035,-.06]],col,.55);
    for(const side of [-1,1]) {
      this.line(head,[[side*.13,.05,-.1],[side*.26,.32,-.34],[side*.29,.3,-.55]],col,.75);
      this.line(head,[[side*.08,-.04,.12],[side*.36,-.12,.26]],col,.45);
    }
    this.add(g,(d.active||500)/1000,k=>{
      g.position.copy(center(f,1.2));g.quaternion.setFromUnitVectors(Z,aim(f));
      for(let i=0;i<12;i++){const t=i/11;segs[i].position.set(Math.sin(t*5-k*6)*.16,Math.cos(t*4-k*7)*.14,t*r);segs[i].rotation.z=k*2+t;}
      head.position.copy(segs[11].position);head.position.z+=.18;
      this.alpha(g,fade(k,.08));
    });
  }

  wings(f) {
    const g=new THREE.Group(),col='#f0df9f';
    for(const side of [-1,1]){
      for(let j=0;j<5;j++)this.line(g,[[side*.16,.13,0],[side*(.65+j*.1),.45+j*.09,-.16],[side*(.92+j*.16),.18+j*.02,-.26]],col,.68-j*.07);
    }
    const halo=this.mesh(g,this.geo.slimRing,col,.55);halo.rotation.x=-Math.PI/2;halo.position.y=.8;halo.scale.setScalar(.27);
    this.add(g,.95,k=>{g.position.copy(center(f,1.4));g.rotation.y=f.yaw;g.scale.setScalar(.55+.45*Math.sin(Math.min(1,k*2)*Math.PI/2));this.alpha(g,fade(k));});
  }

  flight(f,dur,col) {
    const g=new THREE.Group(),nodes=[];
    for(let i=0;i<4;i++){const r=this.mesh(g,this.geo.slimRing,col,.3);r.scale.setScalar(.2+i*.07);nodes.push(r);}
    this.add(g,dur,k=>{
      g.position.copy(center(f,.65));g.quaternion.setFromUnitVectors(Z,aim(f));
      for(let i=0;i<nodes.length;i++)nodes[i].position.z=-.35-i*.3-(k*.5)% .3;
      this.alpha(g,fade(k,.12));
    });
  }

  afterimages(f,dur,col) {
    const start=center(f,.9),expected=f.action;
    const g=new THREE.Group(),segments=[];
    for(let i=0;i<4;i++){
      const m=this.mesh(g,this.geo.box,col,.13*(1-i/5));m.scale.set(.08,.65,.02);segments.push(m);
    }
    this.add(g,dur,(k)=>{
      const now=center(f,.9);
      if(expected && f.action!==expected)g.visible=false;
      for(let i=0;i<4;i++) {segments[i].position.copy(now).lerp(start,(i+1)/5);segments[i].rotation.y=f.yaw;}
      this.alpha(g,1-k);
    });
  }

  buff(f,e,col) {
    if(!e)return;
    this.statusTarget(f,{...e,type:e.type||'berserk',t:e.t||800});
  }

  smoke(pos,r,color,dur=.7,n=6) {
    const group=new THREE.Group();group.position.copy(pos);
    const puffs=[];
    for(let i=0;i<n;i++) {
      const mat=new THREE.SpriteMaterial({map:this.dustMap,color,transparent:true,opacity:.24,depthWrite:false,blending:THREE.NormalBlending});
      const sp=new THREE.Sprite(mat),a=i*2.4,dist=r*(.2+(i%3)*.2);
      sp.position.set(Math.cos(a)*dist,.12+(i%3)*r*.17,Math.sin(a)*dist);sp.scale.setScalar(r*(.8+(i%2)*.3));
      sp.userData.baseScale=sp.scale.x;sp.userData.baseY=sp.position.y;
      sp.userData.alpha=.24;group.add(sp);puffs.push(sp);
    }
    this.add(group,dur,k=>{for(const puff of puffs){puff.scale.setScalar(puff.userData.baseScale*(1+.3*k));puff.position.y=puff.userData.baseY+r*.16*k;}this.alpha(group,fade(k,.1));});
    return group;
  }

  sandFan(pos,dir,range=4,dur=.55) {
    const g=new THREE.Group();g.position.copy(pos);g.quaternion.setFromUnitVectors(Z,dir);
    const grains=[];
    for(let i=0;i<24;i++){
      const m=this.mesh(g,this.geo.box,i%3?'#ae9670':'#d1b887',.58,false),a=(i/23-.5)*1.1;
      m.scale.set(.02+(i%3)*.008,.009,.02);grains.push({m,a,h:(i%5-2)*.075,d:.65+(i%4)*.09});
    }
    this.add(g,dur,k=>{for(const {m,a,h,d} of grains){const dist=range*k*d;m.position.set(Math.sin(a)*dist,h*Math.sqrt(k)*4,Math.cos(a)*dist);m.rotation.set(k*4,k*7,k*3);}this.alpha(g,Math.pow(1-k,.6));});
    const mid=pos.clone().addScaledVector(dir,range*.45);this.smoke(mid,range*.24,'#baa280',dur,4);
  }

  crystals(pos,r,col,n=8,dur=.55) {
    const g=new THREE.Group();g.position.copy(pos);
    const nodes=[];
    for(let i=0;i<n;i++) {const a=i/n*TAU,m=this.mesh(g,this.geo.crystal,col,.62);m.scale.set(.065,.18+(i%3)*.08,.065);m.position.set(Math.cos(a)*r*.6,.12,Math.sin(a)*r*.6);m.rotation.z=(i%3-1)*.6;nodes.push(m);}
    this.add(g,dur,k=>{for(let i=0;i<nodes.length;i++){nodes[i].position.y=.12+Math.sin(k*Math.PI)*(.3+i%3*.15);nodes[i].rotation.y=k*3;}this.alpha(g,fade(k,.08));});
  }

  fire(att,p,d,visual,dir) {
    const profile=visualFor(d,att),theme=identity(att);
    if(p.kind==='sand') {this.sandFan(visual,dir,Math.min(1.3,p.range||4),.25);return true;}
    if(FLASKS.has(profile)||profile==='brick'||profile==='knives'||profile==='needle'||profile==='grenade')return true;
    const g=new THREE.Group();g.position.copy(visual);g.quaternion.setFromUnitVectors(Z,dir);
    const gun=p.kind==='bullet'||p.kind==='shell',col=gun?'#dfb272':p.color||theme.color;
    if(gun){
      const len=p.kind==='shell' ? .36 : .17,width=p.kind==='shell' ? .07 : .032;
      for(let i=0;i<4;i++){const a=i/4*TAU;this.line(g,[[0,0,.015],[Math.cos(a)*width,Math.sin(a)*width,len]],col,.6);}
      const ring=this.mesh(g,this.geo.slimRing,col,.35);ring.scale.setScalar(width*1.25);
    } else this.glyph(g,clamp(p.radius||.22,.12,.35),col,theme.school,.5);
    this.add(g,gun ? .085 : .18,k=>{g.scale.setScalar(.6+.6*k);this.alpha(g,1-k);});
    return true;
  }

  projectileMaterial(color,additive=true,opacity=.8) {
    const key=`${color}_${additive}_${opacity}`;
    if(!this.projectileMats.has(key))this.projectileMats.set(key,this.material(color,opacity,additive));
    return this.projectileMats.get(key);
  }

  projectilePart(g,geo,color,scale,opacity=.8,additive=true) {
    const m=new THREE.Mesh(geo,this.projectileMaterial(color,additive,opacity));
    m.scale.set(...scale);m.userData.sharedMaterial=true;g.add(m);return m;
  }

  projectileMesh(kind,color,d={},p={},owner={}) {
    const profile=visualFor(d,owner),g=new THREE.Group(),rad=clamp(p.radius||.18,.07,.75);
    g.name=`projectile-${kind}-${profile}`;
    g.userData.profile=profile;g.userData.kind=kind;
    if(kind==='sand') {
      for(let i=0;i<12;i++) {const a=i*2.4,m=this.projectilePart(g,this.geo.box,i%2?'#b29870':'#cfb58c',[.024,.011,.025],.6,false);m.position.set(Math.cos(a)*rad*.5,(i%3-1)*rad*.3,Math.sin(a)*rad*.5);}
    } else if(profile==='brick' || profile==='brawl-storm'&&kind==='grenade') {
      const b=this.projectilePart(g,this.geo.box,'#914e3b',[.22,.11,.105],1,false);b.rotation.z=.15;
      const edge=this.projectilePart(g,this.geo.box,'#be846a',[.226,.014,.11],.9,false);edge.position.y=.045;
      g.userData.spin=true;
    } else if(profile==='needle' || kind==='needle') {
      const shaft=this.projectilePart(g,this.geo.box,'#bec5c8',[.009,.009,.23],.88,false);
      const tip=this.projectilePart(g,this.geo.cone,'#c8ced3',[.012,.07,.012],.85,false);tip.rotation.x=Math.PI/2;tip.position.z=.145;
      const tail=this.projectilePart(g,this.geo.box,color,[.025,.025,.045],.55,false);tail.position.z=-.12;
    } else if(profile==='knives') {
      const blade=this.projectilePart(g,this.geo.cone,'#bccad4',[.045,.36,.023],.88,false);blade.rotation.x=Math.PI/2;
      const h=this.projectilePart(g,this.geo.box,'#4a4055',[.05,.04,.12],1,false);h.position.z=-.2;
    } else if(FLASKS.has(profile)) {
      this.projectilePart(g,this.geo.sphere,color,[.105,.15,.105],.56,false);
      const neck=this.projectilePart(g,this.geo.pipe,'#b7d9cc',[.048,.08,.048],.7,false);neck.position.y=.14;
      const cork=this.projectilePart(g,this.geo.box,'#847152',[.07,.04,.07],1,false);cork.position.y=.19;
      const liquid=this.projectilePart(g,this.geo.sphere,color,[.087,.09,.087],.65);liquid.position.y=-.035;
      g.userData.spin=true;
    } else if(kind==='grenade') {
      this.projectilePart(g,this.geo.sphere,'#5c665b',[.09,.13,.09],1,false);
      const cap=this.projectilePart(g,this.geo.box,'#c0ae83',[.06,.06,.07],1,false);cap.position.y=.12;
      g.userData.spin=true;
    } else if(kind==='shell') {
      const nose=this.projectilePart(g,this.geo.cone,'#aa986f',[rad*.45,rad*1.4,rad*.45],1,false);nose.rotation.x=Math.PI/2;nose.position.z=rad*.5;
      const body=this.projectilePart(g,this.geo.pipe,'#635b4b',[rad*.45,rad*1.5,rad*.45],1,false);body.rotation.x=Math.PI/2;
      const tail=this.projectilePart(g,this.geo.slimRing,color,[rad*.5,rad*.5,rad*.5],.5);tail.position.z=-rad*.7;
    } else if(kind==='bullet') {
      const m=this.projectilePart(g,this.geo.box,color,[.016,.016,.4],.72);m.position.z=-.1;
    } else if(kind==='wave') {
      const arc=this.v.arcGeometry(rad*.15,rad,Math.PI*.85);
      const m=this.projectilePart(g,arc,color,[1,1,1],.48);m.rotation.z=Math.PI/2;m.rotation.y=Math.PI/2;
      const core=this.projectilePart(g,this.geo.crystal,color,[rad*.12,rad*.65,rad*.08],.4);core.position.y=.06;
    } else if(profile==='summon-lightning') {
      // Mouth-fired light element: a thin traveling zig-zag, not a star orb.
      for(let i=0;i<4;i++) {
        const bolt=this.projectilePart(g,this.geo.box,i%2?'#fffbe0':color,[.025,.024,.24],.9);
        bolt.position.set((i%2?1:-1)*.035,0,.26-i*.17);bolt.rotation.y=(i%2?1:-1)*.48;
      }
    } else if(profile==='summon-fire') {
      this.projectilePart(g,this.geo.sphere,'#fff0a0',[rad*.55,rad*.55,rad*.55],.9);
      this.projectilePart(g,this.geo.sphere,'#ff763c',[rad,rad,rad*1.3],.52);
      for(let i=0;i<3;i++) {
        const flame=this.projectilePart(g,this.geo.cone,i%2?color:'#e85a2f',[rad*.62,rad*2.4,rad*.62],.56);
        flame.rotation.x=-Math.PI/2;flame.position.set((i-1)*rad*.36,Math.abs(i-1)*rad*.2,-rad*1.1);
      }
    } else if(profile==='holy-edict') {
      const circle=this.projectilePart(g,this.geo.slimRing,color,[rad,rad,rad],.52);
      this.projectilePart(g,this.geo.box,color,[rad*.18,rad*1.1,rad*.1],.55);
      this.projectilePart(g,this.geo.box,color,[rad*.85,rad*.18,rad*.1],.55);
    } else if(profile==='sleep-curse') {
      this.projectilePart(g,this.geo.sphere,color,[rad*.3,rad*.3,rad*.3],.28);
      for(let i=0;i<3;i++){const m=this.projectilePart(g,this.geo.slimRing,color,[rad,rad*(.45+i*.15),rad],.38);m.rotation.z=i*Math.PI/3;}
    } else if(profile==='holy-hammer') {
      this.projectilePart(g,this.geo.box,'#f5e5ba',[rad*1.1,rad*.65,rad*.55],.75);
      const h=this.projectilePart(g,this.geo.box,color,[rad*.2,rad*1.55,rad*.2],.65);h.position.y=-rad*.8;
    } else {
      const dark=/curse|shadow-orb/.test(profile);
      this.projectilePart(g,profile==='ice-bolt'?this.geo.crystal:this.geo.sphere,dark?'#352844':color,[rad*.58,rad*.58,rad*.58],dark ? .85 : .6,!dark);
      for(let i=0;i<2;i++) {const m=this.projectilePart(g,this.geo.slimRing,color,[rad,rad,rad],.58);m.rotation.x=i?Math.PI/2:0;m.rotation.y=i?Math.PI/4:0;}
      if(profile==='homing-stars') {
        for(let i=0;i<3;i++){const a=i/3*TAU,m=this.projectilePart(g,this.geo.crystal,color,[.035,.1,.035],.65);m.position.set(Math.cos(a)*rad*.75,Math.sin(a)*rad*.75,0);m.rotation.z=a;}
      }
    }
    return g;
  }

  projectileStep(pr,dt) {
    const mesh=pr.mesh,kind=pr.p.kind,profile=mesh.userData.profile;
    mesh.userData.clock=(mesh.userData.clock||0)+dt;
    if(kind==='sand') {
      mesh.scale.setScalar(clamp(1+pr.age*2.2,1,3.8));
      mesh.children.forEach((m,i)=>{m.rotation.x+=dt*(i%3+1);m.rotation.z+=dt*3;});
    } else if(mesh.userData.spin) {
      // The collision mesh still follows velocity; only the visible payload tumbles.
      mesh.children.forEach(m=>{m.rotation.z=pr.age*5;m.rotation.x=pr.age*3;});
    } else if(kind==='magic') {
      mesh.children.forEach((m,i)=>{if(i)m.rotation.z+=dt*(i%2?2:-2);});
    }
    const cadence=kind==='bullet'||kind==='needle' ? .045 : .075;
    if(mesh.userData.clock < cadence)return;
    mesh.userData.clock=0;
    if(kind==='bullet'||kind==='needle') {
      const to=mesh.position.clone(),from=to.clone().addScaledVector(pr.vel,-.012);
      this.v.tracer(from,to,pr.color);
    } else if(kind==='shell') this.smoke(mesh.position,.25,'#8c8170',.27,2);
    else if(kind==='sand')this.smoke(mesh.position,.3+Math.min(.4,pr.age*.3),'#b29b77',.35,2);
    else if(kind==='magic'||kind==='wave') {
      const pos=mesh.position;
      this.v.particle(pos.x,pos.y,pos.z,-pr.vel.x*.04,-pr.vel.y*.04,-pr.vel.z*.04,pr.color,.026,.22,0);
    }
  }

  explosionEvent(owner,pos,e,d={}) {
    // Combat already applies class splash bonuses before passing the radius here.
    const profile=visualFor(d,owner),r=e.radius;
    const color=e.color||identity(owner||{}).color;
    if(FLASKS.has(profile)) {
      const g=new THREE.Group();g.position.copy(pos);g.position.y+=.025;
      const rim=this.flatRing(g,1,color,.5),dots=[];
      for(let i=0;i<7;i++){const a=i/7*TAU,m=this.mesh(g,this.geo.disk,color,.08,false);m.rotation.x=-Math.PI/2;m.scale.setScalar(r*.23);m.position.set(Math.cos(a)*r*.52,.008,Math.sin(a)*r*.52);dots.push(m);}
      this.add(g,.9,k=>{rim.scale.setScalar(r*Math.min(1,k*4));this.alpha(g,fade(k,.08));});
      if(profile==='ice-flask')this.crystals(pos,r*.85,color,12,.9);
      else this.smoke(pos,r*.7,color,.85,6);
      return true;
    }
    const g=new THREE.Group();g.position.copy(pos);
    const ring=this.flatRing(g,1,color,.6);ring.position.y=.02;
    // A thin shell expands to the actual splash radius, retaining a visible center.
    const core=this.mesh(g,this.geo.sphere,color,.22);core.scale.setScalar(.1);
    this.add(g,.45,k=>{ring.scale.setScalar(r*Math.min(1,k*2));core.scale.setScalar(r*.45*Math.sin(k*Math.PI));this.alpha(g,1-k);});
    this.smoke(pos,r*.55,/shadow/.test(profile)?'#554163':'#8b8173',.85,8);
    this.v.burst(pos,color,18,r*1.3,.032,.42,6);
    this.v.flashAt(pos,color,1.1);
    return true;
  }

  areaEvent(owner,a,d,pos,tick=1) {
    const profile=visualFor(d,owner),theme=identity(owner||{}),color=a.color||theme.color,r=a.radius||3;
    if(profile==='smoke') {
      const key=`${owner?.id||owner?.name||'actor'}:smoke:${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)}`;
      if(!this.zones.has(key)) {
        const group=this.smoke(pos,r*.85,'#89848c',a.visualRemaining || ((a.ticks||1)-1)*(a.interval||0)/1000+.4,9);
        this.zones.set(key,group);
        const item=this.v.items.find(i=>i.obj===group),end=item?.onEnd;
        if(item)item.onEnd=()=>{end?.();if(this.zones.get(key)===group)this.zones.delete(key);};
      }
      return true;
    }
    if(a.vfx==='zone') {
      const key=`${owner?.id||owner?.name||'actor'}:${d.name}:${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)}`;
      if(!this.zones.has(key)) {
        const g=new THREE.Group();g.name=`skill-zone-${profile}`;g.position.copy(pos);g.position.y+=.035;
        const ring=this.flatRing(g,r,color,.42,true);
        const glyph=new THREE.Group();g.add(glyph);this.glyph(glyph,r*.45,color,profile==='holy-fire'?'holy':'dark',.2);glyph.rotation.x=-Math.PI/2;
        const flames=[],rain=profile==='confusion-rain';
        for(let i=0;i<9;i++){const rad=r*(.3+(i%3)*.2),ang=i*2.4,m=this.mesh(g,rain?this.geo.box:this.geo.cone,color,rain?.34:.22);m.position.set(Math.cos(ang)*rad,rain?1.7:.22,Math.sin(ang)*rad);m.scale.set(rain?.015:.06,rain?.22:.45,rain?.015:.06);flames.push(m);}
        const dur=a.visualRemaining || ((a.ticks||1)-1)*(a.interval||0)/1000+.42;
        this.zones.set(key,g);
        this.add(g,dur,k=>{glyph.rotation.z=k;for(let i=0;i<flames.length;i++){if(rain)flames[i].position.y=2.2-((k*dur*2.3+i*.19)%2.1);else flames[i].scale.y=.3+.18*Math.sin(k*dur*12+i);}this.alpha(g,Math.min(1,k*8)*Math.min(1,(1-k)*8));},()=>{if(this.zones.get(key)===g)this.zones.delete(key);});
      }
      const pulse=new THREE.Group();pulse.position.copy(pos);pulse.position.y+=.045;const ring=this.flatRing(pulse,r,color,.15,true);
      this.add(pulse,.23,k=>{ring.scale.setScalar(r*(.87+.13*k));this.alpha(pulse,1-k);});return true;
    }
    if(a.vfx==='vortex') {this.gate(pos,r,color);return true;}
    if(a.vfx==='meteor') {this.meteor(pos,r,color);return true;}
    if(a.vfx==='satellite') {this.satellite(pos,r);return true;}
    if(a.vfx==='holy') {this.radialWave({pos,scale:1},r,color,.5);return true;}
    this.explosionEvent(owner,pos,{...a,color:a.color||'#d7a367'},d);return true;
  }

  gate(pos,r,col) {
    const g=new THREE.Group();g.position.copy(pos);g.position.y+=.035;
    const disk=this.mesh(g,this.geo.disk,'#352940',.3,false);disk.rotation.x=-Math.PI/2;disk.scale.setScalar(r*.58);
    const glyph=new THREE.Group();g.add(glyph);this.glyph(glyph,r*.85,col,'dark',.42);glyph.rotation.x=-Math.PI/2;
    const spiral=[];for(let i=0;i<70;i++){const t=i/69,a=t*TAU*3,rad=r*(1-t)*.88;spiral.push([Math.cos(a)*rad,.025,Math.sin(a)*rad]);}
    this.line(g,spiral,col,.35);
    this.add(g,.7,k=>{glyph.rotation.z=-k*2;g.scale.setScalar(.7+.3*Math.sin(k*Math.PI));this.alpha(g,fade(k,.08));});
  }

  meteor(pos,r,col) {
    // A compact arrival shape; trajectory ends at the actual ground impact point.
    const g=new THREE.Group();g.position.copy(pos);
    const rock=this.mesh(g,this.geo.sphere,'#635343',.85,false);rock.scale.setScalar(r*.18);
    const heat=this.mesh(g,this.geo.slimRing,'#e8ac63',.55);heat.scale.setScalar(r*.24);heat.rotation.x=Math.PI/2;
    this.add(g,.18,k=>{rock.position.set((1-k)*1.8,(1-k)*4,-(1-k)*1.2);heat.position.copy(rock.position);this.alpha(g,1-k*.3);});
    this.explosionEvent({clsId:'witch'},pos,{radius:r,color:'#d9a168'},{name:'陨石术'});
  }

  satellite(pos,r) {
    const g=new THREE.Group();g.position.copy(pos);
    const core=this.mesh(g,this.geo.pipe,'#b4dfe9',.25);core.scale.set(r*.11,20,r*.11);core.position.y=10;
    const bands=[];
    for(let i=0;i<5;i++){const m=this.flatRing(g,r*(.45+i*.1),'#b3dbe5',.36);m.position.y=i*.07;bands.push(m);}
    this.add(g,.65,k=>{core.scale.x=core.scale.z=r*.11*(.65+.35*Math.sin(k*20));for(let i=0;i<bands.length;i++)bands[i].rotation.z=k*2+i;this.alpha(g,fade(k,.08));});
    this.explosionEvent({clsId:'launcher'},pos,{radius:r,color:'#aad4e3'},{name:'卫星射线'});
  }

  channelBeam(att,d,from,to,width,dur=.14) {
    const drain=d.beam?.drain,theme=identity(att),col=d.color|| (drain?theme.color:'#a9cdd9');
    const g=new THREE.Group(),len=from.distanceTo(to);
    if(len<.01)return true;
    g.position.copy(from);g.quaternion.setFromUnitVectors(Z,to.clone().sub(from).normalize());
    if(drain) {
      for(let j=0;j<2;j++){
        const pts=[];for(let i=0;i<=40;i++){const t=i/40,a=t*TAU*3+j*Math.PI;pts.push([Math.cos(a)*width*.35,Math.sin(a)*width*.35,t*len]);}
        this.line(g,pts,col,.48);
      }
      const pulse=this.mesh(g,this.geo.slimRing,col,.6);pulse.scale.setScalar(width*.28);
      const initial=g.quaternion.clone();
      this.add(g,dur,k=>{pulse.position.z=len*(1-k);g.quaternion.copy(initial);g.rotateZ(k*1.2);this.alpha(g,1-k);});
    } else {
      const beam=this.mesh(g,this.geo.pipe,col,.22);beam.rotation.x=Math.PI/2;beam.position.z=len*.5;beam.scale.set(width*.3,len,width*.3);
      const core=this.mesh(g,this.geo.pipe,'#d0e3e4',.55);core.rotation.x=Math.PI/2;core.position.z=len*.5;core.scale.set(width*.075,len,width*.075);
      const tip=this.mesh(g,this.geo.slimRing,col,.6);tip.position.z=len;tip.scale.setScalar(width*.5);
      this.add(g,dur,k=>this.alpha(g,1-k));
    }
    return true;
  }

  healTarget(target,h={},source) {
    if(h.shield) this.statusTarget(target,{type:'shield',t:h.shield.t,amount:h.shield.amount});
    if(h.hot) this.statusTarget(target,{type:'hot',t:h.hot.t});
    if(h.armor)this.statusTarget(target,{type:'armor',t:h.armor});
    if(!(h.amount||h.pct||h.hot||h.cleanse))return true;
    const g=new THREE.Group(),col=h.cleanse?'#b2d8d9':'#e8dda9';g.name=h.cleanse?'skill-cleanse':'skill-heal';
    this.flatRing(g,.55,col,.4,true);
    const crosses=[];
    for(let i=0;i<4;i++){
      const cross=new THREE.Group();g.add(cross);
      for(const s of [[.035,.16,.012],[.12,.035,.012]]){const m=this.mesh(cross,this.geo.box,col,.55);m.scale.set(...s);}
      const a=i/4*TAU;cross.position.set(Math.cos(a)*.32,.35+ i*.22,Math.sin(a)*.32);crosses.push(cross);
    }
    this.add(g,.8,k=>{g.position.copy(target.pos);g.position.y+=.035;for(let i=0;i<crosses.length;i++){crosses[i].position.y=.25+i*.22+k*.48;crosses[i].rotation.y=(source?.game?.viewYaw||0);}this.alpha(g,fade(k,.1));});
    return true;
  }

  statusTarget(target,e={}) {
    const type=e.type;if(!type||!target?.pos)return false;
    const allowed=['root','weak','fear','blind','dot','slow','shield','hot','armor','berserk',
      'stun','frozen','sleep','bind','silence','confuse','bleed','poison','burn',
      'armorBreak','vulnerable','swordIntent','invuln'];
    if(!allowed.includes(type))return false;
    const key=`${target.id||target.name}:${type}`;
    if(this.statuses.has(key)) {
      const existing=this.statuses.get(key);existing.end=this.v.clock+(e.t||1000)/1000;
      if(existing.item)existing.item.dur=existing.item.t+(e.t||1000)/1000;
      return true;
    }
    // Up to 32 persistent status displays: at most one per actor and status type.
    if(this.statuses.size>=32)return true;
    const color={root:'#ae8bc7',weak:'#ac8fc3',fear:'#9972bd',blind:'#c1a877',dot:'#91b268',slow:'#9bcad4',shield:'#e2d6a5',hot:'#dddda6',armor:'#d6bf85',berserk:'#cf6e56',
      stun:'#d8b86d',frozen:'#a6cdd7',sleep:'#aba9d6',bind:'#bda186',silence:'#bd9db8',confuse:'#b7a9d9',
      bleed:'#bc6f62',poison:'#9caf71',burn:'#d39c61',armorBreak:'#c99277',vulnerable:'#cf9984',swordIntent:'#a4ccdd',invuln:'#e0dfc9'}[type];
    const g=new THREE.Group(),info={group:g,target,type,end:this.v.clock+(e.t||1000)/1000};g.name=`status-${type}`;
    if(type==='shield' || type==='invuln') {
      for(let j=0;j<3;j++){const m=this.mesh(g,this.geo.slimRing,color,.18);m.scale.setScalar(.64);m.position.y=.9;m.rotation.y=j*Math.PI/3;}
    } else if(type==='root' || type==='bind') {
      this.flatRing(g,.42,color,.4,true);
      for(let j=0;j<3;j++) {const a=j/3*TAU;this.line(g,[[Math.cos(a)*.55,0,Math.sin(a)*.55],[Math.cos(a)*.22,.18,Math.sin(a)*.22],[Math.cos(a)*.23,.5,Math.sin(a)*.23]],color,.4);}
    } else if(type==='frozen') {
      const h=target.height||1.75;
      this.flatRing(g,.37,color,.3,true);
      for(let j=0;j<5;j++){const a=j/5*TAU;this.line(g,[[Math.cos(a)*.35,.05,Math.sin(a)*.35],[Math.cos(a)*.3,h*.7,Math.sin(a)*.3],[Math.cos(a)*.08,h*.94,Math.sin(a)*.08]],color,.3);}
      for(let j=0;j<4;j++){const a=j/4*TAU,m=this.mesh(g,this.geo.crystal,color,.24);m.position.set(Math.cos(a)*.31,.15,Math.sin(a)*.31);m.scale.set(.06,.2,.06);}
    } else if(type==='stun' || type==='sleep' || type==='confuse') {
      const h=(target.height||1.75)+.18;
      const halo=this.mesh(g,this.geo.slimRing,color,.35);halo.position.y=h;halo.rotation.x=-Math.PI/2;halo.scale.setScalar(.22);
      for(let j=0;j<3;j++){const a=j/3*TAU,m=this.mesh(g,this.geo.crystal,color,.45);m.position.set(Math.cos(a)*.22,h,Math.sin(a)*.22);m.scale.set(.035,.025,.035);}
      if(type==='sleep')this.line(g,[[-.1,h+.1,0],[.02,h+.1,0],[-.1,h-.02,0],[.02,h-.02,0]],color,.4);
      if(type==='confuse')this.line(g,[[-.08,h+.12,0],[.04,h+.12,0],[.04,h+.03,0],[-.03,h+.01,0],[-.03,h-.06,0]],color,.4);
    } else if(type==='silence') {
      const glyph=new THREE.Group();g.add(glyph);this.glyph(glyph,.13,color,'holy',.3);glyph.position.y=(target.height||1.75)+.19;
      this.line(g,[[-.12,0,.008],[.12,0,.008]],color,.6).position.y=glyph.position.y;
    } else if(type==='poison' || type==='bleed' || type==='burn' || type==='dot') {
      for(let j=0;j<3;j++){const a=j/3*TAU,m=this.mesh(g,type==='burn'?this.geo.cone:this.geo.crystal,color,.28);m.position.set(Math.cos(a)*.28,.4+j*.25,Math.sin(a)*.28);m.scale.set(.025,type==='burn'?.12:.055,.025);}
    } else if(type==='armorBreak' || type==='vulnerable') {
      const h=(target.height||1.75)+.16;
      this.line(g,[[-.13,h+.08,0],[-.13,h-.04,0],[0,h-.15,0],[.04,h-.03,0],[.13,h+.02,0],[.13,h+.08,0]],color,.5);
      this.line(g,[[-.04,h+.08,.01],[.04,h-.12,.01]],color,.55);
    } else if(type==='swordIntent') {
      const m=this.mesh(g,this.geo.slimRing,color,.28);m.scale.setScalar(.12);m.position.set(-.28,1.1,.3);
    } else if(type==='blind') {
      // A small broken ring identifies the blinded victim to others, below eye height.
      const m=this.mesh(g,this.geo.slimRing,color,.4);m.scale.setScalar(.14);m.position.y=target.height||1.75;
      m.rotation.y=Math.PI/4;
      this.line(g,[[-.12,.12,0],[.12,-.12,0]],color,.48).position.y=target.height||1.75;
    } else if(type==='slow') this.flatRing(g,.36,color,.32,true);
    else if(type==='hot')this.flatRing(g,.34,color,.22,true);
    else if(type==='berserk'||type==='armor') {const m=this.mesh(g,this.geo.slimRing,color,.24);m.rotation.x=-Math.PI/2;m.position.y=.18;m.scale.setScalar(.45);}
    else {
      const glyph=new THREE.Group();g.add(glyph);this.glyph(glyph,.12,color,'dark',.35);glyph.position.y=(target.height||1.75)+.2;
    }
    this.statuses.set(key,info);
    // A status is tied to the live effect list and expiry, not a fixed visual timer.
    const duration=clamp((e.t||1000)/1000,.2,30);
    this.add(g,duration,k=>{
      g.position.copy(target.pos);g.rotation.y=target.yaw||0;
      let present=target.effects?.some(effect=>effect.type===type && effect.t>0);
      if(type==='armor')present=target.armor>0;
      if(target.alive===false || this.v.clock>info.end || present===false) {
        g.visible=false;
        if(info.item)info.item.dur=info.item.t;
      } else g.visible=true;
      this.alpha(g,.75+.12*Math.sin(this.v.clock*3));
    },()=>{if(this.statuses.get(key)===info)this.statuses.delete(key);});
    info.item=this.v.items.find(item=>item.obj===g);
    return true;
  }

  blinkTrail(f,from,to) {
    const col=identity(f).color;
    for(const pos of [from,to]) {
      const g=new THREE.Group();g.position.copy(pos);g.position.y+=.04;
      const ring=this.flatRing(g,.45,col,.32,true);
      for(let j=0;j<4;j++){const m=this.mesh(g,this.geo.box,col,.13);m.position.set((j%2-.5)*.4,.3+j*.24,(Math.floor(j/2)-.5)*.22);m.scale.set(.07,.35,.02);}
      this.add(g,.3,k=>{ring.scale.setScalar(.3+k*.4);this.alpha(g,1-k);});
    }
    // No solid beam through walls: departure and arrival remain readable.
    return true;
  }

  clear() {
    this.statuses.clear();this.zones.clear();
  }
}
