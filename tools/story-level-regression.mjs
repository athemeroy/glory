// Full level builders and real World physics, without a renderer. Canvas only
// provides the small decorative atlas API; no GPU or network is needed.
import * as THREE from '../vendor/three.module.js';
import { buildLevel } from '../src/game/levels.js';
import { World } from '../src/game/world.js';

const gradient = () => ({ addColorStop() {} });
const context = new Proxy({}, { get: (target, name) => name === 'createRadialGradient' || name === 'createLinearGradient' ? gradient : name === 'getImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : name === 'measureText' ? text => ({ width: text.length * 10 }) : () => {}, set: () => true });
globalThis.document = { createElement: () => ({ width: 512, height: 512, getContext: () => context }) };
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const reports = [];

for (const id of ['clocktower', 'frostbridge']) {
  const L = buildLevel(id, { tex: () => null, quality: 'high', noEnv: true }), w = new World(); w.setLevel(L);
  const walk = route => {
    const f = { pos: new THREE.Vector3(...route[0]), vel: new THREE.Vector3(), radius: .32, height: 1.8, collisionHeight: 1.8, onGround: true }, samples = [];
    for (let i = 1; i < route.length; i++) {
      const target = new THREE.Vector3(...route[i]); let frames = 0, blocks = 0;
      for (; frames < 1500; frames++) {
        const d = new THREE.Vector3(target.x - f.pos.x, 0, target.z - f.pos.z), len = d.length();
        if (len < .08 && Math.abs(f.pos.y - target.y) < .15) break;
        if (len > .01) d.multiplyScalar(Math.min(len, 3.5 / 60) / len);
        if (!f.onGround) f.vel.y -= 18 / 60; else f.vel.y = 0;
        const r = w.resolve(f, f.pos.x + d.x, f.pos.y + f.vel.y / 60, f.pos.z + d.z);
        f.pos.set(r.x, r.y, r.z); f.onGround = r.grounded; if (r.grounded) f.vel.y = 0;
        if (r.wallHit) blocks++; if (f.pos.y < -20) break;
      }
      const sample = { target: route[i], actual: f.pos.toArray(), frames, blocks, passed: f.pos.distanceTo(target) < .19 }; samples.push(sample);
      assert(sample.passed, id + ' blocked route: ' + JSON.stringify(sample));
    }
    return samples;
  };
  const routes = { main: walk(L.markers.route) }; if (L.markers.alternateRoute) routes.alternate = walk(L.markers.alternateRoute);
  for (const c of L.colliders) assert(c.min.every((v, i) => Number.isFinite(v) && v < c.max[i]), id + ' invalid collider ' + JSON.stringify(c));
  const cover = L.markers.covers.map(([x, z]) => {
    const blocked = w.blocked(new THREE.Vector3(x, .6, z + 2), new THREE.Vector3(x, .6, z - 2));
    const clearAbove = !w.blocked(new THREE.Vector3(x, 2.6, z + 2), new THREE.Vector3(x, 2.6, z - 2));
    assert(blocked && clearAbove, id + ' cover occlusion: ' + [x, z]); return { pos: [x, z], blocked, clearAbove };
  });
  for (const [name, data] of Object.entries(L.spawns)) for (const p of Array.isArray(data[0]) ? data : [data]) {
    assert(Math.abs(w.floorHeight(p[0], p[2]) - p[1]) < .001, id + ' spawn on obstacle: ' + name);
  }
  if (L.floorAt) { assert(L.floorAt(7, 0) === -30 && L.floorAt(7, 18) === 0 && w.floorHeight(0, 0) === 1.8, 'frostbridge floor mismatch'); }
  let disposed = 0, resources = new Set(); L.group.traverse(o => { if (o.geometry) resources.add(o.geometry); if (o.material) resources.add(o.material); });
  for (const r of resources) r.addEventListener('dispose', () => disposed++);
  let shadowDisposed = false;L.sun.shadow.map = { dispose() { shadowDisposed = true; } };
  const colliders = L.colliders.length; L.dispose(); assert(L.group.children.length === 0 && disposed >= resources.size && shadowDisposed, id + ' disposal failed');
  reports.push({ id, colliders, routes, cover, resources: resources.size, disposed });
}
console.log(JSON.stringify({ maps: reports, passed: true }, null, 2));
