// Isolated Frost torso experiment. Never imported by the runtime.
import * as THREE from 'three';
import { markSharedResource } from '../src/game/model.js';
import { FROST_TORSO_SOURCE_BONES, FROST_TORSO_SOURCE_ROWS } from './frost-torso-source-island.js';
import { FROST_TORSO_STRIP_ROWS } from './frost-torso-source-strip.js';

const cached = new WeakMap();
const cell = point => [point.x, point.y, point.z].map(v => Math.round(v / .00005)).join(',');
const smooth = t => t * t * (3 - 2 * t);
// Certified by source-depth bind/getup6 views: torso blue fabric and vertical
// garment trim. This literal is not a height-based runtime selection.
const islandVertices = FROST_TORSO_SOURCE_ROWS.map(row => row[0]);
const stripVertices = FROST_TORSO_STRIP_ROWS.map(row => row[0]);
// Exact six source-certified torso points barely reached by published Sleeve12.
// Every other published sleeve point remains immutable.
const sleeveExceptions = new Set([16758,16759,16760,16761,16762,16763]);
// These five physical waist positions are occluded by the metal waist shell.
// Their fourteen original aliases must retain the published/native binding.
const waistBoundary = new Set([15939,15940,15941,16054,16055,16163,16164,16165,16166,16320,16321,16322,16346,16347]);
const exceptionPrepared = [
  [0,1,9,11,.5183193683624268,.4429180324077606,.03867461159825325,.00008799880015430972],
  [0,1,9,5,.49587222933769226,.46256035566329956,.03926948830485344,.0022979318164288998]
];
const isForeign = name => /^(Hips|.*Leg|.*Foot|.*ToeBase)$/.test(name);

function certifySource(mesh, profile, native) {
  if (!['union','strip'].includes(profile.domain)) return;
  const source = mesh.geometry, names = mesh.skeleton.bones.map(bone => bone.name), si = native?.attributes.skinIndex, sw = native?.attributes.skinWeight, locked = mesh.userData.sleeveComponent;
  if (!native || native.index !== source.index || native.attributes.position !== source.attributes.position || si?.count !== 24111 || sw?.count !== 24111) throw Error('Torso trial requires the explicit original GLB geometry');
  if (names.length !== FROST_TORSO_SOURCE_BONES.length || names.some((name,i) => name !== FROST_TORSO_SOURCE_BONES[i])) throw Error('Torso island source bone palette changed');
  const rows = profile.domain === 'strip' ? [...FROST_TORSO_SOURCE_ROWS,...FROST_TORSO_STRIP_ROWS] : FROST_TORSO_SOURCE_ROWS;
  for (const row of rows) for (let k = 0; k < 4; k++) {
    if (si.getComponent(row[0],k) !== row[1+k] || sw.getComponent(row[0],k) !== row[5+k]) throw Error('Torso island source weights changed '+row[0]+':'+k);
    if (!locked?.[row[0]] && (source.attributes.skinIndex.getComponent(row[0],k) !== row[1+k] || source.attributes.skinWeight.getComponent(row[0],k) !== row[5+k])) throw Error('Torso island has an unexpected prior repair '+row[0]+':'+k);
  }
  if (profile.domain === 'strip') for (const i of sleeveExceptions) {
    const expected = exceptionPrepared[i < 16762 ? 0 : 1], strength = i < 16762 ? .00011432650353526697 : .00011433150211814791;
    if (!locked?.[i] || mesh.userData.sleeveStrength?.[i] !== strength) throw Error('Torso six-point Sleeve12 certificate changed '+i);
    for (let k = 0; k < 4; k++) if (source.attributes.skinIndex.getComponent(i,k) !== expected[k] || source.attributes.skinWeight.getComponent(i,k) !== expected[4+k]) throw Error('Torso six-point published weights changed '+i+':'+k);
  }
}

export function heightWeights(y, chain, mode = 'linear') {
  if (mode === 'rigid') return [[chain.find(bone => bone.name === 'Spine').index, 1]];
  if (y <= chain[0].y) return [[chain[0].index, 1]];
  for (let i = 1; i < chain.length; i++) if (y <= chain[i].y) {
    let t = (y - chain[i - 1].y) / (chain[i].y - chain[i - 1].y);
    if (mode === 'smooth') t = smooth(t);
    return [[chain[i - 1].index, 1 - t], [chain[i].index, t]];
  }
  return [[chain.at(-1).index, 1]];
}

