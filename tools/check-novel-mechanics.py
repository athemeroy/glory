import argparse, json, pathlib
from playwright.sync_api import sync_playwright
ap = argparse.ArgumentParser(); ap.add_argument('base'); ap.add_argument('output', type=pathlib.Path); args = ap.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True, args=['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=metal', '--mute-audio'])
    page = browser.new_page(viewport={'width': 1280, 'height': 720}); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(args.base.rstrip('/') + '/index.html?auto=training&acc=yysf&manual=1&view=fp', wait_until='networkidle', timeout=90000)
    page.wait_for_function('window.__glory?.game?.player && !window.__glory.game.inputFrozen', timeout=90000)
    report = page.evaluate("async()=>{const {checkMechanics}=await import('./tools/check-novel-mechanics.js');return checkMechanics(window.__glory)}")
    report['browserErrors'] = errors
    (args.output / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)); print(json.dumps(report, ensure_ascii=False))
    browser.close()
    assert not report['errors'] and not errors, report
