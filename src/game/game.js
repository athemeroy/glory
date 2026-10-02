// 游戏主控：渲染（主画面 + 第一人称手臂层 + 镜子）、固定步长模拟、玩家操控、打击反馈。
import * as THREE from 'three';
import { World } from './world.js';
import { Combat } from './combat.js';
import { SummonSystem, decorateSummoner } from './summons.js';
import { VFX, WeaponTrail } from './vfx.js';
import { Fighter } from './fighter.js';
import { visibleTo, shadowStep, sandBlinds, incomingFromFront } from './perception.js';
import { statusLabel } from './statuses.js';
import { applyGunRecoil, gunProfile } from './ballistics.js';
import { battleMageHit } from './battle-mage.js';
import { FPView, FP_LAYER, hideWorldArmsForFP, showWorldBodyForFP } from './fpview.js';
import { Brain } from './ai.js';
import { buildLevel } from './levels.js';
import { Post } from './post.js';
import { loadModel } from './skin.js';
import { loadClipLibrary, loadSwordPilotClips } from './mocap.js';
import { GLTFLoader } from '../../vendor/GLTFLoader.js';
import { input } from '../engine/input.js';
import { audio } from '../engine/audio.js';
import { voice } from '../engine/voice.js';
import { clamp, DEG, rand, store, wrapAngle } from '../engine/util.js';

const STEP = 1 / 60;

export const SETTINGS_DEFAULT = {
  sens: 1.0, fov: 95, invertY: false, shake: true, bob: true, quality: 'high', master: 0.8, sfx: 1.0, music: 0.6,
  dmgNumbers: true, showTrails: true, hudScale: 1, crosshair: true,
  aimAssist: false,
};

