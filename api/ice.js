import { iceConfiguration } from '../server/ice-config.mjs';
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: '只接受 GET' });
  return res.status(200).json(iceConfiguration());
}
