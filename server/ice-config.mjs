import { createHmac, randomBytes } from 'node:crypto';

// Coturn REST credentials expire after one hour; the shared secret stays on the server.
export function iceConfiguration(env = process.env) {
  const urls = String(env.TURN_URLS || '').split(',').map(s => s.trim()).filter(s => /^turns?:[^\s]+$/.test(s));
  if (!urls.length || !env.TURN_SECRET) return { iceServers: [], relayAvailable: false };
  const username = `${Math.floor(Date.now() / 1000) + 3600}:glory-${randomBytes(8).toString('hex')}`;
  const credential = createHmac('sha1', env.TURN_SECRET).update(username).digest('base64');
  return { iceServers: [{ urls, username, credential }], relayAvailable: true };
}
