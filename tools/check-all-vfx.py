"""Render every class/skill on Mini's GPU and check VFX budgets and disposal."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

p=argparse.ArgumentParser();p.add_argument('base');p.add_argument('output',type=Path);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
results=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome',headless=True,args=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=metal','--mute-audio'])
    page=browser.new_page(viewport={'width':1280,'height':720});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(a.base+'/tools/vfx-check.html',wait_until='networkidle');page.wait_for_function('window.vfxQA');page.evaluate('vfxQA.setManual(true)')
    manifest=page.evaluate('Object.fromEntries(vfxQA.names.map(k=>[k,Object.keys(vfxQA.specs[k].skills)]))')
    extras=page.evaluate('vfxQA.extras')
    for cls,key in extras:manifest[cls].append('lib:'+key)
    for cls,slots in manifest.items():
        for slot in ['atk',*slots]:
            data=page.evaluate('([cls,slot])=>vfxQA.show(cls,slot,.08)',[cls,slot]);page.screenshot(path=str(a.output/f'{cls}-{slot.replace(":","-")}-wind.jpg'),quality=85,type='jpeg')
            data['active']=page.evaluate('()=>{const a=vfxQA,d=a.player.action.def;const delay=d.aoe?.[0]?.delay||0;const t=(d.wind||0)/1000+delay/1000+(d.heal?.2:.08);return a.advance(Math.max(.015,t-.08))}')
            page.screenshot(path=str(a.output/f'{cls}-{slot.replace(":","-")}-active.jpg'),quality=85,type='jpeg')
            data['complete']=page.evaluate('vfxQA.advance(5)')
            assert data['active']['items']<=data['active']['maxItems'],data
            assert data['active']['drawables']<=data['active']['maxDrawables'],data
            assert data['active']['particles']<=data['active']['maxParticles'],data
            finite=page.evaluate('()=>{let bad=[];vfxQA.scene.traverse(o=>{if(!o.matrixWorld.elements.every(Number.isFinite))bad.push(o.uuid)});return bad}')
            assert not finite,(cls,slot,finite)
            results.append(data)
    page.evaluate('vfxQA.clear()');baseline=page.evaluate('vfxQA.renderer.info.memory')
    stress=page.evaluate('vfxQA.stress(500)');assert stress['items']<=stress['maxItems'],stress
    page.evaluate('vfxQA.advance(8)');settled=page.evaluate('vfxQA.vfx.getStats()');assert settled['items']==0,settled
    page.evaluate('vfxQA.clear()');final=page.evaluate('vfxQA.renderer.info.memory')
    assert final['geometries']<=baseline['geometries']+3,(baseline,final)
    assert not errors,errors
    report={'skills':results,'errors':errors,'stress':stress,'settled':settled,'memory':{'baseline':baseline,'final':final}}
    (a.output/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({'samples':len(results),'errors':errors,'stress':stress,'settled':settled,'memory':report['memory']},ensure_ascii=False));browser.close()
