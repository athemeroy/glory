#!/usr/bin/env python3
"""独立 DOM 战斗 UI：实际触控、多指长按、屏幕布局与职业上下文。"""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser(description=__doc__);p.add_argument('url');p.add_argument('--output',default='/tmp/glory-combat-ui');p.add_argument('--browser');a=p.parse_args();out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
results=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,args=['--disable-gpu'],**({'executable_path':a.browser} if a.browser else {}))
    context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
    page=context.new_page();page.goto(a.url.rstrip('/')+'/tools/combat-ui-fixture.html',wait_until='networkidle');page.wait_for_function('window.__ready')
    def check(exp,label):
        assert page.evaluate(exp),label
        results.append(label);print('PASS',label,flush=True)
    def layout(label):
        bad=page.evaluate('''()=>{
          const es=[...document.querySelectorAll('.skill-bar button,.form-bar button,#touch-controls button,.touch-stick')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
          const bad=[];for(const e of es){const r=e.getBoundingClientRect(),name=e.getAttribute('aria-label');
            if(r.left<-.1||r.top<-.1||r.right>innerWidth+.1||r.bottom>innerHeight+.1)bad.push('outside '+name);
            if(r.width<44||r.height<44)bad.push('small '+name);
            if(!e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))bad.push('covered '+name);}
          for(let i=0;i<es.length;i++)for(let j=i+1;j<es.length;j++){const a=es[i].getBoundingClientRect(),b=es[j].getBoundingClientRect();if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)bad.push('overlap '+es[i].getAttribute('aria-label')+' / '+es[j].getAttribute('aria-label'));}
          return bad;
        }''')
        assert not bad,(label,bad);results.append(label);print('PASS',label,flush=True)
    for w,h in [(360,740),(390,844),(430,932),(844,390),(740,360)]:
        page.set_viewport_size({'width':w,'height':h});layout(f'{w}×{h} 全部动作可点、44px以上且无重叠');page.screenshot(path=str(out/f'touch-{w}x{h}.png'))
    page.set_viewport_size({'width':390,'height':844})
    page.locator('[data-command="more"]').tap();layout('展开更多操作不覆盖技能或工具按钮')
    check('document.querySelector("[data-command=more]").getAttribute("aria-expanded")==="true"','更多菜单正确报告展开状态')
    page.locator('[data-command="goals"]').tap()
    check('getComputedStyle(__ui.hud.goalBox).display!=="none"&&document.querySelector(".touch-more").hidden','手机可随时查看阶段目标，操作菜单随后收起')
    cdp=context.new_cdp_session(page);points={}
    def down(k,sel):
        r=page.locator(sel).bounding_box();points[k]=(r['x']+r['width']/2,r['y']+r['height']/2)
        cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'id':i,'x':xy[0],'y':xy[1]} for i,xy in points.items()]})
    def up(k):
        xy=points.pop(k);cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[{'id':k,'x':xy[0],'y':xy[1]}]})
    def cancel():
        points.clear();cdp.send('Input.dispatchTouchEvent',{'type':'touchCancel','touchPoints':[]})
    down(1,'[data-action="jump"]');down(2,'[data-action="attack"]');page.wait_for_timeout(400)
    check('__ui.input.held("jump")&&__ui.input.held("attack")','跳跃与普攻真实双指保持不互相取消')
    up(2);check('__ui.input.held("jump")&&!__ui.input.held("attack")','松开普攻后继续保持飞行上升输入')
    cancel();check('!__ui.input.held("jump")&&!__ui.input.peek("jump",5000)','系统取消不留下飞行/跳跃输入')
    page.evaluate('__ui.bind("witch");__ui.game.player.onGround=false;__ui.tick()')
    check('document.querySelector("[data-action=jump]").textContent==="骑帚"','魔道在空中显示骑帚操作')
    page.evaluate('Object.defineProperty(__ui.game.player,"flightActive",{value:true,configurable:true});__ui.game.player.flight={maxDuration:5.5,elapsed:1.5};__ui.tick()')
    check('document.querySelector("[data-action=jump]").textContent==="上升"&&document.querySelector("[data-action=dash]").textContent==="收帚"&&__ui.hud.classContext.textContent.includes("4.0 秒")','飞行显示上升/收帚与剩余时间')
    down(1,'[data-action="jump"]');page.evaluate('__ui.game.player.flight.elapsed=2;__ui.tick()')
    check('__ui.input.held("jump")&&__ui.touch.pointers.size===1','飞行状态文字更新不会丢失手指捕获');cancel()
    page.evaluate('__ui.bind("swordmaster");__ui.game.player.mp=0;__ui.tick()')
    check('__ui.hud.slots.s1.dataset.unavailable==="法力不足"&&__ui.hud.slots.s1.getAttribute("aria-disabled")==="true"','技能法力不足给出可读原因')
    page.evaluate('__ui.game.player.mp=100;__ui.game.player.effects.push({type:"silence",t:2000});__ui.tick()')
    check('__ui.hud.slots.s1.dataset.unavailable==="技能封印"&&__ui.hud.slots.atk.dataset.unavailable===""','技能封印提示不误禁普通攻击')
    page.evaluate('__ui.game.player.effects=[];__ui.game.player.action={def:{name:"测试蓄力",wind:1000,active:500},stage:"wind",t:500};__ui.tick()')
    check('!__ui.hud.castBox.hidden&&__ui.hud.castBox.querySelector("i").style.width==="50%"','长施法读条匹配实际阶段进度')
    page.evaluate('__ui.game.player.action=null;__ui.tick()');check('__ui.hud.castBox.hidden','施法结束即时收起进度条')
    page.evaluate('__ui.bind("battlemage");Object.assign(__ui.game.player,{chasers:[{type:"ice",bornHit:1}],chaserHitSerial:1,chaserWindow:1,chaserCd:0});__ui.tick()')
    check('__ui.hud.slots.special.dataset.unavailable==="命中后可发"&&__ui.hud.classContext.querySelectorAll(".chaser-dots i").length===1','刚生成的炫纹显示储存，不能伪装成可立即发射')
    page.evaluate('__ui.game.player.chaserHitSerial=2;__ui.tick()')
    check('__ui.hud.slots.special.dataset.unavailable===""&&__ui.hud.classContext.classList.contains("can-fire")','再次真实命中后才高亮炫纹发射')
    page.evaluate('__ui.game.player.effects.push({type:"silence",t:2000});__ui.tick()')
    check('__ui.hud.slots.special.dataset.unavailable==="技能封印"&&!__ui.hud.classContext.classList.contains("can-fire")','技能封印时炫纹发射同样显示被封印')
    check('__errors.length===0','无浏览器错误')
    context.close()
    desktop=browser.new_context(viewport={'width':1440,'height':900});page=desktop.new_page();page.goto(a.url.rstrip('/')+'/tools/combat-ui-fixture.html',wait_until='networkidle');page.wait_for_function('window.__ready')
    check('document.querySelector(".self-frame").getBoundingClientRect().right<document.querySelector(".skill-bar").getBoundingClientRect().left','桌面资源和技能分区互不遮挡')
    page.screenshot(path=str(out/'desktop-1440x900.png'));desktop.close();browser.close()
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
