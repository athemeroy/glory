"""Check actual mirror/main draw calls share geometry and bone matrices in first person."""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser();ap.add_argument('base');ap.add_argument('out',type=Path);a=ap.parse_args();a.out.mkdir(parents=True,exist_ok=True)
reports=[]
with sync_playwright() as pw:
 b=pw.chromium.launch(channel='chrome',headless=True,args=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=metal','--mute-audio'])
 for pilot,w,h in [(True,1280,720),(False,1280,720),(True,390,844),(True,844,390)]:
  page=b.new_page(viewport={'width':w,'height':h},is_mobile=w<1000,has_touch=w<1000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(a.base+'?auto=training&acc=yysf&manual=1&view=fp'+('&swordpilot=1' if pilot else ''))
  page.wait_for_function('window.__glory?.game?.player && !window.__glory.game.inputFrozen',timeout=90000);page.wait_for_load_state('networkidle')
  page.evaluate('''()=>{const g=window.__glory.game,p=g.player,m=g.scene.getObjectByName('mirror');p.resetState();p.pos.set(m.position.x+2,0,m.position.z);p.yaw=-Math.PI/2;g.viewYaw=p.yaw;g.viewPitch=-.12;g.settings.shake=false;g.settings.bob=false;g.debugAdvance(.5);
   window.mirrorDraws=[];const observe=(mesh,kind)=>{const prev=mesh.onBeforeRender;mesh.onBeforeRender=function(r,s,c,...rest){prev.call(this,r,s,c,...rest);window.mirrorDraws.push({id:mesh.uuid,kind,cam:c===g.camera?'main':c===g.vmCamera?'overlay':'mirror',geometry:mesh.geometry.uuid,indices:mesh.geometry.index?.count,world:mesh.matrixWorld.toArray(),bones:mesh.skeleton?Array.from(mesh.skeleton.boneMatrices):null,clip:[].concat(mesh.material).flatMap(m=>m.clippingPlanes?.map(p=>p.constant)||[])});};};
   p.rig.headParts.forEach(m=>observe(m,'head'));p.rig.armParts.filter(m=>m.isSkinnedMesh).forEach(m=>observe(m,'arm'));p.weapon.obj.traverse(m=>{if(m.isMesh)observe(m,'weapon')});}''')
  samples=[]
  for idx in [-1,0,1,2]:
   for phase in ([.2] if idx<0 else [.07,.23,.39]):
    result=page.evaluate('''({idx,phase})=>{const g=window.__glory.game,p=g.player,m=g.scene.getObjectByName('mirror');p.resetState();p.pos.set(m.position.x+2,0,m.position.z);if(idx>=0)p.startAction(p.chain[idx],'atk',{chainIdx:idx});g.debugAdvance(phase);window.mirrorDraws=[];g.render();return {idx,phase,clip:p.mocap.curName,fpBody:g.fpBody,fpVisible:p.fp.root.visible,overflow:document.documentElement.scrollWidth>innerWidth,draws:window.mirrorDraws};}''',dict(idx=idx,phase=phase))
    assert result['fpBody'] and not result['fpVisible'] and not result['overflow'],result
    draws=result.pop('draws');heads=[d for d in draws if d['kind']=='head'];assert heads and all(d['cam']=='mirror' and not d['clip'] for d in heads),heads
    arms=[d for d in draws if d['kind']=='arm'];assert arms,draws
    for d in [d for d in arms if d['cam']=='main']:
     mirror=next(x for x in arms if x['cam']=='mirror' and x['id']==d['id']);assert all(d[k]==mirror[k] for k in ['geometry','indices','world','bones']),[d,mirror];assert not d['clip'],d
    assert any(d['cam']=='main' for d in arms) and any(d['cam']=='mirror' for d in arms),arms
    assert not any(d['cam']=='overlay' for d in draws),draws
    result.update(headDraws=len(heads),sharedArmDraws=len([d for d in arms if d['cam']=='main']));samples.append(result)
    if idx<0 or phase==.23:page.screenshot(path=str(a.out/f'{"pilot" if pilot else "default"}-{w}x{h}-{idx}.jpg'),type='jpeg',quality=90)
  for view in ['tp','ots','fp']:
   evidence=page.evaluate('''v=>{const g=window.__glory.game,p=g.player;g.setViewMode(v);g.debugAdvance(.05);window.mirrorDraws=[];g.render();return {view:v,headMasks:p.rig.headParts.map(m=>m.layers.mask),arms:p.rig.armParts.filter(m=>m.isSkinnedMesh).map(m=>m.geometry.index.count),headCalls:window.mirrorDraws.filter(d=>d.kind==='head').map(d=>({cam:d.cam,clip:d.clip}))}}''',view)
   assert all(mask==(2 if view=='fp' else 1) for mask in evidence['headMasks']),evidence
   assert all(not d['clip'] for d in evidence['headCalls']),evidence
  assert not errors,errors
  reports.append(dict(pilot=pilot,viewport=[w,h],samples=samples,errors=errors));page.close()
 b.close()
(a.out/'results.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2));print(json.dumps(reports,ensure_ascii=False))
