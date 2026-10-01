#!/usr/bin/env python3
"""触屏回归：真实多点触摸、输入释放、菜单、横竖屏、键鼠和联机输入。

启动静态服务器后运行：python tools/mobiletest.py http://localhost:8780
Mini 上可加 --metal。--cdp URL 可复用支持 WebGL 的现有 Chromium。
"""
import argparse
from datetime import datetime, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('url')
parser.add_argument('--metal', action='store_true')
parser.add_argument('--cdp')
parser.add_argument('--output', default='/tmp/glory-mobile-test')
args = parser.parse_args()
output = Path(args.output)
output.mkdir(parents=True, exist_ok=True)


def check(page, expression, label):
    if not page.evaluate(expression):
        print('STATE', page.evaluate('({down:[...testInput.down],touch:[...testInput.touchDown],move:testInput.moveAxes(),look:[testInput.mouseDX,testInput.mouseDY],pointers:[...__glory.touch.pointers].map(([id,p])=>({id,kind:p.kind,action:p.action})),errors:__errs})'), flush=True)
        raise AssertionError(label)
    print('PASS', label, flush=True)


def center(page, selector):
    rect = page.locator(selector).bounding_box()
    assert rect, selector
    return rect['x'] + rect['width'] / 2, rect['y'] + rect['height'] / 2


class Fingers:
    def __init__(self, context, page):
        self.cdp = context.new_cdp_session(page)
        self.page = page
        self.points = {}

    def send(self, event):
        self.cdp.send('Input.dispatchTouchEvent', {
            'type': event,
            'touchPoints': [{'id': key, 'x': xy[0], 'y': xy[1], 'radiusX': 2, 'radiusY': 2}
                            for key, xy in self.points.items()],
        })

    def down(self, key, xy):
        self.points[key] = xy
        self.send('touchStart')

    def move(self, key, xy):
        self.points[key] = xy
        self.send('touchMove')
        # 虚拟时钟已暂停；推进动画帧，才能派发浏览器合并的 pointermove。
        self.page.clock.run_for(50)

    def up(self, key):
        xy = self.points.pop(key)
        self.cdp.send('Input.dispatchTouchEvent', {
            'type': 'touchEnd',
            'touchPoints': [{'id': key, 'x': xy[0], 'y': xy[1], 'radiusX': 2, 'radiusY': 2}],
        })

    def cancel(self):
        self.points.clear()
        self.send('touchCancel')


def layout(page, label):
    problems = page.evaluate('''() => {
      const els = [...document.querySelectorAll('.skill-bar button, .form-bar button, #touch-controls button, .touch-stick')]
        .filter(e => e.getClientRects().length);
      const bad = [];
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.left < 0 || r.top < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) bad.push(el.outerHTML.slice(0, 100));
        if (r.width < 44 || r.height < 44) bad.push('small: ' + el.getAttribute('aria-label'));
        const hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
        if (!el.contains(hit)) bad.push('covered: ' + el.getAttribute('aria-label'));
      }
      for (let i=0; i<els.length; i++) for (let j=i+1; j<els.length; j++) {
        const a = els[i].getBoundingClientRect(), b = els[j].getBoundingClientRect();
        if (Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)
          bad.push('overlap: ' + els[i].getAttribute('aria-label') + ' / ' + els[j].getAttribute('aria-label'));
      }
      return bad;
    }''')
    assert not problems, (label, problems)
    print('PASS', label, flush=True)