function prepare(mesh, body, profile) {
  const source = mesh.geometry, si = source.attributes.skinIndex, sw = source.attributes.skinWeight;
  if (si?.count !== 24111 || !sw || !source.index || mesh.skeleton.bones.length !== 24) throw Error('Unexpected Frost source');
  const names = mesh.skeleton.bones.map(b => b.name), point = new THREE.Vector3(), positions = [], aliases = new Map(), neighbors = Array.from({length:si.count}, () => new Set());
  mesh.skeleton.update();
  for (let i = 0; i < si.count; i++) {
    const p = mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld).clone(); positions.push(p);
    const key = cell(p); if (!aliases.has(key)) aliases.set(key, []); aliases.get(key).push(i);
  }
  for (let at = 0; at < source.index.count; at += 3) {
    const [a,b,c] = [0,1,2].map(k => source.index.getX(at+k));
    for (const [x,y] of [[a,b],[b,c],[c,a]]) { neighbors[x].add(y); neighbors[y].add(x); }
  }
  const raw = new Set([16706]), queue = [16706];
  for (let at = 0; at < queue.length; at++) for (const n of neighbors[queue[at]]) if (!raw.has(n)) { raw.add(n); queue.push(n); }
  const selected = new Set([...raw].flatMap(i => aliases.get(cell(positions[i]))));
  const bounds = new THREE.Box3().setFromPoints([...raw].map(i => positions[i]));
  const min = [-.108493,1.098708,.008611], max = [.191155,1.401800,.087828];
  if (raw.size !== 66 || !raw.has(16708) || selected.size !== 118 || bounds.min.toArray().some((v,i) => Math.abs(v-min[i]) > .00005) || bounds.max.toArray().some((v,i) => Math.abs(v-max[i]) > .00005)) throw Error('Torso sheet certificate mismatch');
  if (['union','strip'].includes(profile.domain)) {
    const islandBounds = new THREE.Box3().setFromPoints(islandVertices.map(i => positions[i])), min = [-.122270,1.202035,.043053], max = [.129159,1.267476,.215264];
    if (islandVertices.length !== 73 || islandBounds.min.toArray().some((v,i) => Math.abs(v-min[i]) > .00005) || islandBounds.max.toArray().some((v,i) => Math.abs(v-max[i]) > .00005)) throw Error('Torso island source bounds changed');
    for (const i of islandVertices) {
      let foreign = 0; for (let k = 0; k < 4; k++) if (isForeign(names[si.getComponent(i,k)])) foreign += sw.getComponent(i,k);
      if (foreign <= .2 || !aliases.get(cell(positions[i])).every(alias => islandVertices.includes(alias))) throw Error('Torso island source/alias certificate changed '+i);
      selected.add(i);
    }
    if (selected.size !== 180) throw Error('Torso union certificate mismatch');
  }
  if (profile.domain === 'strip') {
    const stripRaw = new Set([16704]), stripQueue = [16704];
    for (let at = 0; at < stripQueue.length; at++) for (const n of neighbors[stripQueue[at]]) if (!stripRaw.has(n)) { stripRaw.add(n); stripQueue.push(n); }
    const closure = new Set([...stripRaw].flatMap(i => aliases.get(cell(positions[i])))), stripBounds = new THREE.Box3().setFromPoints(stripVertices.map(i => positions[i]));
    const min = [.084383681,1.053933441,.039608515], max = [.142935561,1.363914056,.218708362];
    if (stripRaw.size !== 43 || closure.size !== 103 || stripVertices.length !== 103 || stripVertices.some(i => !closure.has(i)) || stripBounds.min.toArray().some((v,i) => Math.abs(v-min[i]) > .00005) || stripBounds.max.toArray().some((v,i) => Math.abs(v-max[i]) > .00005)) throw Error('Torso raw43/103 strip certificate mismatch');
    for (const i of stripVertices) selected.add(i);
    if (selected.size !== 242 || [...waistBoundary].some(i => !selected.has(i))) throw Error('Torso 242/waist source certificate mismatch');
  }
  const chain = ['Hips','Spine02','Spine01','Spine','neck'].map(name => ({name,index:names.indexOf(name), y:body.bones[name]?.getWorldPosition(new THREE.Vector3()).y})).sort((a,b) => a.y-b.y);
  if (chain.some((bone,i) => bone.index < 0 || !Number.isFinite(bone.y) || (i && bone.y-chain[i-1].y < .001))) throw Error('Missing ordered torso chain');
  const indices = new Uint16Array(si.array), weights = new Float32Array(sw.array), strength = new Float32Array(si.count);
  const locked = mesh.userData.sleeveComponent, head = mesh.userData.firstPersonHeadMask;
  const protectedSleevePoint = i => !!locked?.[i] && !(profile.domain === 'strip' && sleeveExceptions.has(i));
  const selectedCells = new Set([...selected].map(i => cell(positions[i]))), nodeNeighbors = new Map(), original = new Map();
  const influence = key => {
    if (!original.has(key)) {
      const values = new Float64Array(names.length), members = aliases.get(key);
      for (const i of members) for (let k = 0; k < 4; k++) values[si.getComponent(i,k)] += sw.getComponent(i,k) / members.length;
      original.set(key,values);
    }
    return original.get(key);
  };
  const boundaryCells = new Set(), pinnedCells = new Set(), healthyCells = new Set(), mutableCells = new Set();
  for (const key of selectedCells) {
    const adjacent = new Set();
    for (const i of aliases.get(key)) for (const n of neighbors[i]) { const next = cell(positions[n]); if (next !== key) adjacent.add(next); }
    nodeNeighbors.set(key,adjacent);
    if ([...adjacent].some(key => !selectedCells.has(key))) boundaryCells.add(key);
    const values = influence(key), foreign = values.reduce((sum,value,bone) => sum + (isForeign(names[bone]) ? value : 0),0);
    if (foreign <= .05) healthyCells.add(key);
    if (boundaryCells.has(key) && (profile.pinMode !== 'foreign' || [...adjacent].some(key => !selectedCells.has(key) && influence(key).reduce((sum,value,bone) => sum + (isForeign(names[bone]) ? value : 0),0) > .2))) pinnedCells.add(key);
    if (profile.domain === 'strip' && aliases.get(key).some(i => waistBoundary.has(i))) pinnedCells.add(key);
    const isProtected = aliases.get(key).some(i => protectedSleevePoint(i) || head?.[i]);
    if (foreign > .05 && !isProtected && (!profile.pin || !pinnedCells.has(key))) mutableCells.add(key);
  }
  let field = new Map([...selectedCells].map(key => [key,influence(key)]));
  if (profile.mode === 'harmonic') for (let step = 0; step < 80; step++) {
    const next = new Map(field);
    for (const key of mutableCells) {
      const adjacent = nodeNeighbors.get(key), base = influence(key), values = new Float64Array(names.length);
      for (let bone = 0; bone < names.length; bone++) {
        let sum = 0; for (const key of adjacent) sum += (field.get(key) || influence(key))[bone];
        values[bone] = .03 * base[bone] + .97 * sum / adjacent.size;
      }
      next.set(key,values);
    }
    field = next;
  }
  let changed = 0, protectedSleeve = 0;
  for (const i of selected) {
    if (protectedSleevePoint(i) || head?.[i]) { protectedSleeve += !!locked?.[i]; continue; }
    const byBone = new Map(), gain = profile.gain ?? 1;
    const key = cell(positions[i]);
    if (!gain || (profile.mode === 'harmonic' && !mutableCells.has(key))) continue;
    for (let k = 0; k < 4; k++) byBone.set(si.getComponent(i,k), (byBone.get(si.getComponent(i,k)) || 0) + sw.getComponent(i,k)*(1-gain));
    const target = profile.mode === 'harmonic' ? [...field.get(key)].map((weight,index) => [index,weight]) : heightWeights(positions[i].y, chain, profile.mode);
    for (const [index, weight] of target) byBone.set(index, (byBone.get(index) || 0) + gain*weight);
    const best = [...byBone].filter(([,w]) => w > 0).sort((a,b) => b[1]-a[1]).slice(0,4), sum = best.reduce((n,[,w]) => n+w,0);
    for (let k = 0; k < 4; k++) { indices[i*4+k] = best[k]?.[0] || 0; weights[i*4+k] = best[k] ? best[k][1]/sum : 0; }
    strength[i] = gain; changed++;
  }
  const geometry = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(source.attributes)) geometry.setAttribute(name,attr);
  geometry.setAttribute('skinIndex',markSharedResource(new THREE.Uint16BufferAttribute(indices,4)));
  geometry.setAttribute('skinWeight',markSharedResource(new THREE.Float32BufferAttribute(weights,4)));
  geometry.setIndex(source.index); geometry.groups = source.groups.map(g => ({...g}));
  geometry.morphAttributes = source.morphAttributes; geometry.morphTargetsRelative = source.morphTargetsRelative;
  geometry.boundingBox = source.boundingBox?.clone() || null; geometry.boundingSphere = source.boundingSphere?.clone() || null;
  geometry.userData = {...source.userData, shared:true}; markSharedResource(geometry);
  const countVertices = cells => [...cells].reduce((sum,key) => sum + aliases.get(key).length,0);
  const domain = new Uint8Array(si.count), boundary = new Uint8Array(si.count), healthy = new Uint8Array(si.count);
  for (const i of selected) { const key = cell(positions[i]); domain[i] = 1; boundary[i] = pinnedCells.has(key); healthy[i] = healthyCells.has(key); }
  const sleeveIntersection = islandVertices.filter(i => locked?.[i]);
  const islandSleeveRows = sleeveIntersection.map(i => {
    const row = FROST_TORSO_SOURCE_ROWS.find(row => row[0] === i);
    return {vertex:i,position:positions[i].toArray(),sleeveStrength:mesh.userData.sleeveStrength?.[i],current:[0,1,2,3].map(k => ({bone:names[si.getComponent(i,k)],weight:sw.getComponent(i,k)})),native:[0,1,2,3].map(k => ({bone:names[row[1+k]],weight:row[5+k]}))};
  });
  const lockedVertices = [...selected].filter(i => protectedSleevePoint(i) || head?.[i] || healthy[i] || (profile.pin && pinnedCells.has(cell(positions[i])))).length;
  const allUnchanged = [...selected].filter(i => !strength[i]).length;
  return {geometry,strength,domain,boundary,healthy,certificate:{rawVertices:raw.size,aliasVertices:selected.size,islandVertices:['union','strip'].includes(profile.domain)?73:0,stripVertices:profile.domain==='strip'?103:0,waistBoundary:profile.domain==='strip'?[...waistBoundary]:[],sleeveExceptions:profile.domain==='strip'?[...sleeveExceptions]:[],islandSleeveIntersection:sleeveIntersection,islandSleeveRows,changed,allUnchanged,lockedVertices,protectedSleeve,boundaryVertices:countVertices(pinnedCells),outerBoundaryVertices:countVertices(boundaryCells),healthyVertices:countVertices(healthyCells),mutableVertices:countVertices(mutableCells),bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}}};
}

