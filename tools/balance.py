#!/usr/bin/env python3
"""职业平衡矩阵：所有账号两两对战（双方同难度 AI），并行多页。输出 JSON 与胜率表。
用法: balance.py BASE_URL 输出.json [并行数] [难度]"""
import sys, json, time, itertools
from playwright.sync_api import sync_playwright
BASE = sys.argv[1]; OUT = sys.argv[2]; PAR = int(sys.argv[3]) if len(sys.argv) > 3 else 6; DIFF = sys.argv[4] if len(sys.argv) > 4 else 'hard'
ACC = ['jmx', 'yysf', 'yyzq', 'dmgy', 'yqcy', 'myc', 'skse', 'xsbl', 'wblx', 'lt', 'yr', 'bzrq']
pairs = list(itertools.combinations(ACC, 2)); pairs += [(b, a) for a, b in pairs]
results = []
JS_STATE = "(()=>{const a=window.__glory; const m=a.mode; if(!m||!m.player) return null; return {over:!!m.over, wins:m.wins, p:m.player.name, e:m.enemy.name, pd:m.player.stats.dmgDealt, ed:m.enemy.stats.dmgDealt, pc:m.player.stats.maxCombo, ec:m.enemy.stats.maxCombo, t:a.game.time}})()"
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=metal', '--mute-audio'])
    queue = list(pairs); running = []
    t0 = time.time()
    while queue or running:
        while queue and len(running) < PAR:
            a, e = queue.pop(0)
            pg = b.new_page(viewport={'width': 320, 'height': 180})
            pg.goto(f'{BASE}?auto=duel&acc={a}&enemy={e}&bot=1&botdiff={DIFF}&diff={DIFF}&speed=8&rskip=120')
            running.append((a, e, pg, time.time()))
        time.sleep(3)
        for item in running[:]:
            a, e, pg, ts = item
            try: st = pg.evaluate(JS_STATE)
            except Exception as ex: st = None
            timeout = time.time() - ts > 240
            if (st and st['over']) or timeout:
                rec = {'a': a, 'b': e, 'st': st, 'timeout': timeout}
                if st: rec['winner'] = a if st['wins'][0] > st['wins'][1] else e if st['wins'][1] > st['wins'][0] else None
                results.append(rec); print(len(results), a, e, st and st['wins'], 'dmg', st and (st['pd'], st['ed']), 'timeout' if timeout else '', flush=True)
                pg.close(); running.remove(item)
    b.close()
json.dump(results, open(OUT, 'w'), ensure_ascii=False, indent=1)
wins = {k: 0 for k in ACC}; games = {k: 0 for k in ACC}
for r in results:
    games[r['a']] += 1; games[r['b']] += 1
    if r.get('winner'): wins[r['winner']] += 1
for k in sorted(ACC, key=lambda k: -wins[k]): print(f'{k:5s} {wins[k]:2d}/{games[k]}')
print('elapsed', round(time.time() - t0))
