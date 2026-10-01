#!/usr/bin/env python3
"""Mini Metal 上真实丢失/恢复游戏上下文；只关闭自己创建的浏览器 context。"""
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
parser.add_argument('--cdp',default='http://127.0.0.1:9334')
parser.add_argument('--output',default='graphics-qa')
args=parser.parse_args();server=None
if args.serve:
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self,*_):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(Path(__file__).resolve().parents[1])))
    Thread(target=server.serve_forever,daemon=True).start();args.url=f'http://127.0.0.1:{server.server_port}'
if not args.url:parser.error('Provide a URL or --serve')
output=Path(args.output);output.mkdir(parents=True,exist_ok=True);results=[]
try:
    with sync_playwright() as pw:
        browser=pw.chromium.connect_over_cdp(args.cdp)
        for label,mobile in [('desktop',False),('phone',True)]:
            context=browser.new_context(viewport={'width':390 if mobile else 1280,'height':844 if mobile else 800},is_mobile=mobile,has_touch=mobile)
            context.add_init_script('window.requestAnimationFrame=()=>0; Element.prototype.requestPointerLock=()=>Promise.resolve()')
            page=context.new_page();errors=[];checks=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            def check(expression,message):
                assert page.evaluate(expression),(label,message)
                checks.append(message);print('PASS',label,message,flush=True)
            try:
                page.goto(args.url.rstrip('/')+'/?auto=training&acc=yysf&manual=1&noenv=1',wait_until='networkidle',timeout=90000)
                page.wait_for_function('window.__glory?.game.player && __glory.menu.root.style.display === "none"',polling=100,timeout=90000)
                page.evaluate('''async()=>{
                    window.__input=(await import('/src/engine/input.js')).input;
                    const g=__glory.game;g.debugAdvance(.05);
                    window.__contextExt=g.renderer.getContext().getExtension('WEBGL_lose_context');
                    window.__retained={player:g.player,geometry:g.player.mocapBody.meshes[0].geometry,skeleton:g.player.mocapBody.meshes[0].skeleton};
                }''')
                check('!!__contextExt && __glory.game.rigged.size===15 && !!__glory.game.player.fp','真实默认资产与第一人称已加载')
                for cycle in range(2):
                    if cycle:page.evaluate('__glory.pause()')
                    page.evaluate('''()=>{const g=__glory.game;window.__before={time:g.time,paused:g.paused,enabled:__input.enabled};__input.touchHold('attack',true);__input.touchMove=[.3,1];__input.mouseDX=20;__contextExt.loseContext()}''')
                    page.wait_for_function('__glory.game.contextLost',polling=100,timeout=15000)
                    check('document.querySelector(".graphics-recovery").getClientRects().length>0 && __glory.touch.root.hidden','实际丢失事件显示恢复状态并隐藏屏幕操作')
                    check('__input.touchDown.size===0 && __input.touchPressedAt.size===0 && __input.mouseDX===0 && __input.touchMove.every(v=>v===0)','丢失后动作和摇杆全部释放')
                    page.evaluate('''()=>{const g=__glory.game;for(let i=0;i<6;i++)g.frame(1/60);g.debugAdvance(.2);g.render()}''')
                    check('__glory.game.time===__before.time && __glory.game.paused===__before.paused','真实丢失期间战斗时间冻结且保持用户暂停状态')
                    page.evaluate('window.__lostView=__glory.game.viewMode')
                    page.keyboard.press('Space');page.keyboard.press(page.evaluate('__input.binds.view'))
                    check('__glory.game.viewMode===__lostView','丢失期间键盘不会切换不可见视角')
                    page.wait_for_timeout(100);page.evaluate('__contextExt.restoreContext()')
                    page.wait_for_function('!__glory.game.contextLost',polling=100,timeout=15000)
                    check('document.querySelector(".graphics-recovery").hidden && __glory.game.acc===0 && __input.pressedAt.size===0 && __input.touchPressedAt.size===0','恢复事件关闭提示并清空不可见期间缓冲')
                    check('__glory.game.paused===__before.paused && __input.enabled===__before.enabled','恢复不自动改变暂停或启用输入')
                    check('__glory.game.player===__retained.player && __retained.geometry===__retained.player.mocapBody.meshes[0].geometry && __retained.skeleton===__retained.player.mocapBody.meshes[0].skeleton','恢复保留角色、绑定骨架与共享模型几何')
                    page.evaluate('__glory.game.render()')
                    check('__glory.game.renderer.info.render.calls>0 && __glory.game.renderer.getContext().getError()===0','恢复后真实后处理与模型绘制无GL错误')
                    if not cycle:
                        page.evaluate('__glory.game.debugAdvance(1/60)')
                        check('Math.abs(__glory.game.time-__before.time-1/60)<1e-7','恢复首步无后台时间补算')
                    else:
                        page.evaluate('__input.fallbackLook=true;__glory.resume()')
                        check('!__glory.game.paused && __input.enabled && (!__input.touchMode || !__glory.touch.root.hidden)','主动继续游戏后恢复正常操作')
                for view in ['fp','tp']:
                    page.evaluate('(view)=>{__glory.game.setViewMode(view);__glory.game.debugAdvance(1/60)}',view)
                    check('__glory.game.renderer.getContext().getError()===0','恢复后 '+view+' 画面正常')
                page.screenshot(path=str(output/f'{label}-restored.png'))
                check('!window.__errs?.length && __glory.game.rigged.size===15','恢复后15类绑定资源仍完整')
                assert not errors,errors
                results.append({'label':label,'checks':checks,'errors':errors})
            finally:context.close()
finally:
    (output/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
    if server:server.shutdown();server.server_close()