export class Game {
  constructor(canvas, hud) {
    this.canvas = canvas;
    this.hud = hud;
    this.settings = { ...SETTINGS_DEFAULT, ...(input.touchMode ? { quality: 'low' } : {}), ...store.get('settings', {}) };
    const hi = this.settings.quality === 'high';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: hi, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, hi ? 2 : 1.25));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.localClippingEnabled = true;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 700);
    this.camera.rotation.order = 'YXZ';
    this.camera.layers.set(0); // 主相机：不看本地玩家头部(1)，不看手臂层(2)
    this.vmCamera = new THREE.PerspectiveCamera(54, 16 / 9, 0.02, 20);
    this.vmCamera.layers.set(FP_LAYER);
    this.camera.add(this.vmCamera);
    this.scene.add(this.camera);
    this.world = new World();
    this.combat = new Combat(this);
    this.vfx = new VFX(this.scene);
    this.fighters = [];
    this.summons = new SummonSystem(this);
    this.trails = new Map();
    this.player = null;
    this.firstPerson = true;
    // 默认直接从角色眼睛看世界身体，镜子与屏幕共享同一套骨骼。fpbody=0 保留旧视图作对照。
    this.fpBody = new URLSearchParams(globalThis.location?.search || '').get('fpbody') !== '0';
    this.swordPilot = new URLSearchParams(globalThis.location?.search || '').get('swordpilot') === '1';
    this.timeScale = 1; this.hitstop = 0;
    this.shakeAmt = 0; this.shakeT = 0;
    this.acc = 0;
    this.time = 0;
    this.paused = true;
    this.isAttract = false;
    this._renderDirty = true; this._wasPaused = true;
    this.running = false;
    this.mode = null;
    this.lockTarget = null;
    this.texCache = new Map();
    this.loader = new THREE.TextureLoader();
    this.stepDist = 0;
    this.camOff = new THREE.Vector3();
    this.viewYaw = 0; this.viewPitch = 0;
    this.lastMouse = [0, 0];
    this.tmp = new THREE.Vector3();
    this.frames = 0; this.fpsT = 0; this.fps = 60;
    this.post = new Post(this.renderer, this.scene, this.camera, this.vmCamera, () => !!(this.player && this.firstPerson && (!this.fpBody && this.player.fp && this.player.fp.root.visible)), this.settings.quality);
    this.resize();
    this.setupGraphicsRecovery();
    window.addEventListener('resize', () => this.resize());
    this.applyAudioSettings();
  }

  applyAudioSettings() { audio.setVolume(this.settings.master, this.settings.sfx, this.settings.music); voice.setVolume(this.settings.master * (this.settings.voice ?? 1)); }
  setupGraphicsRecovery() {
    this.contextLost = false;
    this.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      if (this.contextLost) return;
      this.contextLost = true;
      this.acc = 0;
      input.clear();
      this.onGraphicsChange?.(true);
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      if (!this.contextLost) return;
      // Three.js 的恢复监听已先重建 GPU 状态；不把不可见期间的时间与输入补进战斗。
      this.contextLost = false;
      this.acc = 0;
      this.last = performance.now();
      input.clear();
      this.resize();
      this.onGraphicsChange?.(false);
    });
  }
  voice(name, gain = 1) { voice.play(name, gain); }
  saveSettings() { store.set('settings', this.settings); this.applyAudioSettings(); this.resize(); }

  degrade() {
    this.degraded = true;
    this.renderer.setPixelRatio(1);
    if (this.post && this.post.smaa) this.post.smaa.enabled = false;
    if (this.post) this.post.bloomBase *= 0.8;
    this.resize();
    this.hud.toast('帧率偏低，已自动切换为流畅画质');
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const quality = this.degraded ? 'low' : this.settings.quality;
    const pr = this.degraded ? 1 : Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1.25);
    if (this.renderer.getPixelRatio() !== pr) this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    if (this.post) { this.post.setQuality(quality); this.post.setSize(w, h); }
    // 镜面反射也是整幅相机画面，按画布像素而非固定纵向贴图分配。
    for (const mirror of this.level?.mirrors || []) {
      const pr = this.renderer.getPixelRatio(), cap = quality === 'high' ? 2048 : 1280;
      const scale = Math.min(1, cap / Math.max(w * pr, h * pr));
      mirror.getRenderTarget().setSize(Math.max(1, Math.floor(w * pr * scale)), Math.max(1, Math.floor(h * pr * scale)));
    }
    this.aspect = w / h;
    this.updateFov();
    this.vfx.setScale(h * this.renderer.getPixelRatio());
    this._renderDirty = true;
  }
  updateFov(zoom = 1) {
    // 越肩/第三人称用更窄的视野（约 80°），角色不至于太小
    const hf = this.settings.fov * DEG * zoom * (this.firstPerson || !this.player ? 1 : 0.84);
    const vf = 2 * Math.atan(Math.tan(hf / 2) / this.aspect) / DEG;
    this.camera.fov = vf; this.camera.aspect = this.aspect; this.camera.updateProjectionMatrix();
    // 宽屏固定竖直视野；窄屏保留至少62°水平取景，双手与重武器不会挤出画面。
    // 不随世界 FOV/瞄准缩放，保持武器大小稳定。
    this.vmCamera.fov = Math.max(60, 2 * Math.atan(Math.tan(31 * DEG) / this.aspect) / DEG);
    this.vmCamera.aspect = this.aspect; this.vmCamera.updateProjectionMatrix();
    this._renderDirty = true;
  }

  // 关卡构建前预加载平铺贴图（关卡会用它们烘焙环境光与画布纹理）
  preload() {
    if (this._preload) return this._preload;
    const names = ['stone', 'wood', 'iron', 'cloth', 'leather', 'bronze'];
    this.models ||= new Map();
    this.loadDone = 0; this.loadTotal = 6;
    this.loadProgress = 0; this.loadStage = '准备贴图和动作';
    let listKnown = false, animationFailed = false, assetFailed = false;
    const progress = () => {
      const value = listKnown ? .1 + .8 * this.loadDone / this.loadTotal : .1 * this.loadDone / names.length;
      this.loadProgress = Math.max(this.loadProgress, value);
    };
    const tex = Promise.all(names.map((n) => {
      if (this.texCache.has(n)) { this.loadDone++; progress(); return Promise.resolve(); }
      return this.loader.loadAsync(`assets/tex/${n}.jpg`).then((t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
        this.texCache.set(n, t); this.loadDone++; progress();
      }).catch(() => { this.loadDone++; progress(); });
    }));
    // 动捕绑定模型（Tripo + Meshy）优先；没有绑定模型的角色才加载旧的静态精模
    this.rigged ||= new Map();
    const q = new URLSearchParams(location.search);
    const noRig = this.settings.mocap === false || q.get('mocap') === '0';
    const noModels = this.settings.models === false || q.get('models') === '0';
    const getList = (u) => fetch(u).then((r) => {
      if (!r.ok) throw new Error('Model manifest unavailable');
      return r.json();
    }).then((list) => {
      if (!Array.isArray(list)) throw new Error('Invalid model manifest');
      return [...new Set(list.filter(k => typeof k === 'string' && /^[a-z][a-z0-9_-]*$/.test(k)))];
    }).catch(() => { assetFailed = true; return []; });
    const rigList = noRig || noModels ? Promise.resolve([]) : getList('assets/models/rigged/manifest.json');
    const oldList = noModels ? Promise.resolve([]) : getList('assets/models/manifest.json');
    const rigged = (noRig || noModels ? Promise.resolve([]) : loadClipLibrary().then(async (lib) => {
      if (lib && this.swordPilot) await loadSwordPilotClips();
      animationFailed = !lib;
      return lib ? rigList : [];
    }))
      .then((list) => {
        this.loadTotal += list.length; listKnown = true; this.loadStage = list.length ? '加载角色' : '准备场景'; progress();
        return Promise.all(list.map((k) => {
          if (this.rigged.has(k)) { this.loadDone++; progress(); return Promise.resolve(); }
          const originalURL = `assets/models/rigged/${k}.glb`;
          const modelURL = this.swordPilot && k === 'swordmaster' ? 'assets/models/pilot/swordmaster.glb' : q.get('modelset') === 'original' ? originalURL : `assets/models/optimized/${k}.glb`;
          const loader = new GLTFLoader();
          return loader.loadAsync(modelURL).catch(error => {
            if (modelURL !== originalURL) return loader.loadAsync(originalURL);
            throw error;
          }).then((g) => {
            g.scene.userData.gloryClass = k; this.rigged.set(k, g.scene); this.loadDone++; progress();
          }).catch(() => { assetFailed = true; this.loadDone++; progress(); });
        }));
      });
    const models = noModels ? Promise.resolve() : rigged.then(() => oldList)
      .then((list) => {
        list = list.filter((k) => !this.rigged.has(k)); this.loadTotal += list.length;
        if (list.length) this.loadStage = '补全角色'; progress();
        return Promise.all(list.map((k) => {
          if (this.models.has(k)) { this.loadDone++; progress(); return Promise.resolve(); }
          return loadModel(`assets/models/${k}.glb`).then((sc) => {
            if (sc) this.models.set(k, sc); else assetFailed = true;
            this.loadDone++; progress();
          });
        }));
      });
    this._preload = Promise.all([tex, models, rigged]).then(() => {
      this.loadProgress = 1; this.loadStage = '准备场景';
      // 失败时仍可使用备用模型开局；下一次显式启动才重试失败资源。
      if (animationFailed || assetFailed) this._preload = null;
    }).catch(error => { this._preload = null; this.loadStage = '加载失败'; throw error; });
    return this._preload;
  }

  tex(name) {
    if (this.texCache.has(name)) return this.texCache.get(name);
    const t = this.loader.load(`assets/tex/${name}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    this.texCache.set(name, t);
    return t;
  }

  // ---- 关卡 ----
  loadLevel(id) {
    this.unloadLevel();
    const level = buildLevel(id, { THREE, renderer: this.renderer, tex: (n) => this.tex(n), quality: this.settings.quality, noEnv: new URLSearchParams(location.search).get('noenv') === '1' });
    this.level = level;
    this.resize();
    this.scene.add(level.group);
    this.scene.background = level.background || new THREE.Color('#8fa3b8');
    this.scene.fog = level.fog || null;
    this.world.setLevel(level);
    // 灯光对所有图层生效（手臂层、镜中头部）
    level.group.traverse((o) => { if (o.isLight) { o.layers.enable(1); o.layers.enable(FP_LAYER); } if (o.isMesh && o.receiveShadow === undefined) o.receiveShadow = true; });
    if (level.sun) {
      level.sun.shadow.camera.layers.enable(1);
      this.sunOffset = level.sun.position.clone().sub(level.sun.target.position);
    }
    for (const m of level.mirrors || []) m.reflectLayers = (1 << 0) | (1 << 1);
    this._renderDirty = true;
    return level;
  }
  unloadLevel() {
    this.summons?.clear();
    if (!this.level) return;
    this.level.group.removeFromParent();
    if (this.level.dispose) this.level.dispose();
    this.level = null;
  }

  // ---- 角色 ----
  spawn(opts) {
    const f = new Fighter(this, opts);
    decorateSummoner(f);
    this.fighters.push(f);
    if (opts.isPlayer) this.setPlayer(f);
    if (opts.ai) { f.ai = new Brain(f, opts.ai); }
    const accent = f.cls.look?.accent || '#e8f4ff';
    if (f.weapon.tip && f.weapon.base) this.trails.set(f, new WeaponTrail(this.scene, opts.trailColor || accent, 14, 0));
    this._renderDirty = true;
    return f;
  }
  removeFighter(f) {
    this.summons.removeOwner(f);
    if (this.lockTarget === f) this.lockTarget = null;
    if (this.spectate === f) this.spectate = null;
    const i = this.fighters.indexOf(f);
    if (i >= 0) this.fighters.splice(i, 1);
    const tr = this.trails.get(f); if (tr) { tr.dispose(); this.trails.delete(f); }
    if (f === this.player) { if (this.fpTrail) { this.fpTrail.dispose(); this.fpTrail = null; } }
    f.dispose();
    this._renderDirty = true;
  }
  clearFighters() {
    this.summons.clear();
    for (const f of [...this.fighters]) this.removeFighter(f);
    this.player = null;
    this.combat.clear();
    this.vfx.clear();
  }

  setPlayer(f) {
    this.player = f;
    this.shotHeat = this.shotRoll = 0;
    f.isPlayer = true;
    f.fp = new FPView(f.lookData || f.cls.look, f.cls.weapon, f.cls.weaponOpts || {}, f.fpGlb || null, f.modelKey + (f.mocap ? ':rig' : ''));
    if (f.form) { f.fp.setForm(f.form); f.fp.weapon.setForm?.(f.form, true); }
    this.camera.add(f.fp.root);
    this.fpTrail = new WeaponTrail(this.camera, f.cls.look?.accent || '#dff4ff', 12, FP_LAYER);
    this.viewYaw = f.yaw; this.viewPitch = 0;
    this.applyView();
  }
  rebuildPlayerLook(look) {
    const f = this.player; if (!f) return;
    f.rebuildLook(look);
    if (f.fp) f.fp.dispose();
    f.fp = new FPView(look, f.cls.weapon, f.cls.weaponOpts || {}, f.fpGlb || null, f.modelKey + (f.mocap ? ':rig' : ''));
    if (f.form) { f.fp.setForm(f.form); f.fp.weapon.setForm?.(f.form, true); }
    this.camera.add(f.fp.root);
    this.applyView();
  }
  applyView() {
    const f = this.player; if (!f) return;
    f.setFirstPerson(this.firstPerson);
    // 精模身体：主相机第一人称时裁掉胸口以上（避免领口贴脸穿插），镜子与他人视角不受影响
    const bodies = f.rig.mocapBodyMeshes || (f.usesModel && f.rig.skinned?.body ? [f.rig.skinned.body] : []);
    for (const body of bodies) {
      const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e5);
      for (const material of [].concat(body.material)) material.clippingPlanes = [plane];
      const game = this;
      body.onBeforeRender = (r, sc, cam) => {
        plane.constant = game.firstPerson && cam === game.camera ? f.pos.y + 1.36 * f.scale : 1e5;
      };
    }
    this.vmCamera.position.set(0, 0, 0); this.vmCamera.rotation.set(0, 0, 0);
    if (this.fpBody) showWorldBodyForFP(f.rig, f.weapon.obj, f.leftWeapon);
    else hideWorldArmsForFP(f.rig, f.weapon.obj, f.leftWeapon, this.firstPerson);
    f.fp.root.visible = this.firstPerson && !this.fpBody;
    this._renderDirty = true;
  }
  get viewMode() { return this._viewMode || (this.firstPerson ? 'fp' : 'ots'); }
  setViewMode(m) {
    this._viewMode = m; this.firstPerson = m === 'fp';
    store.set('viewMode', m);
    this.applyView();
    if (this.hud) this.hud.toast({ fp: '第一人称', ots: '越肩视角', tp: '第三人称' }[m]);
  }
  toggleView() { const order = ['fp', 'ots', 'tp']; this.setViewMode(order[(order.indexOf(this.viewMode) + 1) % 3]); }

  // ---- 事件 ----
  sfx(name, pos, vol = 1, rate = 1) { audio.play(name, pos ? { pos: [pos.x, pos.y, pos.z], vol, rate } : { vol, rate }); }

  // 大招等强效果：全屏柔光闪一下（DOM 叠层，不影响输入）
  flashScreen(color = '#ffffff', alpha = 0.35) {
    if (typeof document === 'undefined') return;
    let el = this._flashEl;
    if (!el) {
      el = this._flashEl = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;opacity:0;transition:opacity .5s ease-out';
      document.body.appendChild(el);
    }
    el.style.background = `radial-gradient(ellipse at center, transparent 35%, ${color} 130%)`;
    el.style.transition = 'none'; el.style.opacity = String(alpha);
    requestAnimationFrame(() => { el.style.transition = 'opacity .55s ease-out'; el.style.opacity = '0'; });
  }

  shake(pos, amt) {
    if (!this.settings.shake || !this.player) return;
    const d = pos ? pos.distanceTo(this.player.pos) : 0;
    const a = amt * Math.max(0, 1 - d / 18);
    this.shakeAmt = Math.max(this.shakeAmt, a);
  }

  onFighterEvent(f, type, data) {
    const pos = f.center(new THREE.Vector3());
    const isP = f === this.player;
    const skillVisual = ['action', 'active', 'swing', 'slam', 'buff', 'form'].includes(type) && this.vfx.skillEvent?.(f, type, data) === true;
    switch (type) {
      case 'action': {
        const d = data.def;
        if (d.ult) {
          this.hud.announce(`${f.name}「${d.name}」`, f.team === this.player?.team ? 'ally' : 'enemy'); this.sfx('magic_cast', pos, 1.2);
          const dist = this.player ? f.pos.distanceTo(this.player.pos) : 0;
          voice.ult(d.name, isP ? 1 : Math.max(0.25, 0.9 - dist / 40));
          if (!skillVisual) this.vfx.ultAura(f.pos, f.cls.look?.accent || '#ffd27a');
        }
        const accA = f.cls.look?.accent || '#e8f4ff';
        f._vfxPower = d.ult ? 2.2 : data.slot === 'atk' ? 1 : 1.6;
        if (data.slot !== 'atk' || d.ult) {
          const tp = new THREE.Vector3(); if (f.weapon?.tip) f.weapon.tip.getWorldPosition(tp); else tp.copy(pos);
          if (!skillVisual) this.vfx.charge(tp, accA, d.ult ? 44 : 24, d.ult ? 1.7 : 1.0, Math.max(0.18, (d.wind || 200) / 1000 * 0.9));
          if (isP) { this.post?.pulse(d.ult ? 0.9 : 0.35); }
        }
        if (d.ult && !skillVisual) this.flashScreen(accA, 0.4);
        if (d.tele) this.spawnTelegraph(f, d);
        if (isP && data.slot !== 'atk') this.hud.skillFlash(data.slot);
        break;
      }
      case 'nostamina': if (isP) this.hud.toast('体力不足，稍停片刻恢复'); break;
      case 'statusblocked': if (isP && this.time >= (f.statusNoticeAt || 0)) { f.statusNoticeAt = this.time + .7; this.hud.toast(data.type === 'silence' ? '技能已被封印，仍可普攻' : '受到控制，暂时无法出招'); } break;
      case 'active': {
        const d = data.def;
        if (d.sfx && !d.proj) this.sfx(d.sfx, pos, 1, rand(0.95, 1.05));
        const acc = f.cls.look?.accent || '#e8f4ff';
        if (skillVisual) { /* 职业技能效果已绘制 */ }
        else if (d.vfx === 'ult_dragon') this.vfx.dragon(f, acc);
        else if (d.vfx === 'ult_blades') this.vfx.blades(f, acc);
        else if (d.vfx === 'ult_fists') { this.vfx.shock(f.center(new THREE.Vector3()).addScaledVector(f.forward(), 1.2), f.yaw, acc); }
        else if (d.vfx && !d.slamOnLand && d.hits) this.vfx.slash(f, d.vfx, acc, (d.hits[0]?.range || 2.4) * 0.9, f._vfxPower || 1);
        if (isP && (f._vfxPower || 1) > 1.2) { this.fovPunch = Math.min(this.fovPunch || 0, -0.035 * (f._vfxPower - 1)); this.post?.pulse(0.5); this.shake(f.pos, 0.18 * f._vfxPower); }
        break;
      }
      case 'swing': {
        const d = data.def; const acc = f.cls.look?.accent || '#e8f4ff';
        this.sfx(d.sfx || 'swing_light', pos, 0.8);
        if (skillVisual) { /* 每段只绘制一次 */ }
        else if (d.vfx === 'ult_blades') this.vfx.blades(f, acc);
        else if (d.vfx === 'ult_fists') { this.vfx.shock(f.center(new THREE.Vector3()).addScaledVector(f.forward(), 1.2), f.yaw, acc); this.vfx.sprite(f.center(new THREE.Vector3()).addScaledVector(f.forward(), 1.1), acc, 0.6, 0.1, 2); }
        else if (d.vfx && d.hits) this.vfx.slash(f, data.i % 2 ? 'slashL' : 'slashR', acc, (d.hits[0]?.range || 2.4) * 0.9, f._vfxPower || 1);
        break;
      }
      case 'slam': if (!skillVisual) { this.vfx.ring(f.pos, (data.def.hits?.[0]?.range || 3), f.cls.look?.accent || '#ffffff', 0.4); this.vfx.dust(f.pos, 24); } this.sfx('boss_slam', f.pos); this.shake(f.pos, 0.6); break;
      case 'jump': this.sfx('jump', f.pos, 0.6); break;
      case 'fullcharge': this.sfx('parry', pos, 0.6, 1.4); this.vfx.sprite(f.center(new THREE.Vector3()), '#ffc040', 1.2, 0.2, 2); break;
      case 'land': this.sfx('land', f.pos, 0.7); this.vfx.dust(f.pos, 6); if (isP) this.camDip = Math.min(0.12, (data.impact || 6) * 0.012); break;
      case 'dash': this.sfx('dash', pos, 0.8); this.vfx.dust(f.pos, 8); break;
      case 'knockdown': this.sfx('knockdown', f.pos); this.vfx.dust(f.pos, 14); if (isP) this.shake(f.pos, 0.35); break;
      case 'tech': this.sfx('tech', pos); this.hud.floatText(pos, '受身', 'tech'); break;
      case 'getup': this.sfx('getup', pos, 0.6); break;
      case 'protect': this.hud.floatText(pos, '保护', 'armor'); break;
      case 'heal': this.hud.floatText(pos, '+' + data.amount, 'heal'); break;
      case 'absorb': if (Math.random() < 0.5) this.hud.floatText(pos, '吸收', 'blocked'); break;
      case 'buff': this.sfx('magic_cast', pos, 0.8); if (!skillVisual) this.vfx.ring(f.pos, 1.6, data.def.buffColor || '#ff5a4a', 0.5); break;
      case 'cleanse': this.hud.floatText(pos, '净化', 'tech'); break;
      case 'form': if (!data.silent) { this.sfx('form_switch', pos, 0.9); if (data.form === 'shield') this.sfx('umbrella_open', pos, 0.7); } if (isP) this.hud.setForm(data.form); break;
      case 'parry': this.sfx('parry', pos, 1.2); this.vfx.parrySpark(pos.clone().add(f.forward().multiplyScalar(0.6))); this.hud.floatText(pos, data.zhen ? '振刀！' : '完美格挡', 'parry'); if (data.zhen) { this.shake(pos, 0.5); this.post && this.post.kick(0, 0.015); } this.hitstop = Math.max(this.hitstop, 0.12); break;
      case 'block': this.sfx('block', pos); this.vfx.blockSpark(pos.clone().add(f.forward().multiplyScalar(0.5))); break;
      case 'guardbreak': this.sfx('guard_break', pos); this.hud.floatText(pos, '破防', 'crit'); break;
      case 'armor': this.hud.floatText(pos, '霸体', 'armor'); break;
      case 'interrupted': if (data.why === 'parried') this.hud.floatText(pos, '被弹开', 'enemy'); break;
      case 'nomana': if (isP) { this.sfx('no_mana', null, 0.6); this.hud.toast('法力不足'); } break;
      case 'cooldown': if (isP) this.hud.toast('技能冷却中'); break;
      case 'comboEnd': if (isP && data.n >= 5) this.hud.comboEnd(data.n); break;
      case 'damage': {
        if (this.settings.dmgNumbers) {
          const src = data.src;
          const cls = data.blocked ? 'blocked' : f === this.player ? 'taken' : (src === this.player ? (data.crit ? 'crit' : 'dealt') : 'other');
          if (cls !== 'other' || Math.random() < 0.6) this.hud.damageNumber(pos, data.dmg, cls);
        }
        if (isP) { this.hud.hurt(data.src ? data.src.pos : null, data.dmg / f.maxHp); if (!data.blocked) this.post.kick(Math.min(0.9, 0.25 + data.dmg / f.maxHp * 5), Math.min(0.02, 0.004 + data.dmg / f.maxHp * 0.1)); }
        if (data.src === this.player && !data.blocked) this.hud.combo(this.player.comboDealt, data.dmg);
        break;
      }
      case 'death': {
        this.summons.removeOwner(f);
        this.sfx('knockdown', pos, 1.2);
        if (f.kind === 'hero' || f.kind === 'boss') this.slowMo(f.kind === 'boss' ? 1.6 : 1.0);
        if (this.mode && this.mode.onDeath) this.mode.onDeath(f, data.src);
        break;
      }
    }
  }

  startCinematic(targets, dur = 2.6) {
    if (this.manual) return;
    const p = this.player;
    this.cinematic = { t: 0, dur, targets, a0: p ? p.yaw + Math.PI * 0.75 : 0 };
  }

  slowMo(sec) {
    if (this.netGuest || this.manual) return;
    this.timeScale = 0.25; this.post && this.post.kick(0, 0.012);
    clearTimeout(this._smT); this._smT = setTimeout(() => { this.timeScale = this._baseScale || 1; }, sec * 1000);
  }

  spawnTelegraph(f, d) {
    const t = d.tele;
    const dur = (d.wind + (t.extra || 0)) / 1000;
    if (t.type === 'cone') this.vfx.coneTelegraph(f.pos, f.yaw, t.radius, t.arc, dur);
    else if (t.type === 'circle') {
      const p = t.at === 'target' && f.leapTarget ? f.leapTarget : f.pos;
      this.vfx.telegraph(p, t.radius, dur + (t.at === 'target' ? (d.active / 1000) : 0));
    }
    this.sfx('boss_warn', f.pos, 1);
  }

  onHit(att, t, res, hit, def, ranged = false, at = null) {
    // 客机重放 onHit 只做反馈；职业资源完全服从主机快照。
    if (!this.netGuest) battleMageHit(att, t, res, hit, def, ranged);
    if (res === 'hit' || res === 'armor') att.shadowVictim = t;
    const p = at ? at.clone() : t.center(new THREE.Vector3());
    if (!at) { p.x += (att.pos.x - t.pos.x) * 0.25; p.z += (att.pos.z - t.pos.z) * 0.25; p.y += 0.2; }
    const color = att.cls.look?.accent || '#ffe0a0';
    const heavy = (hit.dmg || 0) >= 130 || hit.launch || hit.down;
    if (res === 'hit' || res === 'armor') {
      this.vfx.hitSpark(p, res === 'armor' ? '#ffd27a' : color, heavy);
      if (att === this.player || t === this.player) this.post?.pulse(heavy ? 0.45 : 0.18);
      const snd = t.kind === 'mob' || t.kind === 'boss' ? (t.cls.metal ? 'hit_metal' : 'mob_hit') : heavy ? 'hit_heavy' : 'hit_flesh';
      this.sfx(snd, p, heavy ? 1.1 : 0.9);
      if (hit.launch && res === 'hit') this.sfx('launch', p, 0.7);
      if (att === this.player || t === this.player) {
        this.hitstop = Math.max(this.hitstop, heavy ? 0.075 : 0.035);
        if (att === this.player) this.fovPunch = Math.max(this.fovPunch || 0, heavy ? 0.035 : 0.012);
        this.shake(p, heavy ? 0.35 : 0.15);
        if (att === this.player) this.hud.hitmarker(heavy);
      }
    }
    if (att === this.player && !ranged && att.fp) att.fp.kick = -0.02;
    // 散人被动“百家”：连续用不同形态的技能命中叠层
    if (att.cls.forms && def && def.form && (res === 'hit' || res === 'armor')) {
      if (att.lastForm !== def.form) { att.stacks = Math.min(3, (att.stacks || 0) + 1); att.lastForm = def.form; if (att === this.player) this.hud.toast(`百家 ×${att.stacks}`); }
      att.stackT = 5000;
    }
    // 附加状态
    const statuses = [...(hit.effects || []), ...(hit.effect ? [hit.effect] : [])];
    if ((res === 'hit' || res === 'armor') && t.alive) for (const status of statuses) {
      if (status.type === 'blind' && hit.eyeOnlyBlind && !sandBlinds(att, t, hit, this.world)) continue;
      if (hit.headOnlyStatus && hit.contact?.region !== 'head') continue;
      if (hit.frontOnlyStatus && !incomingFromFront(att, t, hit)) continue;
      const e = { ...status, src: att, debuff: true };
      if (att.clsId === 'witch') e.t *= 1.2;
      if (!t.addEffect(e)) continue;
      this.vfx.statusTarget?.(t, e);
      if (t === this.player && e.type === 'blind') this.lockTarget = null;
      this.hud.floatText(t.center(new THREE.Vector3()).setY(t.pos.y + t.height + .15), statusLabel(e), 'enemy');
    }
    if (this.mode && this.mode.onHit) this.mode.onHit(att, t, res, hit, def);
  }
  onWhiff(att, def) { /* 挥空 */ }
  onFire(att, p, def, visual, dir) {
    const gun = gunProfile(att, p, def);
    const kick = applyGunRecoil(this, att, p, def, dir, { physics: false });
    if (gun && !kick) return;
    this.mode?.onFire?.(att, p, def, visual, dir);
    this.sfx(def.sfx || 'gun_shot', visual, p.kind === 'shell' ? 1.1 : 0.85, rand(0.95, 1.05));
    if (gun) {
      const heavy = p.kind === 'shell' || p.kind === 'beam';
      this.vfx.sprite(visual.clone().addScaledVector(dir, 0.08), p.kind === 'beam' ? '#c2edf1' : '#ffe3a1', heavy ? 0.48 : 0.22, 0.045, 1.1);
      if (att === this.player) this.shake(null, heavy ? 0.13 : 0.025);
    }
  }

  // ---- 主循环 ----
  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const now = performance.now();
      let dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
    };
    requestAnimationFrame(loop);
  }

  frame(dt) {
    // 菜单不需要空场景后处理；后台页与手机背景对战也不消耗模拟和 GPU。
    if (this.contextLost || document.hidden || (this.isAttract && input.touchMode)) { this._renderDirty = true; return; }
    if (!this.level) return;
    const pauseChanged = this.paused !== this._wasPaused; this._wasPaused = this.paused;
    if (this.paused) {
      // 保留暂停瞬间的画面，只有机位、画质或窗口改变后才重画。
      if (pauseChanged || this._renderDirty) {
        this.updateCamera(dt); this.render(dt);
        if (this.hud) this.hud.update(0, this);
      }
      return;
    }
    this.fpsT += dt; this.frames++;
    if (this.fpsT >= 1) {
      this.fps = this.frames / this.fpsT; this.frames = 0; this.fpsT = 0;
      // 自动画质：对局中连续 4 秒低于 40 帧则降档
      if (this.level && !this.paused && !this.manual && !this.renderSkip && this.settings.autoQuality !== false) {
        this.lowFpsSec = this.fps < 40 ? (this.lowFpsSec || 0) + 1 : 0;
        if (this.lowFpsSec >= 4 && !this.degraded) this.degrade();
      }
    }
    if (!this.paused && this.level && !this.manual) {
      this.handleLook(dt);
      // 顿帧
      let sdt = dt;
      if (this.hitstop > 0) { this.hitstop -= dt; sdt = dt * 0.08; }
      sdt *= this.timeScale;
      this.acc += sdt;
      let n = 0;
      const maxSteps = this.maxSteps || 5;
      while (this.acc >= STEP && n < maxSteps) { this.tick(STEP); this.acc -= STEP; n++; }
      if (n === maxSteps) this.acc = 0;
      this.vfx.update(sdt);
      if (this.level.update) this.level.update(dt, this.time);
      this.updateTrails(dt);
      if (this.mode && this.mode.frame) this.mode.frame(dt);
    }
    this.updateCamera(dt);
    if (!this.renderSkip || (this._rf = (this._rf || 0) + 1) % this.renderSkip === 0) this.render(dt);
    if (this.hud && this.level) this.hud.update(dt, this);
  }

  // 调试：手动推进模拟（测试用，manual 模式下实时循环不推进模拟）
  debugAdvance(sec) {
    if (this.contextLost) return;
    const n = Math.max(1, Math.round(sec * 60));
    for (let i = 0; i < n; i++) { this.tick(STEP); this.vfx.update(STEP); this.updateTrails(STEP); if (this.mode && this.mode.frame) this.mode.frame(STEP); }
    this.updateCamera(STEP);
    this.render();
    if (this.hud) this.hud.update(STEP, this);
  }

  handleLook(dt) {
    const p = this.player;
    let [mx, my] = input.takeMouse();
    const [kx, ky] = input.keyLook();
    mx += kx * 900 * dt; my += ky * 600 * dt;
    this.lastMouse = [mx, my];
    if (!p) return;
    const s = 0.0022 * this.settings.sens * (p.aiming ? 0.55 : 1);
    this.viewYaw -= mx * s;
    this.viewPitch -= my * s * (this.settings.invertY ? -1 : 1);
    this.viewPitch = clamp(this.viewPitch, -85 * DEG, 85 * DEG);
    // 默认只观察目标血条；练习辅助需主动开启，命中仍取实际瞄准方向。
    if (this.lockTarget) {
      const t = this.lockTarget;
      if (!t.alive || !visibleTo(p, t, this.world)) this.lockTarget = null;
      else if (this.settings.aimAssist) {
        const want = Math.atan2(t.pos.x - p.pos.x, t.pos.z - p.pos.z);
        const k = 1 - Math.exp(-7 * dt);
        this.viewYaw += wrapAngle(want - this.viewYaw) * k;
        const dy = (t.pos.y + 1.2) - (p.pos.y + 1.6);
        const want2 = Math.atan2(dy, Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z));
        this.viewPitch += (want2 - this.viewPitch) * k * 0.5;
      }
    }
  }

  tick(dt) {
    this.time += dt;
    const p = this.player;
    if (this.netGuest) { if (this.mode && this.mode.tick) this.mode.tick(dt); return; }
    if (this.mode && this.mode.preTick) this.mode.preTick(dt);
    if (p && !this.inputFrozen && !this.autoPlayer) this.playerControl(p, dt);
    if (p && this.autoPlayer) { this.viewYaw = p.yaw; this.viewPitch = p.pitch * 0.5; const cp = Math.cos(p.pitch); p.aimDir.set(Math.sin(p.yaw) * cp, Math.sin(p.pitch), Math.cos(p.yaw) * cp); }
    for (const f of this.fighters) if (f.ai && !this.aiFrozen && !(f === p && !this.autoPlayer)) f.ai.update(dt);
    for (const f of this.fighters) f.update(dt);
    this.separate();
    this.summons.tick(dt);
    this.combat.updateMelee?.(dt);
    this.updateShadowSteps(dt);
    this.combat.updateProjectiles(dt);
    this.combat.updateAoes(dt);
    if (this.mode && this.mode.tick) this.mode.tick(dt);
    // 脚步声
    for (const f of this.fighters) {
      if (!f.onGround || f.dead) continue;
      const sp = Math.hypot(f.vel.x, f.vel.z);
      if (sp < 1) continue;
      f.footT += sp * dt;
      if (f.footT > 1.6) { f.footT = 0; this.sfx('footstep', f.pos, f === p ? 0.35 : 0.8); }
    }
  }

  updateShadowSteps(dt) {
    for (const attacker of this.fighters) {
      const victim = attacker.shadowVictim;
      if (victim && shadowStep(attacker, victim, this.world)) {
        attacker.shadowTime = (attacker.shadowTime || 0) + dt;
        attacker.stats.shadowSeconds = (attacker.stats.shadowSeconds || 0) + dt;
        if (attacker === this.player && attacker.shadowTime > .45) this.mode?.goal?.('shadow');
      } else attacker.shadowTime = 0;
    }
  }

  playerControl(p, dt) {
    p.yaw = this.viewYaw;
    p.pitch = this.viewPitch;
    const cp = Math.cos(p.pitch);
    p.aimDir.set(Math.sin(p.yaw) * cp, Math.sin(p.pitch), Math.cos(p.yaw) * cp).normalize();
    const [mx, my] = input.moveAxes();
    p.moveInput.set(mx, my);
    p.wantGuard = input.held('special');
    if (p.cls.special?.type === 'chaser') { p.wantGuard = false; if (input.consume('special', 180)) p.wantChaser = true; }
    p.wantSprint = input.held('sprint');
    p.jumpHeld = input.held('jump');
    if (input.consume('jump', 150)) {
      if (p.state === 'air' || p.state === 'down') p.requestTech();
      else p.wantJump = true;
    }
    if (input.consume('dash', 120)) p.wantDash = true;
    if (p.cls.forms) {
      const forms = ['sword', 'spear', 'gun', 'shield'];
      for (let i = 0; i < 4; i++) if (input.consume('form' + (i + 1), 150) && !p.action && p.canAct()) p.setForm(forms[i]);
    }
    // 近战：按住左键，当前普攻收招后进入蓄力；松开即出手
    const held = input.held('attack');
    if (p.action && p.action.slot === 'charge') p.charging = held;
    if (input.consume('attack', 180)) { p.tryUse('atk'); this.atkHeldT = 0; }
    if (held) this.atkHeldT = (this.atkHeldT || 0) + dt; else this.atkHeldT = 0;
    if (held && this.atkHeldT > 0.28 && p.chain && !p.chain[0].proj && (!p.action || (p.action.slot === 'atk' && p.action.stage === 'recover'))) {
      if (p.action) { p.action = null; p.state = 'idle'; }
      p.startCharge();
    }
    else if (input.held('attack') && !p.action && (p.state === 'idle' || p.state === 'move' || p.state === 'jump') && p.chain && p.chain[0].proj) p.tryUse('atk'); // 远程空中也可持射，支持飞枪/飛炮
    for (const s of ['s1', 's2', 's3', 's4', 's5', 's6', 'ult']) if (input.consume(s, 200)) p.tryUse(s);
    if (input.consume('lockon', 200)) this.toggleLock();
  }

  toggleLock() {
    if (this.lockTarget) { this.lockTarget = null; this.hud.toast('取消观察'); return; }
    const p = this.player; if (!p || p.hasEffect('blind')) return;
    let best = null, bs = 1e9;
    for (const f of this.fighters) {
      if (f.team === p.team || !f.alive || !visibleTo(p, f, this.world)) continue;
      const dx = f.pos.x - p.pos.x, dz = f.pos.z - p.pos.z;
      const a = Math.abs(wrapAngle(Math.atan2(dx, dz) - this.viewYaw));
      const s = a * 10 + Math.hypot(dx, dz);
      if (a < 70 * DEG && s < bs) { bs = s; best = f; }
    }
    this.lockTarget = best;
    if (best) this.hud.toast(`观察：${best.name}`);
  }

  // 角色之间的推挤
  separate() {
    const fs = this.fighters;
    for (let i = 0; i < fs.length; i++) {
      const a = fs[i]; if (a.dead || a.state === 'down') continue;
      for (let j = i + 1; j < fs.length; j++) {
        const b = fs[j]; if (b.dead || b.state === 'down') continue;
        if (a.pos.y + a.collisionHeight <= b.pos.y || b.pos.y + b.collisionHeight <= a.pos.y) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz), min = a.radius + b.radius;
        if (d >= min) continue;
        const push = (min - d);
        const wa = a.kind === 'boss' || a.kind === 'dummy' ? 0 : b.kind === 'boss' || b.kind === 'dummy' ? 1 : 0.5;
        const nx = d > 1e-5 ? dx / d : (a.id < b.id ? 1 : -1), nz = d > 1e-5 ? dz / d : 0;
        a.pos.x -= nx * push * wa; a.pos.z -= nz * push * wa;
        b.pos.x += nx * push * (1 - wa); b.pos.z += nz * push * (1 - wa);
        for (const f of [a, b]) { const r = this.world.resolve(f, f.pos.x, f.pos.y, f.pos.z); f.pos.set(r.x, r.y, r.z); }
      }
    }
  }

  updateTrails(dt) {
    if (!this.settings.showTrails) return;
    for (const [f, tr] of this.trails) {
      const a = f.action;
      const emitting = !!a && a.stage === 'active' && !!a.def.hits && !(f === this.player && this.firstPerson && !this.fpBody);
      tr.update(dt, f.weapon.base, f.weapon.tip, emitting);
    }
    const p = this.player;
    if (p && this.fpTrail && p.fp) {
      const a = p.action;
      const emitting = this.firstPerson && !this.fpBody && !!a && a.stage === 'active' && !!a.def.hits;
      this.camera.updateMatrixWorld(true);
      this.fpTrail.update(dt, this.fpBody ? p.weapon.base : p.fp.weapon.base, this.fpBody ? p.weapon.tip : p.fp.weapon.tip, emitting);
    }
  }

  updateCamera(dt) {
    const p = this.player || (this.cinematic && this.cinematic.orbit ? this.cinematic.targets[0] : null);
    const cam = this.camera;
    if (p) {
      const zoom = p.aiming && p.cls.special?.fov ? p.cls.special.fov : 1;
      this._zoom = (this._zoom || 1) + (zoom - (this._zoom || 1)) * Math.min(1, dt * 12);
      // 冲刺/突进时视野略拉宽，命中时轻微收缩
      const dashing = p.state === 'dash' || (p.action && p.action.def.dash && p.action.stage === 'active');
      this.fovKick = (this.fovKick || 0) + ((dashing ? 0.07 : 0) - (this.fovKick || 0)) * Math.min(1, dt * (dashing ? 10 : 5));
      this.fovPunch = (this.fovPunch || 0) * Math.exp(-dt * 10);
      this.shotHeat = (this.shotHeat || 0) * Math.exp(-dt * 9);
      this.shotRoll = (this.shotRoll || 0) * Math.exp(-dt * 14);
      this.updateFov(this._zoom * (1 + this.fovKick - this.fovPunch));
      this.camDip = (this.camDip || 0) * Math.exp(-dt * 9);
      // 抖动
      this.shakeAmt *= Math.exp(-dt * 9);
      const sh = this.shakeAmt;
      // 团队赛阵亡后观战队友（第三人称跟随）
      const spec = p.dead && this.spectate && this.spectate.alive ? this.spectate : null;
      const cine = this.cinematic;
      if (cine || spec || !this.firstPerson) this._fpEyeOwner = null;
      if (cine) {
        cine.t += dt;
        const k = cine.orbit ? 0.35 : Math.min(1, cine.t / cine.dur);
        const fs = cine.targets.filter((f) => f && !f.dead);
        const mid = new THREE.Vector3(); for (const f of fs) mid.add(f.pos); if (fs.length) mid.divideScalar(fs.length);
        let span = 4; for (const f of fs) span = Math.max(span, f.pos.distanceTo(mid) * 2);
        const ang = cine.orbit ? cine.a0 + cine.t * 0.12 : cine.a0 + k * 1.1;
        const r = cine.orbit ? Math.min(9, span * 0.5 + 4.5) : span * 0.75 + 3.5 - k * 1.2;
        cine.mid = cine.mid ? cine.mid.lerp(mid, Math.min(1, dt * 2)) : mid.clone();
        const m2 = cine.mid;
        cam.position.set(m2.x + Math.sin(ang) * r, m2.y + (cine.orbit ? 1.2 : 2.2 + (1 - k) * 1.2), m2.z + Math.cos(ang) * r);
        cam.lookAt(m2.x, m2.y + (cine.orbit ? 0.35 : 1.1), m2.z);
        cam.layers.enable(1);
        if (p.fp) p.fp.root.visible = false;
        if (!cine.orbit && k >= 1) { this.cinematic = null; cam.layers.disable(1); }
        audio.setListener(cam.position.x, cam.position.y, cam.position.z, this.viewYaw);
        return;
      }
      if (spec) {
        const t = new THREE.Vector3(spec.pos.x, spec.pos.y + 1.6, spec.pos.z);
        const back = new THREE.Vector3(-Math.sin(spec.yaw) * 4, 1.2, -Math.cos(spec.yaw) * 4);
        cam.position.lerp(t.clone().add(back), Math.min(1, dt * 5));
        this.viewYaw += wrapAngle(spec.yaw - this.viewYaw) * Math.min(1, dt * 4);
        this.viewPitch += (-0.2 - this.viewPitch) * Math.min(1, dt * 4);
      } else if (this.firstPerson) {
        p.eyePos(this.tmp);
        // 眼睛略前移，避免看到脖子内部
        const fwd = 0.08;
        this.tmp.x += Math.sin(this.viewYaw) * fwd; this.tmp.z += Math.cos(this.viewYaw) * fwd;
        this.camPos = this.camPos || this.tmp.clone();
        // 跳跃/飞行的世界位移与身体同步；仅平滑动作引起的相对眼高。
        // 平滑绝对 y 会让起跳时镜头落入自己的肩衣，瞬移时甚至留在腰下。
        const eyeHeight = this.tmp.y - p.pos.y;
        if (this._fpEyeOwner !== p.id) { this._fpEyeOwner = p.id; this._fpEyeHeight = eyeHeight; }
        this._fpEyeHeight += (eyeHeight - this._fpEyeHeight) * Math.min(1, dt * 18);
        this.camPos.x = this.tmp.x; this.camPos.z = this.tmp.z;
        if (this.camFade) this.camFade.value = 0;
        this.camPos.y = p.pos.y + this._fpEyeHeight;
        cam.position.copy(this.camPos);
        cam.position.y -= this.camDip || 0;
      } else {
        const tp = this.viewMode === 'tp';
        if (this.camFade) this.camFade.value = 1.25;
        const back = tp ? (3.3 + (4.4 - 3.3) * clamp((cam.aspect - .55) / .45, 0, 1)) : 2.9, up = tp ? (.75 - .20 * (1 - clamp((cam.aspect - .55) / .45, 0, 1))) : 0.08, shoulder = tp ? 0 : 0.7;
        const cp = Math.cos(this.viewPitch);
        const target = new THREE.Vector3(p.pos.x, p.pos.y + (tp ? 1.45 : 1.5), p.pos.z);
        const dir = new THREE.Vector3(Math.sin(this.viewYaw) * cp, Math.sin(this.viewPitch), Math.cos(this.viewYaw) * cp);
        const want = target.clone().addScaledVector(dir, -back); want.y += up;
        // 越肩：相机偏右肩
        want.x += -Math.cos(this.viewYaw) * shoulder; want.z += Math.sin(this.viewYaw) * shoulder;
        // 相机碰撞
        const hit = this.world.raycast(target, want.clone().sub(target).normalize(), target.distanceTo(want), null);
        cam.position.copy(hit.dist < target.distanceTo(want) ? hit.point.lerp(target, 0.1) : want);
      }
      cam.rotation.set(this.viewPitch + (Math.random() - 0.5) * sh * 0.03, this.viewYaw + Math.PI + (Math.random() - 0.5) * sh * 0.03, this.settings.shake ? this.shotRoll : 0);
      if (p.fp && !this.fpBody) {
        p.fp.sync(p.rig, dt, this.settings.bob ? Math.hypot(p.vel.x, p.vel.z) * (p.onGround ? 1 : 0) : 0, this.lastMouse[0], this.lastMouse[1], this.settings.bob);
        p.fp.root.visible = this.firstPerson && !this.fpBody && !p.dead && p.state !== 'down';
      }
      audio.setListener(cam.position.x, cam.position.y, cam.position.z, this.viewYaw);
      // 阴影相机跟随玩家
      if (this.level && this.level.sun && this.sunOffset) {
        const s = this.level.sun;
        s.target.position.set(p.pos.x, 0, p.pos.z);
        s.position.copy(s.target.position).add(this.sunOffset);
        s.target.updateMatrixWorld();
      }
    }
  }

  render(dt = 1 / 60) {
    if (this.contextLost) return;
    this._renderDirty = false;
    const smooth = !this.manual && !this.paused && this.fpBody;
    if (smooth) for (const f of this.fighters) f.renderPose?.present(this.acc / STEP);
    try {
      // 录制工具用：外部接管机位（宣传片运镜），游戏本身不设置
      if (this.camHook) { try { this.camHook(this.camera, this); } catch (e) { this.camHook = null; console.warn('camHook', e); } }
      if (this.settings.post !== false && this.post) { this.post.render(dt); return; }
      const r = this.renderer;
      r.autoClear = true;
      r.render(this.scene, this.camera);
      if (this.player && this.firstPerson && (!this.fpBody && this.player.fp && this.player.fp.root.visible)) {
        r.autoClear = false;
        const sm = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = false;
        r.clearDepth();
        const bg = this.scene.background, fog = this.scene.fog;
        this.scene.background = null;
        r.render(this.scene, this.vmCamera);
        this.scene.background = bg; this.scene.fog = fog;
        r.shadowMap.autoUpdate = sm;
        r.autoClear = true;
      }
    } finally {
      if (smooth) for (const f of this.fighters) {
        f.renderPose?.restore(); f.rig.root.updateMatrixWorld(true);
      }
    }
  }
}
