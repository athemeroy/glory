#!/usr/bin/env python3
"""Snapshot real rigged bodies, weapons and first-person arms on Mini's shared GPU.

python tools/modelqa.py http://127.0.0.1:8889 --cdp http://127.0.0.1:9334 --output qa
Only its independent browser context is closed; shared Chrome stays running.
"""
import argparse
import json
import subprocess
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('url',nargs='?')
parser.add_argument('--serve',action='store_true',help='Serve the repository on a temporary local port and stop it on exit')
parser.add_argument('--cdp',default='http://127.0.0.1:9334')
parser.add_argument('--output',default='qa')
parser.add_argument('--version',default='',help='Source checkpoint and isolated candidate label recorded with every result')
parser.add_argument('--classes',default='unspecialized,swordmaster,battlemage,striker,sharpshooter,launcher,warlock,cleric,witch,berserker,assassin,thug,frostcaster,boss,skeleton')
parser.add_argument('--poses',default='stance,attack,overhead')
parser.add_argument('--rear-view',action='store_true',help='Use a full rear model view in place of the hand closeup')
parser.add_argument('--forms',default='')
parser.add_argument('--samples',default='',help='Comma-separated class:animation:normalized-time samples')
parser.add_argument('--probes',default='',help='Comma-separated class:vertex-a:vertex-b:pose marked closeups')
parser.add_argument('--source-probes',default='',help='Comma-separated class:vertex-a:vertex-b:pose closeups with original GLB weights and native hands')
parser.add_argument('--fp-triangles',default='',help='Comma-separated class:pose:a-b-c/a-b-c exact original source face colors in first-person view')
parser.add_argument('--component-probes',default='',help='Comma-separated class:vertex:pose connected-component highlights')
parser.add_argument('--source-component-probes',default='',help='Connected-component highlights using untouched source GLB weights and native hands')
parser.add_argument('--region-probes',default='',help='Comma-separated class:mesh-user-data-field:pose repair-region highlights')
parser.add_argument('--reaction-samples',default='',help='Comma-separated class:reaction:frames, after sixty real stance frames and actual fallen pre-roll for getup')
parser.add_argument('--reaction-probes',default='',help='Comma-separated class:vertex-a:vertex-b:reaction:frames marked actual reaction sequence')
parser.add_argument('--robe-trial',action='store_true',help='Apply the isolated robe candidate only to audit world bodies; never changes game modules')
parser.add_argument('--skirt-trial',action='store_true',help='Apply the isolated skirt candidate only to audit world bodies; never changes game modules')
parser.add_argument('--check-pages',default='',help='Comma-separated test HTML pages exposing __ready and __errors')
parser.add_argument('--app-check',action='store_true',help='Verify the actual default asset-loading game path on desktop and phone')
parser.add_argument('--app-accounts',default='yysf',help='Comma-separated real training accounts; two-handed accounts also verify world/FP grips and mirror rendering')
parser.add_argument('--framing-check',action='store_true',help='Snapshot real first-person weapons at phone portrait and landscape sizes with screen projection metrics')
parser.add_argument('--fade-check',action='store_true',help='Compare runtime-only first-person arm nearFade thresholds and count visible/dither mask pixels on Mini')
parser.add_argument('--mode-check',action='store_true',help='Verify real battle result cancellation, repeated team HUD and relay/training transitions')
parser.add_argument('--cpu-benchmark',type=Path,help='Run a pure CPU page.evaluate function in the DOM regression page, without creating a WebGL renderer')
parser.add_argument('--benchmark-before',type=Path,help='JSON of prior source modules passed to the CPU benchmark')
parser.add_argument('--mobile-check',action='store_true',help='Run the existing touch, menu and desktop input regression through the same temporary server')
args=parser.parse_args()
if args.cpu_benchmark:
    if args.app_check or args.framing_check or args.fade_check or args.mode_check or args.mobile_check:parser.error('CPU benchmark cannot be combined with GPU or input checks')
    args.classes=args.samples=args.probes=''
