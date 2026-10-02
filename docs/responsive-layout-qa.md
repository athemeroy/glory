# Foldable and mobile layout regression

## Changes

- Lobby layout switches by CSS viewport width, rather than requiring portrait orientation below 760px. Browser chrome can make the content viewport landscape-shaped while a foldable device is physically upright.
- Up to 1100px, modes use a horizontally scrollable strip and the preview / launch panel use fluid columns. Up to 600px, the launch panel sits below the preview. The primary action does not depend on scrolling a desktop-width panel into view.
- At 380px visible height or less, decorative mode art yields space to the two launch actions. Very short narrow views also reduce the account preview to its change-account row. Both Start and Configure are checked after viewport shrink and safe-area simulation.
- Character preparation has a horizontal account carousel, scrollable details / match options, and a separate launch footer. Desktop above 1100px retains the existing three-column layout.
- Fixed UI uses dynamic viewport height and existing safe-area insets. A visual viewport resize cancels stale touch captures, just like a window resize.
- The 320px cover-display layout separates the movement controls from the joystick and skill buttons while retaining at least 44px action targets.

## Reproduce layout checks

Use an already installed Chromium and Playwright; start the ordinary local server:

```sh
node server/server.mjs
python tools/check-responsive-ui.py http://localhost:8780 --browser /path/to/chromium --output /tmp/glory-responsive-ui
python tools/check-combat-ui.py http://localhost:8780 --browser /path/to/chromium --output /tmp/glory-combat-ui
```

The responsive check covers 320×568, 360×740, 390×844, 600×700, 700×635, 752×688, 768×1024, 841×701, 1024×768, 667×375, 844×390 and 1440×900 CSS viewports. It checks the launch button, account selection, carousel navigation, match options, return / re-entry, safe areas, reduced viewport height, touch target bounds, overlap, the expanded touch menu, and gesture reset on rotation.

`responsive-ui-fixture.html` uses the production Menu class with an explicitly labelled static portrait in place of WebGL. `combat-ui-fixture.html` uses the production HUD, TouchControls and Fighter. Their screenshots are layout evidence only, not rendered-character or 3D gameplay acceptance.

## CPU and syntax checks

```sh
node tools/touch-viewport-regression.mjs
node --check src/ui/touch.js
python -m py_compile tools/check-responsive-ui.py
git diff --check
node --experimental-loader ./tools/three-local-loader.mjs tools/combat-volume-regression.mjs
```

The touch regression checks viewport event registration, multi-finger cancellation, repeated resize, late pointer events, a fresh gesture after cancellation, keyboard isolation, and browsers without the optional visualViewport API. It runs production Input and TouchControls with a minimal DOM mock, so it does not verify CSS layout.

## Acceptance boundaries

Run the browser matrix on a supported Chromium before declaring visual layout acceptance. Also test a real foldable device through folding, unfolding, rotation, and browser-toolbar changes. The static portrait fixture cannot verify 3D gameplay, character art, or continuous first-person flicker.

Packaging uses the existing `tools/vercel/build.sh` and requires `rsync` in addition to Node. A successful CPU regression is not a packaging or deployment pass.
