#!/usr/bin/env python3
"""Exercise cancellation during asset loading and the loading-screen delay.

python tools/loadqa.py --serve --cdp http://127.0.0.1:9334 --output load-qa
Only independent contexts are closed; shared Chrome stays running.
"""
import argparse
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('url', nargs='?')
parser.add_argument('--serve', action='store_true')
parser.add_argument('--cdp', default='http://127.0.0.1:9334')
parser.add_argument('--output', default='load-qa')
args = parser.parse_args()
server = None
if args.serve:
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *_): pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(Path(__file__).resolve().parents[1])))
    Thread(target=server.serve_forever, daemon=True).start()
    args.url = f'http://127.0.0.1:{server.server_port}'
if not args.url: parser.error('Provide a URL or --serve')
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
results = []
try:
    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp(args.cdp)
        for label, mobile in [('desktop', False), ('phone', True)]:
            context = browser.new_context(viewport={'width': 390 if mobile else 1280, 'height': 844 if mobile else 800}, is_mobile=mobile, has_touch=mobile)
            context.add_init_script('window.requestAnimationFrame=()=>0; Element.prototype.requestPointerLock=()=>Promise.resolve()')
            page = context.new_page(); errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            try:
                page.goto(args.url.rstrip('/')+'/?models=0&mocap=0&noenv=1', wait_until='networkidle', timeout=90000)
                page.wait_for_function('window.__glory', polling=100)
                page.evaluate('''async()=>{
                  const app=__glory,g=app.game; await g.preload(); g.settings.attract=false;
                  window.__preloadNative=g.preload.bind(g);
                  const {ACCOUNTS}=await import('/src/data/classes.js');
                  const {input}=await import('/src/engine/input.js'); window.__testInput=input;
                  const {store}=await import('/src/engine/util.js');store.set(input.touchMode?'seenTouchHelp':'seenHelp',false);
                  window.__first=ACCOUNTS.find(a=>a.id==='yysf');window.__second=ACCOUNTS.find(a=>a.id==='yqcy');
                  window.__holdLoad=()=>{g.preload=()=>new Promise(resolve=>{window.__releaseLoad=resolve})};
                  window.__state=()=>({mode:!!app.mode,cls:g.player?.clsId||null,menu:app.menu.root.style.display,input:input.enabled,
                    loading:!!app._loadingMode,timers:!!(app._loadTick||app._startTimer||app._hideLoadTimer),help:!!document.querySelector('.quick-help'),fighters:g.fighters.length,level:!!g.level,
                    paused:g.paused,status:document.querySelector('.load-state')?.textContent||null});
                }''')
                rows = {}
                page.evaluate('__glory.game.loadProgress=0;__holdLoad();__glory.startMode("training",{account:__first,diff:"normal"})')
                progress = []
                for step, value in enumerate([0.2, 0.7, 0.1, 0.4]):
                    stage = f'qa-progress-step-{step}'
                    page.evaluate('({value,stage})=>{__glory.game.loadProgress=value;__glory.game.loadStage=stage}', {'value':value,'stage':stage})
                    target = round(10 + 85 * value)
                    # 以实际interval已消费本步状态为屏障，不能假定130ms内一定派发一次。
                    page.wait_for_function('({stage,target})=>document.querySelector(".load-state")?.textContent.includes(stage) && Number(document.querySelector(".load-bar")?.getAttribute("aria-valuenow"))>=target', arg={'stage':stage,'target':max(target, int(progress[-1]) if progress else 0)}, polling=100, timeout=30000)
                    progress.append(page.locator('.load-bar').get_attribute('aria-valuenow'))
                rows['displayProgress'] = list(map(int, progress))
                button = page.locator('.load-cancel'); bounds = button.bounding_box()
                viewport = page.viewport_size
                assert bounds['height'] >= 44 and bounds['x'] >= 0 and bounds['y'] >= 0 and bounds['x']+bounds['width'] <= viewport['width'] and bounds['y']+bounds['height'] <= viewport['height'], bounds
                button.click()
                page.evaluate('__releaseLoad();__glory.game.loadProgress=1')
                page.wait_for_timeout(550)
                rows['clickCancelWhileLoading'] = page.evaluate('__state()')
                page.evaluate('__holdLoad();__glory.startMode("training",{account:__first,diff:"normal"});__glory.quit();__releaseLoad()')
                page.wait_for_timeout(550)
                rows['quitWhileLoading'] = page.evaluate('__state()')
                page.evaluate('''()=>{
                  __holdLoad();__glory.startMode('training',{account:__first,diff:'normal'});const stale=__releaseLoad;
                  __glory.startMode('training',{account:__second,diff:'normal'});stale();
                }''')
                page.wait_for_timeout(150)
                rows['staleRequest'] = page.evaluate('__state()')
                page.evaluate('__releaseLoad()')
                page.wait_for_function('__glory.game.player?.clsId==="sharpshooter"', polling=20, timeout=90000)
                page.evaluate('__glory.quit()')
                page.wait_for_timeout(450)
                rows['quitDuringHideDelay'] = page.evaluate('__state()')
                page.evaluate('__glory.game.preload=()=>Promise.resolve();__glory.startMode("training",{account:__first,diff:"normal"})')
                page.wait_for_function('__glory.mode && __glory._loadingMode && __glory._hideLoadTimer', polling=20, timeout=90000)
                # 真实键盘事件必须在350ms隐藏延迟内触发，不能用直接quit替代这个竞争条件。
                page.keyboard.press('Escape')
                page.wait_for_timeout(450)
                rows['escapeDuringHideDelay'] = page.evaluate('__state()')
                page.evaluate('__glory.game.preload=()=>Promise.resolve();__glory.startMode("training",{account:__first,diff:"normal"})')
                page.wait_for_function('__glory.game.player && __glory.menu.root.style.display==="none"', polling=50, timeout=90000)
                rows['normalStart'] = page.evaluate('__state()')
                page.evaluate('__glory.quit()')
                rows['quitWithHelp'] = page.evaluate('__state()')
                page.evaluate('__glory.game.preload=()=>Promise.reject(new Error("expected preload rejection"));__glory.startMode("training",{account:__first,diff:"normal"})')
                page.wait_for_function('document.querySelector(".load-state")?.textContent.includes("加载失败")', polling=100, timeout=90000)
                rows['preloadFailure'] = page.evaluate('__state()')
                page.locator('.load-cancel').click()
                rows['cancelFailure'] = page.evaluate('__state()')
                page.evaluate('__glory.game.preload=__preloadNative;__glory.startMode("training",{account:__first,diff:"normal"})')
                page.wait_for_function('__glory.game.player && __glory.menu.root.style.display==="none" && !__glory._loadingMode', polling=50, timeout=90000)
                rows['retryAfterFailure'] = page.evaluate('__state()')
                page.evaluate('__glory.quit()')
                for key in ['clickCancelWhileLoading', 'quitWhileLoading', 'quitDuringHideDelay', 'escapeDuringHideDelay', 'cancelFailure']:
                    state = rows[key]
                    assert not state['mode'] and not state['level'] and state['fighters']==0 and not state['input'] and not state['loading'] and not state['timers'] and state['menu']!='none', state
                assert not rows['staleRequest']['mode'] and rows['staleRequest']['loading'] and rows['staleRequest']['menu']!='none', rows['staleRequest']
                assert rows['normalStart']['cls']=='swordmaster' and rows['normalStart']['input'] and not rows['normalStart']['loading'] and not rows['normalStart']['timers'] and rows['normalStart']['menu']=='none', rows['normalStart']
                assert rows['normalStart']['help'] and not rows['quitWithHelp']['help'] and not rows['quitWithHelp']['input'], rows['quitWithHelp']
                assert rows['displayProgress'] == sorted(rows['displayProgress']) and rows['displayProgress'][1] > rows['displayProgress'][0], rows['displayProgress']
                failure = rows['preloadFailure']; assert failure['loading'] and not failure['mode'] and not failure['input'] and not failure['timers'] and failure['menu']!='none' and '加载失败' in failure['status'], failure
                retry = rows['retryAfterFailure']; assert retry['cls']=='swordmaster' and retry['input'] and not retry['loading'] and not retry['timers'] and retry['menu']=='none', retry
                assert not errors, errors
                result = {'label':label, 'measurements':rows, 'errors':errors}
                results.append(result); print(json.dumps(result, ensure_ascii=False), flush=True)
            finally: context.close()
finally:
    (out/'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    if server: server.shutdown(); server.server_close()