server=None
if args.serve:
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self,*_):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(Path(__file__).resolve().parents[1])))
    Thread(target=server.serve_forever,daemon=True).start()
    args.url=f'http://127.0.0.1:{server.server_port}'
if not args.url:parser.error('Provide a URL or --serve')
output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
metrics=[];errors=[];checks=[]
def log_metric(result):
    # Full per-frame samples stay in metrics.json; keep managed-job logs compact.
    concise={**result}
    if 'ground' in concise:concise['ground']={k:v for k,v in concise['ground'].items() if k!='samples'}
    print(json.dumps(concise),flush=True)
with sync_playwright() as pw:
    browser=pw.chromium.connect_over_cdp(args.cdp)
    context=browser.new_context(viewport={'width':1440,'height':900},device_scale_factor=1)
    context.add_init_script('window.__qaVersion='+json.dumps(args.version))
    page=context.new_page()
    page.on('pageerror',lambda error: errors.append(str(error)))
    try:
        initial='/tools/anim-regression.html' if args.cpu_benchmark else '/tools/model-audit.html'
        trial_query='&'.join(flag+'=1' for flag,enabled in [('robeTrial',args.robe_trial),('skirtTrial',args.skirt_trial),('rearView',args.rear_view)] if enabled)
        page.goto(args.url.rstrip('/')+initial+('?'+trial_query if trial_query else ''),wait_until='networkidle',timeout=90000)
        page.wait_for_function('window.__ready',timeout=90000,polling=100)
        if args.cpu_benchmark:
            if not args.benchmark_before:parser.error('--cpu-benchmark requires --benchmark-before')
            result=page.evaluate(args.cpu_benchmark.read_text(),json.loads(args.benchmark_before.read_text()))
            checks.append({'page':'animation-cpu-benchmark',**result})
            (output/'benchmark.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
            print('BENCHMARK',json.dumps(result),flush=True)
        for cls in filter(None,args.classes.split(',')):
            for pose in filter(None,args.poses.split(',')):
                result=page.evaluate('([c,p])=>__audit(c,p)',[cls,pose])
                metrics.append(result)
                page.screenshot(path=str(output/f'{cls}-{pose}.png'))
                log_metric(result)
            if cls=='unspecialized':
                for form in filter(None,args.forms.split(',')):
                    result=page.evaluate('([c,f])=>__audit(c,"stance",f)',[cls,form])
                    metrics.append(result)
                    page.screenshot(path=str(output/f'{cls}-{form}.png'))
        for sample in filter(None,args.samples.split(',')):
            cls,clip,t=sample.split(':')
            result=page.evaluate('([c,clip,t])=>__audit(c,"sample",null,{clip,t})',[cls,clip,float(t)])
            metrics.append(result);page.screenshot(path=str(output/f'{cls}-{clip}-{t}.png'))
            log_metric(result)
        for probe in filter(None,args.probes.split(',')):
            cls,a,b,pose=probe.split(':')
            result=page.evaluate('([c,a,b,p])=>__probe(c,a,b,p)',[cls,int(a),int(b),pose])
            metrics.append(result);page.screenshot(path=str(output/f'{cls}-probe-{a}-{b}-{pose}.png'))
            log_metric(result)
        for probe in filter(None,args.source_probes.split(',')):
            cls,a,b,pose=probe.split(':')
            result=page.evaluate('([c,a,b,p])=>__probe(c,a,b,p,{rawSource:true})',[cls,int(a),int(b),pose])
            metrics.append(result);page.screenshot(path=str(output/f'{cls}-source-probe-{a}-{b}-{pose}.png'));log_metric(result)
        for probe in filter(None,args.fp_triangles.split(',')):
            cls,pose,faces=probe.split(':')
            triangles=[[int(vertex) for vertex in triangle.split('-')] for triangle in faces.split('/')]
            result=page.evaluate('([c,triangles,p])=>__fpTriangles(c,triangles,p)',[cls,triangles,pose])
            metrics.append(result);page.screenshot(path=str(output/f'{cls}-fp-triangles-{pose}.png'));log_metric(result)
        for sample in filter(None,args.reaction_samples.split(',')):
            cls,reaction,frames=sample.split(':')
            result=page.evaluate('([c,r,n])=>__audit(c,"reaction",null,{react:r,frames:n})',[cls,reaction,int(frames)])
            metrics.append(result);page.screenshot(path=str(output/f'{cls}-{reaction}-frame-{frames}.png'));log_metric(result)
        for probe in filter(None,args.reaction_probes.split(',')):
            cls,a,b,reaction,frames=probe.split(':')
            result=page.evaluate('([c,a,b,r,n])=>__probe(c,a,b,"reaction",{react:r,frames:n})',[cls,int(a),int(b),reaction,int(frames)])
            metrics.append(result);page.screenshot(path=str(output/f'{cls}-probe-{a}-{b}-{reaction}-frame-{frames}.png'));log_metric(result)
        for probe in filter(None,args.component_probes.split(',')):
            cls,vertex,pose=probe.split(':')
            result=page.evaluate('([c,i,p])=>__componentProbe(c,i,p)',[cls,int(vertex),pose])
            metrics.append(result);page.screenshot(path=str(output/f'{cls}-component-{vertex}-{pose}.png'));log_metric(result)
        for probe in filter(None,args.source_component_probes.split(',')):
            cls,vertex,pose=probe.split(':')
            result=page.evaluate('([c,i,p])=>__componentProbe(c,i,p,{rawSource:true})',[cls,int(vertex),pose])
            metrics.append(result);page.screenshot(path=str(output/f'{cls}-source-component-{vertex}-{pose}.png'));log_metric(result)
        for probe in filter(None,args.region_probes.split(',')):
            cls,field,pose=probe.split(':')
            result=page.evaluate('([c,f,p])=>__regionProbe(c,f,p)',[cls,field,pose])
            metrics.append(result);page.screenshot(path=str(output/f'{cls}-region-{field}-{pose}.png'));log_metric(result)
        errors.extend(page.evaluate('window.__errors'))
        for path in filter(None,args.check_pages.split(',')):
            page.goto(args.url.rstrip('/')+'/'+path,wait_until='networkidle',timeout=90000)
            page.wait_for_function('window.__ready',timeout=90000,polling=100)
            result=page.evaluate('({results:window.__results||[],metrics:window.__metrics||[],errors:window.__errors||[]})')
            checks.append({'page':path,**result});errors.extend(result['errors']);print('CHECK',path,json.dumps(result),flush=True)
        if args.app_check:
            for label,viewport,mobile in [('desktop',{'width':1440,'height':900},False),('phone',{'width':390,'height':844},True)]:
                for account in filter(None,args.app_accounts.split(',')):
                    game_context=browser.new_context(viewport=viewport,is_mobile=mobile,has_touch=mobile,device_scale_factor=1)
                    game_context.add_init_script('window.requestAnimationFrame=()=>0; Element.prototype.requestPointerLock=()=>Promise.resolve()')
                    game_page=game_context.new_page();game_page.on('pageerror',lambda error:errors.append(str(error)))
                    try:
                        game_page.goto(args.url.rstrip('/')+f'/?auto=training&acc={account}&manual=1&noenv=1',wait_until='networkidle',timeout=120000)
                        game_page.wait_for_function('window.__glory?.game.player?.mocap',timeout=90000,polling=100)
                        result=game_page.evaluate('''async()=>{
                          const {Vector3}=await import('/vendor/three.module.js'),g=__glory.game,p=g.player;
                          g.debugAdvance(3);
                          const grip=(hand)=>hand.root.localToWorld(hand.grip.clone());
                          const bone=(name)=>p.mocapBody.bones[name].getWorldPosition(new Vector3());
                          const chains=[['LeftArm','LeftForeArm'],['LeftForeArm','LeftHand'],['RightArm','RightForeArm'],['RightForeArm','RightHand']];
                          const lengths=()=>chains.map(([a,b])=>bone(a).distanceTo(bone(b))),reference=lengths();
                          window.__appGrips=()=>{
                            p.rig.root.updateMatrixWorld(true);
                            const worldLeft=p.gripHands.find(h=>h.side==='Left'),worldRight=p.gripHands.find(h=>h.side==='Right');
                            return {worldGripDistance:p.weapon.offhandGrip?grip(worldLeft).distanceTo(p.weapon.obj.localToWorld(p.weapon.offhandGrip.clone())):null,
                              weaponGripDistance:grip(worldRight).distanceTo(p.weapon.obj.getWorldPosition(new Vector3())),
                              fpGripDistance:p.fp.weapon.offhandGrip?grip(p.fp.gripHands[1]).distanceTo(p.fp.weapon.obj.localToWorld(p.fp.weapon.offhandGrip.clone())):null,
                              boneLengths:lengths(),maxBoneLengthChange:Math.max(...lengths().map((v,i)=>Math.abs(v-reference[i]))),
                              finiteBones:Object.values(p.mocapBody.bones).every(b=>[...b.position.toArray(),...b.quaternion.toArray(),...b.matrixWorld.elements].every(Number.isFinite))};
                          };
                          return {rigged:g.rigged.size,cls:p.clsId,mocap:!!p.mocap,fp:!!p.fp?.mc,quality:g.settings.quality,...__appGrips(),errors:window.__errs||[]};
                        }''')
                        errors.extend(result['errors'])
                        assert result['rigged']==15 and result['mocap'] and result['fp'] and result['finiteBones'],result
                        if result['worldGripDistance'] is not None:
                            assert result['worldGripDistance']<.02 and result['weaponGripDistance']<.001 and result['fpGripDistance']<.02,result
                        for view in ['fp','tp']:
                            values=game_page.evaluate('(view)=>{const g=__glory.game;g.setViewMode(view);g.debugAdvance(.05);return __appGrips()}',view)
                            assert values['finiteBones'] and values['maxBoneLengthChange']<1e-5,values
                            result[view]=values
                            game_page.screenshot(path=str(output/f'app-{label}-{account}-{view}.png'))
                        result['mirror']=game_page.evaluate('''()=>{
                          const g=__glory.game,p=g.player,m=g.level.mirrors[0],r=g.renderer,render=r.render,target=m.getRenderTarget();let draws=0;
                          p.pos.set(__glory.mode.mirrorZone.center[0],0,__glory.mode.mirrorZone.center[1]);g.viewYaw=-Math.PI/2;g.viewPitch=0;g.setViewMode('fp');
                          r.render=function(scene,camera){if(this.getRenderTarget()===target)draws++;return render.call(this,scene,camera)};
                          try{g.debugAdvance(.05)}finally{r.render=render}
                          return {draws,width:target.width,height:target.height,...__appGrips()};
                        }''')
                        assert result['mirror']['draws']>0 and result['mirror']['finiteBones'] and result['mirror']['maxBoneLengthChange']<1e-5,result['mirror']
                        checks.append({'page':f'app-{label}-{account}',**result})
                        game_page.screenshot(path=str(output/f'app-{label}-{account}-mirror.png'))
                        print('CHECK',label,account,json.dumps(result),flush=True)
                    finally:game_context.close()
        if args.framing_check:
            for orientation,viewport in [('portrait',{'width':390,'height':844}),('landscape',{'width':844,'height':390})]:
                for account in filter(None,args.app_accounts.split(',')):
                    game_context=browser.new_context(viewport=viewport,is_mobile=True,has_touch=True,device_scale_factor=1)
                    game_context.add_init_script('window.requestAnimationFrame=()=>0; Element.prototype.requestPointerLock=()=>Promise.resolve()')
                    game_page=game_context.new_page();game_page.on('pageerror',lambda error:errors.append(str(error)))
                    try:
                        game_page.goto(args.url.rstrip('/')+f'/?auto=training&acc={account}&manual=1&noenv=1',wait_until='networkidle',timeout=120000)
                        game_page.wait_for_function('window.__glory?.game.player?.fp?.mc',timeout=90000,polling=100)
                        result=game_page.evaluate('''async()=>{
                          const {Vector3}=await import('/vendor/three.module.js'),g=__glory.game,p=g.player;g.setViewMode('fp');g.debugAdvance(3);
                          const camera=g.vmCamera;camera.updateWorldMatrix(true,false);
                          const projection=o=>{if(!o)return null;const ndc=o.getWorldPosition(new Vector3()).project(camera);return {ndc:ndc.toArray(),screen:[(ndc.x+1)*innerWidth/2,(1-ndc.y)*innerHeight/2],inside:Math.abs(ndc.x)<=1&&Math.abs(ndc.y)<=1&&Math.abs(ndc.z)<=1}};
                          const projectedBounds=root=>{
                            const min=[Infinity,Infinity],max=[-Infinity,-Infinity],point=new Vector3();let vertices=0,inside=0,behind=0;
                            root.traverse(mesh=>{if(!mesh.isMesh||!mesh.visible)return;if(mesh.skeleton)mesh.skeleton.update();const position=mesh.geometry.attributes.position;
                              for(let i=0;i<position.count;i++){
                                if(mesh.isSkinnedMesh)mesh.getVertexPosition(i,point);else point.fromBufferAttribute(position,i);
                                point.applyMatrix4(mesh.matrixWorld).project(camera);if(point.z>1){behind++;continue;}
                                vertices++;if(Math.abs(point.x)<=1&&Math.abs(point.y)<=1)inside++;
                                min[0]=Math.min(min[0],point.x);min[1]=Math.min(min[1],point.y);max[0]=Math.max(max[0],point.x);max[1]=Math.max(max[1],point.y);
                              }
                            });return {min,max,vertices,behind,insideFraction:vertices?inside/vertices:null};
                          };
                          const reticle=document.querySelector('.crosshair'),rect=reticle.getBoundingClientRect();
                          return {cls:p.clsId,rigged:g.rigged.size,viewport:[innerWidth,innerHeight],vmCamera:{fov:camera.fov,aspect:camera.aspect},worldCamera:{fov:g.camera.fov,aspect:g.camera.aspect},
                            right:{origin:projection(p.fp.weapon.obj),tip:projection(p.fp.weapon.tip),bounds:projectedBounds(p.fp.weapon.obj)},
                            left:p.fp.left?{origin:projection(p.fp.left),tip:projection(p.fp.left.userData.muzzle),bounds:projectedBounds(p.fp.left)}:null,
                            hands:p.fp.gripHands.map(h=>projectedBounds(h.root)),reticle:{visible:getComputedStyle(reticle).display!=='none',center:[rect.x+rect.width/2,rect.y+rect.height/2]},errors:window.__errs||[]};
                        }''')
                        checks.append({'page':f'framing-{orientation}-{account}',**result});errors.extend(result['errors'])
                        game_page.screenshot(path=str(output/f'framing-{orientation}-{account}.png'))
                        print('FRAMING',orientation,account,json.dumps(result),flush=True)
                    finally:game_context.close()
        if args.fade_check:
            for account in filter(None,args.app_accounts.split(',')):
                game_context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1)
                game_context.add_init_script('window.requestAnimationFrame=()=>0; Element.prototype.requestPointerLock=()=>Promise.resolve()')
                game_page=game_context.new_page();game_page.on('pageerror',lambda error:errors.append(str(error)))
                try:
                    game_page.goto(args.url.rstrip('/')+f'/?auto=training&acc={account}&manual=1&noenv=1',wait_until='networkidle',timeout=120000)
                    game_page.wait_for_function('window.__glory?.game.player?.fp?.mc',timeout=90000,polling=100)
                    game_page.evaluate('''()=>{const g=__glory.game;g.setViewMode('fp');g.debugAdvance(3)}''')
                    for variant,near,band in [('baseline',.42,.06),('lower',.30,.06),('narrow',.42,.025),('lower-narrow',.30,.025)]:
                        result=game_page.evaluate(r'''async({near,band})=>{
                          const T=await import('/vendor/three.module.js'),g=__glory.game,p=g.player,r=g.renderer,camera=g.vmCamera;
                          const materials=new Set(),all=[];p.fp.root.traverse(mesh=>{if(mesh.isMesh){all.push(mesh);for(const m of [].concat(mesh.material))if(m.customProgramCacheKey?.().startsWith('fpNearFade'))materials.add(m)}});
                          if(!materials.size)throw Error('No production nearFade materials found');
                          for(const m of materials){
                            m.userData.qaOriginalCompile??=m.onBeforeCompile;
                            const original=m.userData.qaOriginalCompile;
                            m.onBeforeCompile=shader=>{original(shader);const old=shader.fragmentShader;
                              const injected=/d < \d+\.\d{3} \+ \d+\.\d{3} \* h/;
                              if(!injected.test(old))throw Error('nearFade shader injection not found');
                              shader.fragmentShader=old.replace(injected,`d < ${near.toFixed(3)} + ${band.toFixed(3)} * h`);};
                            m.customProgramCacheKey=()=>`fpNearFade-qa-${near}-${band}`;m.needsUpdate=true;
                          }
                          const savedMeshes=all.map(mesh=>({mesh,material:mesh.material,visible:mesh.visible}));
                          const target=new T.WebGLRenderTarget(innerWidth,innerHeight,{depthBuffer:true});
                          const mask=new T.ShaderMaterial({side:T.DoubleSide,toneMapped:false,uniforms:{near:{value:near},band:{value:band},mode:{value:0}},
                            vertexShader:`#include <common>
                              #include <skinning_pars_vertex>
                              varying float qaDepth;
                              void main(){
                                #include <skinbase_vertex>
                                #include <begin_vertex>
                                #include <skinning_vertex>
                                #include <project_vertex>
                                qaDepth=-mvPosition.z;
                              }`,
                            fragmentShader:`uniform float near;uniform float band;uniform float mode;varying float qaDepth;
                              void main(){
                                if(mode<.5){gl_FragColor=vec4(1.);return;}
                                if(mode<1.5){if(qaDepth<near)discard;gl_FragColor=qaDepth<near+band?vec4(1.,0.,0.,1.):vec4(0.,1.,0.,1.);return;}
                                float h=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
                                if(qaDepth<near+band*h)discard;gl_FragColor=vec4(1.);
                              }`});
                          const saved={target:r.getRenderTarget(),viewport:r.getViewport(new T.Vector4()),scissor:r.getScissor(new T.Vector4()),scissorTest:r.getScissorTest(),autoClear:r.autoClear,clear:r.getClearColor(new T.Color()).clone(),alpha:r.getClearAlpha(),background:g.scene.background};
                          const pixels=new Uint8Array(innerWidth*innerHeight*4),counts={};
                          try{
                            for(const {mesh,material,visible} of savedMeshes){const faded=[].concat(material).some(m=>materials.has(m));mesh.visible=visible&&faded;if(faded)mesh.material=mask;}
                            g.scene.background=null;r.autoClear=true;r.setClearColor(0,0);r.setRenderTarget(target);r.setViewport(0,0,innerWidth,innerHeight);r.setScissorTest(false);
                            for(const [name,mode] of [['uncut',0],['regions',1],['visible',2]]){
                              mask.uniforms.mode.value=mode;r.render(g.scene,camera);r.readRenderTargetPixels(target,0,0,innerWidth,innerHeight,pixels);
                              let occupied=0,dither=0,opaque=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]>127){occupied++;if(pixels[i]>127&&pixels[i+1]<127)dither++;if(pixels[i]<127&&pixels[i+1]>127)opaque++;}}
                              counts[name]={occupied,dither,opaque};
                            }
                          }finally{
                            for(const {mesh,material,visible} of savedMeshes){mesh.material=material;mesh.visible=visible;}
                            g.scene.background=saved.background;r.autoClear=saved.autoClear;r.setRenderTarget(saved.target);r.setViewport(saved.viewport);r.setScissor(saved.scissor);r.setScissorTest(saved.scissorTest);r.setClearColor(saved.clear,saved.alpha);target.dispose();mask.dispose();
                          }
                          g.render();
                          return {cls:p.clsId,near,band,vmCamera:{fov:camera.fov,aspect:camera.aspect},maskResolution:[innerWidth,innerHeight],maskIsolation:'arms with weapons hidden',materials:materials.size,maskPixels:counts,
                            visibleFraction:counts.visible.occupied/counts.uncut.occupied,ditherScreenFraction:counts.regions.dither/(innerWidth*innerHeight),errors:window.__errs||[]};
                        }''',{'near':near,'band':band})
                        checks.append({'page':f'fade-{account}-{variant}',**result});errors.extend(result['errors'])
                        game_page.screenshot(path=str(output/f'fade-{account}-{variant}.png'))
                        print('FADE',account,variant,json.dumps(result),flush=True)
                finally:game_context.close()
        if args.mode_check:
            for label,mobile in [('desktop',False),('phone',True)]:
                game_context=browser.new_context(viewport={'width':390 if mobile else 1280,'height':844 if mobile else 800},is_mobile=mobile,has_touch=mobile,device_scale_factor=1)
                game_context.add_init_script('window.requestAnimationFrame=()=>0; Element.prototype.requestPointerLock=()=>Promise.resolve()')
                game_page=game_context.new_page();game_page.on('pageerror',lambda error:errors.append(str(error)))
                try:
                    game_page.goto(args.url.rstrip('/')+'/?auto=training&acc=yysf&manual=1&noenv=1',wait_until='networkidle',timeout=120000)
                    game_page.wait_for_function('window.__glory?.game.player?.mocap && !__glory._loadingMode',timeout=90000,polling=100)
                    game_page.evaluate('''async()=>{
                      const app=__glory,g=app.game,{ACCOUNTS}=await import('/src/data/classes.js');g.settings.attract=false;
                      window.__modeOpts={account:ACCOUNTS.find(a=>a.id==='yysf'),enemy:ACCOUNTS.find(a=>a.id==='yqcy'),diff:'normal',
                        teamA:['lt','myc','yyzq'].map(id=>ACCOUNTS.find(a=>a.id===id)),teamB:['yysf','dmgy','yqcy'].map(id=>ACCOUNTS.find(a=>a.id===id))};
                      window.__resultCalls=[];const show=app.showResults.bind(app);app.showResults=result=>{__resultCalls.push(result.title);return show(result)};
                      window.__modeState=()=>{if(g.level)g.debugAdvance(.05);return {mode:app.modeId,paused:g.paused,over:app.mode?.over,menu:app.menu.root.style.display,
                        resultPage:!!document.querySelector('.results-screen'),resultCalls:[...__resultCalls],teamRows:app.hud.teamBox.innerHTML.length,
                        allies:app.hud.allies?.length??null,enemies:app.hud.enemies?.length??null,target:app.hud._aimT?.name??null,
                        fighters:g.fighters.length,inputFrozen:g.inputFrozen,finiteBones:g.fighters.every(f=>!f.mocapBody||Object.values(f.mocapBody.bones).every(b=>b.matrixWorld.elements.every(Number.isFinite))),
                        errors:window.__errs||[]}};
                    }''')
                    def start_actual(mode):
                        game_page.evaluate('mode=>__glory.startMode(mode,__modeOpts)',mode)
                        game_page.wait_for_function('mode=>__glory.modeId===mode && __glory.mode && !__glory._loadingMode',arg=mode,polling=100,timeout=90000)
                    rows={}
                    start_actual('duel')
                    rows['finalScheduled']=game_page.evaluate('''()=>{window.__oldFinal=__glory.mode;__oldFinal.wins[0]=1;__oldFinal.endRound(0,'QA');return {over:__oldFinal.over,pending:__oldFinal.timers.pending.size}}''')
                    assert rows['finalScheduled']['over'] and rows['finalScheduled']['pending']>0,rows['finalScheduled']
                    start_actual('training')
                    game_page.wait_for_timeout(3000)
                    rows['trainingAfterFinal']=game_page.evaluate('''()=>({...__modeState(),oldTimers:__oldFinal.timers.pending.size})''')
                    state=rows['trainingAfterFinal']
                    assert state['mode']=='training' and not state['paused'] and not state['resultPage'] and not state['resultCalls'] and state['oldTimers']==0 and state['menu']=='none' and not state['inputFrozen'],state
                    game_page.screenshot(path=str(output/f'mode-{label}-training-after-final.png'))
                    for key in ['teamFirst','teamRepeated']:
                        start_actual('team');rows[key]=game_page.evaluate('__modeState()')
                        state=rows[key];assert state['teamRows']>0 and state['allies']==3 and state['enemies']==3 and state['fighters']==6,state
                    game_page.screenshot(path=str(output/f'mode-{label}-team-repeated.png'))
                    game_page.evaluate('__glory.quit()');rows['quitAfterTeam']=game_page.evaluate('__modeState()')
                    state=rows['quitAfterTeam'];assert state['teamRows']==0 and state['allies'] is None and state['enemies'] is None and state['target'] is None and state['fighters']==0,state
                    start_actual('relay');rows['relayAfterTeam']=game_page.evaluate('__modeState()')
                    state=rows['relayAfterTeam'];assert state['teamRows']==0 and state['allies'] is None and state['enemies'] is None and state['fighters']==2,state
                    game_page.evaluate('window.__oldRelay=__glory.mode')
                    start_actual('training');game_page.wait_for_timeout(3000)
                    rows['trainingAfterRelay']=game_page.evaluate('''()=>({...__modeState(),oldTimers:__oldRelay.timers.pending.size})''')
                    state=rows['trainingAfterRelay'];assert state['teamRows']==0 and state['allies'] is None and state['enemies'] is None and state['target'] is None and not state['resultPage'] and not state['resultCalls'] and state['oldTimers']==0 and not state['inputFrozen'],state
                    for state in rows.values():
                        assert state.get('finiteBones',True) and not state.get('errors'),state
                    checks.append({'page':f'actual-mode-{label}','measurements':rows,'errors':[]})
                    print('MODE',label,json.dumps(rows),flush=True)
                finally:game_context.close()
        if args.mobile_check:
            subprocess.run([sys.executable,str(Path(__file__).resolve().with_name('mobiletest.py')),args.url,'--cdp',args.cdp,'--output',str(output/'mobile')],check=True)
            checks.append({'page':'tools/mobiletest.py','passed':True})
    except Exception as error:
        errors.append(f'{type(error).__name__}: {error}')
        raise
    finally:
        (output/'metrics.json').write_text(json.dumps({'sourceVersion':args.version,'metrics':metrics,'checks':checks,'errors':errors},ensure_ascii=False,indent=2))
        context.close()
        if server:server.shutdown();server.server_close()
    if errors:raise AssertionError(errors)
