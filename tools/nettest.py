#!/usr/bin/env python3
"""联机冒烟测试：两个页面，一个建房一个加入，主机 AI 代打，客机模拟按键。"""
import time, sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8780/'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/nettest'
SECS = float(sys.argv[3]) if len(sys.argv) > 3 else 40
args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=args)
    A = b.new_page(viewport={'width': 640, 'height': 360}); B = b.new_page(viewport={'width': 640, 'height': 360})
    logs = []
    for n, pg in (('A', A), ('B', B)):
        pg.on('pageerror', lambda e, n=n: logs.append(f'{n} pageerror {e}'))
        pg.goto(BASE + '?noenv=1'); pg.wait_for_timeout(800)
        pg.click('#enter'); pg.wait_for_timeout(300)
        pg.evaluate('window.__glory.openNet()'); pg.wait_for_timeout(800)
    A.click('#create'); A.wait_for_timeout(800)
    code = A.inner_text('.net-room b'); print('room', code)
    B.fill('.code-in', code); B.click('#join'); B.wait_for_timeout(1000)
    print('A room:', A.inner_text('.net-room')[:120].replace('\n', ' '))
    print('B room:', B.inner_text('.net-room')[:120].replace('\n', ' '))
    A.click('#start')
    A.wait_for_timeout(1500)
    # 主机：AI 代打；客机：模拟前进 + 连续攻击
    A.evaluate("""(async()=>{ const {Brain}=await import('./src/game/ai.js'); const g=window.__glory.game; const t=setInterval(()=>{ if(g.player){ g.player.ai=new Brain(g.player,'normal'); g.autoPlayer=true; clearInterval(t);} },100); })()""")
    B.evaluate("""(async()=>{ const {input}=await import('./src/engine/input.js'); input.enabled=true; let i=0; setInterval(()=>{ const g=window.__glory.game; const me=g.player, en=g.fighters.find(f=>f!==me); if(me&&en){ g.viewYaw=Math.atan2(en.pos.x-me.pos.x,en.pos.z-me.pos.z);} input.simHold('forward', true); i++; const k=['attack','attack','attack','s1','s2','s3','attack','s4','dash','jump'][i%10]; input.simPress(k); }, 250); })()""")
    t0 = time.time()
    while time.time() - t0 < SECS:
        time.sleep(5)
        st = B.evaluate("(()=>{const g=window.__glory.game; return g.fighters.map(f=>`${f.name} hp${Math.round(f.hp)} ${f.state} ${f.action?f.action.slot+'/'+f.action.stage:''} (${f.pos.x.toFixed(1)},${f.pos.z.toFixed(1)})`).join(' | ') + ' rtt'+Math.round(window.__glory.game.mode&&window.__glory.game.mode.net?window.__glory.game.mode.net.rtt:-1)})()")
        sa = A.evaluate("(()=>{const g=window.__glory.game; return g.fighters.map(f=>`${f.name} hp${Math.round(f.hp)} ${f.state} sk${f.stats.skills}`).join(' | ')})()")
        print(f'{time.time()-t0:4.0f}s HOST {sa}\n      GUEST {st}')
    A.screenshot(path=OUT + '_host.png'); B.screenshot(path=OUT + '_guest.png')
    print('errsA', A.evaluate('JSON.stringify(window.__errs.slice(0,5))')[:600])
    print('errsB', B.evaluate('JSON.stringify(window.__errs.slice(0,5))')[:600])
    for l in logs[:10]: print(l)
    b.close()
