#!/usr/bin/env python3
"""真实触摸取消回归，纯 DOM 页面不创建 WebGL。"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('url',help='游戏静态服务器的根地址')
parser.add_argument('--output',default='/tmp/glory-touch-cancel')
args=parser.parse_args();output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True)
    context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
    page=context.new_page();page.goto(args.url.rstrip('/')+'/tools/touch-release-test.html');page.wait_for_function('window.__ready')
    cdp=context.new_cdp_session(page);points={};passed=[]
    def coords(selector):
        b=page.locator(selector).bounding_box();assert b,selector;return (b['x']+b['width']/2,b['y']+b['height']/2)
    def send(kind):
        cdp.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':[{'id':k,'x':v[0],'y':v[1]} for k,v in points.items()]})
    def down(k,selector):
        points[k]=coords(selector);send('touchStart')
    def end(k):
        xy=points.pop(k);cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[{'id':k,'x':xy[0],'y':xy[1]}]})
    def cancel():
        points.clear();send('touchCancel')
    def check(expression,label):
        assert page.evaluate(expression),label+' '+str(page.evaluate('({held:[...__touchTest.input.touchDown],buffer:[...__touchTest.input.touchPressedAt],pointers:[...__touchTest.touch.pointers].map(([id,p])=>({id,kind:p.kind}))})'))
        passed.append(label);print('PASS',label,flush=True)
    down(1,'[data-action="attack"]')
    check('__touchTest.input.held("attack") && __touchTest.input.peek("attack",5000)','真实触摸按下进入保持与技能缓冲')
    cancel()
    check('!__touchTest.input.held("attack") && !__touchTest.input.consume("attack",5000)','系统取消触摸不会留下幽灵攻击')
    down(1,'[data-action="jump"]');end(1)
    check('__touchTest.input.consume("jump",5000) && !__touchTest.input.held("jump")','正常点按保留技能缓冲')
    down(1,'[data-action="special"]');down(2,'[data-action="special"]')
    page.evaluate('''() => { const id=[...__touchTest.touch.pointers.keys()][0]; document.dispatchEvent(new PointerEvent('pointercancel',{pointerId:id,bubbles:true})); }''')
    check('__touchTest.input.held("special") && __touchTest.input.peek("special",5000) && __touchTest.touch.pointers.size===1','同一按钮另一个手指仍按住时保留动作')
    cancel()
    check('!__touchTest.input.held("special") && !__touchTest.input.consume("special",5000)','最后一个手指取消时清除动作缓冲')
    page.keyboard.down('Space');down(1,'[data-action="jump"]');cancel()
    check('__touchTest.input.held("jump") && __touchTest.input.consume("jump",5000)','触摸取消不清除同时按住的键盘输入')
    page.keyboard.up('Space')
    down(1,'[data-action="attack"]')
    page.evaluate('''() => { const id=[...__touchTest.touch.pointers.keys()][0]; document.dispatchEvent(new PointerEvent('lostpointercapture',{pointerId:id,bubbles:true})); }''')
    check('!__touchTest.input.held("attack") && !__touchTest.input.consume("attack",5000)','意外丢失捕获不会留下幽灵攻击')
    cancel()
    points[1]=(240,300);send('touchStart');points[1]=(270,280);send('touchMove');page.wait_for_timeout(80)
    check('__touchTest.input.mouseDX>0 && __touchTest.input.mouseDY<0','真实拖动产生视角输入')
    cancel()
    check('__touchTest.input.mouseDX===0 && __touchTest.input.mouseDY===0 && __touchTest.touch.pointers.size===0','系统取消视角手指时清除未消费转向')
    check('__errors.length===0','无浏览器运行错误')
    (output/'touch-cancel-proof.json').write_text(json.dumps({'results':passed},ensure_ascii=False,indent=2))
    context.close();browser.close()
