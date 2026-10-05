// 联机牵线服务（房间号 ↔ 连接码）。本地 server.mjs 与 Vercel 函数 api/sig.js 共用。
// 只保存双方的连接码（约 200 字符）15 分钟，不转发任何游戏数据。
// 请求：POST { op, ... }
//   new    { offer, pw, name, acc }  → { room }          房主登记连接码，得到 6 位房间号
//   get    { room, pw }              → { offer, name, acc } 加入方取房主的连接码
//   answer { room, pw, answer }      → { ok }            加入方交回回复码
//   poll   { room, pw }              → { answer|null }   房主轮询回复码
// pw 是客户端对密码做的哈希（没设密码时为空串）。

const TTL = 15 * 60;
const MAX_CODE = 16000;

export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// 内存存储（本地服务器；Vercel 未配置 Redis 时的退路）
export function memoryStore() {
  const m = new Map();
  return {
    async get(k) { const v = m.get(k); if (!v) return null; if (v.exp < Date.now()) { m.delete(k); return null; } return v.val; },
    async set(k, val, ttl = TTL) { m.set(k, { val, exp: Date.now() + ttl * 1000 }); if (m.size > 5000) for (const [kk, v] of m) if (v.exp < Date.now()) m.delete(kk); },
  };
}

const str = (v, max) => String(v ?? '').slice(0, max);

export async function handleSig(body, store) {
  const op = body && body.op;
  const room = str(body && body.room, 6).replace(/\D/g, '');
  const pw = str(body && body.pw, 64);
  const load = async () => {
    const r = room.length === 6 ? await store.get('glory:r:' + room) : null;
    if (!r) throw new HttpError(404, '房间不存在或已过期');
    if (r.pw !== pw) throw new HttpError(403, '密码不对');
    return r;
  };
  switch (op) {
    case 'new': {
      const offer = str(body.offer, MAX_CODE + 1);
      if (!offer.startsWith('G1') || offer.length > MAX_CODE) throw new HttpError(400, '连接码无效');
      let code = '';
      for (let i = 0; i < 20 && !code; i++) {
        const c = String(Math.floor(100000 + Math.random() * 900000));
        if (!(await store.get('glory:r:' + c))) code = c;
      }
      if (!code) throw new HttpError(503, '房间号用完了，请稍后再试');
      await store.set('glory:r:' + code, { offer, pw, name: str(body.name, 16), acc: str(body.acc, 8), answer: null });
      return { room: code };
    }
    case 'get': {
      const r = await load();
      if (r.answer) throw new HttpError(409, '房间已有人加入');
      return { offer: r.offer, name: r.name, acc: r.acc };
    }
    case 'answer': {
      const r = await load();
      const answer = str(body.answer, MAX_CODE + 1);
      if (!answer.startsWith('G1') || answer.length > MAX_CODE) throw new HttpError(400, '回复码无效');
      if (r.answer) throw new HttpError(409, '房间已有人加入');
      r.answer = answer;
      await store.set('glory:r:' + room, r);
      return { ok: true };
    }
    case 'poll': {
      const r = await load();
      return { answer: r.answer || null };
    }
    default: throw new HttpError(400, '未知操作');
  }
}
