// Persistent, host-authoritative four-beast summons. Kept outside fighters so
// killing a pet cannot end a duel, advance a wave or count as a hero death.
import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/BufferGeometryUtils.js';
import { sphereContact } from './combat-volumes.js';
import { normalizeStatus, mergeStatus, hasStatusFlag, statusMoveMultiplier, statusDamageTaken, breakDamageStatuses } from './statuses.js';
import { clamp, uid, wrapAngle } from '../engine/util.js';

export const BEASTS = Object.freeze({
  cat: { name: '灵猫', element: '暗', hp: 440, height: .7, radius: .24, speed: 7.2, vision: 18, reach: .9, damage: 33, interval: .85, color: '#393440', light: '#c6a4ea', lifetime: 32 },
  wolf: { name: '冰狼', element: '冰', hp: 780, height: .92, radius: .32, speed: 5.4, vision: 13, reach: 1.15, damage: 42, interval: 1.15, color: '#647782', light: '#b0d9e8', lifetime: 32, effect: { type: 'slow', t: 650, speedMul: .82 } },
  eagle: { name: '雷鹰', element: '光', hp: 350, height: .48, radius: .25, speed: 6.4, vision: 16, reach: 9, damage: 39, interval: 1.6, color: '#493f35', light: '#e8cb87', lifetime: 32, flying: true, altitude: 2.25, projectile: 'lightning' },
  dragon: { name: '小飞龙', element: '火', hp: 510, height: .7, radius: .3, speed: 4.8, vision: 14, reach: 7, damage: 43, interval: 1.9, color: '#543b34', light: '#ee9e65', lifetime: 32, flying: true, altitude: 1.55, projectile: 'fire', effect: { type: 'burn', t: 1800, dps: 7 } },
});
const KINDS = Object.keys(BEASTS), MAX_PER_OWNER = 4;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function material(color, glow = false) {
  return new THREE.MeshStandardMaterial({ color, roughness: .65, metalness: glow ? .28 : .05,
    emissive: glow ? color : '#000000', emissiveIntensity: glow ? .18 : 0 });
}
function mesh(geometry, mat, parent, position = [0, 0, 0], scale = [1, 1, 1]) {
  const m = new THREE.Mesh(geometry, mat); m.position.set(...position); m.scale.set(...scale);
  m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function sphere(mat, parent, p, scale) { return mesh(new THREE.SphereGeometry(1, 12, 8), mat, parent, p, scale); }
function cone(mat, parent, p, r, h, rz = 0) {
  const m = mesh(new THREE.ConeGeometry(r, h, 8), mat, parent, p); m.rotation.z = rz; return m;
}
function link(mat, parent, a, b, radius = .03, endRadius = radius) {
  a = V(...a); b = V(...b); const delta = b.clone().sub(a);
  const part = mesh(new THREE.CylinderGeometry(endRadius, radius, delta.length(), 7), mat, parent, a.add(b).multiplyScalar(.5).toArray());
  part.quaternion.setFromUnitVectors(V(0,1,0), delta.normalize()); return part;
}
function feather(mat, parent, position, length, width, turn = 0) {
  const shape = new THREE.Shape(); shape.moveTo(0,0); shape.quadraticCurveTo(-width*.6,-length*.35,0,-length);
  shape.quadraticCurveTo(width*.6,-length*.35,0,0);
  const geometry = new THREE.ExtrudeGeometry(shape,{depth:.012,bevelEnabled:true,bevelThickness:.005,bevelSize:.01,bevelSegments:1,steps:1});
  geometry.rotateX(Math.PI/2); const part=mesh(geometry,mat,parent,position);part.rotation.y=turn;return part;
}
// Ring-lofted anatomy avoids the round, disconnected toy silhouette of stacked
// spheres. Radius profiles taper through a continuous shoulder, skull or muzzle.
function anatomy(mat, parent, rings, facets = 12) {
  const path = new THREE.CatmullRomCurve3(rings.map(r => V(r[0], r[1], 0))),
    radii = new THREE.CatmullRomCurve3(rings.map(r => V(r[2], r[3], 0))), positions=[], uvs=[], indices=[];
  const count=(rings.length-1)*3;
  for(let i=0;i<=count;i++) {
    const c=path.getPoint(i/count), r=radii.getPoint(i/count);
    for(let j=0;j<=facets;j++) {const a=j/facets*Math.PI*2;positions.push(Math.sin(a)*Math.max(.001,r.x),c.y+Math.cos(a)*Math.max(.001,r.y),c.x);uvs.push(j/facets,i/count);}
  }
  for(let i=0;i<count;i++)for(let j=0;j<facets;j++){const a=i*(facets+1)+j,b=a+facets+1;indices.push(a,b,a+1,b,b+1,a+1);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();return mesh(g,mat,parent);
}
function taperedCurve(mat,parent,points,radius,segments=16) {
  const curve=new THREE.CatmullRomCurve3(points.map(p=>V(...p))),g=new THREE.TubeGeometry(curve,segments,1,7,false),p=g.attributes.position;
  for(let i=0;i<=segments;i++){const t=i/segments,c=curve.getPointAt(t),r=radius*(1-.96*Math.pow(t,.85));for(let j=0;j<=7;j++){const n=i*8+j;p.setXYZ(n,c.x+(p.getX(n)-c.x)*r,c.y+(p.getY(n)-c.y)*r,c.z+(p.getZ(n)-c.z)*r);}}
  g.computeVertexNormals();return mesh(g,mat,parent);
}
function mergeStatic(group) {
  for (const mat of new Set(group.children.filter(o => o.isMesh).map(o => o.material))) {
    const parts = group.children.filter(o => o.isMesh && o.material === mat), geometries = [];
    for (const part of parts) {
      part.updateMatrix(); let geometry=part.geometry.clone();
      if(geometry.index) {const expanded=geometry.toNonIndexed();geometry.dispose();geometry=expanded;}
      geometry.applyMatrix4(part.matrix);
      // Subtle deterministic coat mottling and dorsal darkening, rather than
      // large flat plastic colors. Vertex data adds no textures or draw calls.
      const p=geometry.attributes.position,colors=[];
      for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),grain=Math.sin(x*113+z*73)*Math.sin(y*137-z*41),v=mat.userData.coat? .83+.1*grain+.06*Math.sin(z*31+x*19):1;colors.push(v,v,v);}
      geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));mat.vertexColors=!!mat.userData.coat;
      geometries.push(geometry);part.geometry.dispose();group.remove(part);
    }
    if (geometries.length) { mesh(mergeGeometries(geometries), mat, group); for (const g of geometries) g.dispose(); }
  }
}

