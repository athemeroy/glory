#!/usr/bin/env python3
"""实时运行游戏页面若干秒，输出状态文本并截图。
用法: pwrun.py URL 秒数 截图前缀 [截图间隔秒] [--keys "W:1.5,Mouse0,..."]
"""
import sys, time, json, argparse
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('url'); ap.add_argument('secs', type=float); ap.add_argument('prefix')
ap.add_argument('--every', type=float, default=0)
ap.add_argument('--w', type=int, default=1280); ap.add_argument('--h', type=int, default=720)
ap.add_argument('--js', default='')          # 开始后执行的 JS
ap.add_argument('--at', action='append', default=[])  # "秒数:JS" 定时执行
a = ap.parse_args()
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': a.w, 'height': a.h})
    logs = []
    pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    pg.goto(a.url)
    t0 = time.time(); n = 0; nextShot = a.every if a.every else None
    ats = sorted([(float(x.split(':', 1)[0]), x.split(':', 1)[1]) for x in a.at])
    if a.js: pg.evaluate(a.js)
    while time.time() - t0 < a.secs:
        el = time.time() - t0
        while ats and ats[0][0] <= el:
            try: print('AT', ats[0][0], pg.evaluate(ats[0][1]))
            except Exception as e: print('AT ERR', e)
            ats.pop(0)
        if nextShot is not None and el >= nextShot:
            n += 1; pg.screenshot(path=f'{a.prefix}_{n:02d}.png'); nextShot += a.every
        time.sleep(0.2)
    pg.screenshot(path=f'{a.prefix}_end.png')
    import sys as _s
    try: print(pg.evaluate("(document.getElementById('status')||{}).textContent || ''")[:3000])
    except Exception as e: print('eval err', e)
    print('ERRS', pg.evaluate('JSON.stringify((window.__errs||[]).slice(0,5))')[:1500])
    for l in logs[:30]: print(l)
    b.close()
