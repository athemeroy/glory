// 键鼠与触控输入：指针锁定、可重绑定键位、输入缓冲、APM 统计
import { store } from './util.js';

export const DEFAULT_BINDS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', dash: 'ShiftLeft', sprint: 'ControlLeft', attack: 'Mouse0', special: 'Mouse2',
  s1: 'KeyQ', s2: 'KeyE', s3: 'KeyR', s4: 'KeyF', s5: 'KeyC', s6: 'KeyX', ult: 'KeyV',
  form1: 'Digit1', form2: 'Digit2', form3: 'Digit3', form4: 'Digit4',
  interact: 'KeyG', stats: 'Tab', view: 'F5', lockon: 'KeyT',
};

export const BIND_LABELS = {
  forward: '前进', back: '后退', left: '左移', right: '右移', jump: '跳跃 / 受身', dash: '闪避冲刺', sprint: '疾跑（按住）',
  attack: '普通攻击', special: '职业特技', s1: '技能 1', s2: '技能 2', s3: '技能 3', s4: '技能 4', s5: '技能 5', s6: '技能 6', ult: '大招',
  form1: '千机伞·剑', form2: '千机伞·矛', form3: '千机伞·枪', form4: '千机伞·盾',
  interact: '交互', stats: '数据面板', view: '切换视角', lockon: '观察目标',
};

export function keyLabel(code) {
  if (!code) return '—';
  if (code === 'Mouse0') return '左键';
  if (code === 'Mouse1') return '中键';
  if (code === 'Mouse2') return '右键';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map = { Space: '空格', ShiftLeft: 'Shift', ShiftRight: '右Shift', ControlLeft: 'Ctrl', AltLeft: 'Alt', Tab: 'Tab', Escape: 'Esc', CapsLock: 'Caps' };
  return map[code] || code;
}

class Input {
  constructor() {
    this.binds = { ...DEFAULT_BINDS, ...store.get('binds', {}) };
    this.down = new Set();
    this.pressedAt = new Map(); // code -> performance.now()
    this.touchDown = new Set();
    this.touchPressedAt = new Map();
    this.touchMove = [0, 0];
    this.touchMode = matchMedia('(pointer: coarse)').matches;
    this.mouseDX = 0; this.mouseDY = 0;
    this.locked = false;
    this._enabled = false; // 游戏中才接收
    this.actionTimes = [];
    this.onEscape = null;
    this.onKey = null; // 调试/界面钩子
    this.captureNext = null; // 重绑定时捕获下一个按键
    this.canvas = null;
  }

  get enabled() { return this._enabled; }
  set enabled(on) {
    this._enabled = on;
    if (!on) this.clear();
    this.onEnabledChange?.();
  }
  setTouchMode(on) {
    if (this.touchMode === on) return;
    this.touchMode = on;
    if (on && this.locked) this.unlock();
    this.onTouchModeChange?.();
  }
  resetTouch() {
    this.touchDown.clear(); this.touchPressedAt.clear();
    this.touchMove = [0, 0];
  }
  clear() {
    this.down.clear(); this.pressedAt.clear(); this.resetTouch();
    this.mouseDX = 0; this.mouseDY = 0;
    this.onReset?.();
  }

