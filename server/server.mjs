#!/usr/bin/env node
// 荣耀联机服务器：静态文件 + WebSocket 房间转发。零依赖（Node ≥ 18）。
// 用法：node server/server.mjs [端口，默认 8780]，然后局域网内浏览器打开 http://<本机IP>:端口/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = parseInt(process.argv[2] || process.env.PORT || '8780', 10);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.md': 'text/markdown; charset=utf-8' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || p.includes('/server/') || p.includes('/.')) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});

// ---------------- 最小 WebSocket 实现（RFC 6455，仅文本帧） ----------------
class Sock {
  constructor(socket) {
    this.s = socket; this.buf = Buffer.alloc(0); this.onmessage = null; this.onclose = null; this.open = true; this.frag = null;
    socket.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.parse(); });
    socket.on('close', () => this.closed());
    socket.on('error', () => this.closed());
    socket.setNoDelay(true);
  }
  closed() { if (!this.open) return; this.open = false; if (this.onclose) this.onclose(); }
  parse() {
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      const mOff = off; if (masked) off += 4;
      if (this.buf.length < off + len) return;
      let payload = this.buf.subarray(off, off + len);
      if (masked) { const m = this.buf.subarray(mOff, mOff + 4); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3]; }
      this.buf = this.buf.subarray(off + len);
      if (op === 8) { this.send(null, 8); this.s.end(); this.closed(); return; }
      if (op === 9) { this.send(payload, 10); continue; }
      if (op === 10) continue;
      if (op === 0) { if (this.frag) this.frag.push(payload); if (fin && this.frag) { const all = Buffer.concat(this.frag); this.frag = null; this.deliver(all); } continue; }
      if (op === 1 || op === 2) { if (!fin) { this.frag = [payload]; continue; } this.deliver(payload); }
    }
  }
  deliver(p) { if (this.onmessage) { try { this.onmessage(JSON.parse(p.toString('utf8'))); } catch { /* 忽略坏包 */ } } }
  send(data, op = 1) {
    if (!this.open) return;
    const payload = data == null ? Buffer.alloc(0) : Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
    const n = payload.length;
    let head;
    if (n < 126) { head = Buffer.from([0x80 | op, n]); }
    else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(n, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
    try { this.s.write(Buffer.concat([head, payload])); } catch { this.closed(); }
  }
}

// ---------------- 房间 ----------------
const rooms = new Map(); // code -> { code, host, guest, name, info }
function code() { let c; do { c = String(1000 + Math.floor(Math.random() * 9000)); } while (rooms.has(c)); return c; }
function openRooms() { return [...rooms.values()].filter((r) => !r.guest).map((r) => ({ room: r.code, name: r.hostName, info: r.info })); }

server.on('upgrade', (req, socket) => {
  if (!req.url.startsWith('/ws')) { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const ws = new Sock(socket);
  let room = null, role = null;
  ws.onmessage = (m) => {
    switch (m.t) {
      case 'list': ws.send({ t: 'rooms', rooms: openRooms() }); break;
      case 'create': {
        room = { code: code(), host: ws, guest: null, hostName: String(m.name || '玩家').slice(0, 16), info: m.info || {} };
        rooms.set(room.code, room); role = 'host';
        ws.send({ t: 'created', room: room.code });
        log(`房间 ${room.code} 创建：${room.hostName}`);
        break;
      }
      case 'join': {
        const r = rooms.get(String(m.room));
        if (!r) { ws.send({ t: 'error', msg: '房间不存在' }); break; }
        if (r.guest) { ws.send({ t: 'error', msg: '房间已满' }); break; }
        r.guest = ws; room = r; role = 'guest';
        ws.detach = () => { room = null; role = null; };
        const name = String(m.name || '玩家').slice(0, 16);
        ws.send({ t: 'joined', room: r.code, host: r.hostName, info: r.info });
        r.host.send({ t: 'peer', name, info: m.info || {} });
        log(`房间 ${r.code}：${name} 加入`);
        break;
      }
      case 'relay': {
        if (!room) break;
        const peer = role === 'host' ? room.guest : room.host;
        if (peer) peer.send({ t: 'relay', d: m.d });
        break;
      }
      case 'ping': ws.send({ t: 'pong', ts: m.ts }); break;
      case 'leave': cleanup(); break;
    }
  };
  const cleanup = () => {
    if (!room) return;
    const r = room; room = null;
    if (role === 'host') {
      if (r.guest) { r.guest.send({ t: 'left', who: 'host' }); if (r.guest.detach) r.guest.detach(); }
      rooms.delete(r.code);
      log(`房间 ${r.code} 关闭`);
    } else if (r.guest === ws && rooms.get(r.code) === r) {
      r.guest = null;
      r.host.send({ t: 'left', who: 'guest' });
    }
  };
  ws.onclose = cleanup;
});

function log(s) { console.log(new Date().toLocaleTimeString(), s); }

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`荣耀服务器已启动：`);
  console.log(`  本机    http://localhost:${PORT}/`);
  for (const ip of ips) console.log(`  局域网  http://${ip}:${PORT}/`);
});
