#!/usr/bin/env python3
"""确定性逐帧截图：fpseq.py URL(含 manual=1) 输出前缀 帧数 每帧秒数 [--setup JS] [--each JS]"""
import argparse
from playwright.sync_api import sync_playwright
ap = argparse.ArgumentParser(); ap.add_argument('url'); ap.add_argument('prefix'); ap.add_argument('n', type=int); ap.add_argument('step', type=float)
ap.add_argument('--setup', default=''); ap.add_argument('--each', default=''); ap.add_argument('--warm', type=float, default=1.0)
ap.add_argument('--w', type=int, default=960); ap.add_argument('--h', type=int, default=540)
a = ap.parse_args()
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': a.w, 'height': a.h})
    pg.goto(a.url)
    pg.wait_for_function('window.__glory && window.__glory.game.player && window.__glory.game.level', timeout=90000)
    pg.evaluate(f'window.__glory.game.debugAdvance({a.warm})')
    if a.setup: print('setup:', pg.evaluate(a.setup))
    for i in range(a.n):
        if a.each: r = pg.evaluate(a.each)
        else: r = ''
        st = pg.evaluate(f"(()=>{{const g=window.__glory.game; g.debugAdvance({a.step}); const p=g.player; return p.state+' '+(p.action?(p.action.def.name||p.action.slot)+'/'+p.action.stage+'/'+Math.round(p.action.t):'')}})()")
        pg.screenshot(path=f'{a.prefix}_{i:02d}.png')
        print(i, st, r or '')
    print('errs', pg.evaluate('JSON.stringify(window.__errs.slice(0,5))'))
    b.close()
