import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { pack, unpack, P2PNet } from '../src/engine/p2p.js';
import { iceConfiguration } from '../server/ice-config.mjs';
import { handleSig, memoryStore } from '../server/sig-core.mjs';
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };
const fingerprint = Array(32).fill('AA').join(':');
const candidates = [
  'a=candidate:1 1 udp 2122260223 device.local 5555 typ host',
  'a=candidate:2 1 udp 1686052607 203.0.113.1 4444 typ srflx raddr 192.168.1.2 rport 5555',
  'a=candidate:3 1 udp 16777215 203.0.113.2 3333 typ relay raddr 203.0.113.1 rport 4444',
  'a=candidate:4 1 tcp 1518280447 device.local 9 typ host tcptype active',
];
const desc = { type:'offer',sdp:['v=0','a=ice-ufrag:abcd','a=ice-pwd:abcdefghijklmnopqrstuv',`a=fingerprint:sha-256 ${fingerprint}`,'a=setup:actpass',...candidates,''].join('\r\n') };
await test('Preserve all candidate types, priorities and related addresses',()=>{
  const rebuilt=unpack(pack(desc));assert.equal(rebuilt.type,'offer');for(const c of candidates)assert.ok(rebuilt.sdp.includes(c));
});
await test('Legacy G1 codes remain readable',()=>{
  const o=JSON.parse(Buffer.from(pack(desc).slice(2),'base64url'));delete o.l;
  assert.ok(unpack('G1'+Buffer.from(JSON.stringify(o)).toString('base64url')).sdp.includes('typ srflx'));
});
await test('Malformed code rejected',()=>{assert.throws(()=>unpack('G1abc'));assert.throws(()=>unpack('x'));});
await test('Wrong offer pasted as answer does not poison retry',async()=>{
  const net=new P2PNet();net.pc={setRemoteDescription:async()=>{}};
  await assert.rejects(net.acceptAnswer(pack(desc)),/回复码/);assert.ok(!net.remoteSet);
  await net.acceptAnswer(pack({...desc,type:'answer'}));assert.equal(net.remoteSet,true);clearTimeout(net._connTo);
});
await test('Browser SDP rejection leaves answer retryable',async()=>{
  const net=new P2PNet();net.pc={setRemoteDescription:async()=>{throw Error('bad sdp');}};
  await assert.rejects(net.acceptAnswer(pack({...desc,type:'answer'})));assert.ok(!net.remoteSet);
});
await test('Manual reply deadline is three minutes, direct connection deadline 45 seconds',()=>{
  const original=globalThis.setTimeout;let delay;globalThis.setTimeout=(fn,ms)=>{delay=ms;return 0;};
  try{const net=new P2PNet();net.armTimeout(180000);assert.equal(delay,180000);net.armTimeout();assert.equal(delay,45000);}finally{globalThis.setTimeout=original;}
});
await test('TURN secret stays server-side with short-lived valid HMAC credentials',()=>{
  const cfg=iceConfiguration({TURN_URLS:'turn:relay.example:3478,turns:relay.example:5349',TURN_SECRET:'test-only-secret'});
  assert.equal(cfg.relayAvailable,true);const s=cfg.iceServers[0];assert.equal(s.urls.length,2);
  assert.equal(s.credential,createHmac('sha1','test-only-secret').update(s.username).digest('base64'));
  assert.ok(Number(s.username.split(':')[0])>Date.now()/1000+3500);assert.ok(!JSON.stringify(cfg).includes('test-only-secret'));
  assert.deepEqual(iceConfiguration({}),{iceServers:[],relayAvailable:false});
});
await test('Signaling accepts larger complete-candidate codes',async()=>{
  const store=memoryStore();const offer='G1'+'a'.repeat(6000);const {room}=await handleSig({op:'new',offer},store);
  assert.equal((await handleSig({op:'get',room},store)).offer,offer);
});
await test('Vercel without persistent storage refuses unreliable room numbers', async () => {
  const { default: handler } = await import('../api/sig.js');
  let status, body;
  const res = { setHeader() {}, status(n) { status=n; return this; }, json(o) { body=o; } };
  await handler({method:'POST',body:{op:'new',offer:pack(desc)}},res);
  assert.equal(status,503); assert.match(body.error,/持久化存储/);
});
console.log(JSON.stringify({passed,total:9}));
