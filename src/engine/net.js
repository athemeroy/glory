// 联机：连接 server/server.mjs 的 WebSocket 房间。主机权威，客机发送输入、接收快照。
export class Net {
  constructor() {
    this.ws = null; this.handlers = new Map(); this.connected = false; this.role = null; this.room = null; this.rtt = 0;
  }
  connect(timeout = 3000) {
    if (this.connected) return Promise.resolve(this);
    return new Promise((resolve, reject) => {
      let done = false;
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      let ws;
      try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
      const to = setTimeout(() => { if (!done) { done = true; try { ws.close(); } catch { /* */ } reject(new Error('连接超时')); } }, timeout);
      ws.onopen = () => { if (done) return; done = true; clearTimeout(to); this.ws = ws; this.connected = true; this.pingLoop(); resolve(this); };
      ws.onerror = () => { if (!done) { done = true; clearTimeout(to); reject(new Error('无法连接联机服务器')); } };
      ws.onclose = () => { this.connected = false; this.emit('close', {}); };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'pong') { this.rtt = performance.now() - m.ts; return; }
        if (m.t === 'relay') this.emit('relay', m.d);
        else { if (m.t === 'peer') this.peerGone = false; if (m.t === 'left') this.peerGone = true; this.emit(m.t, m); }
      };
    });
  }
  pingLoop() { clearInterval(this._pi); this._pi = setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 1000); }
  on(t, fn) { if (!this.handlers.has(t)) this.handlers.set(t, new Set()); this.handlers.get(t).add(fn); return () => this.handlers.get(t).delete(fn); }
  emit(t, m) { const hs = this.handlers.get(t); if (hs) for (const fn of [...hs]) fn(m); }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  relay(d) { this.send({ t: 'relay', d }); }
  leave() { this.send({ t: 'leave' }); this.role = null; this.room = null; }
  close() { clearInterval(this._pi); try { this.ws && this.ws.close(); } catch { /* */ } this.ws = null; this.connected = false; }
}

export const net = new Net();