  attach(canvas) {
    this.canvas = canvas;
    const kd = (e) => {
      if (this.captureNext) {
        e.preventDefault();
        const cb = this.captureNext; this.captureNext = null;
        if (e.code !== 'Escape') cb(e.code);
        else cb(null);
        return;
      }
      if (e.code === 'Escape') { if (this.onEscape) this.onEscape(); return; }
      if (this.enabled && (e.code === 'Tab' || e.code === 'Space' || e.code === 'F5' || (e.ctrlKey && Object.values(this.binds).includes(e.code)))) e.preventDefault();
      if (this.enabled && !e.repeat) this._press(e.code);
      if (this.onKey) this.onKey(e.code, true, e);
    };
    const ku = (e) => { this.down.delete(e.code); if (this.onKey) this.onKey(e.code, false, e); };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });
    canvas.addEventListener('mousedown', (e) => {
      if (this.captureNext) { const cb = this.captureNext; this.captureNext = null; cb('Mouse' + e.button); e.preventDefault(); return; }
      if (!this.enabled || (this.touchMode && e.sourceCapabilities?.firesTouchEvents)) return;
      if (!this.locked && !this.fallbackLook) { this.lock(); return; }
      this._press('Mouse' + e.button);
    });
    window.addEventListener('mouseup', (e) => this.down.delete('Mouse' + e.button));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      // 无法锁定指针（如嵌入式 iframe）时：按住右键或中键拖动转视角
      if (!this.locked && !(this.fallbackLook && this.enabled && (e.buttons & 6))) return;
      // 过滤浏览器偶发的巨大跳变
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX; this.mouseDY += e.movementY;
    });
    document.addEventListener('pointerlockerror', () => { if (this._gesture) { this.fallbackLook = true; if (this.onLockFail) this.onLockFail(); } else if (this.onLockNeeded) this.onLockNeeded(); });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) this.fallbackLook = false;
      if (!this.locked) this.down.clear();
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  // gesture=true 表示由用户点击触发；只有点击触发仍失败（如沙箱 iframe）才退回拖拽转视角
  lock(gesture = true) {
    if (this.cursorMode) return;
    if (this.touchMode || !this.canvas || this.locked) return;
    this._gesture = gesture;
    const fail = () => { if (this._gesture) { this.fallbackLook = true; if (this.onLockFail) this.onLockFail(); } else if (this.onLockNeeded) this.onLockNeeded(); };
    if (!this.canvas.requestPointerLock) { fail(); return; }
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { const p2 = this.canvas.requestPointerLock(); if (p2 && p2.catch) p2.catch(fail); } catch { fail(); } });
    } catch { try { this.canvas.requestPointerLock(); } catch { fail(); } }
  }
  // 方向键转视角（键盘备用）
  keyLook() {
    let x = 0, y = 0;
    if (this.down.has('ArrowLeft')) x -= 1; if (this.down.has('ArrowRight')) x += 1;
    if (this.down.has('ArrowUp')) y -= 1; if (this.down.has('ArrowDown')) y += 1;
    return [x, y];
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  _press(code) {
    this.down.add(code);
    this.pressedAt.set(code, performance.now());
    if (this.enabled) this.actionTimes.push(performance.now());
  }

  // 虚拟输入（测试/自动演示用）
  simPress(action) { const c = this.binds[action]; if (c) this._press(c); }
  simHold(action, on) { const c = this.binds[action]; if (!c) return; if (on) this.down.add(c); else this.down.delete(c); }

  // 触控按动作存储，改键和键盘同时按住时也不会互相释放。
  touchHold(action, on) {
    if (on) {
      if (!this.enabled || this.touchDown.has(action)) return;
      this.touchDown.add(action);
      const now = performance.now();
      this.touchPressedAt.set(action, now); this.actionTimes.push(now);
    } else if (!this.touchDown.delete(action)) return;
    this.onKey?.(this.binds[action], on);
  }
  held(action) { return this.down.has(this.binds[action]) || this.touchDown.has(action); }
  moveAxes() {
    const x = this.touchMove[0] + Number(this.held('right')) - Number(this.held('left'));
    const y = this.touchMove[1] + Number(this.held('forward')) - Number(this.held('back'));
    return [Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y))];
  }
  // 在 windowMs 内按下过（输入缓冲），消费后清除
  consume(action, windowMs = 120) {
    const touchTime = this.touchPressedAt.get(action);
    if (touchTime !== undefined && performance.now() - touchTime <= windowMs) { this.touchPressedAt.delete(action); return true; }
    const code = this.binds[action];
    const t = this.pressedAt.get(code);
    if (t !== undefined && performance.now() - t <= windowMs) { this.pressedAt.delete(code); return true; }
    return false;
  }
  peek(action, windowMs = 120) {
    const t = this.pressedAt.get(this.binds[action]);
    const tt = this.touchPressedAt.get(action);
    return (t !== undefined && performance.now() - t <= windowMs) || (tt !== undefined && performance.now() - tt <= windowMs);
  }
  takeMouse() { const d = [this.mouseDX, this.mouseDY]; this.mouseDX = 0; this.mouseDY = 0; return d; }

  apm() {
    const now = performance.now();
    while (this.actionTimes.length && now - this.actionTimes[0] > 60000) this.actionTimes.shift();
    // 前 60 秒按实际时长折算
    const span = Math.min(60000, Math.max(5000, now - (this._apmStart || now)));
    return Math.round(this.actionTimes.length * 60000 / span);
  }
  resetApm() { this.actionTimes.length = 0; this._apmStart = performance.now(); }

  setBind(action, code) {
    // 冲突：交换
    for (const k in this.binds) if (this.binds[k] === code && k !== action) this.binds[k] = this.binds[action];
    this.binds[action] = code;
    store.set('binds', this.binds);
  }
  resetBinds() { this.binds = { ...DEFAULT_BINDS }; store.set('binds', {}); }
}

export const input = new Input();
