// 特效：刀光、火花、粒子、爆炸、预警圈、光束、武器拖尾。均为程序生成。
import * as THREE from 'three';
import { rand } from '../engine/util.js';
import { SkillEffects } from './skill-vfx.js';

function glowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.35)') {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner); gr.addColorStop(0.25, mid); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function arcTexture() {
  // 横向：u 为弧长（两端淡出），v 为径向（外沿最亮）
  const c = document.createElement('canvas'); c.width = 128; c.height = 32;
  const g = c.getContext('2d');
  for (let y = 0; y < 32; y++) {
    const v = y / 31;
    const radial = Math.pow(v, 2.2);
    for (let x = 0; x < 128; x++) {
      const u = x / 127;
      const along = Math.sin(Math.PI * Math.pow(u, 0.7));
      const a = radial * along;
      g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function ringTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 20, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.75, 'rgba(255,255,255,0.15)'); gr.addColorStop(0.93, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function streakTexture() {
  // 横向光芒：中心亮，两端与上下边缘柔和淡出（Sprite 非等比缩放 + 旋转即可作放射光条）
  const c = document.createElement('canvas'); c.width = 128; c.height = 16;
  const g = c.getContext('2d');
  for (let x = 0; x < 128; x++) for (let y = 0; y < 16; y++) {
    const u = Math.abs(x - 63.5) / 64, v = Math.abs(y - 7.5) / 8;
    const a = Math.pow(1 - u, 1.6) * Math.pow(1 - v, 2.2);
    g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`; g.fillRect(x, y, 1, 1);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// 扫过式刀光：reveal 为刀光头部位置（0..1），拖尾在头部后方渐隐，外沿最亮、内核白热
const ARC_VS = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }';
const ARC_FS = `varying vec2 vUv; uniform vec3 color; uniform float reveal, fade, dir, trail, gain;
  void main(){
    float u = dir > 0.0 ? vUv.x : 1.0 - vUv.x;
    float head = smoothstep(reveal + 0.02, reveal - 0.05, u);
    float tail = smoothstep(reveal - trail, reveal, u);
    float a = head * tail;
    float v = vUv.y;
    float streak = 0.78 + 0.22 * sin(v * 38.0 + u * 7.0) * sin(u * 23.0 + 1.3);
    float prof = pow(v, 2.2) * streak;
    float core = pow(v, 7.0);
    vec3 col = mix(color, vec3(1.0), clamp(core * 1.4 + (u - (reveal - 0.08)) * 3.0 * head * 0.0, 0.0, 1.0));
    float alpha = a * (prof * 0.85 + core * 1.2) * fade;
    gl_FragColor = vec4(col * alpha * gain, alpha);
  }`;

const MAX_P = 900;

export class VFX {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.clock = 0;
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.maxItems = touch ? 72 : 112;
    this.maxDrawables = touch ? 180 : 320;
    this.drawableCount = 0;
    this.droppedItems = 0;
    this.tex = { glow: glowTexture(), arc: arcTexture(), ring: ringTexture(), streak: streakTexture() };
    this.arcGeo2 = new Map();
    // 粒子池
    const g = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_P * 3);
    this.pCol = new Float32Array(MAX_P * 3);
    this.pSize = new Float32Array(MAX_P);
    this.pVel = new Float32Array(MAX_P * 3);
    this.pLife = new Float32Array(MAX_P);
    this.pMax = new Float32Array(MAX_P);
    this.pGrav = new Float32Array(MAX_P);
    this.pBase = new Float32Array(MAX_P);
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.tex.glow }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC;
        uniform float scale;
        void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*scale/max(0.1,-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; void main(){ vec4 t=texture2D(map, gl_PointCoord); gl_FragColor=vec4(vC*t.a, t.a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
    this.pNext = 0;
    this.flash = new THREE.PointLight('#ffb070', 0, 10, 2);
    scene.add(this.flash);
    this.flashT = 0;
    this.arcGeo = new Map();
    this.skills = new SkillEffects(this);
  }

  skillEvent(f, type, data) { return this.skills.skillEvent(f, type, data); }
  fire(att, p, def, visual, dir) { return this.skills.fire(att, p, def, visual, dir); }
  projectileStep(pr, dt) { return this.skills.projectileStep(pr, dt); }
  areaEvent(owner, a, def, pos, tick) { return this.skills.areaEvent(owner, a, def, pos, tick); }
  explosionEvent(owner, pos, e, def) { return this.skills.explosionEvent(owner, pos, e, def); }
  channelBeam(att, def, from, to, width, dur) { return this.skills.channelBeam(att, def, from, to, width, dur); }
  healTarget(target, heal, source) { return this.skills.healTarget(target, heal, source); }
  statusTarget(target, effect) { return this.skills.statusTarget(target, effect); }
  blinkTrail(f, from, to) { return this.skills.blinkTrail(f, from, to); }

  getStats() {
    let particles = 0;
    for (const life of this.pLife) if (life > 0) particles++;
    return { items: this.items.length, maxItems: this.maxItems, drawables: this.drawableCount,
      maxDrawables: this.maxDrawables, particles, maxParticles: MAX_P,
      dropped: this.droppedItems, statuses: this.skills.statuses.size, zones: this.skills.zones.size,
      geometryCache: this.arcGeo2.size, ...this.skills.stats };
  }

  setScale(h) { this.points.material.uniforms.scale.value = h * 0.9; }

  particle(x, y, z, vx, vy, vz, color, size, life, grav = 9) {
    const i = this.pNext; this.pNext = (this.pNext + 1) % MAX_P;
    this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
    this.pVel[i * 3] = vx; this.pVel[i * 3 + 1] = vy; this.pVel[i * 3 + 2] = vz;
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    this.pCol[i * 3] = c.r; this.pCol[i * 3 + 1] = c.g; this.pCol[i * 3 + 2] = c.b;
    this.pBase[i] = size; this.pSize[i] = size;
    this.pLife[i] = life; this.pMax[i] = life; this.pGrav[i] = grav;
  }

  burst(pos, color, n = 14, speed = 5, size = 0.06, life = 0.35, grav = 9, up = 1) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const th = rand(0, Math.PI * 2), ph = rand(-0.4, 1.2);
      const s = speed * rand(0.4, 1.1);
      this.particle(pos.x, pos.y, pos.z, Math.cos(th) * Math.cos(ph) * s, Math.sin(ph) * s * up + 1, Math.sin(th) * Math.cos(ph) * s, c, size * rand(0.6, 1.3), life * rand(0.6, 1.2), grav);
    }
  }

  add(obj, dur, update, onEnd) {
    let draws = 0;
    obj.traverse(o => { if (o.isMesh || o.isSprite || o.isLine) draws++; });
    while (this.items.length && (this.items.length >= this.maxItems || this.drawableCount + draws > this.maxDrawables)) {
      // Drop the oldest display under extreme load; damage and status stay untouched.
      this.finishItem(this.items[0]);
      this.droppedItems++;
    }
    this.scene.add(obj);
    this.drawableCount += draws;
    this.items.push({ obj, t: 0, dur: Math.max(.01, dur), update, onEnd, draws, ended: false });
    return obj;
  }

  finishItem(it) {
    if (it.ended) return;
    it.ended = true;
    it.obj.removeFromParent();
    this.drawableCount = Math.max(0, this.drawableCount - (it.draws || 0));
    const i = this.items.indexOf(it); if (i >= 0) this.items.splice(i, 1);
    it.onEnd?.();
  }

  sprite(pos, color, size, dur, grow = 1.6) {
    const m = new THREE.SpriteMaterial({ map: this.tex.glow, color: new THREE.Color(color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const s = new THREE.Sprite(m); s.position.copy(pos); s.scale.setScalar(size);
    s.renderOrder = 11;
    this.add(s, dur, (k) => { s.scale.setScalar(size * (1 + (grow - 1) * k)); m.opacity = 1 - k; }, () => m.dispose());
    return s;
  }

  // ---- 刀光：在攻击者前方生成一段弧 ----
  // 弧形几何：以 +Z 为正前方，φ 从右(-)扫到左(+)，u 沿弧、v 沿半径
  arcGeometry(r0, r1, len) {
    const key = `${r0.toFixed(2)}_${r1.toFixed(2)}_${len.toFixed(2)}`;
    if (this.arcGeo2.has(key)) return this.arcGeo2.get(key);
    const N = 40, pos = [], uvs = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N, phi = -len / 2 + len * u;
      for (const [r, v] of [[r0, 0], [r1, 1]]) { pos.push(Math.sin(phi) * r, 0, Math.cos(phi) * r); uvs.push(u, v); }
      if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    this.arcGeo2.set(key, g);
    return g;
  }
  arcMaterial(color, dir = 1, trail = 0.5, gain = 1.6) {
    return new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(color) }, reveal: { value: 0 }, fade: { value: 1 }, dir: { value: dir }, trail: { value: trail }, gain: { value: gain } },
      vertexShader: ARC_VS, fragmentShader: ARC_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
  }

  // ---- 刀光：跟随当前攻击方向，在真实技能射程内扫出短弧 ----
  slash(f, kind, color = '#e8f4ff', range = 2.4, power = 1) {
    const yaw = f.yaw ?? f.action?.aimYaw ?? 0, pitch = f.pitch ?? f.action?.aimPitch ?? 0;
    const cp = Math.cos(pitch), direction = new THREE.Vector3(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
    const base = new THREE.Vector3(f.pos.x, f.pos.y + 1.15 * (f.scale || 1), f.pos.z);
    const g = new THREE.Group();
    g.position.copy(base);
    g.rotation.order = 'YXZ';
    g.rotation.y = yaw;
    if (kind !== 'ring' && kind !== 'ringWide') {
      // Current yaw/pitch also exists on the guest's remote puppet.
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    }
    const followPose=()=>{
      const y=f.yaw??f.action?.aimYaw??0,p=f.pitch??f.action?.aimPitch??0,c=Math.cos(p);
      g.position.set(f.pos.x,f.pos.y+((kind==='ring'||kind==='ringWide') ? .8 : 1.15)*(f.scale||1),f.pos.z);
      if(kind==='ring'||kind==='ringWide')g.rotation.y=y;
      else g.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),direction.set(Math.sin(y)*c,Math.sin(p),Math.cos(y)*c));
    };
    let dur = 0.22 + 0.1 * (power - 1), tilt = 0, roll = 0, len = Math.PI * 0.85, dir = 1;
    const r1 = range, r0 = Math.max(0.35, r1 * 0.64);
    switch (kind) {
      case 'slashR': roll = -0.55; tilt = -0.12; break;
      case 'slashL': roll = 0.55; tilt = -0.12; dir = -1; break;
      case 'slashWide': len = Math.PI * 1.15; tilt = -0.05; dur += 0.04; break;
      case 'slashUp': roll = Math.PI / 2 - 0.15; len = Math.PI * 0.8; dir = -1; break;
      case 'slashDown': roll = Math.PI / 2; len = Math.PI * 0.8; dir = 1; break;
      case 'ring': case 'ringWide': len = Math.PI * 2; dur = 0.34; base.y = f.pos.y + 0.8; g.position.copy(base); break;
      case 'thrust': case 'thrustMulti': {
        const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.08 * power, range, 8, 1, true), m);
        cone.rotation.x = Math.PI / 2; cone.position.z = range * 0.5;
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.018 * power, range, 6, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        tip.rotation.x = Math.PI / 2; tip.position.z = range * 0.5;
        g.add(cone, tip);
        const fw = direction;
        for (let i = 0; i < 4 * power; i++) { const d = rand(0.4, range); this.particle(base.x + fw.x * d, base.y + fw.y * d + rand(-0.04, 0.04), base.z + fw.z * d, fw.x, fw.y, fw.z, color, 0.025, 0.18, 0); }
        this.add(g, 0.2, (k) => { followPose();m.opacity = 0.4 * (1 - k); tip.material.opacity = 0.6 * (1 - k); }, () => { m.dispose(); tip.material.dispose(); cone.geometry.dispose(); tip.geometry.dispose(); });
        return;
      }
      case 'punch': case 'punchBig': case 'kick': case 'palm': case 'bash': {
        const p = base.clone().addScaledVector(f.forward(), kind === 'palm' ? 1.3 : 1.0);
        const big = kind === 'punchBig' || kind === 'palm';
        this.sprite(p, color, (big ? 1.5 : 0.8) * power, 0.2, 2.4);
        this.flare(p, color, big ? 8 : 5, big ? 1.4 : 0.8, 0.18);
        if (big) this.shock(p, f.yaw, color);
        return;
      }
      default: roll = -0.4;
    }
    const geo = this.arcGeometry(r0, r1, len);
    const outer = new THREE.Mesh(geo, this.arcMaterial(color, dir, 0.48, 0.65 * power));
    const inner = new THREE.Mesh(geo, this.arcMaterial(color, dir, 0.28, 0.35 * power));
    inner.scale.set(0.97, 1, 0.97);
    for (const m of [outer, inner]) { m.rotation.z = roll; m.rotation.x = tilt; m.renderOrder = 9; g.add(m); }
    const sparkN = Math.round(6 * power), c = new THREE.Color(color);
    let spawned = 0;
    const tmp = new THREE.Vector3();
    this.add(g, dur, (k) => {
      followPose();
      const reveal = Math.min(1.25, k * 1.9);
      const fade = k < 0.55 ? 1 : Math.max(0, 1 - (k - 0.55) / 0.45);
      for (const m of [outer, inner]) { m.material.uniforms.reveal.value = reveal; m.material.uniforms.fade.value = fade; }
      // 沿刀光头部喷火星
      const want = Math.floor(Math.min(1, k * 1.9) * sparkN);
      while (spawned < want) {
        spawned++;
        const u = Math.min(1, k * 1.9), phi = (dir > 0 ? -len / 2 + len * u : len / 2 - len * u), r = r1 * rand(0.8, 1.0);
        tmp.set(Math.sin(phi) * r, 0, Math.cos(phi) * r); outer.updateWorldMatrix(true, false); outer.localToWorld(tmp);
        this.particle(tmp.x, tmp.y, tmp.z, rand(-1.6, 1.6), rand(0.2, 2.2), rand(-1.6, 1.6), Math.random() < 0.4 ? '#ffffff' : c, 0.05 * power, rand(0.25, 0.5), 5);
      }
    }, () => { outer.material.dispose(); inner.material.dispose(); });
    // Actual ranged sword waves are projectiles. Ordinary power attacks remain in reach.
  }

  // 剑气：沿前方飞出的新月光刃
  wave(f, color, size = 2.4, power = 1.5) {
    const fw = f.forward();
    const g = new THREE.Group();
    g.position.set(f.pos.x + fw.x * 0.8, f.pos.y + 1.1 * f.scale, f.pos.z + fw.z * 0.8);
    g.rotation.order = 'YXZ'; g.rotation.y = f.yaw;
    const geo = this.arcGeometry(size * 0.55, size * 0.9, Math.PI * 0.7);
    const mat = this.arcMaterial(color, 1, 0.9, 1.8);
    const mat2 = this.arcMaterial('#ffffff', 1, 0.7, 1.2);
    const a = new THREE.Mesh(geo, mat), b = new THREE.Mesh(geo, mat2);
    for (const m of [a, b]) { m.rotation.z = Math.PI / 2; m.renderOrder = 9; g.add(m); }
    b.scale.set(0.96, 1, 0.96);
    const dist = 5.5 * power, dur = 0.34;
    this.add(g, dur, (k) => {
      for (const m of [mat, mat2]) { m.uniforms.reveal.value = 1.3; m.uniforms.fade.value = (1 - k) * (1 - k * 0.4); }
      g.position.set(f.pos.x + fw.x * (0.8 + dist * k), g.position.y, f.pos.z + fw.z * (0.8 + dist * k));
      if (Math.random() < 0.7) this.particle(g.position.x, g.position.y + rand(-size * 0.5, size * 0.5), g.position.z, fw.x * -1, rand(-0.3, 0.3), fw.z * -1, color, 0.07, 0.3, 0);
    }, () => { mat.dispose(); mat2.dispose(); });
  }

  // 放射光芒：n 条随机角度的光条（始终朝向镜头），配大光晕
  flare(pos, color, n = 8, size = 1.0, dur = 0.16) {
    const mats = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.SpriteMaterial({ map: this.tex.streak, color: i % 3 === 0 ? '#ffffff' : color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, rotation: rand(0, Math.PI * 2) });
      const sp = new THREE.Sprite(m); sp.position.copy(pos); sp.renderOrder = 12;
      const L = size * rand(0.7, 1.5), T = size * rand(0.06, 0.12);
      sp.scale.set(0.2, T, 1);
      mats.push(m);
      this.add(sp, dur * rand(0.8, 1.2), (k) => { sp.scale.set(L * (0.25 + 0.75 * Math.sqrt(k)), T * (1 - 0.6 * k), 1); m.opacity = 1 - k * k; }, () => m.dispose());
    }
  }

  // 蓄力：粒子从四周向手中/武器汇聚
  charge(pos, color, n = 22, radius = 1.0, life = 0.28) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const th = rand(0, Math.PI * 2), ph = rand(-1.1, 1.1), r = radius * rand(0.7, 1.2);
      const dx = Math.cos(th) * Math.cos(ph), dy = Math.sin(ph), dz = Math.sin(th) * Math.cos(ph);
      const sp = r / life * 0.8;
      this.particle(pos.x + dx * r, pos.y + dy * r, pos.z + dz * r, -dx * sp, -dy * sp, -dz * sp, i % 4 === 0 ? '#ffffff' : c, 0.07, life * rand(0.9, 1.3), 0);
    }
    this.sprite(pos, color, radius * 0.9, life, 0.35);
  }

  // 大招起手：多重光环、旋转法阵、螺旋上升的光粒与高光柱
  ultAura(pos, color = '#ffd27a') {
    this.ring(pos, 3.4, color, 0.7);
    let first = false, second = false;
    this.add(new THREE.Object3D(), .25, (k) => {
      if (!first && k >= .36) { first = true; this.ring(pos, 2.2, color, .5); }
      if (!second && k >= .8) { second = true; this.ring(pos, 4.6, color, .8); }
    });
    const c = new THREE.Color(color);
    // 旋转法阵
    const gm = new THREE.MeshBasicMaterial({ map: this.tex.ring, color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const glyph = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), gm);
    glyph.rotation.x = -Math.PI / 2; glyph.position.set(pos.x, pos.y + 0.06, pos.z);
    this.add(glyph, 0.9, (k) => { glyph.scale.setScalar(1.6 + 1.2 * Math.sin(Math.min(1, k * 1.6) * Math.PI / 2)); gm.opacity = 0.9 * (1 - k * k); glyph.rotation.z = k * 3; }, () => { gm.dispose(); glyph.geometry.dispose(); });
    // 光柱（内白外色）
    for (const [rad, col, op] of [[0.9, color, 0.5], [0.45, '#ffffff', 0.7]]) {
      const m = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, map: this.tex.glow });
      const colu = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.7, rad, 8, 24, 1, true), m);
      colu.position.set(pos.x, pos.y + 4, pos.z);
      this.add(colu, 0.7, (k) => { m.opacity = op * (1 - k) * Math.min(1, k * 8); colu.scale.set(1 + k * 0.5, 1, 1 + k * 0.5); }, () => { m.dispose(); colu.geometry.dispose(); });
    }
    // 螺旋上升
    let t = 0, n = 0;
    this.add(new THREE.Object3D(), 0.7, (k, dt) => {
      t += dt;
      while (n < Math.floor(t * 110)) {
        n++;
        const a = n * 0.55, r = 1.1 - (t / 0.7) * 0.5;
        this.particle(pos.x + Math.cos(a) * r, pos.y + 0.1, pos.z + Math.sin(a) * r, -Math.sin(a) * 1.6, 3 + rand(0, 3.5), Math.cos(a) * 1.6, n % 3 ? c : '#ffffff', 0.09, 0.8, -2);
      }
    });
    this.flare(new THREE.Vector3(pos.x, pos.y + 1.2, pos.z), color, 14, 3.2, 0.4);
    this.flashAt(new THREE.Vector3(pos.x, pos.y + 1.2, pos.z), color, 9);
  }
  // 伏龙翔天：沿前方的龙形光流
  dragon(f, color = '#ffd27a') {
    const fw = f.forward();
    const base = new THREE.Vector3(f.pos.x, f.pos.y + 1.2, f.pos.z);
    const c = new THREE.Color(color);
    let spawned = 0;
    this.add(new THREE.Object3D(), .37, (k) => {
      const want = Math.floor(k * 26);
      while (spawned < want) {
        const i = spawned++, d = i * .35, wob = Math.sin(i * .7) * .5;
        const p = base.clone().addScaledVector(fw, d);
        p.x += -fw.z * wob; p.z += fw.x * wob; p.y += Math.cos(i*.7)*.35+i*.03;
        this.sprite(p,color,.9-i*.02,.35,1.6);this.burst(p,c,3,1.5,.08,.5,-1);
      }
    });
  }
  // 千刃：多方向刀光
  blades(f, color) {
    const kinds = ['slashR', 'slashL', 'slashUp', 'slashWide'];
    this.slash(f, kinds[(Math.random() * 4) | 0], color, 3.0);
    const p = f.center(new THREE.Vector3()).addScaledVector(f.forward(), 1.6);
    this.sprite(p, color, 0.7, 0.1, 2.2);
  }

  shock(pos, yaw, color) {
    const m = new THREE.MeshBasicMaterial({ map: this.tex.ring, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
    mesh.position.copy(pos); mesh.rotation.y = yaw;
    this.add(mesh, 0.25, (k) => { mesh.scale.setScalar(0.4 + 2.2 * k); m.opacity = 1 - k; }, () => { m.dispose(); mesh.geometry.dispose(); });
  }

  // 地面冲击环
  ring(pos, radius, color = '#ffffff', dur = 0.35) {
    const m = new THREE.MeshBasicMaterial({ map: this.tex.ring, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(pos.x, pos.y + 0.05, pos.z);
    this.add(mesh, dur, (k) => { mesh.scale.setScalar(radius * (0.3 + 0.8 * k)); m.opacity = 1 - k; }, () => { m.dispose(); mesh.geometry.dispose(); });
  }

  hitSpark(pos, color = '#ffe0a0', strong = false) {
    const sp = this.sprite(pos, color, strong ? 1.1 : 0.55, strong ? 0.16 : 0.1, 2.0); sp.material.opacity = 0.95;
    this.sprite(pos, '#ffffff', strong ? 0.5 : 0.28, 0.08, 1.6);
    this.flare(pos, color, strong ? 12 : 6, strong ? 1.5 : 0.8, strong ? 0.2 : 0.13);
    this.burst(pos, color, strong ? 34 : 14, strong ? 8 : 5.5, 0.05, 0.38, 12);
    if (strong) { this.burst(pos, '#ffffff', 12, 10, 0.04, 0.25, 8); this.ringAt(pos, 1.5, color, 0.22); }
    this.flashAt(pos, color, strong ? 4.5 : 2.2);
  }
  // 朝向镜头的冲击环（命中点）
  ringAt(pos, size, color, dur = 0.25) {
    const m = new THREE.SpriteMaterial({ map: this.tex.ring, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const s = new THREE.Sprite(m); s.position.copy(pos); s.renderOrder = 12;
    this.add(s, dur, (k) => { s.scale.setScalar(size * (0.3 + 0.9 * Math.sqrt(k))); m.opacity = 1 - k; }, () => m.dispose());
  }
  blockSpark(pos) {
    this.sprite(pos, '#bfe6ff', 0.7, 0.12, 1.8);
    this.burst(pos, '#dff4ff', 16, 6, 0.04, 0.25, 14);
  }
  parrySpark(pos) {
    this.sprite(pos, '#ffffff', 1.4, 0.2, 2.4);
    this.burst(pos, '#fff3c0', 30, 8, 0.05, 0.4, 10);
    this.flashAt(pos, '#fff0c0', 4);
  }
  dust(pos, n = 10) { this.burst(new THREE.Vector3(pos.x, pos.y + 0.1, pos.z), '#8a8070', n, 2.2, 0.12, 0.5, 2, 0.3); }

  flashAt(pos, color, intensity) {
    this.flash.position.copy(pos); this.flash.color.set(color); this.flash.intensity = intensity * 1.2; this.flashT = 0.08;
  }

  explosion(pos, radius, color = '#ffa050') {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, map: this.tex.glow });
    const s = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), m);
    s.position.copy(pos);
    this.add(s, 0.4, (k) => { s.scale.setScalar(radius * (0.3 + 0.9 * Math.sqrt(k))); m.opacity = 0.9 * (1 - k); }, () => { m.dispose(); s.geometry.dispose(); });
    this.sprite(pos, '#fff2c0', radius * 1.2, 0.25, 1.8);
    this.burst(pos, color, 40, radius * 4, 0.1, 0.6, 6);
    this.burst(pos, '#555048', 16, radius * 2, 0.25, 0.9, -1, 0.6);
    this.ring(pos, radius * 1.2, color, 0.4);
    this.flashAt(pos, color, 8);
  }

  // 预警圈：外圈 + 由内向外填充表示剩余时间
  telegraph(pos, radius, dur, color = '#cf624b') {
    const g = new THREE.Group();
    g.position.set(pos.x, pos.y + 0.04, pos.z);
    const outline = new THREE.Mesh(new THREE.RingGeometry(radius * 0.94, radius, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
    outline.rotation.x = fill.rotation.x = -Math.PI / 2;
    fill.position.y = 0.01;
    g.add(outline, fill);
    const item = this.add(g, dur, (k) => { fill.scale.setScalar(Math.max(0.02, k)); outline.material.opacity = 0.6 + 0.4 * Math.sin(k * 30); }, () => { outline.material.dispose(); fill.material.dispose(); outline.geometry.dispose(); fill.geometry.dispose(); });
    return item;
  }
  // 扇形预警（Boss 横扫）
  coneTelegraph(pos, yaw, radius, arcDeg, dur, color = '#cf624b') {
    const g = new THREE.Group();
    g.position.set(pos.x, pos.y + 0.04, pos.z);
    g.rotation.y = yaw;
    const a = arcDeg * Math.PI / 180;
    const geo = new THREE.CircleGeometry(radius, 40, Math.PI / 2 - a / 2, a); geo.rotateX(-Math.PI / 2);
    // CircleGeometry 在 XY 平面，旋转后指向 -Z；翻转到 +Z
    geo.rotateY(Math.PI);
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, m);
    g.add(mesh);
    this.add(g, dur, (k) => { m.opacity = 0.2 + 0.3 * k + 0.1 * Math.sin(k * 40); }, () => { m.dispose(); geo.dispose(); });
    return g;
  }

  beam(from, to, width, color, dur) {
    const len = from.distanceTo(to);
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, map: this.tex.glow });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.5, width * 0.5, len, 10, 1, true), m);
    core.position.copy(from).lerp(to, 0.5);
    core.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    this.add(core, dur, (k) => { m.opacity = 0.9 * (1 - k); core.scale.set(1 + k, 1, 1 + k); }, () => { m.dispose(); core.geometry.dispose(); });
  }

  tracer(from, to, color = '#ffe6a0') {
    const len = from.distanceTo(to);
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 4, 1, true), m);
    line.position.copy(from).lerp(to, 0.5);
    line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    this.add(line, 0.06, (k) => { m.opacity = 0.85 * (1 - k); }, () => { m.dispose(); line.geometry.dispose(); });
  }

  // 投射物外形
  projectileMesh(kind, color = '#ffd27a', def = {}, projectile = {}, owner = {}) {
    return this.skills.projectileMesh(kind, color, def, projectile, owner);
  }

  update(dt) {
    this.clock += dt;
    // A callback may spawn or retire another effect. Iterate a snapshot so budget
    // pressure cannot update a removed effect twice or splice an unrelated one.
    for (const it of [...this.items]) {
      if (it.ended) continue;
      it.t += dt;
      const k = Math.min(1, it.t / it.dur);
      if (it.update) it.update(k, dt);
      if (it.t >= it.dur) {
        this.finishItem(it);
      }
    }
    // 粒子
    for (let i = 0; i < MAX_P; i++) {
      if (this.pLife[i] <= 0) { if (this.pSize[i] !== 0) this.pSize[i] = 0; continue; }
      this.pLife[i] -= dt;
      const j = i * 3;
      this.pVel[j + 1] -= this.pGrav[i] * dt;
      const drag = Math.exp(-2.5 * dt);
      this.pVel[j] *= drag; this.pVel[j + 2] *= drag;
      this.pPos[j] += this.pVel[j] * dt; this.pPos[j + 1] += this.pVel[j + 1] * dt; this.pPos[j + 2] += this.pVel[j + 2] * dt;
      if (this.pPos[j + 1] < 0.02) { this.pPos[j + 1] = 0.02; this.pVel[j + 1] *= -0.3; }
      this.pSize[i] = this.pBase[i] * Math.max(0, this.pLife[i] / this.pMax[i]);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.size.needsUpdate = true; g.attributes.color.needsUpdate = true;
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.intensity = 0; else this.flash.intensity *= Math.exp(-dt * 20); }
  }

  clear() {
    for (const it of [...this.items]) this.finishItem(it);
    this.items.length = 0;
    this.drawableCount = 0;
    this.pLife.fill(0);
    this.pSize.fill(0);
    this.points.geometry.attributes.size.needsUpdate = true;
    this.flashT = 0; this.flash.intensity = 0;
    this.skills.clear();
  }
}

// 武器拖尾：记录刃根与刃尖轨迹，形成带状网格
export class WeaponTrail {
  constructor(parent, color = '#dff4ff', segs = 14, layer = 0) {
    this.parent = parent;
    this.segs = segs;
    this.pts = []; // [{b:Vector3, t:Vector3, age}]
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(segs * 2 * 3);
    this.alpha = new Float32Array(segs * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const idx = [];
    for (let i = 0; i < segs - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(color) } },
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA=alpha; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 color; varying float vA; void main(){ gl_FragColor=vec4(color*vA, vA); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(layer);
    this.mesh.renderOrder = 8;
    parent.add(this.mesh);
    this.active = false;
    this._b = new THREE.Vector3(); this._t = new THREE.Vector3();
  }
  setColor(c) { this.mat.uniforms.color.value.set(c); }
  update(dt, baseObj, tipObj, emitting) {
    for (const p of this.pts) p.age += dt;
    if (emitting && baseObj && tipObj) {
      baseObj.getWorldPosition(this._b); tipObj.getWorldPosition(this._t);
      this.parent.worldToLocal(this._b); this.parent.worldToLocal(this._t);
      this.pts.unshift({ b: this._b.clone(), t: this._t.clone(), age: 0 });
    }
    while (this.pts.length > this.segs || (this.pts.length && this.pts[this.pts.length - 1].age > 0.14)) this.pts.pop();
    const n = this.pts.length;
    for (let i = 0; i < this.segs; i++) {
      const p = this.pts[Math.min(i, n - 1)];
      const j = i * 6;
      if (!p) { this.alpha[i * 2] = this.alpha[i * 2 + 1] = 0; continue; }
      this.pos[j] = p.b.x; this.pos[j + 1] = p.b.y; this.pos[j + 2] = p.b.z;
      this.pos[j + 3] = p.t.x; this.pos[j + 4] = p.t.y; this.pos[j + 5] = p.t.z;
      const a = i < n ? Math.max(0, 1 - p.age / 0.14) * (1 - i / this.segs) : 0;
      this.alpha[i * 2] = a * 0.15; this.alpha[i * 2 + 1] = a * 0.85;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
    this.mesh.visible = n > 1;
  }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mat.dispose(); }
}
