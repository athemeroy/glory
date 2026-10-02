"""Bake account portraits from the same optimized models used in the client."""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser();ap.add_argument('base');ap.add_argument('output',type=Path);args=ap.parse_args();args.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome',headless=True,args=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=metal','--mute-audio'])
    page=browser.new_page(viewport={'width':900,'height':700},device_scale_factor=1);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(args.base.rstrip('/')+'/',wait_until='networkidle');page.wait_for_function('window.__glory?.game');page.evaluate('window.__glory.game.preload()')
    classes=page.evaluate("""async()=>{
      const {CharViewer}=await import('./src/ui/viewer.js');const {CLASS_ORDER}=await import('./src/data/classes.js');
      const THREE=await import('three');window.__avatarThree=THREE;
      window.__glory.menu.clear();document.querySelector('#menu').style.display='none';
      const box=document.createElement('div');box.id='avatar';box.style.cssText='position:fixed;left:0;top:0;width:512px;height:512px;z-index:999;background:#19252e';document.body.append(box);
      const g=window.__glory.game;window.__avatar=new CharViewer(box,g.models,g.rigged);cancelAnimationFrame(window.__avatar.raf);
      return CLASS_ORDER;
    }""")
    report=[]
    for cls in classes:
        result=page.evaluate("""cls=>{
          const v=window.__avatar,T=window.__avatarThree;v.show(cls,'idle');
          if(!v.body)throw Error('Missing optimized portrait body: '+cls);
          for(let i=0;i<5;i++){v.last=performance.now()-50;v.frame();}
          v.rot=0;v.holder.rotation.y=0;v.weapon.obj.visible=false;if(v.leftWeapon)v.leftWeapon.visible=false;
          v.scene.background=new T.Color('#1b2a31');v.r.toneMappingExposure=1.2;v.rig.root.updateMatrixWorld(true);
          const head=v.body.bones.Head.localToWorld(new T.Vector3(...v.body.shape.headOffset));
          const target=head.clone().add(new T.Vector3(0,-.075,0));v.cam.position.copy(target).add(new T.Vector3(.08,.02,1.23));v.cam.lookAt(target);v.cam.aspect=1;v.cam.updateProjectionMatrix();v.r.render(v.scene,v.cam);
          return {cls,model:v.modelKey,source:v._sourceRig.userData.gloryClass,head:head.toArray(),triangles:v.r.info.render.triangles};
        }""",cls)
        page.locator('#avatar canvas').screenshot(path=str(args.output/(cls+'.png')))
        report.append(result)
    browser.close()
    (args.output/'manifest.json').write_text(json.dumps({'models':report,'errors':errors},ensure_ascii=False,indent=2));print(json.dumps({'models':len(report),'errors':errors}))
    assert len(report)==13 and not errors
