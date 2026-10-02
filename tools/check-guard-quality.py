import argparse,json, pathlib
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser();ap.add_argument('base');ap.add_argument('output',type=pathlib.Path);a=ap.parse_args();out=a.output;out.mkdir(parents=True,exist_ok=True);base=a.base.rstrip('/')
with sync_playwright() as pw:
 b=pw.chromium.launch(channel='chrome',headless=True,args=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=metal','--mute-audio']);reports=[]
 for route in ['guard-pose-test.html','anim-regression.html']:
  p=b.new_page();p.goto(base+'/tools/'+route);p.wait_for_function('window.__done||window.__ready',timeout=90000);r=p.evaluate('({results:window.__results,errors:window.__errors})');assert not r['errors'],r;reports.append({'test':route,'checks':len(r['results'])});p.close()
 for width,height,dpr,pilot in [(1280,720,2,True),(390,844,3,True),(1280,720,2,False),(390,844,3,False)]:
  p=b.new_page(viewport={'width':width,'height':height},device_scale_factor=dpr,is_mobile=width<1000,has_touch=width<1000);errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
  p.goto(base+'/index.html?auto=training&acc=yysf&manual=1&view=fp'+('&swordpilot=1' if pilot else ''));p.wait_for_function('window.__glory?.game?.player&&!window.__glory.game.inputFrozen',timeout=90000);p.wait_for_load_state('networkidle')
  report=p.evaluate('''()=>{const g=window.__glory.game,p=g.player,m=g.scene.getObjectByName('mirror');p.resetState();p.pos.set(m.position.x+1.8,0,m.position.z);p.yaw=-Math.PI/2;p.pitch=-.35;g.viewYaw=p.yaw;g.viewPitch=p.pitch;p.state='guard';p.guarding=true;g.settings.shake=false;g.settings.bob=false;
   for(let i=0;i<30;i++)p.updateModel(1/60);p.rig.root.updateMatrixWorld(true);const head=p.mocapBody.bones.Head,base=head.getWorldPosition(head.position.clone());let drift=0;
   for(let i=0;i<1800;i++){p.updateModel(1/60);p.rig.root.updateMatrixWorld(true);drift=Math.max(drift,head.getWorldPosition(head.position.clone()).distanceTo(base))}
   g.updateCamera(.3);g.render();const renderer=g.renderer,rt=g.post.composer.renderTarget1,mirror=m.getRenderTarget();return {drift,quality:g.settings.quality,pr:renderer.getPixelRatio(),canvas:[renderer.domElement.width,renderer.domElement.height],post:[rt.width,rt.height],mirror:[mirror.width,mirror.height],fxaa:!!g.post.fxaa,overflow:document.documentElement.scrollWidth>innerWidth};}''')
  assert report['drift']<1e-5 and report['canvas']==report['post'] and not report['overflow'],report
  if width<1000:assert report['fxaa'] and report['pr']==1.25,report
  p.screenshot(path=str(out/f'guard-{width}-{pilot}.jpg'),type='jpeg',quality=92)
  # Verify interpolation produces a fractional attack pose only during render and restores simulation exactly.
  smooth=p.evaluate('''()=>{const g=window.__glory.game,p=g.player;p.resetState();p.startAction(p.chain[0],'atk',{chainIdx:0});for(let i=0;i<5;i++){p.action.t+=1000/60;p.updateModel(1/60)}
   const sample=p.renderPose.samples.filter(s=>Object.values(p.mocapBody.bones).includes(s.node)).reduce((best,s)=>s.prevQ.angleTo(s.currQ)>best.prevQ.angleTo(best.currQ)?s:best),before=sample.node.quaternion.clone(),expected=sample.prevQ.clone().slerp(sample.currQ,.5);let angle=null;
   g.camHook=()=>{angle=Math.max(...sample.node.quaternion.toArray().map((x,i)=>Math.abs(x-expected.toArray()[i])))};const paused=g.paused;g.manual=false;g.paused=false;g.acc=1/120;g.render();g.manual=true;g.paused=paused;g.camHook=null;
   return {movement:sample.prevQ.angleTo(sample.currQ),renderError:angle,restoreError:Math.max(...sample.node.quaternion.toArray().map((x,i)=>Math.abs(x-before.toArray()[i])))};}''')
  assert smooth['movement']>.001 and smooth['renderError']<1e-6 and smooth['restoreError']<1e-6,smooth
  p.evaluate('''()=>{const g=window.__glory.game;g.degrade();}''');assert p.evaluate('window.__glory.game.renderer.domElement.width===window.__glory.game.post.composer.renderTarget1.width')
  assert not errors,errors;reports.append(dict(viewport=[width,height,dpr],pilot=pilot,guard=report,smooth=smooth,errors=errors));p.close()
 b.close()
(out/'results.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2));print(json.dumps(reports,ensure_ascii=False))
