#!/usr/bin/env python3
import sys
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; BASE = sys.argv[2] if len(sys.argv) > 2 else 'http://127.0.0.1:8770/'
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 1440, 'height': 810})
    pg.goto(BASE); pg.wait_for_timeout(2500); pg.screenshot(path=OUT + '_1title.png')
    pg.click('#enter'); pg.wait_for_timeout(1200); pg.screenshot(path=OUT + '_2main.png')
    pg.click('.mode-card >> nth=1'); pg.wait_for_timeout(1200); pg.screenshot(path=OUT + '_3setup.png')
    pg.click('#back'); pg.wait_for_timeout(500)
    pg.click('.mode-card >> nth=3'); pg.wait_for_timeout(1000); pg.screenshot(path=OUT + '_4team.png')
    pg.click('#back'); pg.wait_for_timeout(500)
    pg.click('.mode-card >> nth=4'); pg.wait_for_timeout(1000); pg.screenshot(path=OUT + '_5dungeon.png')
    pg.click('#back'); pg.wait_for_timeout(500)
    pg.click('#help'); pg.wait_for_timeout(600); pg.screenshot(path=OUT + '_6help.png')
    print('errs', pg.evaluate('JSON.stringify(window.__errs)'))
    b.close()
