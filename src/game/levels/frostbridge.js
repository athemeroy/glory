// 霜溪古桥：有栏杆的 1.8m 石桥与 .6m 西侧便桥都可过河。
import * as THREE from 'three';
import { Kit, rng } from './kit.js';
import { baseMats, brazier, archGeo, flatRing } from './props.js';
import { crate, coverWall, lamp, gate, routeStrip, rail } from './story-props.js';

export function buildFrostbridge(ctx) {
  const kit = new Kit(ctx, 'frostbridge', '霜溪古桥'), R = rng(6301);
  baseMats(kit, { trim: 0xc8d4db, iron: 0x94a6b4 });
  kit.mat('snow', { tex: 'stone', tile: 3.5, color: 0xe4eaf0, roughness: .95, bump: .007 });
  kit.mat('masonry', { tex: 'stone', tile: 1.6, color: 0x9aafb9, roughness: .82, bump: .024 });
  kit.mat('stoneDark', { tex: 'stone', tile: 1.3, color: 0x607989, roughness: .9 });
  kit.mat('path', { tex: 'stone', tile: 1.7, color: 0xacbdc8, roughness: .85, bump: .012 });
  kit.mat('ice', { color: 0x8cbacb, roughness: .35, metalness: .1 });
  kit.mat('pine', { color: 0x466b72, roughness: 1 });
  kit.mat('route', { color: 0xbda169, emissive: 0xb08137, emissiveIntensity: .12, roughness: .7 });
  const sd = [-.65, .8, .36];
  kit.sky({ top: 0x254969, horizon: 0xb8d0dc, bottom: 0xc3d1da, sunDir: sd, sunColor: 0xe1f1ff, clouds: .63, cloudShade: 0x8ea6bc });
  kit.hemi(0xc5def0, 0x72828c, 1.1);
  kit.sun({ dir: sd, color: 0xe1efff, intensity: 2.55, extent: 43, center: [0, 1, 0], dist: 100 });
  kit.mountains({ seed: 78, count: 22, rMin: 140, rMax: 240, hMin: 95, hMax: 190, base: -45, aspect: [.2, .35], colTop: 0xe0e9f0, colMid: 0x819aaa, colBase: 0xafc1ce, seg: 14, hseg: 10 });
  // Banks end visibly at the river; floorAt below removes the invisible ground.
  for (const s of [-1, 1]) {
    const lo = s > 0 ? 9 : -31.6, hi = s > 0 ? 31.6 : -9;
    kit.slab('masonry', [-23.6, -5, lo], [23.6, -.25, hi], { cast: false });
    kit.slab('snow', [-23.6, -.25, lo], [23.6, 0, hi], { cast: false });
    kit.box('path', [0, .008, s * 22], [6.2, .015, 17.5], { cast: false });
    routeStrip(kit, [[0, s * 27], [0, s * 14]], .023);
  }
  flowingRiver(kit);

  // Main deck and matching collision. Supports leave open water between them.
  kit.solid('masonry', [-4, 1.2, -10], [4, 1.8, 10], 'platform');
  kit.box('path', [0, 1.804, 0], [7.55, .008, 19.9], { cast: false });
  kit.stairs('stoneTrim', { x: 0, z: 13.6, dir: 'z-', width: 6.2, height: 1.8, steps: 6, depth: .6 });
  kit.stairs('stoneTrim', { x: 0, z: -13.6, dir: 'z+', width: 6.2, height: 1.8, steps: 6, depth: .6 });
  for (const z of [-8.8, 0, 8.8]) kit.solid('stoneDark', [-3.8, -5, z - .75], [3.8, 1.2, z + .75], 'pier');
  for (const sx of [-1, 1]) {
    rail(kit, [sx * 3.8, -9.9], [sx * 3.8, 9.9], 1.8, 1.05);
    // Two vaults are oriented along the river-facing sides of the bridge.
    for (const z of [-4.4, 4.4]) kit.add('masonry', archGeo(3.55, 0, .6, .5, 1, 16), { pos: [sx * 3.5, -3, z], rotY: Math.PI / 2 });
    for (const z of [-8, 8]) { kit.box('stoneTrim', [sx * 3.85, 3.1, z], [.52, .48, .52]); lamp(kit, sx * 3.5, 2.87, z); }
  }
  routeStrip(kit, [[0, 10], [0, -10]], 1.824);
  flatRing(kit, 'route', 0, 1.826, -4, .7, .78, 44);

  // Narrow lower bridge: a useful alternate height and flanking route.
  kit.solid('woodDark', [-15.5, .28, -9.6], [-10.5, .6, 9.6], 'platform');
  for (let z = -9.45; z < 9.6; z += .48) kit.box('wood', [-13, .58, z], [5.1, .08, .045]);
  kit.stairs('stoneTrim', { x: -13, z: 10.8, dir: 'z-', width: 4, height: .6, steps: 2, depth: .6 });
  kit.stairs('stoneTrim', { x: -13, z: -10.8, dir: 'z+', width: 4, height: .6, steps: 2, depth: .6 });
  for (const x of [-15.3, -10.7]) {
    for (const z of [-8, -4, 0, 4, 8]) kit.cyl('woodDark', [x, -5, z], .13, .17, 6.7, 8);
    kit.box('woodDark', [x, 1.6, 0], [.12, .14, 19.2]);
    kit.collider([x - .1, .6, -9.6], [x + .1, 1.85, 9.6], 'rail');
  }
  for (const z of [-8, 8]) lamp(kit, -15.2, .6, z);
  // Rail along the dangerous water edge, leaving both stair mouths open.
  for (const z of [-9, 9]) {
    rail(kit, [-23, z], [-16, z], 0, 1);
    rail(kit, [-10, z], [-4.4, z], 0, 1);
    rail(kit, [4.4, z], [23, z], 0, 1);
  }
  coverWall(kit, -5.2, 19.1, 3, 1.14);
  coverWall(kit, 6.4, -18, 3.2, 1.22);
  coverWall(kit, -6.8, -22, 3.7, 1.05);
  crate(kit, 5.5, 0, 16, 1.15); crate(kit, 6.7, 0, 16.1, .9); crate(kit, -7.1, 0, -16.5, 1.25);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    brazier(kit, sx * 4.5, sz * 14.7, { ped: .9, fs: .72 });
    kit.box('snow', [sx * 4.5, .88, sz * 14.7], [.85, .045, .85], { cast: false });
  }
  gate(kit, 0, 0, -28.3, 6);
  for (const sx of [-1, 1]) {
    kit.solid('masonry', [sx * 8 - 1.8, 0, -30], [sx * 8 + 1.8, 4.3, -27], 'wall');
    kit.box('snow', [sx * 8, 4.3, -28.5], [3.8, .16, 3.2]);
  }
  flatRing(kit, 'route', 0, .022, -27, .85, .96, 40);
  // Outer scene: trees and rocks stay beyond the playable rail rather than blocking paths invisibly.
  for (let i = 0; i < 34; i++) {
    const sx = i % 2 ? 1 : -1, x = sx * (19 + R() * 15), z = (R() > .5 ? 1 : -1) * (12 + R() * 31), h = 5 + R() * 6;
    kit.pine('pine', 'woodDark', [x, 0, z], h, R);
    for (let j = 0; j < 3; j++) kit.add('snow', new THREE.ConeGeometry((h * .27) * (1 - j * .2), h * .35, 8), { pos: [x, h * (.4 + j * .18), z], cast: false });
    if (Math.abs(x) < 23 && Math.abs(z) < 31) kit.collider([x - .3, 0, z - .3], [x + .3, 3, z + .3], 'tree');
  }
  for (const x of [-23.4, 23.4]) kit.solid('stoneDark', [x - .3, -.2, -31.5], [x + .3, .9, 31.5], 'wall');
  for (const z of [-31.4, 31.4]) kit.solid('stoneDark', [-23.5, -.2, z - .3], [23.5, 1.1, z + .3], 'wall');
  snowfall(kit, R);
  kit.finish();
  const background = new THREE.Color(0xb9cdda), fog = new THREE.Fog(0xb9cdda, 55, 310);
  kit.bakeEnv([0, 4, 16], background, .45);
  return kit.result({ background, fog, bounds: { minX: -23, maxX: 23, minZ: -31, maxZ: 31 },
    floorAt: (x, z) => Math.abs(z) < 9 ? -30 : 0,
    spawns: { player: [0, 0, 25, Math.PI], enemy: [0, 0, -18, 0], teamA: [[0, 0, 25, Math.PI], [-2, 0, 26, Math.PI], [2, 0, 26, Math.PI]], teamB: [[0, 0, -18, 0], [-2, 0, -19, 0], [2, 0, -19, 0]] },
    markers: { story: { waypoint: [0, 1.8, -4], encounter: [0, 0, -18], exit: [0, 0, -27] },
      route: [[0, 0, 25], [0, 0, 14], [0, 1.8, 10], [0, 1.8, -4], [0, 1.8, -10], [0, 0, -14], [0, 0, -18], [0, 0, -27]],
      alternateRoute: [[-13, 0, 14], [-13, 0, 11], [-13, .6, 9], [-13, .6, -9], [-13, 0, -11], [-13, 0, -14]],
      platforms: [{ min: [-4, 1.2, -10], max: [4, 1.8, 10], top: 1.8 }, { min: [-15.5, .28, -9.6], max: [-10.5, .6, 9.6], top: .6 }], covers: [[-5.2, 19.1], [6.4, -18], [-6.8, -22]], hazards: ['river'] },
  });
}

