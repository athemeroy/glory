import argparse, json, pathlib
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser(); ap.add_argument('base'); ap.add_argument('output', type=pathlib.Path)
args = ap.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
checks, errors = [], []
def check(value, name):
    checks.append({'name': name, 'passed': bool(value)})
    assert value, name

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True, args=['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=metal', '--mute-audio'])
    page = browser.new_page(viewport={'width': 1280, 'height': 720})
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.base.rstrip('/') + '/index.html?auto=story&acc=jmx&manual=1', wait_until='networkidle', timeout=90000)
    page.wait_for_function('window.__glory?.modeId === "story" && window.__glory.mode?.dialogueRoot && !window.__glory._loadingMode', timeout=90000)
    check(page.evaluate('JSON.parse(localStorage.getItem("glory.storyProgress") || "{}").cleared?.length || 0') == 0, '新档只有第一章')
    for chapter, level in enumerate(['courtyard', 'clocktower', 'frostbridge']):
        page.wait_for_function('(i) => window.__glory.mode?.chapterIndex === i && !!window.__glory.mode.lines', arg=chapter)
        check(page.evaluate('window.__glory.game.inputFrozen && window.__glory.game.aiFrozen'), f'{level}: 对话暂停战斗输入')
        page.screenshot(path=str(args.output / f'{level}-intro.png'))
        while page.evaluate('!!window.__glory.mode.lines'): page.locator('.story-next').click()
        check(page.evaluate('window.__glory.mode.stage === "travel" && !window.__glory.game.inputFrozen'), f'{level}: 对话按钮进入探索')
        page.evaluate('()=>{const a=window.__glory; a.game.player.pos.copy(a.mode.waypoint); a.game.debugAdvance(.05)}')
        check(page.evaluate('window.__glory.mode.stage === "fight" && window.__glory.mode.enemies.length > 0'), f'{level}: 路标触发遭遇')
        page.evaluate('()=>{window.__glory.game.debugAdvance(2)}')
        check(page.evaluate('window.__glory.game.fighters.every(f => [f.pos.x,f.pos.y,f.pos.z,f.hp,f.stamina].every(Number.isFinite))'), f'{level}: 实体战斗、骨架更新正常')
        if level == 'frostbridge': check(page.evaluate('window.__glory.mode.party.length === 2 && !!window.__glory.mode.enemies.find(f=>f.kind==="boss")'), '第三章: 队友与Boss生成')
        page.screenshot(path=str(args.output / f'{level}-encounter.png'))
        # Apply real damage to verify victory/quest/save lifecycle; this is not a playability or difficulty claim.
        page.evaluate('()=>{const a=window.__glory; a.mode.enemies.forEach(f=>f.applyDamage(a.game.player, f.maxHp*3, {})); a.game.debugAdvance(.05)}')
        check(page.evaluate('window.__glory.mode.stage === "outro" && !!window.__glory.mode.lines'), f'{level}: 胜利触发后续对话')
        while page.evaluate('!!window.__glory.mode.lines'): page.locator('.story-next').click()
        check(page.evaluate('window.__glory.mode.stage === "exit" && !window.__glory.mode.over'), f'{level}: 通关需要走到出口')
        page.evaluate('()=>{const a=window.__glory; a.game.player.pos.copy(a.mode.exit); a.game.debugAdvance(.05)}')
        check(page.evaluate('window.__glory.mode.over && window.__glory.mode.stage === "complete"'), f'{level}: 出口完成章节')
        check(page.evaluate('JSON.parse(localStorage.getItem("glory.storyProgress")).cleared.length') == chapter + 1, f'{level}: 进度已保存')
        check(page.evaluate('JSON.parse(localStorage.getItem("glory.materials"))') == (chapter + 1) * 5, f'{level}: 首通奖励只计一次')
        page.locator('#again').wait_for(state='visible', timeout=15000)
        check(page.locator('#again').inner_text() == ('继续下一章' if chapter < 2 else '重温本章'), f'{level}: 结算按钮正确')
        if chapter < 2: page.locator('#again').click()
    # Retry and river death preserve the already earned chapter progression.
    page.locator('#again').click(); page.wait_for_function('window.__glory.mode?.stage === "intro" && !window.__glory._loadingMode')
    while page.evaluate('!!window.__glory.mode.lines'): page.locator('.story-next').click()
    page.evaluate('()=>{const a=window.__glory; const f=a.game.player; f.pos.set(8,0,0); f.onGround=false; a.game.debugAdvance(3)}')
    check(page.evaluate('window.__glory.game.player.dead && window.__glory.mode.over'), '实际落入霜桥河道触发失败')
    check(page.evaluate('JSON.parse(localStorage.getItem("glory.storyProgress")).cleared.length') == 3, '失败保持通关进度')
    page.locator('#again').wait_for(state='visible'); check(page.locator('#again').inner_text() == '重试本章', '失败可以重试')
    page.screenshot(path=str(args.output / 'river-retry.png'))
    # Native touch input and portrait layout.
    mobile = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    phone = mobile.new_page(); phone.on('pageerror', lambda error: errors.append(str(error)))
    phone.goto(args.base.rstrip('/') + '/index.html?auto=story&acc=jmx&manual=1', wait_until='networkidle', timeout=90000)
    phone.wait_for_function('window.__glory?.mode?.dialogueRoot && !window.__glory._loadingMode', timeout=90000)
    check(phone.locator('.story-next').is_visible(), '触屏竖屏对话按钮可见')
    for _ in range(3): phone.locator('.story-next').tap()
    check(phone.evaluate('window.__glory.mode.stage === "travel" && !document.body.classList.contains("story-speaking")'), '触屏原生点击能开始探索')
    phone.evaluate('window.__glory.game.debugAdvance(.05)')
    phone.screenshot(path=str(args.output / 'phone-story.png'))
    check(phone.evaluate('document.documentElement.scrollWidth <= innerWidth'), '触屏页面没有横向溢出')
    browser.close()
report = {'checks': checks, 'browserErrors': errors, 'note': 'Quest lifecycle uses real damage to finish encounters. Difficulty tested separately with AI matches; routes tested with physical walking.'}
(args.output / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)); print(json.dumps(report, ensure_ascii=False))
assert not errors, errors
