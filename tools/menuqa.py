#!/usr/bin/env python3
"""Measure actual menu/game frame work with GPU drawing disabled after startup.

python tools/menuqa.py --serve --baseline --output menu-baseline
python tools/menuqa.py --serve --output menu-qa
"""
import argparse
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('url',nargs='?')
parser.add_argument('--serve',action='store_true')
parser.add_argument('--baseline',action='store_true')
parser.add_argument('--cdp',default='http://127.0.0.1:9334')
parser.add_argument('--output',default='menu-qa')
args=parser.parse_args()
server=None
if args.serve:
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self,*_):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(Path(__file__).resolve().parents[1])))
    Thread(target=server.serve_forever,daemon=True).start()
    args.url=f'http://127.0.0.1:{server.server_port}'
if not args.url:parser.error('Provide a URL or --serve')
out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
results=[]
try:
    with sync_playwright() as pw:
        browser=pw.chromium.connect_over_cdp(args.cdp)
        for label,mobile in [('desktop',False),('phone',True)]:
            context=browser.new_context(viewport={'width':390 if mobile else 1280,'height':844 if mobile else 800},is_mobile=mobile,has_touch=mobile)
            context.add_init_script('window.requestAnimationFrame=()=>0; Element.prototype.requestPointerLock=()=>Promise.resolve()')
            page=context.new_page();errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            try:
                page.goto(args.url.rstrip('/')+'/?models=0&mocap=0&noenv=1',wait_until='networkidle',timeout=90000)
                page.wait_for_function('window.__glory',polling=100,timeout=90000)
                page.evaluate('''async()=>{
                  const app=__glory,g=app.game; await g.preload();
                  const {input}=await import('/src/engine/input.js'); window.__testInput=input;
                  window.__measure=()=>{let renders=0,cameras=0;const r=g.render,u=g.updateCamera;
                    g.render=()=>{renders++;g._renderDirty=false};g.updateCamera=(...args)=>{cameras++;u.apply(g,args)};
                    const before=g.time;for(let i=0;i<30;i++)g.frame(1/60);
                    g.render=r;g.updateCamera=u;return {renders,cameras,simulation:g.time-before,paused:g.paused,mode:app.modeId||null};};
                }''')
                rows={}
                rows['title']=page.evaluate('__measure()')
                page.evaluate('__glory.menu.main();__glory.startAttract()')
                page.wait_for_timeout(100)
                rows['main']=page.evaluate('__measure()')
                page.evaluate('__glory.menu.setup("training")')
                rows['setup']=page.evaluate('__measure()')
                page.evaluate('''async()=>{const {ACCOUNTS}=await import('/src/data/classes.js');const acc=ACCOUNTS.find(a=>a.id==='yysf');__glory.startMode('training',{account:acc,diff:'normal'});}''')
                page.wait_for_function('window.__glory.game.player && __glory.menu.root.style.display === "none"',polling=100,timeout=90000)
                rows['running']=page.evaluate('__measure()')
                page.evaluate('__glory.pause()')
                rows['paused']=page.evaluate('__measure()')
                page.evaluate('__glory.menu.settings(()=>{});__glory.game.settings.fov+=1;__glory.game.saveSettings()')
                rows['settings']=page.evaluate('__measure()')
                page.evaluate('__testInput.fallbackLook=true;__glory.resume()')
                rows['resumed']=page.evaluate('__measure()')
                page.evaluate('__glory.openWardrobe()')
                rows['wardrobe']=page.evaluate('__measure()')
                page.get_by_role('button',name='取消',exact=True).click()
                rows['wardrobeClosed']=page.evaluate('__measure()')
                page.evaluate('Object.defineProperty(document,"hidden",{configurable:true,value:true})')
                rows['hidden']=page.evaluate('__measure()')
                page.evaluate('delete document.hidden')
                rows['visible']=page.evaluate('__measure()')
                page.evaluate('__glory.quit()')
                page.wait_for_timeout(100)
                rows['quit']=page.evaluate('__measure()')
                errors.extend(page.evaluate('window.__errs||[]'))
                result={'label':label,'frames':30,'measurements':rows,'errors':errors}
                results.append(result);print(json.dumps(result,ensure_ascii=False),flush=True)
                assert not errors,errors
                if not args.baseline:
                    assert rows['title']['renders']==0,rows['title']
                    if mobile:
                        for key in ['main','setup','quit']:
                            assert rows[key]['renders']==0 and rows[key]['simulation']==0,rows[key]
                    else:
                        for key in ['main','setup','quit']:
                            assert rows[key]['renders']==30 and rows[key]['simulation']>0,rows[key]
                    for key in ['paused','settings']:
                        assert rows[key]['renders']<=1 and rows[key]['simulation']==0,rows[key]
                    for key in ['running','resumed','wardrobe','wardrobeClosed','visible']:
                        assert rows[key]['renders']==30 and rows[key]['simulation']>0,rows[key]
                    assert rows['hidden']['renders']==0 and rows['hidden']['simulation']==0,rows['hidden']
            finally:context.close()
finally:
    (out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
    if server:server.shutdown();server.server_close()