// A clearly identified derivative of the existing robed rig, with a jade
// four-element crest and brass book fittings. No claim of a new authored GLB.
export function decorateSummoner(f) {
  if (f.clsId !== 'summoner' || f.rig.root.userData.summonerDecorated) return;
  f.rig.root.userData.summonerDecorated = true;
  const host = f.mocapBody?.bones?.[f.mocapBody.shape?.chestBone || 'Spine'] || f.rig.bones.chest;
  if (!host) return;
  const emblem = new THREE.Group(), jade = material('#78cbb7', true), gold = material('#d6bd76'); host.add(emblem);
  emblem.position.set(0, .045, .18);
  const rim = mesh(new THREE.TorusGeometry(.105, .018, 6, 20), gold, emblem);
  sphere(jade, emblem, [0, 0, .006], [.068, .082, .02]);
  for (let i = 0; i < 4; i++) sphere(gold, emblem, [Math.sin(i * Math.PI / 2) * .075, Math.cos(i * Math.PI / 2) * .075, .025], [.022, .022, .012]);
  mergeStatic(emblem); rim.userData.decorative = true;
}

// Each beast has a distinct silhouette. Static features are merged by material;
// only four legs or two wings move, avoiding dozens of draw calls per animal.
export function buildBeast(kind) {
  const s = BEASTS[kind], root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const fur = material(s.color), accent = material(s.light, true), dark = material('#202123');
  fur.roughness=.97;fur.userData.coat=true;
  const secondary=material(({cat:'#4f4855',wolf:'#98a6ac',eagle:'#7c7666',dragon:'#745842'})[kind]);
  secondary.roughness=.94;secondary.userData.coat=true;
  const legs = [], wings = [];
  if (!s.flying) {
    const large = kind === 'wolf', y = large ? .58 : .40, length = large ? .50 : .40;
    const w=large?.22:.155,h=large?.24:.17;
    anatomy(fur,body,[[-length,y,0,0],[-length*.75,y,w*.85,h*.86],[-length*.32,y+.015,w*.8,h*.75],[length*.27,y,w,h],[length*.62,y+.045,w*.76,h*1.03],[length*.78,y+.105,w*.54,h*.75],[length*.87,y+.15,0,0]]);
    anatomy(fur,body,large?[[.28,y+.19,0,0],[.36,y+.21,.14,.135],[.51,y+.18,.112,.095],[.68,y+.10,.069,.05],[.76,y+.09,0,0]]:
      [[.25,y+.19,0,0],[.30,y+.22,.095,.10],[.39,y+.215,.087,.087],[.445,y+.19,.05,.04],[.48,y+.18,0,0]]);
    if(large)anatomy(secondary,body,[[.47,y+.13,0,0],[.61,y+.07,.078,.036],[.73,y+.09,.04,.023],[.75,y+.095,0,0]]);
    else for(const side of [-1,1])sphere(secondary,body,[side*.025,y+.173,.452],[.032,.024,.029]);
    sphere(dark,body,[0,y+(large?.105:.185),large?.75:.48],[large?.036:.015,large?.022:.011,large?.025:.01]);
    for (const side of [-1, 1]) {
      const earX=large?.105:.077;
      cone(fur, body, [side * earX, y + (large?.365:.325), length * .68], large?.055:.047, large?.16:.145, side * -.15);
      cone(secondary,body,[side*earX,y+(large?.37:.33),length*.69+.026],large?.029:.025,large?.09:.085,side*-.15);
      sphere(dark, body, [side * (large?.105:.073), y + .223, length*.98], [.024, .011, .022]);
      sphere(accent, body, [side * (large?.109:.077), y + .225, length*.98+.015], [.007, .008, .007]);
      for (const z of [-length * .66, length * .65]) {
        const leg = new THREE.Group(); const top=y+.01;leg.position.set(side * (large?.15:.095),top,z);root.add(leg);legs.push(leg);
        const knee=top*.48, bend=z<0?-.075:.025;
        sphere(fur,leg,[0,-.02,0],[large?.083:.054,large?.11:.075,large?.1:.065]);
        link(fur,leg,[0,0,0],[0,-knee,bend],large?.078:.048,large?.048:.031);
        sphere(fur,leg,[0,-knee,bend],[large?.049:.032,large?.062:.041,large?.06:.035]);
        link(fur,leg,[0,-knee,bend],[0,-top+.065,.035],large?.041:.029,large?.026:.019);
        sphere(fur,leg,[0,-top+.041,.069],[large?.059:.041,.035,large?.10:.065]);
        for(let toe=0;toe<3;toe++)sphere(dark,leg,[(toe-1)*(large?.026:.018),-top+.034,large?.154:.122],[.008,.013,.018]);
        mergeStatic(leg);
      }
    }
    taperedCurve(fur,body,large ? [[0,y,-length*.85],[.10,y-.05,-length-.24],[.2,y-.22,-length-.44],[.25,y-.33,-length-.49]] :
      [[0,y,-length*.85],[.12,y+.05,-length-.2],[.24,y+.24,-length-.34],[.21,y+.4,-length-.25]],large?.095:.031);
    // Frost is concentrated in the eyes and a few guard hairs, not huge spikes.
    if (large) for (const side of [-1,1]) for(let i=0;i<4;i++) {
      const tuft=cone(secondary,body,[side*(.13+i*.023),y+.14-i*.027,.31-i*.075],.042,.15);
      tuft.rotation.x=-.65;tuft.rotation.z=side*-.45;
    }
  } else {
    const eagle = kind === 'eagle';
    anatomy(fur,body,eagle?[[-.44,.21,0,0],[-.23,.24,.125,.12],[.0,.23,.16,.16],[.19,.27,.105,.145],[.32,.32,.073,.10],[.40,.34,0,0]]:[[-.48,.20,0,0],[-.3,.21,.13,.11],[-.04,.22,.185,.17],[.2,.29,.13,.145],[.37,.32,.087,.09],[.46,.32,0,0]]);
    anatomy(eagle?secondary:fur,body,eagle?[[.26,.36,0,0],[.32,.38,.075,.075],[.45,.365,.055,.05],[.49,.34,0,0]]:[[.3,.36,0,0],[.39,.37,.108,.089],[.51,.34,.095,.067],[.67,.305,.066,.045],[.74,.30,0,0]]);
    if (eagle) {
      taperedCurve(dark,body,[[0,.35,.455],[0,.34,.51],[0,.30,.55],[0,.26,.536]],.045,12);
      for(let i=0;i<5;i++)feather(fur,body,[(i-2)*.032,.34,.22],.22,.07,(i-2)*.13);
      for(let i=0;i<3;i++) feather(i%2?secondary:fur,body,[(i-1)*.07,.22,-.26],.48,.14,(i-1)*.15);
      for(const side of [-1,1]) {
        link(secondary,body,[side*.1,.09,-.01],[side*.11,-.05,-.01],.019,.013);
        for(let j=0;j<3;j++) taperedCurve(dark,body,[[side*.11,-.05,-.01],[side*.11+(j-1)*.04,-.08,.06],[side*.11+(j-1)*.04,-.115,.055]],.014,7);
      }
    } else {
      anatomy(dark,body,[[.42,.277,0,0],[.49,.277,.075,.008],[.66,.277,.057,.008],[.72,.285,0,0]]);
      for(const side of [-1,1]) for(let i=0;i<3;i++) cone(secondary, body, [side*(.079-i*.009),.265,.49+i*.075], .010, .026, Math.PI);
      for(let i=0;i<7;i++) { const ridge=cone(secondary,body,[0,.30+Math.sin(i/6*Math.PI)*.09,-.4+i*.13],.024,.065);ridge.rotation.x=-.55; }
      for(let i=0;i<6;i++) sphere(secondary,body,[0,.079+i*.006,.25-i*.085],[.10-i*.006,.014,.038]);
      for(const side of [-1,1]) {
        link(fur,body,[side*.15,.15,-.15],[side*.23,-.02,-.22],.065,.037);
        link(fur,body,[side*.23,-.02,-.22],[side*.19,-.12,-.11],.037,.025);
        for(let j=0;j<3;j++) link(secondary,body,[side*.19,-.12,-.11],[side*.19+(j-1)*.035,-.13,-.035],.012,.003);
      }
    }
    for (const side of [-1, 1]) {
      const ex=eagle?.055:.091,ez=eagle?.414:.467;
      sphere(dark, body, [side * ex, .385, ez], [.014, .009, .020]);
      sphere(accent, body, [side * (ex+.003), .385, ez+.01], [.006, .006, .006]);
      const brow=sphere(eagle?secondary:fur,body,[side*ex,.40,ez],[.024,.009,.027]);brow.rotation.z=side*-.24;
      const wing = new THREE.Group(); wing.position.set(side * .16, .24, -.04); root.add(wing); wings.push(wing);
      if (eagle) {
        sphere(fur,wing,[side*.3,.01,-.015],[.35,.055,.125]);
        for(let i=0;i<9;i++) feather(i%3===0?secondary:fur,wing,[side*(.16+i*.092),-.008,-.02-i*.018],.43-i*.011,.145,side*(-.1-i*.022));
        for(let i=0;i<7;i++) feather(fur,wing,[side*(.16+i*.091),.023,.06-i*.011],.22,.135,side*-.1);
      } else {
        const membraneMat=secondary; membraneMat.side=THREE.DoubleSide;
        const shape=new THREE.Shape();shape.moveTo(0,.05);shape.lineTo(side*.45,.22);shape.lineTo(side*1.06,.02);
        shape.quadraticCurveTo(side*.70,-.12,side*.68,-.58);shape.quadraticCurveTo(side*.39,-.25,side*.32,-.57);shape.quadraticCurveTo(side*.16,-.28,0,-.33);shape.closePath();
        const membrane=mesh(new THREE.ShapeGeometry(shape),membraneMat,wing);membrane.rotation.x=Math.PI/2;
        for(const tip of [[side*1.06,0,.02],[side*.68,0,-.58],[side*.32,0,-.57]])link(fur,wing,[side*.45,.015,.22],[tip[0],.015,tip[2]],.025,.009);
        link(fur,wing,[0,0,0],[side*.45,.015,.22],.042,.026);
        taperedCurve(secondary,body,[[side*.08,.41,.37],[side*.13,.50,.23],[side*.12,.53,.12]],.032,12);
      }
      mergeStatic(wing);
    }
    if(!eagle) {
      taperedCurve(fur,body,[[0,.23,-.25],[0,.18,-.64],[.22,.23,-1.00],[.35,.35,-1.11]],.076);
    }
  }
  const mouth = new THREE.Object3D(); mouth.name='summon-mouth';
  const mouthLocal={cat:[0,.585,.48],wolf:[0,.685,.75],eagle:[0,.27,.54],dragon:[0,.29,.74]}[kind];
  mouth.position.set(...mouthLocal);body.add(mouth);
  mergeStatic(body);
  const ring = mesh(new THREE.TorusGeometry(s.radius + .12, .015, 4, 24), accent, root, [0, .025, 0]); ring.rotation.x = Math.PI / 2;
  const health = new THREE.Group(); root.add(health); health.position.y = s.height + .28;
  const back = mesh(new THREE.PlaneGeometry(.6, .045), dark, health);
  const bar = mesh(new THREE.PlaneGeometry(.56, .022), accent, health, [0, 0, .002]);
  back.material.side = THREE.DoubleSide; bar.material.side = THREE.DoubleSide;
  root.userData.beast = kind;
  return { root, body, legs, wings, ring, health, bar, mouth };
}

