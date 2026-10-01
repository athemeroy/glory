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
parser.add_argument('--classes',default='unspecialized,swordmaster,battlemage,striker,sharpshooter,launcher,warlock,cleric,witch,berserker,assassin,thug,frostcaster,boss,skeleton')
parser.add_argument('--poses',default='stance,attack,overhead')
parser.add_argument('--forms',default='')
parser.add_argument('--samples',default='',help='Comma-separated class:animation:normalized-time samples')
parser.add_argument('--probes',default='',help='Comma-separated class:vertex-a:vertex-b:pose marked closeups')
parser.add_argument('--check-pages',default='',help='Comma-separated test HTML pages exposing __ready and __errors')
parser.add_argument('--app-check',action='store_true',help='Verify the actual default asset-loading game path on desktop and phone')
parser.add_argument('--app-accounts',default='yysf',help='Comma-separated real training accounts; two-handed accounts also verify world/FP grips and mirror rendering')
parser.add_argument('--mobile-check',action='store_true',help='Run the existing touch, menu and desktop input regression through the same temporary server')
args=parser.parse_args()
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
    page=context.new_page()
    page.on('pageerror',lambda error: errors.append(str(error)))
    try:
        page.goto(args.url.rstrip('/')+'/tools/model-audit.html',wait_until='networkidle',timeout=90000)
        page.wait_for_function('window.__ready',timeout=90000,polling=100)
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
                        checks.append({'page':f'app-{label}-{account}',**result});errors.extend(result['errors'])
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
                        game_page.screenshot(path=str(output/f'app-{label}-{account}-mirror.png'))
                        print('CHECK',label,account,json.dumps(result),flush=True)
                    finally:game_context.close()
        if args.mobile_check:
            subprocess.run([sys.executable,str(Path(__file__).resolve().with_name('mobiletest.py')),args.url,'--cdp',args.cdp,'--output',str(output/'mobile')],check=True)
            checks.append({'page':'tools/mobiletest.py','passed':True})
    except Exception as error:
        errors.append(f'{type(error).__name__}: {error}')
        raise
    finally:
        (output/'metrics.json').write_text(json.dumps({'metrics':metrics,'checks':checks,'errors':errors},ensure_ascii=False,indent=2))
        context.close()
        if server:server.shutdown();server.server_close()
    if errors:raise AssertionError(errors)
