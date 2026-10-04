// Vercel 函数：联机牵线（逻辑见 server/sig-core.mjs）。
// 存储：配置了 Upstash Redis（Vercel Marketplace，环境变量 KV_REST_API_URL / KV_REST_API_TOKEN
// 或 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN）时用 Redis；否则返回明确错误，让客户端使用手动连接码，避免多实例下生成失效房间号。
import { handleSig, HttpError } from '../server/sig-core.mjs';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

function redisStore() {
  const cmd = async (args) => {
    const r = await fetch(URL_, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    if (!r.ok) throw new HttpError(502, '房间服务存储出错');
    return (await r.json()).result;
  };
  return {
    async get(k) { const v = await cmd(['GET', k]); return v ? JSON.parse(v) : null; },
    async set(k, val, ttl = 900) { await cmd(['SET', k, JSON.stringify(val), 'EX', String(ttl)]); },
  };
}

const store = URL_ && TOKEN ? redisStore() : null;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!store) { res.status(503).json({ error: '房间号服务尚未配置持久化存储，请使用手动连接码' }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: '只接受 POST' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    res.status(200).json(await handleSig(body, store));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : '房间服务出错' });
  }
}