export function repairTorsoTrial(body, profile = {mode:'linear',gain:1}, nativeGeometry = null) {
  if (!['linear','smooth','rigid','harmonic'].includes(profile.mode) || !Number.isFinite(profile.gain) || profile.gain < 0 || profile.gain > 1) throw Error('Invalid torso trial profile');
  if (profile.domain && !['sheet','union','strip'].includes(profile.domain)) throw Error('Invalid torso domain');
  if (profile.pinMode && !['all','foreign'].includes(profile.pinMode)) throw Error('Invalid torso boundary mode');
  if (profile.domain === 'strip' && (profile.mode !== 'harmonic' || profile.gain !== 1 || !profile.pin || profile.pinMode !== 'foreign')) throw Error('The certified 242 strip has one fixed harmonic candidate');
  if (body.torsoTrial) return body.torsoTrial;
  const key = JSON.stringify(profile);
  let certificate;
  for (const mesh of body.meshes) {
    certifySource(mesh,profile,nativeGeometry);
    const source = mesh.geometry;
    if (!cached.has(source)) cached.set(source,new Map());
    const cache = cached.get(source); if (!cache.has(key)) cache.set(key,prepare(mesh,body,profile));
    const result = cache.get(key); mesh.geometry = result.geometry; mesh.userData.torsoTrialStrength = result.strength; mesh.userData.torsoTrialDomain = result.domain; mesh.userData.torsoTrialBoundary = result.boundary; mesh.userData.torsoTrialHealthy = result.healthy; certificate = result.certificate;
  }
  body.torsoTrial = {...certificate,profile}; return body.torsoTrial;
}
