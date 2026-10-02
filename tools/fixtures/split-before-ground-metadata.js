// 冻结第12split：索引分区正确，但原mesh只读衣料mask未转移。
import * as THREE from 'three';

export function splitForFirstPerson(body) {
  const out = { head: [], arms: [], body: [] };
  for (const m of [...body.meshes]) {
    const g = m.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    if (!si) { out.body.push(m); continue; }
    const names = m.skeleton.bones.map((b) => b.name);
    const cls = (vi) => {
      if (m.userData.firstPersonHeadMask?.[vi]) return 'head';
      let best = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(vi, k); if (w > bw) { bw = w; best = si.getComponent(vi, k); } }
      const n = names[best] || '';
      if (/head|neck/i.test(n)) return 'head';
      if (/Arm|Hand|Shoulder/.test(n)) return 'arms';
      return 'body';
    };
    const idx = g.index ? g.index.array : null;
    const triCount = idx ? idx.length / 3 : g.attributes.position.count / 3;
    const lists = { head: [], arms: [], body: [] };
    for (let t = 0; t < triCount; t++) {
      const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const ca = cls(a), cb = cls(b), cc = cls(c);
      const k = ca === cb || ca === cc ? ca : cb === cc ? cb : 'body';
      lists[k].push(a, b, c);
    }
    for (const k of ['head', 'arms', 'body']) {
      if (!lists[k].length) continue;
      // 分区只改变索引；顶点、UV 和蒙皮属性保持只读共享，避免复制三份精模。
      const ng = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(g.attributes)) ng.setAttribute(name, attribute);
      ng.morphAttributes = g.morphAttributes;
      ng.morphTargetsRelative = g.morphTargetsRelative;
      ng.setIndex(lists[k]);
      const nm = new THREE.SkinnedMesh(ng, m.material);
      nm.castShadow = true; nm.frustumCulled = false; nm.name = m.name + '_' + k;
      nm.position.copy(m.position); nm.quaternion.copy(m.quaternion); nm.scale.copy(m.scale);
      nm.bindMode = m.bindMode;
      nm.bind(m.skeleton, m.bindMatrix);
      if (m.morphTargetInfluences) nm.morphTargetInfluences = m.morphTargetInfluences.slice();
      m.parent.add(nm);
      out[k].push(nm);
    }
    m.removeFromParent();
  }
  body.meshes = [...out.head, ...out.arms, ...out.body];
  return out;
}
