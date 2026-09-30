#!/usr/bin/env python3
"""真 GPU 画面巡检（在 Mini 上跑）：tour.py BASE 输出目录"""
import sys, os
from playwright.sync_api import sync_playwright
BASE = sys.argv[1]; OUT = sys.argv[2]; os.makedirs(OUT, exist_ok=True)
W, H = int(os.environ.get('TW', 1920)), int(os.environ.get('TH', 1080))
SCENES = [
  # 名称, 查询参数, 预热秒, 设置 JS, [(推进秒, 截图名后缀, 每步前 JS)]
  ('duel_fp', 'auto=duel&acc=yyzq&enemy=yysf&bot=1&diff=hard', 4.5, '', [(0.8, 'a', ''), (0.6, 'b', ''), (0.7, 'c', ''), (1.2, 'd', '')]),
  ('duel_tp', 'auto=duel&acc=jmx&enemy=dmgy&bot=1&diff=hard&fp=0', 4.5, '', [(1.0, 'a', ''), (1.0, 'b', '')]),
  ('mirror', 'auto=training&acc=jmx', 2.0, "(()=>{const g=window.__glory.game;const p=g.player;p.pos.set(-3.6,0,0.2);g.viewYaw=-Math.PI/2;g.viewPitch=-0.06;return 1})()", [(0.3, 'a', ''), (0.4, 'b', "window.__glory.game.player.tryUse('atk')"), (0.25, 'c', "window.__glory.game.player.setForm('shield')")]),
  ('slash', 'auto=training&acc=yysf', 2.0, "(()=>{const g=window.__glory.game;const p=g.player;p.pos.set(0.4,0,0);g.viewYaw=Math.PI/2;g.viewPitch=-0.08;g.debugAdvance(0.3);p.tryUse('atk');return 1})()", [(0.12, 'a', ''), (0.07, 'b', ''), (0.07, 'c', ''), (0.2, 'd', "window.__glory.game.player.tryUse('atk')"), (0.1, 'e', ''), (0.5, 'f', "window.__glory.game.player.tryUse('s1')"), (0.08, 'g', ''), (0.6, 'h', "window.__glory.game.player.tryUse('s3')"), (0.08, 'i', ''), (0.25, 'j', '')]),
  ('ult1', 'auto=duel&acc=yyzq&enemy=dmgy&fp=0', 4.5, "(()=>{const g=window.__glory.game;const m=window.__glory.mode;const p=g.player,e=m.enemy;e.ai=null;p.pos.set(0,0,4);e.pos.set(0,0,-1);g.viewYaw=Math.PI;p.yaw=Math.PI;e.yaw=0;g.debugAdvance(0.2);p.tryUse('ult');return 1})()", [(0.3, 'a', ''), (0.25, 'b', ''), (0.2, 'c', ''), (0.25, 'd', '')]),
  ('ult2', 'auto=duel&acc=yysf&enemy=dmgy&fp=0', 4.5, "(()=>{const g=window.__glory.game;const m=window.__glory.mode;const p=g.player,e=m.enemy;e.ai=null;p.pos.set(0,0,3);e.pos.set(0,0,-0.5);g.viewYaw=Math.PI;p.yaw=Math.PI;e.yaw=0;g.debugAdvance(0.2);p.tryUse('ult');return 1})()", [(0.35, 'a', ''), (0.3, 'b', ''), (0.3, 'c', '')]),
  ('fpjmx', 'auto=training&acc=jmx', 2.0, "(()=>{const g=window.__glory.game;const p=g.player;p.pos.set(0.4,0,0);g.viewYaw=Math.PI/2;g.viewPitch=-0.08;g.debugAdvance(0.3);return 1})()", [(0.1, 'a', ''), (0.12, 'b', "window.__glory.game.player.tryUse('atk')"), (0.5, 'c', "window.__glory.game.player.tryUse('s1')"), (0.15, 'd', ''), (0.6, 'e', "window.__glory.game.player.setForm('gun')"), (0.6, 'f', "(()=>{const g=window.__glory.game; g.viewPitch=-1.0; return 1})()")]),
  ('mocap', 'auto=duel&acc=yysf&enemy=yysf&bot=1&diff=hard&view=tp', 4.0, '', [(0.4, 'a', ''), (0.4, 'b', ''), (0.4, 'c', ''), (0.4, 'd', ''), (0.4, 'e', ''), (0.4, 'f', '')]),
  ('team3', 'auto=team&bot=1&diff=hard&view=tp&ta=jmx,yyzq,dmgy&tb=yysf,yqcy,skse', 4.5, '', [(0.6, 'a', ''), (0.6, 'b', ''), (0.6, 'c', ''), (1.0, 'd', '')]),
  ('ots', 'auto=duel&acc=jmx&enemy=dmgy&bot=1&diff=hard&view=ots', 4.5, "(()=>{const g=window.__glory.game;const p=g.player;return JSON.stringify({vm:g.viewMode,fp:g.firstPerson,cam:g.camera.position.toArray().map(v=>+v.toFixed(2)),p:p.pos.toArray().map(v=>+v.toFixed(2)),yaw:+g.viewYaw.toFixed(2),pitch:+g.viewPitch.toFixed(2),vis:p.rig.parts.filter(m=>m.visible).length,layers:p.rig.parts.map(m=>m.layers.mask).join(''),mocap:!!p.mocap,bodyY:p.mocapBody&&p.mocapBody.model.getWorldPosition(new (g.camera.position.constructor)()).toArray().map(v=>+v.toFixed(2)), head:(()=>{const V=g.camera.position.constructor; const h=p.mocapBody.bones.Head.getWorldPosition(new V()); const s=h.clone().project(g.camera); return h.toArray().map(v=>+v.toFixed(2)).concat(['scr',+s.x.toFixed(2),+s.y.toFixed(2)])})(), st:p.state, clip:p.mocap.curName, hipsL:p.mocapBody.bones.Hips.position.toArray().map(v=>+v.toFixed(1)), hipsW:p.mocapBody.bones.Hips.getWorldPosition(new (g.camera.position.constructor)()).y.toFixed(2), parent:p.mocapBody.model.parent&&p.mocapBody.model.parent.name, rootPos:p.rig.root.position.y, rootRot:p.rig.root.rotation.x, rootScale:p.rig.root.scale.x, modelScale:p.mocapBody.model.scale.toArray()})})()", [(0.35, 'a', ''), (0.35, 'b', ''), (0.35, 'c', ''), (0.5, 'd', '')]),
  ('occl', 'auto=duel&acc=yyzq&enemy=lt&view=ots', 4.5, "(()=>{const g=window.__glory.game;const m=window.__glory.mode;const p=g.player,e=m.enemy;e.ai=null;p.pos.set(0,0,0);e.pos.set(0.5,0,-1.9);g.viewYaw=0;g.viewPitch=-0.05;p.yaw=0;e.yaw=0;return 1})()", [(0.2, 'a', ''), (0.2, 'b', "(()=>{const e=window.__glory.mode.enemy;e.pos.set(0.4,0,-1.1);return 1})()"), (0.2, 'c', "(()=>{const e=window.__glory.mode.enemy;e.pos.set(1.6,0,-0.4);return 1})()")]),
  ('lookdown', 'auto=training&acc=myc', 2.0, "(()=>{const g=window.__glory.game;g.viewPitch=-1.2;return 1})()", [(0.3, 'a', '')]),
  ('dungeon', 'auto=dungeon&acc=yysf&bot=1', 2.0, "(()=>{const m=window.__glory.mode; for(const x of m.mobs) x.hp=1; return 1})()", [(3, 'a', ''), (8, 'b', ''), (6, 'c', '')]),
  ('team', 'auto=team&bot=1&diff=hard', 4.5, '', [(2.0, 'a', ''), (3.0, 'b', '')]),
  ('boss', 'auto=dungeon&acc=jmx', 3.5, "(()=>{const m=window.__glory.mode; const g=window.__glory.game; for(const x of m.mobs) {x.hp=0; x.die(null);} m.wave=9; g.debugAdvance(0.3); for(const p of m.party){p.pos.set(p.pos.x,0,6);} g.viewYaw=Math.PI; g.debugAdvance(0.5); return m.stage})()", [(1.2, 'a', ''), (1.0, 'b', "window.__glory.mode.boss && window.__glory.mode.boss.tryUse('s1')"), (0.5, 'c', ''), (1.5, 'd', "(()=>{const b=window.__glory.mode.boss; b.hp=b.maxHp*0.45; return 1})()"), (1.0, 'e', "window.__glory.mode.boss.tryUse('s3')"), (0.8, 'f', '')]),
]
only = os.environ.get('ONLY')
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=metal', '--mute-audio'])
    for name, qs, warm, setup, steps in SCENES:
        if only and name not in only.split(','): continue
        pg = b.new_page(viewport={'width': W, 'height': H})
        pg.goto(f'{BASE}?{qs}&manual=1', wait_until='domcontentloaded')
        pg.wait_for_function('window.__glory && window.__glory.game.player && window.__glory.game.level', timeout=60000)
        pg.wait_for_timeout(1500)
        try: pg.wait_for_function('!window.__glory.game.inputFrozen', timeout=15000)
        except Exception: pass
        pg.evaluate(f'window.__glory.game.debugAdvance({warm})')
        if setup: print(name, "setup:", pg.evaluate(setup))
        for sec, suf, js in steps:
            if js: pg.evaluate(js)
            pg.evaluate(f'window.__glory.game.debugAdvance({sec})')
            pg.wait_for_timeout(200)
            pg.screenshot(path=f'{OUT}/{name}_{suf}.jpg', quality=82)
        print(name, 'errs', pg.evaluate('JSON.stringify(window.__errs.slice(0,3))')[:300])
        pg.close()
    b.close()