class Beast {
  constructor(system, owner, kind, id = uid()) {
    const s = BEASTS[kind]; this.system = system; this.game = system.game; this.owner = owner; this.kind = 'summon'; this.beastKind = kind;
    this.id = id; this.spec = s; this.name = s.name; this.team = owner.team; this.cls = { look: { accent: s.light } };
    this.pos = owner.pos.clone(); this.vel = V(); this.knockVel = V(); this.yaw = owner.yaw; this.pitch = 0; this.scale = 1;
    this.radius = s.radius; this.height = s.height; this.collisionHeight = s.height; this.hp = this.maxHp = s.hp;
    this.effects = []; this.remaining = s.lifetime; this.attackT = .5; this.wind = 0; this.biteTarget = null;
    this.dead = false; this.onGround = !s.flying; this.state = 'idle'; this.stunT = 0; this.age = 0; this.formation = false;
    this.visual = buildBeast(kind); this.rig = { root: this.visual.root }; this.game.scene.add(this.rig.root);
  }
  get alive() { return !this.dead && this.hp > 0; }
  center(out = V()) { return out.copy(this.pos).add(V(0, this.height * .5, 0)); }
  eyePos(out = V()) { return out.copy(this.pos).add(V(0, this.height * .75, 0)); }
  forward(out = V()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  hasEffect(type) { return this.effects.some(e => e.type === type && e.t > 0); }
  customHurtCapsules() {
    const fwd = this.forward(), c = this.center(), length = this.spec.flying ? .2 : this.beastKind === 'wolf' ? .38 : .3;
    const head = c.clone().addScaledVector(fwd, length + .13).add(V(0, .1, 0));
    return [{ region: 'torso', a: c.clone().addScaledVector(fwd, -length), b: c.clone().addScaledVector(fwd, length), radius: this.radius },
      { region: 'head', a: head, b: head.clone(), radius: this.radius * .7 }];
  }
  addEffect(effect) {
    if (!this.alive) return false;
    const e = normalizeStatus(effect), old = this.effects.find(x => x.type === e.type);
    if (old) mergeStatus(old, e); else this.effects.push(e);
    if (hasStatusFlag(this, 'actionLock')) { this.wind = 0; this.biteTarget = null; }
    return true;
  }
  receiveHit(src, hit, dx = 0, dz = 0) {
    if (!this.alive) return 'miss';
    const dmg = Math.max(0, (hit.dmg || 0) * (src?.damageMul?.(this) ?? 1) * statusDamageTaken(this) * (this.formation ? .75 : 1));
    if (dmg > 0) breakDamageStatuses(this);
    this.hp = Math.max(0, this.hp - dmg);
    // Pet damage is credited, but its death is not a player kill.
    if (src?.stats) { src.stats.dmgDealt += dmg; src.stats.hits++; }
    this.stunT = Math.max(this.stunT, Math.min(.65, (hit.stun || 0) / 1000));
    this.knockVel.set(dx, 0, dz).multiplyScalar(Math.min(8, Math.max(0, hit.knock || 0)));
    if (hit.launch) this.vel.y = Math.min(8, hit.launch);
    if (!this.hp) { this.dead = true; this.state = 'dead'; }
    if (dmg) this.game.hud?.floatText?.(this.center(), String(Math.round(dmg)), 'enemy');
    return 'hit';
  }
  dispose() {
    this.rig.root.removeFromParent(); const geometries = new Set(), materials = new Set();
    this.rig.root.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); });
    for (const g of geometries) g.dispose(); for (const m of materials) m.dispose();
  }
  animate(dt) {
    const v = this.visual; v.root.position.copy(this.pos); v.root.rotation.y = this.yaw;
    const stride = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 3), phase = this.age * (this.beastKind === 'cat' ? 15 : 11);
    v.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(phase + (i === 0 || i === 3 ? 0 : Math.PI)) * .6 * stride; });
    v.wings.forEach((wing, i) => { wing.rotation.z = Math.sin(this.age * (this.beastKind === 'eagle' ? 10 : 7)) * .5 * (i ? -1 : 1); });
    v.body.rotation.x = this.wind > 0 ? -.14 : 0; v.ring.visible = this.formation;
    v.bar.scale.x = Math.max(.001, this.hp / this.maxHp);
    if (this.game.camera) v.health.quaternion.copy(this.game.camera.quaternion).premultiply(v.root.quaternion.clone().invert());
    v.health.visible = this.hp < this.maxHp || this.owner === this.game.player;
  }
}