function flowingRiver(kit) {
  const g = new THREE.PlaneGeometry(180, 18, 1, 1); g.rotateX(-Math.PI / 2);
  const m = new THREE.ShaderMaterial({ uniforms: { uTime: kit.uTime }, transparent: true, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `uniform float uTime; varying vec2 vUv;
      void main(){float wave=sin(vUv.x*250.-uTime*1.5+sin(vUv.y*18.))*sin(vUv.y*32.+uTime*.6);float rip=pow(max(0.,wave),8.);
      vec3 col=mix(vec3(.045,.18,.23),vec3(.19,.38,.46),wave*.5+.5);col+=rip*.1;gl_FragColor=vec4(col,.94);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }` });
  const water = new THREE.Mesh(g, m); water.position.y = -1.5; water.name = 'frost-river'; kit.group.add(water); kit.disposables.push(g, m);
  for (const s of [-1, 1]) for (let i = 0; i < 18; i++) {
    const x = -24 + i * 2.8, z = s * (8.5 - (i % 3) * .13);
    kit.add('ice', new THREE.ConeGeometry(.34, 1.1 + (i % 4) * .22, 5), { pos: [x, -1.3, z], rot: [Math.PI, 0, .15], cast: false });
  }
}

function snowfall(kit, R) {
  const n = kit.low ? 90 : 230, pos = new Float32Array(n * 3), origin = [];
  for (let i = 0; i < n; i++) { origin.push([R() * 46 - 23, R() * 14, R() * 62 - 31]); pos.set(origin[i], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0xe9f3ff, size: .045, transparent: true, opacity: .65, depthWrite: false });
  const points = new THREE.Points(g, m); points.name = 'snowfall'; kit.group.add(points); kit.disposables.push(g, m);
  kit.updaters.push((dt, t) => { for (let i = 0; i < n; i++) { const p = origin[i]; pos[i * 3] = p[0] + Math.sin(t * .3 + i) * .7; pos[i * 3 + 1] = ((p[1] - t * .65) % 14 + 14) % 14; } g.attributes.position.needsUpdate = true; });
}
