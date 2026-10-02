import argparse, json, pathlib
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('base'); ap.add_argument('output', type=pathlib.Path)
ap.add_argument('--pairs', default=''); ap.add_argument('--seconds', type=int, default=45)
ap.add_argument('--seed', type=int, default=7129); ap.add_argument('--diff', choices=['easy', 'normal', 'hard'], default='normal')
ap.add_argument('--class-overrides', type=json.loads, default={})
ap.add_argument('--trace', action='store_true')
args = ap.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True, args=['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=metal', '--mute-audio'])
    page = browser.new_page(viewport={'width': 1280, 'height': 720}); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(args.base.rstrip('/') + '/index.html?auto=training&acc=yysf&manual=1&view=fp', wait_until='networkidle', timeout=90000)
    page.wait_for_function('window.__glory?.game?.player && !window.__glory.game.inputFrozen', timeout=90000)
    options = {'seconds': args.seconds, 'seed': args.seed, 'diff': args.diff, 'classOverrides': args.class_overrides, 'trace': args.trace}
    if args.pairs: options['pairs'] = [p.split(':') for p in args.pairs.split(',')]
    report = page.evaluate("async options => {const {checkBalance}=await import('./tools/check-balance.js'); return checkBalance(window.__glory, options)}", options)
    report['browserErrors'] = errors
    (args.output / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False)); browser.close()
    assert not errors and not report['invariantErrors'] and all(f['finite'] for r in report['results'] for f in r['fighters']), report
