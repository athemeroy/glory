// 屏幕操作：多指摇杆、拖动视角、复用 HUD 的技能与形态按钮。
import { input } from '../engine/input.js';

export class TouchControls {
  constructor(app) {
    this.app = app;
    this.pointers = new Map();
    this.root = document.createElement('div');
    this.root.id = 'touch-controls';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="touch-toolbar" aria-label="游戏菜单">
        <button type="button" data-command="view" aria-label="切换视角">视角</button>
        <button type="button" data-command="stats" aria-label="显示或关闭战斗数据" aria-pressed="false">数据</button>
        <button type="button" data-command="fullscreen" aria-label="全屏游戏">全屏</button>
        <button type="button" data-command="pause" aria-label="暂停游戏">暂停</button>
      </div>
      <div class="touch-stick" role="group" aria-label="拖动摇杆移动">
        <span class="stick-ring"></span><span class="stick-knob"></span><span class="stick-label">移动</span>
      </div>
      <div class="touch-movement" aria-label="战斗动作">
        <button type="button" data-action="lockon" aria-label="锁定或取消锁定目标">锁定</button>
        <button type="button" data-action="jump" aria-label="跳跃或受身">跳跃</button>
        <button type="button" data-action="dash" aria-label="闪避冲刺">闪避</button>
      </div>
      <button type="button" class="touch-interact" data-action="interact" aria-label="镜前换装">换装</button>
      <div class="touch-look-hint">右侧空白处拖动视角</div>`;
    document.body.appendChild(this.root);
    this.stick = this.root.querySelector('.touch-stick');
    this.knob = this.root.querySelector('.stick-knob');
    if (!document.documentElement.requestFullscreen) this.root.querySelector('[data-command="fullscreen"]').hidden = true;

    input.onEnabledChange = () => this.sync();
    input.onTouchModeChange = () => this.sync();
    input.onReset = () => this.reset();
    document.addEventListener('pointerdown', (e) => this.down(e), { passive: false });
    document.addEventListener('contextmenu', (e) => {
      if (input.touchMode && e.target.closest('#hud [data-action], #touch-controls')) e.preventDefault();
    });
    window.addEventListener('pointermove', (e) => this.move(e), { passive: false });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      document.addEventListener(event, (e) => this.up(e.pointerId, event !== 'pointerup'));
    }
    window.addEventListener('resize', () => this.reset());
    document.addEventListener('click', (e) => {
      if (!input.touchMode || !input.enabled || this.app.game.contextLost) return;
      const btn = e.target.closest('#touch-controls [data-command]');
      if (btn) this.command(btn.dataset.command);
      // 键盘和辅助技术也能激活屏幕按钮。
      const action = e.target.closest('#hud [data-action], #touch-controls [data-action]');
      if (action && e.detail === 0 && !e.pointerType) {
        input.touchHold(action.dataset.action, true); input.touchHold(action.dataset.action, false);
      }
    });
    this.sync();
  }

  sync() {
    const active = input.touchMode && input.enabled && !this.app.game.contextLost;
    document.body.classList.toggle('touch-mode', input.touchMode);
    document.body.classList.toggle('touch-playing', active);
    this.root.hidden = !active;
    if (!active) this.reset();
  }

  down(e) {
    if (e.pointerType === 'touch') input.setTouchMode(true);
    // 外接鼠标或触屏电脑回到画面点击时，恢复原有键鼠和指针锁定流程。
    if (input.enabled && e.pointerType === 'mouse' && e.target === this.app.canvas) {
      input.setTouchMode(false);
      return;
    }
    if (!input.touchMode || !input.enabled || this.app.game.contextLost || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const button = e.target.closest('#hud [data-action], #touch-controls [data-action]');
    let pointer;
    if (button) {
      pointer = { kind: 'action', action: button.dataset.action, el: button };
      button.classList.add('touch-held');
      input.touchHold(pointer.action, true);
    } else if (this.stick.contains(e.target)) {
      if ([...this.pointers.values()].some((p) => p.kind === 'stick')) return;
      const rect = this.stick.getBoundingClientRect();
      pointer = { kind: 'stick', el: this.stick, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, radius: rect.width * 0.32 };
      this.stick.classList.add('touch-held');
      this.moveStick(pointer, e);
    } else if (e.target === this.app.canvas && e.pointerType !== 'mouse') {
      e.preventDefault(); // 阻止触摸生成普攻鼠标事件。
      if ([...this.pointers.values()].some((p) => p.kind === 'look')) return;
      pointer = { kind: 'look', el: this.app.canvas, x: e.clientX, y: e.clientY };
      this.root.classList.add('look-used');
    } else return;
    e.preventDefault();
    this.pointers.set(e.pointerId, pointer);
    pointer.el.setPointerCapture(e.pointerId);
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    if (p.kind === 'stick') this.moveStick(p, e);
    else if (p.kind === 'look') {
      // 按 CSS 像素计算，不随手机 DPR 改变；灵敏度和反转设置继续生效。
      input.mouseDX += (e.clientX - p.x) * 2.2;
      input.mouseDY += (e.clientY - p.y) * 2.2;
      p.x = e.clientX; p.y = e.clientY;
    }
  }

  moveStick(p, e) {
    let x = (e.clientX - p.x) / p.radius, y = (e.clientY - p.y) / p.radius;
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    const magnitude = Math.min(1, length);
    const gain = magnitude <= 0.14 ? 0 : (magnitude - 0.14) / (0.86 * magnitude);
    input.touchMove = [x * gain, -y * gain];
    this.knob.style.transform = `translate(${x * p.radius}px, ${y * p.radius}px)`;
  }

  up(id, cancelled = false) {
    const p = this.pointers.get(id);
    if (!p) return;
    this.pointers.delete(id);
    if (p.el.hasPointerCapture(id)) p.el.releasePointerCapture(id);
    if (p.kind === 'stick') { input.touchMove = [0, 0]; this.knob.style.transform = ''; p.el.classList.remove('touch-held'); }
    if (p.kind === 'look' && cancelled) { input.mouseDX = 0; input.mouseDY = 0; }
    if (p.kind === 'action') {
      if (![...this.pointers.values()].some((other) => other.el === p.el)) p.el.classList.remove('touch-held');
      if (![...this.pointers.values()].some((other) => other.action === p.action)) {
        // 系统取消手势不能留下待触发的技能；正常松手仍保留点按缓冲。
        if (cancelled) input.touchPressedAt.delete(p.action);
        input.touchHold(p.action, false);
      }
    }
  }

  reset() {
    const pointers = [...this.pointers];
    this.pointers.clear();
    for (const [id, p] of pointers) {
      p.el.classList.remove('touch-held');
      if (p.el.hasPointerCapture(id)) p.el.releasePointerCapture(id);
    }
    input.resetTouch();
    input.mouseDX = 0; input.mouseDY = 0;
    this.knob.style.transform = '';
    this.root.querySelector('[data-command="stats"]').setAttribute('aria-pressed', 'false');
    this.app.hud.showStats(false, this.app.game);
  }

  command(command) {
    if (command === 'pause') this.app.pause();
    if (command === 'view') this.app.game.toggleView();
    if (command === 'stats') {
      const on = this.app.hud.stats.style.display === 'none';
      this.app.hud.showStats(on, this.app.game);
      this.root.querySelector('[data-command="stats"]').setAttribute('aria-pressed', String(on));
    }
    if (command === 'fullscreen') {
      if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
      document.documentElement.requestFullscreen?.().then(() => {
        screen.orientation?.lock?.('landscape').catch(() => {});
      }).catch(() => this.app.hud.toast('可以旋转手机，横屏操作更舒适'));
    }
  }
}
