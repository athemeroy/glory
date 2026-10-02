#!/usr/bin/env python3
"""Audit every production body on Mini Metal Chrome, preserving the running server."""
import argparse, json
from pathlib import Path
from playwright.sync_api import sync_playwright
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('base');parser.add_argument('output',type=Path);parser.add_argument('--native',action='store_true');parser.add_argument('--quick',action='store_true')
args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
classes='unspecialized,swordmaster,battlemage,striker,sharpshooter,launcher,warlock,cleric,witch,berserker,assassin,thug,frostcaster,boss,skeleton'.split(',')
results=[]; errors=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome',headless=True,args=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=metal','--mute-audio'])
    page=browser.new_page(viewport={'width':1440,'height':900});page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(args.base.rstrip('/')+'/tools/all-models-quality.html'+('?nativeHands=1' if args.native else ''),wait_until='networkidle',timeout=90000)
    page.wait_for_function('window.__ready',timeout=90000)
    for cls in classes:
        result=page.evaluate('(cls)=>__load(cls)',cls);result['poses']=[]
        for pose in ['stance','attack','run','guard','down']:
            result['poses'].append(page.evaluate('(pose)=>__pose(pose)',pose))
            page.screenshot(path=str(args.output/f'{cls}-{pose}.jpg'),type='jpeg',quality=92)
        if not args.quick:
            result['guard']=page.evaluate('__guard()');result['animation']=page.evaluate('__animation()');result['invariants']=page.evaluate('__invariants()')
        results.append(result)
        (args.output/'results.json').write_text(json.dumps({'characters':results,'errors':errors},ensure_ascii=False,indent=2))
        print(cls,json.dumps({'shape':result['shape'],'guard':result.get('guard'),'animation':result.get('animation')}),flush=True)
    browser.close()
if errors:raise AssertionError(errors)
assert all(c['finite'] and all(p['finite'] for p in c['poses']) for c in results)
if not args.quick:
    assert all(c['guard']['drift']<1e-5 and c['guard']['angle']<1e-5 and all(a['finite'] for a in c['animation']['actions']) for c in results)
