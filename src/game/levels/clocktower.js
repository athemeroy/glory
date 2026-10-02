// 钟楼旧街：两条街道绕过实体钟楼，西侧阶梯连通 2.4m 高廊。
import * as THREE from 'three';
import { Kit, canvasTex, rng, TAU } from './kit.js';
import { baseMats, flatRing, brazier } from './props.js';
import { crate, coverWall, lamp, gate, house, routeStrip, rail } from './story-props.js';

export function buildClocktower(ctx) {
  const kit = new Kit(ctx, 'clocktower', '钟楼旧街'), R = rng(7216);
  baseMats(kit, { trim: 0xddc8a7 });
  kit.mat('street', { tex: 'stone', tile: 2.1, color: 0xaaa18e, roughness: .92, bump: .018 });
  kit.mat('masonry', { tex: 'stone', tile: 1.5, color: 0xc8b99c, roughness: .85, bump: .025 });
  kit.mat('stoneDark', { tex: 'stone', tile: 1.4, color: 0x787975, roughness: .93 });
  kit.mat('plaster', { tex: 'stone', tile: 2.6, color: 0xc2b398, roughness: .95 });
  kit.mat('plasterRed', { tex: 'stone', tile: 2.6, color: 0xab8270, roughness: .95 });
  kit.mat('roof', { tex: 'iron', tile: 1, color: 0x485d60, roughness: .77, metalness: .12 });
  kit.mat('window', { color: 0x243b45, emissive: 0xffbd6a, emissiveIntensity: .12, roughness: .5 });
  kit.mat('route', { color: 0xd2b170, emissive: 0xc79437, emissiveIntensity: .18, roughness: .8 });
  kit.mat('green', { color: 0x53675b, roughness: 1 });
  const sd = [.52, .72, .45];
  kit.sky({ top: 0x345773, horizon: 0xe1b785, bottom: 0xa7aeb0, sunDir: sd, sunColor: 0xffc27d, clouds: .48, cloudShade: 0x8c97a2 });
  kit.hemi(0xbeced7, 0x797363, 1.05);
  kit.sun({ dir: sd, color: 0xffdeb0, intensity: 2.7, extent: 38, center: [0, 4, 0], dist: 85 });
  kit.mountains({ seed: 47, count: 14, rMin: 160, rMax: 220, hMin: 65, hMax: 120, base: -40, colTop: 0x687786, colMid: 0x829099, colBase: 0xb9b6ae, seg: 12, hseg: 8 });
  kit.slab('street', [-22.5, -.5, -25.5], [22.5, 0, 25.5], { cast: false });
  // Side gutters break up the cobbled ground without creating unseen trip hazards.
  for (const x of [-5.1, 5.1]) kit.box('stoneDark', [x, .002, 0], [.18, .006, 46], { cast: false });
  for (const z of [-14, 15]) kit.box('stoneDark', [0, .003, z], [34, .006, .2], { cast: false });
  routeStrip(kit, [[0, 19], [-10, 16], [-10, 12]]);
  routeStrip(kit, [[-10, 8], [-10, -6]], 2.414);
  routeStrip(kit, [[-10, -10], [-10, -12], [0, -12], [0, -17]]);

  // Solid tower body, visible buttresses and roof. A sword cannot pass through it.
  kit.solid('masonry', [-3.25, 0, -3.25], [3.25, 14.5, 3.25], 'building');
  kit.solid('stoneDark', [-3.6, 0, -3.6], [3.6, .45, 3.6], 'building');
  for (const y of [3.3, 7.1, 11.2, 14.3]) kit.box('stoneTrim', [0, y, 0], [6.9, .25, 6.9]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.box('stoneDark', [sx * 3.15, 7.3, sz * 3.15], [.42, 14.6, .42]);
  for (const s of [-1, 1]) {
    kit.box('woodDark', [s * 2.45, 1.25, 3.285], [.75, 2.5, .06]);
    kit.box('window', [s * 1.55, 5.2, 3.29], [.75, 1.65, .05]);
    kit.box('window', [s * 1.55, 5.2, -3.29], [.75, 1.65, .05]);
  }
  const roof = new THREE.CylinderGeometry(.4, 5.6, 4.3, 4);
  roof.rotateY(Math.PI / 4); kit.add('roof', roof, { pos: [0, 16.55, 0] });
  kit.collider([-3.85, 14.5, -3.85], [3.85, 18.7, 3.85], 'roof');
  kit.cyl('bronze', [0, 18.6, 0], .05, .1, 1.8, 8);
  kit.box('bronze', [0, 20, 0], [1.3, .08, .1]);
  clockFaces(kit);

  // Roofed homes leave clear west/east streets and a broad northern encounter square.
  for (const [x, z, w, d, h, color] of [
    [-18, 16, 7, 6, 7.3, 'plaster'], [17.5, 15, 8, 7, 8.2, 'plasterRed'],
    [18, 4, 7, 7, 6.2, 'plaster'], [18, -7, 7, 7, 9.1, 'plasterRed'],
    [-18.5, -15, 6, 7, 8.4, 'plasterRed'], [16.5, -20, 10, 6, 6.7, 'plaster'],
  ]) house(kit, x, z, w, d, h, color);
  // A tall wall behind the gallery makes the playable route readable at eye height.
  kit.solid('masonry', [-16, 0, -7], [-14.8, 8, 9], 'building');
  kit.box('roof', [-15.4, 8.2, 1], [2, .45, 17]);
  for (const z of [-5, -1, 3, 7]) kit.box('window', [-14.785, 5.6, z], [.04, 1.6, 1]);
  kit.solid('masonry', [-14, 0, -6], [-6, 2.4, 8], 'platform');
  kit.box('stoneTrim', [-10, 2.32, 1], [8.2, .16, 14.2]);
  kit.stairs('stoneTrim', { x: -10, z: 12, dir: 'z-', width: 4, height: 2.4, steps: 8, depth: .5 });
  kit.stairs('stoneTrim', { x: -10, z: -10, dir: 'z+', width: 4, height: 2.4, steps: 8, depth: .5 });
  rail(kit, [-6.2, -5.9], [-6.2, 7.9], 2.4, .95);
  rail(kit, [-13.8, -5.9], [-13.8, 7.9], 2.4, .95);
  for (const z of [-5, 7]) lamp(kit, -13, 2.4, z);
  crate(kit, -8.4, 2.4, -.8, 1.05);
  crate(kit, -12.6, 2.4, -.5, .9);

  // Northern gate rises another 1.2m using legal .3m steps.
  kit.solid('masonry', [-4.5, 0, -24.5], [4.5, 1.2, -19], 'platform');
  kit.stairs('stoneTrim', { x: 0, z: -17, dir: 'z-', width: 5.4, height: 1.2, steps: 4, depth: .5 });
  gate(kit, 0, 1.2, -22.6, 5.4);
  for (const s of [-1, 1]) { brazier(kit, s * 3.7, -21.7, { y0: 1.2, ped: .65, fs: .7 }); lamp(kit, s * 6.8, 0, -15.8); }
  coverWall(kit, 5.6, -9.1, 3.2, 1.12);
  coverWall(kit, -6.2, -15.8, 3.5, 1.3);
  crate(kit, 7.7, 0, 7, 1.35); crate(kit, 8.9, 0, 7.2, .95); crate(kit, -5.8, 0, 20.5, .95);
  for (const s of [-1, 1]) lamp(kit, s * 5.9, 0, 19.8);
  flatRing(kit, 'route', -10, 2.416, 4, .68, .76, 40);
  flatRing(kit, 'route', 0, 1.216, -21, .85, .94, 40);
  // Physical outer walls; the gateway openings are scenery beyond the boundary.
  for (const x of [-22.4, 22.4]) kit.solid('masonry', [x - .35, 0, -25.5], [x + .35, 3, 25.5], 'wall');
  for (const z of [-25.4, 25.4]) kit.solid('masonry', [-22.5, 0, z - .35], [22.5, 2.7, z + .35], 'wall');
  for (let i = 0; i < 20; i++) {
    const x = -23.8 - R() * 6, z = -22 + R() * 44;
    kit.cyl('woodDark', [x, 0, z], .18, .23, 3.4, 7);
    kit.add('green', new THREE.IcosahedronGeometry(1.55, 1), { pos: [x, 4.2, z], scale: [1.1, 1.2, .9], cast: false });
  }
  kit.finish();
  const background = new THREE.Color(0xb9b5ad), fog = new THREE.Fog(0xb9b5ad, 55, 280);
  kit.bakeEnv([7, 3, 10], background, .5);
  return kit.result({ background, fog, bounds: { minX: -22, maxX: 22, minZ: -25, maxZ: 25 },
    spawns: { player: [0, 0, 19, Math.PI], enemy: [0, 0, -12, 0], teamA: [[0, 0, 19, Math.PI], [-2, 0, 20, Math.PI], [2, 0, 20, Math.PI]], teamB: [[0, 0, -12, 0], [-2, 0, -13, 0], [2, 0, -13, 0]] },
    markers: { story: { waypoint: [-10, 2.4, 4], encounter: [0, 0, -12], exit: [0, 1.2, -21] },
      route: [[0, 0, 19], [-10, 0, 16], [-10, 0, 12.5], [-10, 2.4, 8], [-10, 2.4, 4], [-10, 2.4, -6], [-10, 0, -10.6], [-10, 0, -12], [0, 0, -12], [0, 0, -16.5], [0, 1.2, -19], [0, 1.2, -21]],
      platforms: [{ min: [-14, 0, -6], max: [-6, 2.4, 8], top: 2.4 }], covers: [[5.6, -9.1], [-6.2, -15.8], [7.7, 7]] },
  });
}

function clockFaces(kit) {
  const texture = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#e6d9b7'; g.fillRect(0, 0, w, h); g.translate(w / 2, h / 2);
    g.strokeStyle = '#5b4732'; g.lineWidth = 14; g.beginPath(); g.arc(0, 0, 237, 0, TAU); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 196, 0, TAU); g.stroke();
    const nums = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    g.fillStyle = '#413d37'; g.font = 'bold 32px Georgia'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < 60; i++) { const a = i * TAU / 60, r = i % 5 ? 221 : 213; g.lineWidth = i % 5 ? 2 : 4; g.beginPath(); g.moveTo(Math.sin(a) * r, -Math.cos(a) * r); g.lineTo(Math.sin(a) * 229, -Math.cos(a) * 229); g.stroke(); }
    nums.forEach((n, i) => { const a = i * TAU / 12; g.fillText(n, Math.sin(a) * 176, -Math.cos(a) * 176); });
  });
  kit.disposables.push(texture);
  kit.mat('clock-face', { map: texture, color: 0xffffff, roughness: .8 });
  const handMat = new THREE.MeshStandardMaterial({ color: 0x292d32, roughness: .6, metalness: .35 });
  kit.disposables.push(handMat);
  for (let side = 0; side < 4; side++) {
    const yaw = side * Math.PI / 2, group = new THREE.Group(); group.position.set(Math.sin(yaw) * 3.29, 10, Math.cos(yaw) * 3.29); group.rotation.y = yaw;
    kit.add('clock-face', new THREE.CircleGeometry(1.75, 48), { pos: group.position.toArray(), rotY: yaw, uv: 'keep' });
    kit.add('bronze', new THREE.TorusGeometry(1.77, .075, 6, 48), { pos: group.position.toArray(), rotY: yaw });
    const hands = [];
    for (const len of [.85, 1.35]) { const pivot = new THREE.Group(), geo = new THREE.BoxGeometry(.09, len, .05), mesh = new THREE.Mesh(geo, handMat); mesh.position.set(0, len / 2 - .1, .045); pivot.add(mesh); group.add(pivot); hands.push(pivot); kit.disposables.push(geo); }
    const pinGeo = new THREE.SphereGeometry(.12, 12, 8), pin = new THREE.Mesh(pinGeo, handMat); pin.position.z = .085; group.add(pin); kit.disposables.push(pinGeo);
    kit.group.add(group); kit.updaters.push((dt, t) => { hands[0].rotation.z = -Math.PI / 3 - t / 720; hands[1].rotation.z = Math.PI / 3 - t / 60; });
  }
}
