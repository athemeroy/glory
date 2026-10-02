import argparse, json, pathlib
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser(); ap.add_argument('base'); ap.add_argument('output', type=pathlib.Path)
args = ap.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True, args=['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=metal', '--mute-audio'])
    page = browser.new_page(viewport={'width': 1280, 'height': 720}); errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.base.rstrip('/') + '/index.html?auto=story&acc=yysf', wait_until='networkidle', timeout=90000)
    page.wait_for_function('window.__glory?.mode?.dialogueRoot && !window.__glory._loadingMode', timeout=90000)
    assert page.evaluate('!document.pointerLockElement && !window.__glory.game.paused && document.body.classList.contains("story-speaking")')
    for _ in range(3): page.locator('.story-next').click()
    page.wait_for_function('window.__glory.mode.stage === "travel" && !!document.pointerLockElement')
    # Real RAF, no manual stepping: let the mode trigger an encounter and its outro.
    page.evaluate('()=>{const a=window.__glory;a.game.player.pos.copy(a.mode.waypoint)}')
    page.wait_for_function('window.__glory.mode.stage === "fight"')
    page.evaluate('()=>{const a=window.__glory;a.mode.enemies.forEach(f=>f.applyDamage(a.game.player,f.maxHp*3,{}))}')
    page.wait_for_function('window.__glory.mode.stage === "outro" && !document.pointerLockElement')
    assert page.evaluate('!window.__glory.game.paused && document.body.classList.contains("story-speaking")')
    page.screenshot(path=str(args.output / 'outro-cursor.png'))
    for _ in range(2): page.locator('.story-next').click()
    page.wait_for_function('window.__glory.mode.stage === "exit" && !!document.pointerLockElement')
    assert page.evaluate('!window.__glory.game.paused && !window.__glory.game.inputFrozen')
    report = {'introCursorFree': True, 'travelMouseLocked': True, 'outroCursorFreeWithoutPause': True, 'exitMouseLocked': True, 'browserErrors': errors}
    (args.output / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)); print(json.dumps(report)); browser.close()
    assert not errors, errors
