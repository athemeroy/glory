// 联机：浏览器直连（WebRTC DataChannel）。对外接口与原来的 WebSocket 版相同：
// on/emit、relay(d)、leave()、close()，字段 role / room / rtt / connected / peerGone，事件 peer / joined / left / close / relay / error。
// 牵线（交换连接信息）两种方式：
//   1. 房间号：连接码存到 /api/sig（Vercel 函数或本地 server/server.mjs），对方凭房间号 + 密码取走；
//   2. 连接码：不经过任何服务器，双方各复制一次压缩后的连接码（约 200 字符）。
// 不使用 trickle ICE：等候选地址收集完再出码，一个码包含全部信息。

const ICE = [
  { urls: ['stun:stun.chat.bilibili.com:3478', 'stun:stun.hitv.com:3478'] },
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
];
const SIG = '/api/sig'; // 站点根路径：游戏放在 /play/ 下也能找到；没有该接口时自动退回连接码
const GATHER_MS = 3500;   // 收集候选地址的最长等待
const CONNECT_MS = 20000; // 对方应答后，打洞的最长等待

// ---------------------------------------------------------------- 连接码压缩
// 只保留 SDP 里建立数据通道所需的字段，其余按固定模板还原（Chrome / Edge / Firefox / Safari 均接受）
function pack(desc) {
  const sdp = desc.sdp;
  const get = (re) => { const m = sdp.match(re); return m ? m[1] : ''; };
  const fp = get(/a=fingerprint:sha-256 ([0-9A-F:]+)/i).replace(/:/g, '');
  const cands = [];
  for (const m of sdp.matchAll(/a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ (host|srflx)/gi)) {
    const [, addr, port, typ] = m;
    const k = cands.findIndex((c) => c[0] === addr && c[1] === +port);
    if (k < 0) cands.push([addr, +port, typ === 'host' ? 'h' : 's']);
  }
  const o = {
    t: desc.type === 'offer' ? 'o' : 'a',
    u: get(/a=ice-ufrag:(\S+)/), p: get(/a=ice-pwd:(\S+)/),
    f: hexToB64(fp), s: get(/a=setup:(\S+)/), c: cands.slice(0, 6),
  };
  return 'G1' + b64url(new TextEncoder().encode(JSON.stringify(o)));
}

function unpack(code) {
  const s = String(code || '').replace(/\s+/g, '');
  if (!s.startsWith('G1')) throw new Error('连接码格式不对');
  const o = JSON.parse(new TextDecoder().decode(unb64url(s.slice(2))));
  const fp = b64ToHex(o.f).match(/../g).join(':').toUpperCase();
  let prio = 2130706431;
  const cand = o.c.map(([addr, port, k], i) => `a=candidate:${i + 1} 1 udp ${k === 'h' ? prio - i : 1686052607 - i} ${addr} ${port} typ ${k === 'h' ? 'host' : 'srflx'}${k === 's' ? ' raddr 0.0.0.0 rport 0' : ''}`);
  const sdp = [
    'v=0', `o=- ${Date.now()} 2 IN IP4 127.0.0.1`, 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
    ...cand,
    `a=ice-ufrag:${o.u}`, `a=ice-pwd:${o.p}`, `a=fingerprint:sha-256 ${fp}`, `a=setup:${o.s}`,
    'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144', '',
  ].join('\r\n');
  return { type: o.t === 'o' ? 'offer' : 'answer', sdp };
}

function b64url(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64url(s) { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, (c) => c.charCodeAt(0)); }
function hexToB64(h) { return b64url(Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16))); }
function b64ToHex(s) { return [...unb64url(s)].map((b) => b.toString(16).padStart(2, '0')).join(''); }

// 密码哈希：只用于核对“双方输入的是同一个密码”。不用 crypto.subtle，因为它在 http 局域网地址下不可用
function cyrb53(str, seed) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
async function sha(text) { return cyrb53(text, 7) + cyrb53(text, 1999); }

async function sig(body) {
  const r = await fetch(SIG, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `房间服务出错（${r.status}）`);
  return j;
}

// ---------------------------------------------------------------- 直连
export class P2PNet {
  constructor() {
    this.handlers = new Map();
    this.pc = null; this.ch = null;
    this.connected = false; this.role = null; this.room = null; this.rtt = 0; this.peerGone = false;
    this.me = { name: '玩家', info: {} }; this.pwHash = '';
  }
  get supported() { return typeof RTCPeerConnection !== 'undefined'; }
  on(t, fn) { if (!this.handlers.has(t)) this.handlers.set(t, new Set()); this.handlers.get(t).add(fn); return () => this.handlers.get(t).delete(fn); }
  emit(t, m) { const hs = this.handlers.get(t); if (hs) for (const fn of [...hs]) fn(m); }
  send(o) { if (this.ch && this.ch.readyState === 'open') this.ch.send(JSON.stringify(o)); }
  relay(d) { this.send({ t: 'relay', d }); }
  // 兼容旧接口：直连不需要预先连接服务器
  connect() { return this.supported ? Promise.resolve(this) : Promise.reject(new Error('浏览器不支持 WebRTC')); }

