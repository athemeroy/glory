#!/usr/bin/env python3
"""Check preview loading, dragging, GPU ownership and mobile rendering on Mini.

python tools/viewqa.py --serve --cdp http://127.0.0.1:9334 --output view-qa
Only independent browser contexts are closed; shared Chrome stays running.
"""
import argparse
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('url', nargs='?')
parser.add_argument('--serve', action='store_true')
parser.add_argument('--cdp', default='http://127.0.0.1:9334')
parser.add_argument('--output', default='view-qa')
args = parser.parse_args()
server = None
if args.serve:
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(Path(__file__).resolve().parents[1])))
    Thread(target=server.serve_forever, daemon=True).start()
    args.url = f'http://127.0.0.1:{server.server_port}'
if not args.url:
    parser.error('Provide a URL or --serve')
output = Path(args.output)
output.mkdir(parents=True, exist_ok=True)
results = []
try:
    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp(args.cdp)
        for label, mobile in [('desktop', False), ('phone', True)]:
            context = browser.new_context(viewport={'width': 390 if mobile else 1280, 'height': 844 if mobile else 800}, is_mobile=mobile, has_touch=mobile, device_scale_factor=3 if mobile else 1)
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            try:
                page.goto(args.url.rstrip('/') + '/tools/viewtest.html', wait_until='networkidle', timeout=90000)
                page.wait_for_function('window.__ready', polling=100, timeout=90000)
                errors.extend(page.evaluate('window.__errors'))
                assert not errors, errors
                page.evaluate('''()=>{const v=__viewer;v.el.scrollIntoView({block:'start'});v.visible=true;v.last=performance.now()-40;v.frame()}''')
                page.locator('.preview').last.screenshot(path=str(output / f'{label}.png'))
                result = page.evaluate('window.__finish()')
                result['label'] = label
                results.append(result)
                print(json.dumps(result, ensure_ascii=False), flush=True)
            finally:
                context.close()
finally:
    (output / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    if server:
        server.shutdown()
        server.server_close()
