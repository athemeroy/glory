#!/usr/bin/env python3
"""Real Chromium/WebGL draw-boundary checks and sampled first-person/mirror frames.

Uses production assets and simulation with a stopped RAF loop for deterministic
sampling. Software WebGL screenshots are review evidence, not physical-device or
complete continuous-flicker acceptance.
"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_qa import confine_to_local

ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('url')
ap.add_argument('--browser')
ap.add_argument('--output', type=Path, default=Path('/tmp/glory-render-qa'))
a = ap.parse_args()
a.output.mkdir(parents=True, exist_ok=True)
reports = []

SETUP = r'''async () => {
  const {input} = await import('./src/engine/input.js');
  const g = __glory.game, f = g.player;
  g.running = false; g.manual = true; g.paused = false; g.aiFrozen = true;
  g.cinematic = null; g.inputFrozen = false;
  Object.assign(g.settings, {shake:false, bob:false, autoQuality:false});
  f.updateModel(1/60); g.updateCamera(1/60);
  if (!f.mocapBody || !f.renderPose) throw Error('production rig missing');
  const mirror = g.scene.getObjectByName('mirror');
  if (!mirror) throw Error('training mirror missing');
  const vector = f.pos.clone();
  const poses = () => f.renderPose.samples.flatMap(s => [...s.node.position.toArray(), ...s.node.quaternion.toArray(), ...s.node.scale.toArray()]);
  const eye = () => {
    const p = f.rig.root.position;
    let h = f.bodyProfile.eyeHeight * f.scale;
    const down = f.bodyProfile.downHeight * f.scale * .75;
    if (f.state === 'down' || f.state === 'dead') h = down;
    else if (f.state === 'getup') h = down+(h-down)*Math.max(0,Math.min(1,f.stateT/.45));
    else if (f.mocapBody.bones.Head && f.bodyProfile.headOffset) {
      const head = f.mocapBody.bones.Head.localToWorld(vector.fromArray(f.bodyProfile.headOffset));
      h = Math.max(f.height*.42,Math.min(f.height*1.08,head.y-p.y+f.bodyProfile.headRadius*.25*f.scale));
    }
    return vector.set(p.x,p.y+h,p.z).clone();
  };
  const armMeshes = f.rig.armParts.filter(m => m.isSkinnedMesh);
  if (!armMeshes.length) throw Error('skinned first-person arms missing');
  let drawState = null;
  for (const mesh of armMeshes) {
    const original = mesh.onBeforeRender;
    mesh.onBeforeRender = function(r,s,c,...args) {
      original.call(this,r,s,c,...args);
      if (!drawState) return;
      const kind = c === g.camera ? 'main' : c === g.vmCamera ? 'overlay' : 'mirror';
      drawState.draws.push({id:this.uuid,kind,geo:this.geometry.uuid,index:this.geometry.index?.count,
        world:this.matrixWorld.toArray(),bones:Array.from(this.skeleton.boneMatrices)});
      if (kind === 'main') {
        const root=f.rig.root;
        drawState.rootError=Math.max(drawState.rootError,root.position.distanceTo(drawState.rootP),
          ...root.quaternion.toArray().map((v,i)=>Math.abs(v-drawState.rootQ.toArray()[i])));
        drawState.eyeError=Math.max(drawState.eyeError,g.camera.position.clone().sub(eye()).distanceTo(drawState.offset));
      }
    };
  }
  window.renderQA = {
    reset(scenario) {
      input.clear(); input.enabled=true; g.combat.clear(); g.vfx.clear(); f.resetState();
      f.pos.set(mirror.position.x+2,0,mirror.position.z);
      f.yaw=g.viewYaw=-Math.PI/2; f.pitch=g.viewPitch=-.12; g.camDip=g.shakeAmt=0;
      g._fpEyeOwner=null; g.acc=0;
      for(let i=0;i<30;i++){f.updateModel(1/60);g.updateCamera(1/60);}
      if(scenario==='move') input.simHold('right',true);
      if(scenario==='jump-attack'){input.simPress('jump');input.simPress('attack');}
    },
    step() { g.tick(1/60); g.vfx.update(1/60); g.updateCamera(1/60); },
    sample({alpha,post}) {
      const root=f.renderPose.samples.find(s=>s.node===f.rig.root);
      const camera=g.camera.position.clone(), before=poses();
      // The observer reads world transforms without invoking mutating eyePos().
      f.rig.root.updateWorldMatrix(true,true);
      drawState={draws:[],rootError:0,eyeError:0,
        rootP:root.prevP.clone().lerp(root.currP,alpha),
        rootQ:root.prevQ.clone().slerp(root.currQ,alpha),offset:camera.clone().sub(eye())};
      g.acc=alpha/60; g.settings.post=post; g.manual=false;
      try { g.render(1/60); } finally { g.manual=true; }
      const main=drawState.draws.filter(d=>d.kind==='main'), reflected=drawState.draws.filter(d=>d.kind==='mirror');
      const shared=main.every(d=>reflected.some(m=>m.id===d.id && ['geo','index','world','bones'].every(k=>JSON.stringify(m[k])===JSON.stringify(d[k]))));
      const restored=g.camera.position.equals(camera) && JSON.stringify(poses())===JSON.stringify(before);
      const gl=g.renderer.getContext(), glError=gl.getError();
      const result={alpha,post,main:main.length,mirror:reflected.length,shared,restored,
        rootError:drawState.rootError,eyeError:drawState.eyeError,glError,contextLost:gl.isContextLost()};
      drawState=null;
      if(!main.length || !reflected.length || !shared || !restored || result.rootError>1e-8 || result.eyeError>1e-8 || glError || result.contextLost)
        throw Error(JSON.stringify(result));
      return result;
    }
  };
  const gl=g.renderer.getContext();
  return {cls:f.clsId,webgl:gl.getParameter(gl.VERSION),renderer:gl.getParameter(gl.RENDERER),arms:armMeshes.length};
}'''

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, chromium_sandbox=True,
        args=['--use-angle=swiftshader', '--mute-audio'],
        **({'executable_path': a.browser} if a.browser else {}))
    for account in ['yqcy', 'yysf']:
        page = browser.new_page(viewport={'width': 960, 'height': 540}, device_scale_factor=1)
        blocked = confine_to_local(page.context, a.url)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda message: errors.append(message.text[:2000]) if message.type == 'error' else None)
        try:
            page.goto(a.url.rstrip('/')+f'/?auto=training&manual=1&acc={account}&view=fp')
            page.wait_for_function('window.__glory?.game?.player && !__glory._loadingMode && !__glory.game.inputFrozen', timeout=120000)
            page.wait_for_load_state('networkidle')
            metadata = page.evaluate(SETUP)
            for scenario in ['idle', 'move', 'jump-attack']:
                page.evaluate('(s)=>renderQA.reset(s)', scenario)
                samples = []
                for frame in range(12):
                    page.evaluate('renderQA.step()')
                    for alpha in [0, .25, .5, .75]:
                        result = page.evaluate('(x)=>renderQA.sample(x)', {'alpha':alpha, 'post':frame >= 6})
                        samples.append({'frame':frame, **result})
                    if frame in [3, 7, 11]:
                        page.screenshot(path=str(a.output/f'{account}-{scenario}-{frame:02}.jpg'), type='jpeg', quality=70)
                reports.append({'account':account, 'scenario':scenario, 'metadata':metadata, 'samples':samples})
                (a.output/'results.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2))
            assert not blocked, blocked
            assert not errors, errors
        except Exception as error:
            (a.output/f'{account}-failure.json').write_text(json.dumps({'error':str(error), 'browserErrors':errors, 'blockedRequests':blocked}, ensure_ascii=False, indent=2))
            try:
                page.screenshot(path=str(a.output/f'{account}-failure.jpg'), type='jpeg', quality=70)
            except Exception:
                pass
            raise
        finally:
            page.close()
    browser.close()
print(json.dumps({'scenes':len(reports), 'samples':sum(len(r['samples']) for r in reports),
                  'coverage':'software WebGL draw checks and sampled frames; physical foldable and continuous flicker not certified'}))