export class SummonSystem {
  constructor(game) { this.game = game; this.units = []; this.orders = new Map(); this.recent = new Map(); }
  owned(owner) { return this.units.filter(p => p.owner === owner && p.alive); }
  lookup(id) { return this.units.find(p => p.id === id) || this.recent.get(id)?.entity || null; }
  order(owner) {
    if (!this.orders.has(owner.id)) this.orders.set(owner.id, { mode: 'free', target: null, point: null, formation: 0 });
    return this.orders.get(owner.id);
  }
  canUse(owner, action, feedback = false) {
    const reject = message => {
      if (feedback && owner.isPlayer && (this.game.time || 0) >= (owner._summonToastAt || 0)) { this.game.hud?.toast?.(message); owner._summonToastAt = (this.game.time || 0) + .8; }
      return false;
    };
    if (!owner.alive) return false;
    const pets = this.owned(owner), order = this.order(owner);
    if (action.kind) {
      if (order.formation > 0) return reject('四元素阵期间不能重新召唤');
      return !!BEASTS[action.kind] && (this.units.length < 32 || pets.some(p => p.beastKind === action.kind));
    }
    if (!pets.length) return reject('先召唤至少一只召唤兽');
    if (action.command === 'formation') return order.formation <= 0 && KINDS.every(k => pets.some(p => p.beastKind === k && p.pos.distanceTo(owner.pos) <= 18)) || reject('需要四种召唤兽存活，且都在18米内');
    return true;
  }
  cast(owner, action) {
    if (this.game.netGuest || !this.canUse(owner, action)) return false;
    const order = this.order(owner), pets = this.owned(owner);
    if (action.kind) {
      const old = pets.find(p => p.beastKind === action.kind); if (old) this.remove(old);
      if (this.units.length >= 32) return false;
      const p = new Beast(this, owner, action.kind), index = KINDS.indexOf(action.kind), yaw = owner.yaw + (index - 1.5) * .65;
      const raw = owner.pos.clone().add(V(Math.sin(yaw) * 1.1, 0, Math.cos(yaw) * 1.1));
      p.pos.copy(owner.pos); p.onGround = owner.onGround;
      const position = this.game.world.resolve(p, raw.x, raw.y + (p.spec.flying ? p.spec.altitude : .05), raw.z);
      p.pos.set(position.x, position.y, position.z); p.onGround = position.grounded && !p.spec.flying;
      this.units.push(p); p.animate(0); this.game.vfx.ring?.(p.pos, .65, p.spec.light, .7);
    } else if (action.command === 'follow') {
      order.mode = order.mode === 'follow' ? 'free' : 'follow'; order.target = null; order.point = null;
      for (const p of pets) { p.target = null; p.wind = 0; p.biteTarget = null; }
    } else if (action.command === 'focus') {
      const eye = owner.eyePos(), dir = owner.isPlayer ? owner.aimDir : owner.target?.center().sub(eye).normalize() || owner.forward();
      const hit = this.game.world.raycast(eye, dir, 25, this.game.combat.targets().filter(f => f.kind !== 'summon'), undefined, owner);
      order.target = hit.fighter; order.point = hit.point.clone(); order.mode = hit.fighter ? hit.fighter.team === owner.team ? 'escort' : 'focus' : 'guard';
      if (!hit.fighter) order.point.y = this.game.world.floorHeight(order.point.x, order.point.z, order.point.y + .5);
      this.game.vfx.ring?.(hit.point, .6, '#8cd7c4', .65);
    } else if (action.command === 'formation') {
      order.formation = 12;
      for (const p of pets) { p.remaining = 12; p.formation = true; this.game.vfx.ring?.(p.pos, .8, p.spec.light, .9); }
      this.game.vfx.ring?.(owner.pos, 2.5, '#8cd7c4', 1);
    }
    owner.summonState = this.summary(owner); return true;
  }
  summary(owner) {
    const order = this.order(owner), pets = this.owned(owner);
    return { count: pets.length, max: MAX_PER_OWNER, mode: order.mode, targetName: order.target?.alive ? order.target.name : '', formation: order.formation,
      pets: pets.map(p => ({ kind: p.beastKind, name: p.name, hp: p.hp, maxHp: p.maxHp, remaining: p.remaining })) };
  }
  remove(p) {
    const at = this.units.indexOf(p); if (at >= 0) this.units.splice(at, 1);
    // Recent entities remain addressable for delayed LAN impact events, but no
    // longer simulate, render or own GPU resources.
    p.dead=true;p.state='dead';this.recent.set(p.id, { entity: p, until: this.game.time + 1 }); p.dispose();
  }
  removeOwner(owner) {
    for (const p of [...this.units]) if (p.owner === owner) this.remove(p);
    this.orders.delete(owner.id); owner.summonState = { count: 0, max: MAX_PER_OWNER, mode: 'free', targetName: '', formation: 0, pets: [] };
  }
  clear() { for (const p of [...this.units]) this.remove(p); this.orders.clear(); this.recent.clear(); }
  targetFor(p, order) {
    if (order.mode === 'follow' || order.mode === 'escort' || p.hasEffect('blind')) return null;
    const eye = p.eyePos(), visible = t => t?.alive && !t.untargetable && t.team !== p.team &&
      t.pos.distanceTo(p.owner.pos) < 28 && !this.game.world.blocked(eye, t.center());
    if (order.mode === 'focus' && visible(order.target)) return order.target;
    let best = null, dist = p.spec.vision;
    for (const t of this.game.combat.enemiesOf(p)) {
      const d = p.pos.distanceTo(t.pos); if (d >= dist || !visible(t)) continue;
      if (order.mode === 'guard' && order.point && t.pos.distanceTo(order.point) > 8) continue;
      best = t; dist = d;
    }
    return best;
  }
  mouthPoint(p) {
    // Match the visible model socket after this frame's physics, including
    // attack lean, instead of testing a floating point near the belly.
    p.animate(0);p.visual.root.updateWorldMatrix(true,true);
    return p.visual.mouth.getWorldPosition(V());
  }
  shoot(p, target) {
    if (!target?.alive || this.game.world.blocked(p.eyePos(), target.center())) return;
    const origin = this.mouthPoint(p), aim = target.center(), dir = aim.sub(origin).normalize();
    if (this.game.world.blocked(p.center(), origin)) return;
    const spec = { kind: 'magic', color: p.spec.light, speed: p.beastKind === 'eagle' ? 30 : 18, radius: p.beastKind === 'eagle' ? .10 : .18,
      range: p.spec.reach + 2, dmg: p.spec.damage * (p.formation ? 1.45 : 1), stun: 90, knock: .12,
      effect: p.spec.effect, summon: true, summonId: p.id };
    const def = { name: p.name + (p.beastKind === 'eagle' ? '·落雷' : '·吐息'), sfx: p.beastKind === 'eagle' ? 'thunder' : 'magic_bolt' };
    const mesh = this.game.vfx.projectileMesh(spec.kind, spec.color, def, spec, p.owner); mesh.position.copy(origin); this.game.scene.add(mesh);
    this.game.combat.projectiles.push({ owner: p.owner, p: spec, def, pos: origin.clone(), vis: origin.clone(), visOff: V(),
      origin: origin.clone(), vel: dir.clone().multiplyScalar(spec.speed), traveled: 0, mesh, hit: new Set(), age: 0, color: spec.color });
    this.game.vfx.fire?.(p.owner, spec, def, origin, dir); this.game.onFire(p.owner, spec, def, origin, dir);
  }
  bite(p, target) {
    if (!target?.alive) return;
    const mouth = this.mouthPoint(p);
    const contact = sphereContact(mouth, .21, target);
    if (!contact || this.game.world.blocked(p.center(), contact.point)) return;
    const dir = target.center().sub(mouth).normalize(), hit = { dmg: p.spec.damage * (p.formation ? 1.45 : 1), stun: 110, knock: .25,
      effect: p.spec.effect, contact, origin: mouth, incomingDir: dir.clone() };
    const res = target.receiveHit(p.owner, hit, dir.x, dir.z);
    this.game.onHit(p.owner, target, res, hit, { name: p.name + '·扑咬' }, false, contact.point);
  }
  tick(dt) {
    if (this.game.netGuest) return;
    for (const [id, item] of this.recent) if (item.until < this.game.time) this.recent.delete(id);
    for (const [id, order] of this.orders) {
      const owner = this.game.fighters.find(f => f.id === id);
      if (!owner?.alive) { if (owner) this.removeOwner(owner); else this.orders.delete(id); continue; }
      order.formation = Math.max(0, order.formation - dt);
    }
    for (const p of [...this.units]) {
      p.remaining -= dt; if (!p.hasEffect('frozen')) p.age += dt;
      if (!p.alive || !p.owner.alive || p.remaining <= 0 || !this.game.fighters.includes(p.owner)) { this.remove(p); continue; }
      for (const e of p.effects) {
        const elapsed = Math.min(e.t, dt * 1000); e.t -= elapsed;
        if (e.dps && e.src) p.receiveHit(e.src, { dmg: e.dps * elapsed / 1000, dot: true, stun: 0 });
      }
      p.effects = p.effects.filter(e => e.t > 0); p.stunT = Math.max(0, p.stunT - dt);
      const order = this.order(p.owner), actionLocked = p.stunT > 0 || hasStatusFlag(p, 'actionLock') || hasStatusFlag(p, 'attackLock');
      p.formation = order.formation > 0; p.target = actionLocked ? null : this.targetFor(p, order);
      const index = KINDS.indexOf(p.beastKind), followYaw = p.owner.yaw + Math.PI + (index - 1.5) * .68;
      const follow = p.owner.pos.clone().add(V(Math.sin(followYaw) * (1.4 + index * .22), 0, Math.cos(followYaw) * (1.4 + index * .22)));
      let goal = p.target?.pos || (order.mode === 'escort' && order.target?.alive ? order.target.pos.clone().addScaledVector(p.owner.forward(), -1.5) : order.mode === 'guard' && order.point ? order.point : follow);
      const dx = goal.x - p.pos.x, dz = goal.z - p.pos.z, distance = Math.hypot(dx, dz);
      const stop = p.target ? (p.spec.flying ? p.spec.reach * .7 : p.radius + (p.target.radius || .25) + .045) : .4;
      let speed = distance > stop ? p.spec.speed * statusMoveMultiplier(p) : 0;
      if (actionLocked || hasStatusFlag(p, 'movementLock')) speed = 0;
      const heading = Math.atan2(dx, dz); p.yaw += clamp(wrapAngle(heading - p.yaw), -dt * 8, dt * 8);
      // Try bounded detours around cover. No teleporting through walls to owner.
      let moveYaw = heading;
      if (speed) {
        const start = p.center(); const blocked = yaw => this.game.world.blocked(start, start.clone().add(V(Math.sin(yaw) * .9, 0, Math.cos(yaw) * .9)), p.radius * .5);
        if (blocked(moveYaw)) { const side = index % 2 ? -1 : 1; const free = [.7, -.7, 1.3, -1.3, 2, -2].map(a => heading + a * side).find(y => !blocked(y)); if (free === undefined) speed = 0; else moveYaw = free; }
      }
      p.vel.x = Math.sin(moveYaw) * speed + p.knockVel.x; p.vel.z = Math.cos(moveYaw) * speed + p.knockVel.z;
      p.knockVel.multiplyScalar(Math.exp(-dt * 9));
      if (p.spec.flying && !actionLocked) {
        const floor = this.game.world.floorHeight(p.pos.x, p.pos.z, Math.max(p.pos.y, p.owner.pos.y) + .4);
        // Bounded height relative to local floor; flying opponents can still
        // move above the eagle's attack lane instead of receiving homing hits.
        const wanted = Math.max(floor + .35, Math.min(floor + 4, goal.y + p.spec.altitude));
        p.vel.y = clamp((wanted - p.pos.y) * 3, -4, 4);
      } else p.vel.y -= 20 * dt;
      let r = this.game.world.resolve(p, p.pos.x + p.vel.x * dt, p.pos.y + p.vel.y * dt, p.pos.z + p.vel.z * dt);
      for (const other of this.game.combat.targets()) {
        if (other === p || !other.alive || r.y + p.height < other.pos.y || r.y > other.pos.y + other.collisionHeight) continue;
        const x = r.x - other.pos.x, z = r.z - other.pos.z, d = Math.hypot(x, z), gap = p.radius + other.radius;
        if (d >= gap || d < 1e-5) continue;
        r = this.game.world.resolve(p, r.x + x / d * (gap - d), r.y, r.z + z / d * (gap - d));
      }
      p.pos.set(r.x, r.y, r.z); p.onGround = r.grounded; if (r.grounded || r.ceiling) p.vel.y = 0;
      if (p.pos.y < this.game.world.killY) { this.remove(p); continue; }
      p.attackT -= dt * (p.formation ? 1.3 : 1);
      if (p.wind > 0) { p.wind -= dt; if (p.wind <= 0 && !actionLocked) { if (p.spec.flying) this.shoot(p, p.biteTarget); else this.bite(p, p.biteTarget); p.biteTarget = null; } }
      if (p.target && !actionLocked && p.attackT <= 0 && p.wind <= 0 && p.center().distanceTo(p.target.center()) <= p.spec.reach + (p.target.radius || .25)) {
        p.attackT = p.spec.interval; p.wind = p.spec.flying ? .23 : .16; p.biteTarget = p.target;
      }
      p.animate(dt);
    }
    for (const owner of this.game.fighters) if (owner.clsId === 'summoner') owner.summonState = this.summary(owner);
  }
  snapshot() {
    return { units: this.units.filter(p => p.alive).map(p => ({ id: p.id, o: p.owner.id, k: p.beastKind, p: p.pos.toArray(), y: p.yaw,
      hp: Math.round(p.hp), t: +p.remaining.toFixed(2), age: +p.age.toFixed(2), v: p.vel.toArray(), w: p.wind, f: p.formation })),
    owners: this.game.fighters.filter(f => f.clsId === 'summoner').map(f => [f.id, this.summary(f)]) };
  }
  applySnapshot(current = { units: [], owners: [] }, previous, alpha, lookup, dt) {
    for (const [id, item] of this.recent) if (item.until < this.game.time) this.recent.delete(id);
    const seen = new Set(), old = new Map((previous?.units || []).map(p => [p.id, p]));
    for (const data of current.units || []) {
      const owner = lookup(data.o); if (!owner || !BEASTS[data.k]) continue;
      seen.add(data.id); let p = this.units.find(p => p.id === data.id);
      if (!p) { p = new Beast(this, owner, data.k, data.id); this.units.push(p); }
      const before = old.get(data.id) || data;
      p.pos.fromArray(before.p).lerp(V(...data.p), alpha); p.yaw = before.y + wrapAngle(data.y - before.y) * alpha;
      p.vel.fromArray(data.v); p.hp = data.hp; p.remaining = data.t; p.age = data.age; p.wind = data.w; p.formation = data.f; p.animate(dt);
    }
    for (const p of [...this.units]) if (!seen.has(p.id)) this.remove(p);
    for (const [id, state] of current.owners || []) { const f = lookup(id); if (f) { f.summonState = state; this.orders.set(id, { ...state, target: null, point: null }); } }
  }
}
