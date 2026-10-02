// Shared street props. Static geometry goes through Kit's material buckets.
import * as THREE from 'three';
import { archGeo, balustrade } from './props.js';

export function crate(kit, x, y, z, size = 1.2) {
  kit.box('wood', [x, y + size / 2, z], [size, size, size], { collide: 'cover' });
  for (const s of [-1, 1]) {
    kit.box('woodDark', [x + s * size * .42, y + size / 2, z], [size * .08, size * 1.04, size * 1.04]);
    kit.box('iron', [x, y + size * .22, z + s * size * .505], [size * 1.02, size * .055, .018]);
    kit.box('iron', [x, y + size * .78, z + s * size * .505], [size * 1.02, size * .055, .018]);
    kit.box('woodDark', [x, y + size / 2, z + s * size * .508], [size * .09, size * 1.15, .03], { rot: [0, 0, Math.PI / 4] });
  }
}

export function coverWall(kit, x, z, width = 3, height = 1.15, key = 'masonry') {
  kit.box(key, [x, height / 2, z], [width, height, .8], { collide: 'cover' });
  kit.box('stoneTrim', [x, height + .05, z], [width + .14, .1, .9]);
  kit.box('stoneDark', [x, .13, z], [width + .15, .26, .95]);
  kit.collider([x - width / 2 - .07, 0, z - .45], [x + width / 2 + .07, height + .1, z + .45], 'cover');
}

export function lamp(kit, x, y, z) {
  kit.cyl('iron', [x, y, z], .055, .09, 2.65, 8);
  kit.collider([x - .12, y, z - .12], [x + .12, y + 3.2, z + .12], 'pillar');
  kit.box('woodDark', [x, y + 2.75, z], [.4, .08, .4]);
  kit.box('paper', [x, y + 2.98, z], [.24, .38, .24], { cast: false });
  kit.cyl('iron', [x, y + 3.17, z], .06, .29, .2, 4);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.box('iron', [x + sx * .15, y + 2.98, z + sz * .15], [.025, .4, .025]);
  kit.point(0xffcb88, 6, 5, [x, y + 3, z]);
}

export function gate(kit, x, y, z, width = 5, wall = 'masonry') {
  const hw = width / 2, leg = 3, thick = .6, apex = leg + hw + thick;
  kit.add(wall, archGeo(hw, leg, thick, 1.05, 1, 18), { pos: [x, y, z] });
  for (const sx of [-1, 1]) {
    kit.collider([x + sx * (hw + thick / 2) - thick / 2, y, z - .53], [x + sx * (hw + thick / 2) + thick / 2, y + leg + .35, z + .53], 'wall');
    kit.box('stoneTrim', [x + sx * (hw + thick / 2), y + .22, z], [.9, .44, 1.25]);
  }
  // Small boxes follow the arch; the opening retains its real walkable volume.
  for (let i = 0; i < 14; i++) {
    const a = Math.PI * (i + .5) / 14, cx = x + Math.cos(a) * (hw + thick / 2), cy = y + leg + Math.sin(a) * (hw + thick / 2);
    kit.collider([cx - .31, cy - .29, z - .53], [cx + .31, cy + .29, z + .53], 'wall');
  }
  kit.box('stoneTrim', [x, y + apex + .12, z], [width + 1.65, .26, 1.2]);
}

export function house(kit, x, z, width, depth, height, tint = 'plaster', yaw = 0) {
  // Streets use axis aligned houses so the collision and silhouette agree.
  const wall = tint, roofY = height + .2;
  kit.box(wall, [x, height / 2, z], [width, height, depth], { collide: 'building' });
  kit.box('stoneDark', [x, .3, z], [width + .18, .6, depth + .18]);
  kit.box('stoneTrim', [x, height, z], [width + .28, .2, depth + .28]);
  const rg = new THREE.CylinderGeometry(0, 1, 1, 4, 1);
  rg.rotateY(Math.PI / 4); rg.scale((width + 1) / Math.SQRT2, 2.2, (depth + 1) / Math.SQRT2);
  kit.add('roof', rg, { pos: [x, roofY + 1.1, z] });
  kit.collider([x - (width + 1) / 2, height, z - (depth + 1) / 2], [x + (width + 1) / 2, height + 2.4, z + (depth + 1) / 2], 'roof');
  for (const sx of [-1, 1]) kit.box('woodDark', [x + sx * (width / 2 - .15), height / 2, z + depth / 2 + .04], [.16, height, .12]);
  const cols = Math.max(1, Math.floor(width / 2.6)), rows = Math.max(1, Math.floor(height / 3));
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const xx = x + (col - (cols - 1) / 2) * 2.3, yy = 1.85 + row * 2.6;
    for (const s of [-1, 1]) {
      kit.box('window', [xx, yy, z + s * (depth / 2 + .015)], [.82, 1.15, .035], { cast: false });
      kit.box('woodDark', [xx, yy, z + s * (depth / 2 + .05)], [.055, 1.2, .05]);
      kit.box('woodDark', [xx, yy, z + s * (depth / 2 + .05)], [.88, .06, .05]);
      kit.box('stoneTrim', [xx, yy - .63, z + s * (depth / 2 + .12)], [1.1, .13, .26]);
    }
  }
  kit.box('woodDark', [x, 1.05, z + depth / 2 + .06], [1.2, 2.1, .1]);
  kit.box('bronze', [x + .38, 1.05, z + depth / 2 + .125], [.08, .08, .025]);
}

export function routeStrip(kit, points, y = .014, key = 'route') {
  for (let i = 1; i < points.length; i++) {
    const [x0, z0] = points[i - 1], [x1, z1] = points[i], dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    kit.box(key, [(x0 + x1) / 2, y, (z0 + z1) / 2], [.1, .009, len], { rotY: Math.atan2(dx, dz), cast: false });
  }
}

export function rail(kit, a, b, y = 0, height = 1.05) {
  balustrade(kit, 'stoneTrim', a, b, y, height, { step: 2.4 });
}
