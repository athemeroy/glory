#!/usr/bin/env python3
"""Source/Blender asset compatibility and visible pose audit on Mini Metal."""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('base');parser.add_argument('output',type=Path);parser.add_argument('--samples',action='store_true');parser.add_argument('--local-models',type=Path);args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
classes=['swordmaster','battlemage','striker','cleric'] if args.samples else 'unspecialized swordmaster battlemage striker sharpshooter launcher warlock cleric witch berserker assassin thug frostcaster boss skeleton'.split();report={'characters':[],'errors':[]}
with sync_playwright() as pw:
 browser=pw.chromium.launch(channel='chrome',headless=True,args=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=metal','--mute-audio'])
 pages={variant:browser.new_page(viewport={'width':1440,'height':900}) for variant in ['original','optimized']}
 for variant,p in pages.items():
  if args.local_models:
   directory=args.local_models/('optimized' if variant=='optimized' else 'rigged')
   p.route('**/assets/models/'+('optimized' if variant=='optimized' else 'rigged')+'/*.glb',lambda route,_request,directory=directory:route.fulfill(path=str(directory/route.request.url.rsplit('/',1)[-1]),content_type='model/gltf-binary'))
  p.on('pageerror',lambda error:report['errors'].append(str(error)));p.goto(args.base.rstrip('/')+'/tools/all-models-quality.html'+('?optimized=1' if variant=='optimized' else ''),wait_until='networkidle',timeout=90000);p.wait_for_function('window.__ready',timeout=90000)
 for cls in classes:
  result={'class':cls}
  for variant,p in pages.items():
   record=p.evaluate('cls=>__load(cls)',cls);record['repairs']=p.evaluate('__repairAudit()');record['guard']=p.evaluate('__guard()');record['animation']=p.evaluate('__animation()');record['skin']=p.evaluate('__skinAudit()');record['invariants']=p.evaluate('__invariants()');result[variant]=record
   for pose in ['stance','attack','guard','down']:
    p.evaluate('pose=>__pose(pose)',pose);p.screenshot(path=str(args.output/f'{cls}-{variant}-{pose}.jpg'),type='jpeg',quality=95)
   p.evaluate('__beauty()');p.screenshot(path=str(args.output/f'{cls}-{variant}-face.jpg'),type='jpeg',quality=97)
  result['identicalRepairSelection']=result['original']['repairs']==result['optimized']['repairs'];report['characters'].append(result);(args.output/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(cls,json.dumps({'repairsEqual':result['identicalRepairSelection'],'guard':result['optimized']['guard'],'skin':result['optimized']['skin']}),flush=True)
 browser.close()
assert not report['errors'],report['errors']
assert all(c['identicalRepairSelection'] for c in report['characters'])
assert all(c['optimized']['finite'] and all(p['nonfinite']==0 for p in c['optimized']['skin']['poses']) for c in report['characters'])