  newPeer() {
    this.close(true);
    const pc = new RTCPeerConnection({ iceServers: ICE });
    this.pc = pc;
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return;
      if (pc.connectionState === 'failed') this.fail('直连失败：双方网络都在运营商大内网时打不通。可以让一方换成家里宽带或手机热点再试。');
      if (pc.connectionState === 'disconnected' && this.connected) { this.connected = false; this.peerGone = true; this.emit('close', {}); }
    };
    return pc;
  }
  async localCode(pc) {
    // 等候选地址收集完（或超时）再出码
    await new Promise((res) => {
      if (pc.iceGatheringState === 'complete') return res();
      const to = setTimeout(res, GATHER_MS);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(to); res(); } });
    });
    return pack(pc.localDescription);
  }
  bindChannel(ch) {
    this.ch = ch;
    ch.onopen = () => {
      clearTimeout(this._connTo);
      this.connected = true; this.peerGone = false;
      if (this.role === 'guest') this.send({ t: 'hello', name: this.me.name, info: this.me.info, pw: this.pwHash });
      clearInterval(this._pi); this._pi = setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 1000);
    };
    ch.onclose = () => { if (this.connected) { this.connected = false; this.peerGone = true; this.emit('left', {}); this.emit('close', {}); } };
    ch.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.t) {
        case 'relay': this.emit('relay', m.d); break;
        case 'ping': this.send({ t: 'pong', ts: m.ts }); break;
        case 'pong': this.rtt = performance.now() - m.ts; break;
        case 'hello': // 房主核对密码
          if (m.pw !== this.pwHash) { this.send({ t: 'deny', msg: '密码不对' }); setTimeout(() => this.close(true), 300); this.emit('error', { msg: '有人用错误的密码尝试加入' }); break; }
          this.send({ t: 'welcome', name: this.me.name, info: this.me.info });
          this.emit('peer', { name: String(m.name || '玩家').slice(0, 16), info: m.info || {} });
          break;
        case 'welcome': this.emit('joined', { room: this.room, host: String(m.name || '房主').slice(0, 16), info: m.info || {} }); break;
        case 'deny': this.fail(m.msg || '对方拒绝了连接'); break;
        case 'bye': this.connected = false; this.peerGone = true; this.emit('left', {}); break;
      }
    };
  }
  fail(msg) { this.emit('error', { msg }); this.close(true); }
  armTimeout() { clearTimeout(this._connTo); this._connTo = setTimeout(() => { if (!this.connected) this.fail('连接超时：双方网络可能无法直连。可以让一方换成家里宽带或手机热点再试。'); }, CONNECT_MS); }

  // ---- 房主 ----
  // useServer：用房间号服务；否则只出连接码，等对方的回复码
  async host({ name, info, password = '', useServer = true }) {
    this.role = 'host'; this.me = { name, info }; this.pwHash = password ? await sha('glory:' + password) : '';
    const pc = this.newPeer();
    this.bindChannel(pc.createDataChannel('glory', { ordered: true }));
    await pc.setLocalDescription(await pc.createOffer());
    const code = await this.localCode(pc);
    this.offerCode = code;
    if (!useServer) return { code };
    let r;
    try { r = await sig({ op: 'new', offer: code, pw: this.pwHash, name, acc: info && info.acc }); }
    catch (e) { return { code, sigError: e.message }; } // 没有房间号服务：沿用已生成的连接码
    this.room = r.room;
    this.pollAnswer(pc, r.room);
    return { code, room: r.room };
  }
  async pollAnswer(pc, room) {
    while (pc === this.pc && !this.remoteSet) {
      try {
        const r = await sig({ op: 'poll', room, pw: this.pwHash });
        if (r.answer) { await this.acceptAnswer(r.answer); return; }
      } catch (e) { if (/不存在|过期/.test(e.message)) { this.fail('房间已过期，请重新创建'); return; } }
      await new Promise((res) => setTimeout(res, 1200));
    }
  }
  async acceptAnswer(code) {
    if (this.remoteSet || !this.pc) return;
    this.remoteSet = true;
    await this.pc.setRemoteDescription(unpack(code));
    this.armTimeout();
  }

  // ---- 加入方 ----
  // 用房间号：从服务取房主的连接码，回复码自动交回；用连接码：返回回复码，由玩家发给房主
  async join({ name, info, password = '', room = '', code = '' }) {
    this.role = 'guest'; this.me = { name, info }; this.pwHash = password ? await sha('glory:' + password) : '';
    let offer = code;
    if (room) { const r = await sig({ op: 'get', room, pw: this.pwHash }); offer = r.offer; this.room = room; }
    const desc = unpack(offer);
    if (desc.type !== 'offer') throw new Error('这是回复码，请粘贴房主发来的连接码');
    const pc = this.newPeer();
    pc.ondatachannel = (ev) => this.bindChannel(ev.channel);
    await pc.setRemoteDescription(desc);
    await pc.setLocalDescription(await pc.createAnswer());
    const answer = await this.localCode(pc);
    this.remoteSet = true;
    if (room) await sig({ op: 'answer', room, answer, pw: this.pwHash });
    this.armTimeout();
    return { answer };
  }

  leave() { this.send({ t: 'bye' }); this.close(true); this.role = null; this.room = null; }
  close(silent = false) {
    clearInterval(this._pi); clearTimeout(this._connTo);
    const pc = this.pc; this.pc = null; this.remoteSet = false;
    if (this.ch) { try { this.ch.close(); } catch { /* */ } this.ch = null; }
    if (pc) { try { pc.close(); } catch { /* */ } }
    if (this.connected && !silent) this.emit('close', {});
    this.connected = false;
  }
}

export { pack, unpack };
