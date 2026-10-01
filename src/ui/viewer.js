// 选角界面的 3D 角色展示：待机站姿、缓慢旋转、可拖拽，定时演示招式
import * as THREE from 'three';
import { buildCharacter, disposeRig } from '../game/model.js';
import { buildWeapon } from '../game/weapons.js';
import { Animator, CLIPS } from '../game/anim.js';
import { CLASSES } from '../data/classes.js';
import { store } from '../engine/util.js';
import { applySkinnedModel } from '../game/skin.js';
import { createMocapBody, MocapAnimator, hasClips, weaponTilt, mountMocapWeapon, handSocket } from '../game/mocap.js';
import { installGripHands, fitWorldGripHands } from '../game/grip.js';

let shared = null; // 复用一个渲染器，避免反复创建 WebGL 上下文

export class CharViewer {
  constructor(container, models = null, rigged = null) {
    this.models = models; this.rigged = rigged;
    if (!shared) {
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.shadowMap.enabled = true;
      shared = r;
    }
    this.r = shared;
    this.coarse = matchMedia('(pointer: coarse)').matches;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.visible = true;
    this.observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => { this.visible = entries.some((entry) => entry.isIntersecting); }) : null;
    this.attach(container);
    this.r.domElement.className = 'viewer-canvas';
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.cam.position.set(0, 1.3, 5.6);
    this.cam.lookAt(0, 0.9, 0);
    this.scene.add(new THREE.HemisphereLight('#dfe8f5', '#3a3028', 1.1));
    const key = new THREE.DirectionalLight('#fff1dc', 2.4); key.position.set(2.5, 4, 3); key.castShadow = true; key.shadow.mapSize.set(this.coarse ? 512 : 1024, this.coarse ? 512 : 1024);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#7fd6cd', 1.6); rim.position.set(-3, 2.5, -3); this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.2, 48), new THREE.MeshStandardMaterial({ color: '#1c232c', roughness: 0.6, metalness: 0.3, transparent: true, opacity: 0.85 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.2, 64), new THREE.MeshBasicMaterial({ color: '#c3a775', transparent: true, opacity: 0.6 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.005; this.scene.add(ring);
    this.holder = new THREE.Group(); this.scene.add(this.holder);
    this.rot = 0.4; this.drag = null; this.t = 0; this.demoT = 3;
    const cvs = this.r.domElement;
    this.onDown = (e) => {
      if (this.drag !== null || e.isPrimary === false || e.button !== 0) return;
      this.drag = e.clientX; this.dragPointer = e.pointerId;
      try { cvs.setPointerCapture(e.pointerId); } catch { /* 元素刚被移走时无需捕获 */ }
    };
    this.onMove = (e) => { if (this.drag !== null && e.pointerId === this.dragPointer) { this.rot += (e.clientX - this.drag) * 0.01; this.drag = e.clientX; } };
    this.onUp = (e) => {
      if (e.pointerId !== this.dragPointer) return;
      this.drag = null; this.dragPointer = null;
      if (cvs.hasPointerCapture(e.pointerId)) cvs.releasePointerCapture(e.pointerId);
    };
    this.onBlur = () => {
      const id = this.dragPointer;
      this.drag = null; this.dragPointer = null;
      if (id != null && cvs.hasPointerCapture(id)) cvs.releasePointerCapture(id);
    };
    cvs.addEventListener('pointerdown', this.onDown); cvs.addEventListener('lostpointercapture', this.onUp);
    window.addEventListener('pointermove', this.onMove); window.addEventListener('pointerup', this.onUp); window.addEventListener('pointercancel', this.onUp); window.addEventListener('blur', this.onBlur);
    this.running = true;
    this.last = performance.now();
    const loop = () => { if (!this.running) return; this.raf = requestAnimationFrame(loop); this.frame(); };
    this.raf = requestAnimationFrame(loop);
  }

  attach(container) {
    this.onBlur?.();
    this.observer?.disconnect();
    this.el = container; this.visible = true;
    container.appendChild(this.r.domElement);
    this.observer?.observe(container);
    // 相同尺寸的新容器也要重新配置复用渲染器。
    this._h = null;
  }

  clearCharacter() {
    if (this.mocap) { this.mocap.mixer.stopAllAction(); this.mocap.mixer.uncacheRoot(this.mocap.body.model); }
    if (this.rig) disposeRig(this.rig, { sharedRoots: [this._sourceRig, this._sourceModel, ...(this.gripHands || []).map(hand=>hand.root)] });
    for(const hand of this.gripHands || []) hand.dispose();
    this.gripHands=[]; this.body=null;
    this.holder.clear();
    this.rig = null; this.mocap = null; this.anim = null; this.weapon = null; this._mountLater = null;
  }

  show(clsId, pose = null) {
    this.pose = pose;
    const cls = CLASSES[clsId];
    if (!cls) return;
    const look = { ...cls.look, ...(store.get('look.' + clsId, {})) };
    const rs = this.rigged?.get(clsId), glb = this.models?.get(clsId);
    const lookKey = JSON.stringify(look), clips = hasClips();
    // 预加载会在预览打开后填充 Map；同职业也必须在资源到达或换装后更新。
    if (this.clsId === clsId && this._sourceRig === rs && this._sourceModel === glb && this._lookKey === lookKey && this._clipsReady === clips) return;
    this.clearCharacter();
    this.clsId = clsId; this._sourceRig = rs; this._sourceModel = glb; this._lookKey = lookKey; this._clipsReady = clips;
    this.rig = buildCharacter(look);
    this.holder.add(this.rig.root);
    this.mocap = null;
    if (rs && clips && !look.proc) {
      try {
        const body = createMocapBody(rs);
        for (const p of this.rig.parts) p.visible = false;
        this.rig.root.add(body.model);
        this.rig.root.updateMatrixWorld(true);
        this._mountLater = body;
      } catch { this.mocap = null; }
    }
    if (!this._mountLater && glb && !look.proc) { try { applySkinnedModel(this.rig, glb, { key: `${clsId}|${look.sex}|${look.build || 1}` }); } catch { /* 用程序化造型 */ } }
    this.weapon = buildWeapon(cls.weapon, cls.weaponOpts || {});
    this.rig.bones.gripR.add(this.weapon.obj);
    const left = this.weapon.makeLeft ? this.weapon.makeLeft() : null;
    this.leftWeapon = left;
    if (left) this.rig.bones.gripL.add(left);
    if (this._mountLater) {
      const body = this._mountLater, tilt = weaponTilt(cls.weapon);
      mountMocapWeapon(body, 'Right', this.weapon.obj, tilt); mountMocapWeapon(body, 'Left', left, -tilt);
      this.gripHands=installGripHands(body,{Right:handSocket(body,'Right'),Left:handSocket(body,'Left')},cls.weapon);
      fitWorldGripHands(body,this.gripHands);
      this.body=body; this.mocap=new MocapAnimator(body,this.rig); this._mountLater=null;
    }
    if (this.weapon.setForm) this.weapon.setForm('sword', true);
    this.rig.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.anim = new Animator(this.rig);
    this.cls = cls;
    this.demo = null; this.demoT = 1.5;
  }

  frame() {
    const now = performance.now();
    // 手机菜单无需和战斗争抢 60fps；离屏或切到后台时停止 GPU 渲染。
    if (document.hidden || !this.visible || !this.el.isConnected) { this.last = now; return; }
    if (this.coarse && now - this.last < 1000 / 30) return;
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    const pixelRatio = Math.min(this.coarse ? 1.25 : 2, devicePixelRatio);
    if (this.r.domElement.width !== Math.floor(w * pixelRatio) || this._h !== h) {
      this.r.setPixelRatio(pixelRatio); this.r.setSize(w, h, false); this._h = h;
      this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
    }
    if (!this.rig) return;
    if (this._sourceRig !== this.rigged?.get(this.clsId) || this._sourceModel !== this.models?.get(this.clsId) || this._clipsReady !== hasClips()) this.show(this.clsId, this.pose);
    if (this.drag === null && !this.reducedMotion) this.rot += dt * 0.35;
    this.holder.rotation.y = this.rot;
    // 招式演示：每隔几秒挑一个技能播放
    this.demoT -= dt;
    if (!this.demo && this.demoT <= 0 && !this.pose && !this.reducedMotion) {
      const skills = Object.values(this.cls.skills || {}).filter((s) => CLIPS[s.anim]);
      const d = skills[Math.floor(Math.random() * skills.length)] || this.cls.chain?.[0];
      if (d) this.demo = { d, t: 0, key: Math.random() };
    }
    let action = null;
    if (this.demo) {
      const d = this.demo.d; this.demo.t += dt * 1000 * 0.8;
      const tt = this.demo.t;
      if (tt < d.wind) action = { clip: d.anim, stage: 'wind', t: tt / d.wind };
      else if (tt < d.wind + d.active) action = { clip: d.anim, stage: 'active', t: (tt - d.wind) / d.active };
      else if (tt < d.wind + d.active + d.recover + 300) action = { clip: d.anim, stage: 'recover', t: Math.min(1, (tt - d.wind - d.active) / d.recover) };
      else { this.demo = null; this.demoT = 3.5; }
    }
    this.t += dt;
    const react = this.pose === 'cheer' ? { type: 'cheer', t: this.t } : this.pose === 'down' ? { type: 'down', t: this.t } : null;
    const st = { speed: 0, onGround: true, stance: this.cls.stance, action: action ? { ...action, key: this.demo ? this.demo.key : 0 } : null, pitch: 0, react };
    this.anim.update(dt, st);
    if (this.mocap) this.mocap.update(dt, st);
    if (this.gripHands?.length) fitWorldGripHands(this.body,this.gripHands,this.weapon,this.leftWeapon);
    if (this.weapon.update) this.weapon.update(dt);
    this.r.render(this.scene, this.cam);
  }

  dispose() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf); this.observer?.disconnect(); this.onBlur();
    window.removeEventListener('pointermove', this.onMove); window.removeEventListener('pointerup', this.onUp); window.removeEventListener('pointercancel', this.onUp); window.removeEventListener('blur', this.onBlur);
    this.r.domElement.removeEventListener('pointerdown', this.onDown);
    this.r.domElement.removeEventListener('lostpointercapture', this.onUp);
    this.clearCharacter();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      for (const material of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) material.dispose();
      o.shadow?.dispose();
    });
    this.scene.clear(); this.r.renderLists.dispose();
    this.r.domElement.remove();
  }
}
