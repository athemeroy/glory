#!/usr/bin/env node
// 荣耀本地服务器：静态文件 + 联机牵线接口 POST /api/sig（逻辑见 sig-core.mjs，与 Vercel 函数 api/sig.js 共用）。
// 联机的游戏数据走浏览器直连（WebRTC），不经过本服务器。零依赖（Node ≥ 18）。
// 用法：node server/server.mjs [端口，默认 8780]，然后浏览器打开 http://<本机IP>:端口/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { iceConfiguration } from './ice-config.mjs';
import { handleSig, memoryStore } from './sig-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = parseInt(process.argv[2] || process.env.PORT || '8780', 10);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.md': 'text/markdown; charset=utf-8', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary' };
const store = memoryStore();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/ice') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(iceConfiguration())); return; }
  if (url.pathname === '/api/sig') { sig(req, res); return; }
  let p = decodeURIComponent(url.pathname);
  if (p === '/' || p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || p.startsWith('/server/') || p.startsWith('/api/') || p.includes('/.')) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});

function sig(req, res) {
  const reply = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  if (req.method !== 'POST') { reply(405, { error: '只接受 POST' }); return; }
  let body = '';
  req.on('data', (d) => { body += d; if (body.length > 40000) req.destroy(); });
  req.on('end', async () => {
    try {
      const out = await handleSig(JSON.parse(body || '{}'), store);
      if (out.room && body.includes('"op":"new"')) log(`房间 ${out.room} 创建`);
      reply(200, out);
    } catch (e) { reply(e.status || 500, { error: e.status ? e.message : '房间服务出错' }); }
  });
}

function log(s) { console.log(new Date().toLocaleTimeString(), s); }

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`荣耀服务器已启动：`);
  console.log(`  本机    http://localhost:${PORT}/`);
  for (const ip of ips) console.log(`  局域网  http://${ip}:${PORT}/`);
});
