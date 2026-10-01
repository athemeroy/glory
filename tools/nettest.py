#!/usr/bin/env python3
"""联机冒烟测试（浏览器直连）：两个页面，一个建房一个加入，主机 AI 代打，客机模拟按键。
用法：nettest.py BASE 输出前缀 秒数 [room|code]  room=房间号（需要 /api/sig），code=手动连接码"""
import time, sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8780/'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/nettest'
SECS = float(sys.argv[3]) if len(sys.argv) > 3 else 40
HOW = sys.argv[4] if len(sys.argv) > 4 else 'room'
args = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio']
with sync_playwright() as p:
    import os
    px = os.environ.get('PROXY')  # 例：http://127.0.0.1:18081（访问被污染的域名时）
    b = p.chromium.launch(channel='chrome', headless=True, args=args, **({'proxy': {'server': px}} if px else {}))
    A = b.new_page(viewport={'width': 640, 'height': 360}); B = b.new_page(viewport={'width': 640, 'height': 360})
    logs = []
    for n, pg in (('A', A), ('B', B)):
        pg.on('pageerror', lambda e, n=n: logs.append(f'{n} pageerror {e}'))
        pg.goto(BASE + '?noenv=1'); pg.wait_for_timeout(800)
        pg.click('#enter'); pg.wait_for_timeout(300)
        pg.evaluate('window.__glory.openNet()'); pg.wait_for_timeout(800)
    t0 = time.time()
    if HOW == 'room':
        A.fill('.pw-new', 'ye-xiu'); A.click('#create'); 
        try: A.wait_for_selector('.net-room b.big-code', timeout=15000)
        except Exception: print('A room card:', A.inner_text('.net-room')); raise
        code = A.inner_text('.net-room b.big-code'); print('room', code, f'{time.time()-t0:.1f}s')
        B.fill('.code-in', code); B.fill('.pw-join', 'ye-xiu'); B.click('#join')
    else:
        for pg in (A, B): pg.evaluate("document.querySelector('.net-manual').open = true")
        A.click('#mk-offer'); A.wait_for_function("document.querySelector('.code-out').value.length > 20", timeout=15000)
        offer = A.input_value('.code-out'); print('offer code', len(offer), 'chars:', offer[:60] + '…')
        B.fill('.code-paste', offer); B.click('#use-code'); B.wait_for_function("document.querySelector('.code-out').value.length > 20", timeout=15000)
        answer = B.input_value('.code-out'); print('answer code', len(answer), 'chars')
        A.fill('.code-paste', answer); A.click('#use-code')
    A.wait_for_selector('#start', timeout=30000); print(f'直连建立 {time.time()-t0:.1f}s')
    B.wait_for_timeout(500)
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
        st = B.evaluate("(()=>{const g=window.__glory.game; return g.fighters.map(f=>`${f.name} hp${Math.round(f.hp)} ${f.state} ${f.action?f.action.slot+'/'+f.action.stage:''} (${f.pos.x.toFixed(1)},${f.pos.z.toFixed(1)})`).join(' | ') + ' rtt'+Math.round(window.__glory.mode&&window.__glory.mode.net?window.__glory.mode.net.rtt:-1)})()")
        sa = A.evaluate("(()=>{const g=window.__glory.game; return g.fighters.map(f=>`${f.name} hp${Math.round(f.hp)} ${f.state} sk${f.stats.skills}`).join(' | ')})()")
        print(f'{time.time()-t0:4.0f}s HOST {sa}\n      GUEST {st}')
    A.screenshot(path=OUT + '_host.png'); B.screenshot(path=OUT + '_guest.png')
    print('errsA', A.evaluate('JSON.stringify(window.__errs.slice(0,5))')[:600])
    print('errsB', B.evaluate('JSON.stringify(window.__errs.slice(0,5))')[:600])
    for l in logs[:10]: print(l)
    b.close()
