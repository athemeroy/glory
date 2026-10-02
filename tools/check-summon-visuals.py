import argparse,json,pathlib
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('base');p.add_argument('output',type=pathlib.Path);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
with sync_playwright()as pw:
 b=pw.chromium.launch(channel='chrome',headless=True,args=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=metal','--mute-audio']);page=b.new_page(viewport={'width':1120,'height':840},device_scale_factor=1.5);errors=[];page.on('pageerror',lambda e:errors.append(str(e)));report=[]
 for kind in ['cat','wolf','eagle','dragon']:
  page.goto(a.base+'/tools/summons-preview.html?kind='+kind,wait_until='networkidle');page.wait_for_function('window.__ready');page.screenshot(path=str(a.output/(kind+'.jpg')),quality=93,type='jpeg');report.append(page.evaluate('()=>({kind:window.__preview.kind,drawCalls:window.__preview.renderer.info.render.calls,triangles:window.__preview.renderer.info.render.triangles})'))
 assert not errors,errors;(a.output/'visuals.json').write_text(json.dumps(dict(models=report,errors=errors),ensure_ascii=False,indent=2));print(json.dumps(report));b.close()
