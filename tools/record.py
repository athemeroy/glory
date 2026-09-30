#!/usr/bin/env python3
"""录制演示视频（在 Mini 上跑）：逐帧确定性推进 + 截图，最后 ffmpeg 合成。
用法: record.py BASE 输出目录 [fps]"""
import sys, os, subprocess, shutil
from playwright.sync_api import sync_playwright
BASE = sys.argv[1]; OUT = sys.argv[2]; FPS = int(sys.argv[3]) if len(sys.argv) > 3 else 30
W, H = int(os.environ.get('RW', 1920)), int(os.environ.get('RH', 1080))
CLIPS = [
  # 名称, 参数, 秒数, 设置 JS, 每帧 JS（可空）
  ('duel_ots', 'auto=duel&acc=yysf&enemy=dmgy&bot=1&diff=hard&botdiff=god&view=ots', 8, '', ''),
  ('duel_fp', 'auto=duel&acc=jmx&enemy=yysf&bot=1&diff=hard&botdiff=god', 7, '', ''),
  ('duel_tp', 'auto=duel&acc=yyzq&enemy=lt&bot=1&diff=hard&botdiff=god&view=tp', 7, '', ''),
  ('mirror', 'auto=training&acc=yysf', 5, "(()=>{const g=window.__glory.game;const p=g.player;p.pos.set(-2.4,0,0.0);g.viewYaw=-Math.PI/2;g.viewPitch=-0.05;return 1})()",
     "(()=>{const g=window.__glory.game;const p=g.player;window._f=(window._f||0)+1;const f=window._f; g.viewYaw=-Math.PI/2+Math.sin(f/40)*0.1; if(p.pos.x<-3.0)p.pos.x=-3.0; if(f%45==10)p.tryUse('atk'); if(f==90)p.tryUse('s3'); return 1})()"),
  ('boss', 'auto=dungeon&acc=yysf&bot=1&botdiff=god', 10, "(()=>{const m=window.__glory.mode;const g=window.__glory.game;for(const x of m.mobs){x.hp=0;x.die(null);} m.wave=9; g.debugAdvance(0.3); for(const p of m.party){p.pos.set(p.pos.x,0,6);} g.debugAdvance(0.6); return m.stage})()", ''),
  ('team', 'auto=team&bot=1&diff=hard&botdiff=god&view=tp&ta=myc,yyzq,xsbl&tb=yqcy,skse,lt', 7, '', ''),
]
only = os.environ.get('ONLY')
fr = os.path.join(OUT, 'frames'); shutil.rmtree(fr, ignore_errors=True); os.makedirs(fr, exist_ok=True)
n = 0
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=metal', '--mute-audio'])
    for name, qs, secs, setup, each in CLIPS:
        if only and name not in only.split(','): continue
        pg = b.new_page(viewport={'width': W, 'height': H})
        pg.goto(f'{BASE}?{qs}&manual=1', wait_until='domcontentloaded')
        pg.wait_for_function('window.__glory && window.__glory.game.player && window.__glory.game.level', timeout=60000)
        try: pg.wait_for_function('!window.__glory.game.inputFrozen', timeout=15000)
        except Exception: pass
        pg.evaluate('window.__glory.game.debugAdvance(1.2)')
        if setup: pg.evaluate(setup)
        for i in range(int(secs * FPS)):
            if each: pg.evaluate(each)
            pg.evaluate(f'window.__glory.game.debugAdvance({1 / FPS})')
            pg.screenshot(path=os.path.join(fr, f'{n:05d}.jpg'), quality=90); n += 1
        print(name, 'frames', n, 'errs', pg.evaluate('JSON.stringify(window.__errs.slice(0,3))')[:200], flush=True)
        pg.close()
    b.close()
out = os.path.join(OUT, 'glory-demo.mp4')
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-framerate', str(FPS), '-i', os.path.join(fr, '%05d.jpg'), '-c:v', 'h264_videotoolbox', '-b:v', '12M', '-pix_fmt', 'yuv420p', out], check=True)
print('video', out, os.path.getsize(out))
