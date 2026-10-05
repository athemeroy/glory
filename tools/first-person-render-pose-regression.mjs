// CPU integration regression using the production GLBs, animation and Game.render.
// No WebGL is mocked as a pass: the renderer below only observes the draw boundary.
// Run: node --experimental-loader ./tools/three-local-loader.mjs tools/first-person-render-pose-regression.mjs
// --source /path/to/checkout runs the same checks against an unfixed checkout.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const sourceArg = process.argv.indexOf('--source');
const root = sourceArg < 0 ? new URL('../', import.meta.url) : pathToFileURL(process.argv[sourceArg + 1].replace(/\/$/, '') + '/');
const fromRoot = path => new URL(path, root);
let seed = 0x46504559;
Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
// Only browser I/O is replaced. Texture pixels/audio are irrelevant to pose math.
globalThis.matchMedia = () => ({ matches: false });
globalThis.Audio = class {};
globalThis.ProgressEvent = class { constructor(type, init) { Object.assign(this, init); } };
globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect() {} }) }) };
const THREE = await import(fromRoot('vendor/three.module.js'));
const { GLTFLoader } = await import(fromRoot('vendor/GLTFLoader.js'));
const { loadClipLibrary } = await import(fromRoot('src/game/mocap.js'));
const { Fighter } = await import(fromRoot('src/game/fighter.js'));
const { Game, SETTINGS_DEFAULT } = await import(fromRoot('src/game/game.js'));
const { CLASSES, CLASS_ORDER } = await import(fromRoot('src/data/classes.js'));
const STEP = 1 / 60, results = [];
function check(name, fn) {
  try { fn(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error.message }); }
}
const loader = new GLTFLoader().register(() => ({ name: 'CPU_SKIP_TEXTURE_IO', loadTexture: () => Promise.resolve(null) }));
const clips = await fs.readFile(fromRoot('assets/anim/anims.glb'));
assert(await loadClipLibrary('data:application/octet-stream;base64,' + clips.toString('base64')), 'production clips load');
const assets = new Map(), metrics = [];
async function makeFighter(clsId) {
  const modelKey = CLASSES[clsId].modelKey || clsId;
  if (!assets.has(modelKey)) {
    const bytes = await fs.readFile(fromRoot(`assets/models/optimized/${modelKey}.glb`));
    const glb = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    glb.scene.userData.gloryClass = modelKey; assets.set(modelKey, glb.scene);
  }
  const g = {
    scene: new THREE.Scene(), rigged: assets, mode: { constructor: { name: 'TrainingMode' } },
    onFighterEvent() {}, vfx: { particle() {} }, settings: { ...SETTINGS_DEFAULT, shake: false, bob: false, post: false },
    tmp: new THREE.Vector3(), camera: new THREE.PerspectiveCamera(60, 16 / 9, .05, 700),
    vmCamera: new THREE.PerspectiveCamera(), viewYaw: 0, viewPitch: 0, firstPerson: true, fpBody: true,
    shakeAmt: 0, lastMouse: [0, 0], updateFov() {}, fighters: [], acc: 0, manual: false, paused: false,
    renderer: { autoClear: true, render() {} },
  };
  g.camera.rotation.order = 'YXZ'; g.scene.add(g.camera);
  const f = new Fighter(g, { clsId, cls: CLASSES[clsId] });
  f.fp = { root: new THREE.Group(), dispose() {} }; g.player = f; g.fighters.push(f);
  Game.prototype.applyView.call(g);
  return { g, f };
}
function poses(f) { return f.renderPose.samples.flatMap(s => [...s.node.position.toArray(), ...s.node.quaternion.toArray(), ...s.node.scale.toArray()]); }
// A draw observer must not call eyePos(): its simulation path writes root transforms.
function observedEye(f) {
  const pos = f.rig.root.position;
  let h = f.bodyProfile.eyeHeight * f.scale;
  const down = f.bodyProfile.downHeight * f.scale * .75;
  if (f.state === 'down' || f.state === 'dead') h = down;
  else if (f.state === 'getup') h = down + (h - down) * Math.max(0, Math.min(1, f.stateT / .45));
  else if (f.mocapBody?.bones?.Head && f.bodyProfile.headOffset) {
    const head = f.mocapBody.bones.Head.localToWorld(new THREE.Vector3(...f.bodyProfile.headOffset));
    h = Math.max(f.height * .42, Math.min(f.height * 1.08, head.y - pos.y + f.bodyProfile.headRadius * .25 * f.scale));
  }
  return new THREE.Vector3(pos.x, pos.y + h, pos.z);
}
for (const clsId of CLASS_ORDER) {
  const { g, f } = await makeFighter(clsId);
  let maxPhaseError = 0, maxUncorrectedPhase = 0, maxRestoreError = 0, maxWristError = 0, maxRootError = 0, maxClipError = 0, draws = 0;
  const scenarios = Object.fromEntries(['idle', 'move', 'attack'].map(name => [name, { draws: 0, uncorrectedPhase: 0, correctedPhase: 0 }]));
  for (const scenario of ['idle', 'move', 'attack']) for (const pitch of [-.9, 0, .9]) {
    f.resetState(); f.pitch = g.viewPitch = pitch; g._fpEyeOwner = null;
    for (let i = 0; i < 45; i++) {
      if (scenario === 'move') { f.vel.set(0, 0, 5); f.state = 'move'; f.pos.z += 5 * STEP; f.pos.y = Math.sin(i * .13) * .8; f.yaw = g.viewYaw = i * .04; }
      if (scenario === 'attack') {
        if (!f.action) f.startAction(f.chain[0], 'atk', { chainIdx: 0 });
        else {
          f.action.t += 1000 * STEP;
          if (f.action.t >= f.action.def[f.action.stage]) {
            f.action.t = 0;
            if (f.action.stage === 'wind') f.action.stage = 'active';
            else if (f.action.stage === 'active') f.action.stage = 'recover';
            else f.action = null;
          }
        }
      }
      f.updateModel(STEP); Game.prototype.updateCamera.call(g, STEP);
      const currentEye = f.eyePos(), currentCamera = g.camera.position.clone(), simulation = poses(f);
      const wrists = f.gripHands.map(h => h.wrist);
      for (const alpha of [0, .25, .5, .75]) {
        g.acc = alpha * STEP;
        const root = f.renderPose.samples.find(s => s.node === f.rig.root);
        const expectedRoot = [...root.prevP.clone().lerp(root.currP, alpha).toArray(), ...root.prevQ.clone().slerp(root.currQ, alpha).toArray(), ...root.prevS.clone().lerp(root.currS, alpha).toArray()];
        const expectedWrists = wrists.map(wrist => {
          const s = f.renderPose.samples.find(s => s.node === wrist);
          if (!s) return null;
          return [...s.prevP.clone().lerp(s.currP, alpha).toArray(), ...s.prevQ.clone().slerp(s.currQ, alpha).toArray(), ...s.prevS.clone().lerp(s.currS, alpha).toArray()];
        });
        g.renderer.render = (scene, camera) => {
          scene.updateMatrixWorld(true); draws++;
          const actualRoot = [...f.rig.root.position.toArray(), ...f.rig.root.quaternion.toArray(), ...f.rig.root.scale.toArray()];
          maxRootError = Math.max(maxRootError, ...actualRoot.map((v, k) => Math.abs(v - expectedRoot[k])));
          for (const body of f.rig.mocapBodyMeshes) {
            body.onBeforeRender(null, scene, camera);
            maxClipError = Math.max(maxClipError, Math.abs([].concat(body.material)[0].clippingPlanes[0].constant - (f.rig.root.position.y + 1.36 * f.scale)));
          }
          const presentedEye = observedEye(f);
          const uncorrected = presentedEye.distanceTo(currentEye);
          const corrected = camera.position.clone().sub(presentedEye).distanceTo(currentCamera.clone().sub(currentEye));
          maxUncorrectedPhase = Math.max(maxUncorrectedPhase, uncorrected);
          maxPhaseError = Math.max(maxPhaseError, corrected);
          scenarios[scenario].draws++;
          scenarios[scenario].uncorrectedPhase = Math.max(scenarios[scenario].uncorrectedPhase, uncorrected);
          scenarios[scenario].correctedPhase = Math.max(scenarios[scenario].correctedPhase, corrected);
          for (let j = 0; j < wrists.length; j++) {
            const actual = [...wrists[j].position.toArray(), ...wrists[j].quaternion.toArray(), ...wrists[j].scale.toArray()];
            if (!expectedWrists[j]) { maxWristError = Infinity; continue; }
            maxWristError = Math.max(maxWristError, ...actual.map((v, k) => Math.abs(v - expectedWrists[j][k])));
          }
        };
        Game.prototype.render.call(g);
        maxRestoreError = Math.max(maxRestoreError, g.camera.position.distanceTo(currentCamera), ...poses(f).map((v, k) => Math.abs(v - simulation[k])));
      }
    }
  }
  check(`${clsId}: first-person eye follows the displayed pose, retaining camera smoothing/recoil offset`, () => assert(maxPhaseError < 1e-9, `draw-time phase error ${maxPhaseError}m`));
  check(`${clsId}: draw-time root translation and rotation keep their interpolation`, () => assert(maxRootError < 1e-9, `root interpolation error ${maxRootError}`));
  check(`${clsId}: torso clipping follows the displayed root height`, () => assert(maxClipError < 1e-9, `clip interpolation error ${maxClipError}`));
  check(`${clsId}: wrists are sampled with the arm and grip-hand pose`, () => assert(maxWristError < 1e-9, `wrist interpolation error ${maxWristError}`));
  check(`${clsId}: drawing restores camera and authoritative transforms exactly`, () => assert.equal(maxRestoreError, 0));
  check(`${clsId}: arm culling/layers and independent materials are preserved`, () => {
    for (const arm of f.rig.armParts) {
      assert.equal(arm.frustumCulled, false); assert(arm.layers.test(g.camera.layers));
      for (const mat of [].concat(arm.material)) assert(!mat.clippingPlanes?.length, 'arm inherited torso clipping');
    }
    for (const head of f.rig.headParts) assert(!head.layers.test(g.camera.layers));
    const mirror = new THREE.PerspectiveCamera(); mirror.layers.enable(1);
    for (const body of f.rig.mocapBodyMeshes) {
      body.onBeforeRender(null, g.scene, g.camera);
      assert.equal([].concat(body.material)[0].clippingPlanes[0].constant, f.pos.y + 1.36 * f.scale);
      body.onBeforeRender(null, g.scene, mirror);
      assert.equal([].concat(body.material)[0].clippingPlanes[0].constant, 1e5);
    }
  });
  // Alternate render routes and deliberate failures must not accumulate camera shifts.
  for (const mode of ['manual', 'paused', 'thirdPerson', 'legacy', 'cinematic', 'spectating', 'camHook', 'post', 'throw']) {
    g.manual = mode === 'manual'; g.paused = mode === 'paused'; g.firstPerson = mode !== 'thirdPerson'; g.fpBody = mode !== 'legacy';
    g.acc = STEP / 3; g._fpEyeOwner = ['cinematic', 'spectating'].includes(mode) ? null : f.id;
    const before = poses(f), camera = g.camera.position.clone(), cameraY = camera.y; let drawY;
    g.camHook = mode === 'camHook' ? camera => { camera.position.y = 12; } : null;
    const draw = () => { drawY = g.camera.position.y; if (mode === 'throw') throw Error('intentional draw failure'); };
    g.renderer.render = draw; g.settings.post = mode === 'post'; g.post = { render: draw };
    try { Game.prototype.render.call(g); } catch (error) { assert.equal(error.message, 'intentional draw failure'); }
    check(`${clsId}: ${mode} route preserves camera ownership and simulation`, () => {
      assert.deepEqual(poses(f), before);
      assert.deepEqual(g.camera.position.toArray(), [camera.x, mode === 'camHook' ? 12 : cameraY, camera.z]);
      if (!['post', 'throw'].includes(mode)) assert.equal(drawY, mode === 'camHook' ? 12 : cameraY);
    });
    g.camera.position.y = cameraY;
  }
  metrics.push({ clsId, draws, maxUncorrectedPhase, maxPhaseError, maxRestoreError, maxWristError, maxRootError, maxClipError, scenarios });
  f.dispose();
}
const report = { coverage: 'CPU draw-boundary integration; not WebGL pixel/visual verification', passed: results.filter(r => r.passed).length, total: results.length, metrics, failures: results.filter(r => !r.passed) };
console.log(JSON.stringify(report, null, 2));
if (report.passed !== report.total) process.exitCode = 1;
