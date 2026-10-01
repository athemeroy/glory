// 延迟结算、倒计时和复活只属于发起它们的模式，退出时一并取消。
export class ModeTimers {
  constructor(isCurrent) { this.isCurrent = isCurrent; this.pending = new Set(); this.active = true; }
  after(callback, delay) {
    if (!this.active) return null;
    const id = setTimeout(() => {
      this.pending.delete(id);
      if (this.active && this.isCurrent()) callback();
    }, delay);
    this.pending.add(id);
    return id;
  }
  clear() {
    this.active = false;
    for (const id of this.pending) clearTimeout(id);
    this.pending.clear();
  }
}