with sync_playwright() as pw:
    shared = bool(args.cdp)
    browser = pw.chromium.connect_over_cdp(args.cdp) if shared else pw.chromium.launch(
        headless=True, **({'channel': 'chrome'} if args.metal else {}),
        args=['--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] +
             (['--use-angle=metal'] if args.metal else ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']))
    context = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=1)
    # 手动推进模拟与渲染，检查不依赖运行速度，也避免测试持续占用 GPU。
    context.add_init_script('window.requestAnimationFrame = () => 0; window.__lockCalls = 0; Element.prototype.requestPointerLock = function() { ++window.__lockCalls; return Promise.resolve(); };')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.goto(args.url.rstrip('/') + '/?models=0&mocap=0&noenv=1', wait_until='networkidle')
        check(page, '!!window.__glory', 'game boot')
        page.evaluate('''async () => {
          window.testInput = (await import('./src/engine/input.js')).input;
          __glory.game.manual = true; __glory.game.settings.attract = false;
        }''')
        check(page, '__glory.game.settings.quality === "low"', 'mobile defaults to fluent quality')
        page.locator('#enter').tap()
        check(page, 'document.querySelector(".main-screen").scrollWidth <= innerWidth', 'portrait main menu fits')
        page.screenshot(path=str(output / 'menu-portrait.png'))
        page.locator('.mode-card').first.tap()
        check(page, 'document.querySelector(".setup-body").scrollHeight > document.querySelector(".setup-body").clientHeight', 'character selection scrolls')
        page.dispatch_event('.viewer-canvas', 'pointerdown', {'pointerId': 42, 'clientX': 100})
        page.dispatch_event('.viewer-canvas', 'pointercancel', {'pointerId': 42})
        check(page, '__glory.menu.viewer.drag === null', 'scrolling cancels character preview drag')
        page.wait_for_load_state('networkidle')
        page.screenshot(path=str(output / 'setup-portrait.png'))
        page.locator('#go').tap()
        page.wait_for_function('testInput.enabled && __glory.modeId === "training" && document.getElementById("menu").style.display === "none"', polling=50)
        if page.locator('.quick-help').count():
            page.locator('.quick-help').tap()
            page.wait_for_timeout(450)
        check(page, '__lockCalls === 0 && !document.getElementById("clickplay")', 'touch start skips pointer lock')
        page.evaluate('__glory.game.debugAdvance(.05)')
        layout(page, '390x844 portrait controls fit and can be hit')
        check(page, '''!document.querySelector('[data-action="attack"]').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,cancelable:true}))''', 'long press suppresses the browser context menu')
        page.screenshot(path=str(output / 'game-portrait.png'))
        # 手动模拟冻结墙钟，避免软件渲染耗时让输入缓冲在下一步模拟前超时。
        page.clock.install(time=datetime(2026, 1, 1, tzinfo=timezone.utc))
        page.clock.pause_at(datetime(2026, 1, 1, 0, 0, 1, tzinfo=timezone.utc))
        fingers = Fingers(context, page)
        sx, sy = center(page, '.touch-stick')
        fingers.down(1, (sx, sy))
        fingers.move(1, (sx + 25, sy - 25))
        check(page, 'testInput.moveAxes()[0] > .2 && testInput.moveAxes()[1] > .2', 'analog diagonal movement')
        before = page.evaluate('__glory.game.player.pos.toArray()')
        page.evaluate('__glory.game.debugAdvance(.3)')
        after = page.evaluate('__glory.game.player.pos.toArray()')
        assert before != after, 'joystick must move the player'
        print('PASS joystick moves player', flush=True)
        fingers.down(2, center(page, '[data-action="attack"]'))
        check(page, 'testInput.held("attack") && testInput.moveAxes()[1] > .2', 'move and attack together')
        page.evaluate('__glory.game.debugAdvance(1.4)')
        check(page, '__glory.game.player.action?.slot === "charge"', 'holding attack starts a charged strike')
        fingers.up(2)
        check(page, '!testInput.held("attack") && testInput.moveAxes()[1] > .2', 'releasing attack keeps joystick active')
        page.evaluate('__glory.game.debugAdvance(.05)')
        check(page, '!__glory.game.player.charging && __glory.game.player.action?.stage !== "wind"', 'releasing attack releases the charged strike')
        fingers.up(1)
        check(page, 'testInput.moveAxes().every(v => v === 0)', 'joystick release stops movement input')

        # 独立的视角手指与格挡、摇杆同时存在。
        look = (260, 390)
        fingers.down(1, (sx, sy))
        fingers.move(1, (sx, sy - 30))
        fingers.down(2, look)
        fingers.down(3, center(page, '[data-action="special"]'))
        fingers.move(2, (look[0] + 25, look[1] - 20))
        check(page, 'testInput.mouseDX > 0 && testInput.mouseDY < 0 && testInput.held("special") && testInput.moveAxes()[1] > 0', 'move, look and guard with three fingers')
        yaw = page.evaluate('__glory.game.viewYaw')
        page.evaluate('__glory.game.handleLook(.016)')
        assert yaw != page.evaluate('__glory.game.viewYaw'), 'touch must rotate camera'
        print('PASS touch rotates camera', flush=True)
        fingers.cancel()
        check(page, 'testInput.touchDown.size === 0 && testInput.moveAxes().every(v => v === 0)', 'pointer cancellation releases all holds')
        check(page, 'testInput.touchPressedAt.size === 0 && testInput.mouseDX === 0 && testInput.mouseDY === 0', 'pointer cancellation clears buffered skills and look deltas')

        # 每个屏幕动作都写入原有消费缓冲；技能名、形态和大招都覆盖。
        for action in ['jump', 'dash', 'lockon', 'interact', 's1', 's2', 's3', 's4', 's5', 's6', 'ult', 'form1', 'form2', 'form3', 'form4']:
            fingers.down(1, center(page, f'[data-action="{action}"]'))
            fingers.up(1)
            check(page, f'testInput.consume("{action}", 500)', f'{action} screen button')
        page.evaluate('__glory.game.debugAdvance(2)')
        fingers.down(1, center(page, '[data-action="jump"]'))
        fingers.up(1)
        page.evaluate('__glory.game.debugAdvance(.05)')
        check(page, '__glory.game.player.pos.y > 0 || !__glory.game.player.onGround', 'jump button jumps in game')
        page.evaluate('__glory.game.debugAdvance(2)')
        fingers.down(1, center(page, '[data-action="s1"]'))
        fingers.up(1)
        page.evaluate('__glory.game.debugAdvance(.25)')  # 散人先切形态，再执行缓冲技能。
        check(page, '__glory.game.player.action?.slot === "s1"', 'skill button uses real combat skill')

        view = page.evaluate('__glory.game.viewMode')
        page.locator('[data-command="view"]').tap()
        assert view != page.evaluate('__glory.game.viewMode')
        print('PASS view button', flush=True)
        page.locator('[data-command="stats"]').tap()
        check(page, '__glory.hud.stats.style.display === "block"', 'stats button opens panel')
        page.locator('[data-command="stats"]').tap()
        check(page, '__glory.hud.stats.style.display === "none"', 'stats button closes panel')

        page.evaluate('''const g=__glory.game, mz=__glory.mode.mirrorZone;
          g.debugAdvance(2); g.player.pos.set(mz.center[0], 0, mz.center[1]); __glory.mode.frame(.016);''')
        page.locator('[data-action="interact"]').tap()
        page.evaluate('__glory.game.debugAdvance(.05)')
        check(page, '__glory.inWardrobe && !testInput.enabled && document.getElementById("touch-controls").hidden', 'mirror button opens wardrobe and suspends touch input')
        page.get_by_role('button', name='确认保存', exact=True).tap()
        check(page, '!__glory.inWardrobe && testInput.enabled && __lockCalls === 0', 'wardrobe save restores touch controls')

        fingers.down(1, center(page, '[data-action="special"]'))
        page.evaluate('__glory.pause()')
        fingers.up(1)
        check(page, '!testInput.enabled && testInput.touchDown.size === 0 && document.getElementById("touch-controls").hidden', 'pause releases held inputs and hides controls')
        page.get_by_role('button', name='设置', exact=True).tap()
        check(page, 'document.querySelector(".settings-box").scrollWidth <= innerWidth && document.querySelector(".settings-box").scrollHeight > document.querySelector(".settings-box").clientHeight', 'mobile settings fit and scroll')
        page.get_by_role('button', name='完成', exact=True).tap()
        page.get_by_role('button', name='操作说明', exact=True).tap()
        check(page, 'document.querySelector(".help-box").innerText.includes("左下摇杆")', 'mobile help describes touch controls')
        page.get_by_role('button', name='返回', exact=True).tap()
        page.get_by_role('button', name='继续游戏', exact=True).tap()
        check(page, 'testInput.enabled && !__glory.game.paused && __lockCalls === 0', 'resume works without pointer lock')
        fingers.down(1, center(page, '[data-action="attack"]'))
        page.evaluate('window.dispatchEvent(new Event("blur"))')
        check(page, 'testInput.touchDown.size === 0 && testInput.touchPressedAt.size === 0', 'blur clears held and buffered touch input')
        fingers.up(1)
        page.locator('[data-command="pause"]').tap()
        check(page, '__glory.game.paused && !testInput.enabled', 'on-screen pause button opens pause menu')
        page.get_by_role('button', name='继续游戏', exact=True).tap()

        # 旋转时仍按住手指也不能留住输入；小屏与刘海安全区域。
        fingers.down(1, center(page, '.touch-stick'))
        page.set_viewport_size({'width': 844, 'height': 390})
        page.wait_for_timeout(100)
        fingers.up(1)
        check(page, 'testInput.moveAxes().every(v => v === 0) && __glory.touch.pointers.size === 0', 'rotation resets active gestures')
        page.evaluate('__glory.game.debugAdvance(.05)')
        layout(page, '844x390 landscape controls fit and can be hit')
        page.screenshot(path=str(output / 'game-landscape.png'))
        page.evaluate('''for (const [key, value] of Object.entries({'--safe-left':'44px','--safe-right':'44px','--safe-bottom':'24px'})) document.documentElement.style.setProperty(key, value)''')
        layout(page, 'landscape safe area controls fit')
        page.evaluate('document.documentElement.removeAttribute("style")')
        for width, height in [(667, 375), (320, 568), (360, 640), (768, 1024), (1024, 768)]:
            page.set_viewport_size({'width': width, 'height': height})
            page.wait_for_timeout(70)
            layout(page, f'{width}x{height} controls fit and can be hit')

        # 键盘与触控同按一个动作时，触控松手不释放键盘。
        page.keyboard.down('w')
        page.keyboard.down('Shift')
        fingers.down(1, center(page, '[data-action="dash"]'))
        fingers.up(1)
        check(page, 'testInput.held("dash") && testInput.moveAxes()[1] === 1', 'keyboard and touch holds are independent')
        page.keyboard.up('Shift')
        page.keyboard.up('w')
        check(page, '!testInput.held("dash") && testInput.moveAxes()[1] === 0', 'keyboard release still works')
        # 来宾发送摇杆浮点值和按住 / 点按状态给原有联机协议。
        relay = page.evaluate('''async () => {
          const { NetGuestDuel } = await import('./src/game/netmodes.js');
          const packets = [];
          testInput.touchMove = [.4, .8]; testInput.touchHold('special', true); testInput.touchHold('s2', true);
          NetGuestDuel.prototype.sendInput.call({sendT:0, game:__glory.game, player:__glory.game.player, net:{relay:p=>packets.push(p)}}, .02);
          testInput.clear(); return packets[0];
        }''')
        assert relay['mx'] == .4 and relay['my'] == .8 and relay['guard'] == 1 and 's2' in relay['p'], relay
        print('PASS network guest forwards analog and touch actions', flush=True)
        # 外接鼠标后点画面恢复键鼠，再触摸画面恢复屏幕按钮。
        page.mouse.click(500, 300)
        check(page, '!testInput.touchMode && document.getElementById("touch-controls").hidden && __lockCalls > 0', 'switch from touch to mouse restores pointer lock')
        page.touchscreen.tap(500, 300)
        check(page, 'testInput.touchMode && !document.getElementById("touch-controls").hidden', 'switch from mouse back to touch restores controls')
        check(page, 'window.__errs.length === 0', 'no browser runtime errors')
        assert not errors, errors
    finally:
        context.close()

    # 新的无触屏上下文验证桌面默认布局与键盘输入。
    desktop = browser.new_context(viewport={'width': 1280, 'height': 720})
    if desktop:
        try:
            desktop.add_init_script('window.requestAnimationFrame = () => 0')
            pg = desktop.new_page()
            pg.goto(args.url.rstrip('/') + '/?auto=training&manual=1&models=0&mocap=0&noenv=1', wait_until='networkidle')
            pg.wait_for_function('__glory.game.player && document.getElementById("menu").style.display === "none"', polling=50)
            check(pg, 'document.getElementById("touch-controls").hidden && !document.body.classList.contains("touch-mode")', 'desktop touch controls remain hidden')
            pg.evaluate('''async () => { window.testInput = (await import('./src/engine/input.js')).input; }''')
            pg.keyboard.down('w')
            check(pg, 'testInput.moveAxes()[1] === 1', 'desktop keyboard movement')
            pg.keyboard.up('w')
            pg.keyboard.press('F5')
            check(pg, '__glory.game.viewMode === "ots"', 'desktop F5 view switch')
            pg.evaluate('testInput.fallbackLook = true')
            pg.locator('#game').dispatch_event('mousedown', {'button': 0})
            check(pg, 'testInput.held("attack")', 'desktop mouse attack')
            pg.locator('#game').dispatch_event('mouseup', {'button': 0})
            check(pg, '!testInput.held("attack") && __errs.length === 0', 'desktop mouse release and runtime errors')
        finally:
            desktop.close()
    if not shared:
        browser.close()
print('All mobile checks passed. Screenshots:', output)
