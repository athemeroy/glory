// No renderer/browser needed: exercise real resize wiring and input cancellation.
import assert from 'node:assert/strict';

class Element extends EventTarget {
  constructor() {
    super(); this.dataset = {}; this.style = {}; this.attrs = {}; this.captures = new Set(); this.children = new Map();
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  querySelector(selector) { if (!this.children.has(selector)) this.children.set(selector, new Element()); return this.children.get(selector); }
  appendChild() {}
  setAttribute(name, value) { this.attrs[name] = value; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); this.onRelease?.(id); }
  contains(target) { return target === this; }
  closest() { return this.dataset.action ? this : null; }
}
globalThis.matchMedia = () => ({ matches: true });
globalThis.window = new EventTarget();
window.visualViewport = new EventTarget();
globalThis.document = new EventTarget();
document.body = new Element(); document.documentElement = new Element(); document.createElement = () => new Element();
const { input } = await import('../src/engine/input.js');
const { TouchControls } = await import('../src/ui/touch.js');
const touch = new TouchControls({ canvas: new Element(), game: {}, hud: { showStats() {} } });
input.enabled = true;
const attack = new Element(); attack.dataset.action = 'attack';
attack.onRelease = id => touch.up(id, true); // Model synchronous lostpointercapture re-entry.
const down = id => touch.down({ target: attack, pointerType: 'touch', pointerId: id, preventDefault() {} });
const assertReleased = () => {
  assert.equal(touch.pointers.size, 0);
  assert.equal(attack.captures.size, 0);
  assert.equal(input.touchDown.size, 0);
  assert.equal(input.touchPressedAt.size, 0);
  assert.deepEqual(input.touchMove, [0, 0]);
  assert.deepEqual([input.mouseDX, input.mouseDY], [0, 0]);
};
down(1); down(2);
assert.equal(input.held('attack'), true);
assert.equal(touch.pointers.size, 2);
input.touchMove = [.4, .8]; input.mouseDX = 12; input.mouseDY = -4;
window.visualViewport.dispatchEvent(new Event('resize'));
assertReleased();
for (let i = 0; i < 20; i++) window.visualViewport.dispatchEvent(new Event('resize'));
assertReleased();
// Late events from the old physical fingers must not resurrect an action.
touch.up(1); touch.up(2); touch.move({ pointerId: 1, clientX: 20, clientY: 30 });
assertReleased();
// A fresh gesture works immediately after the viewport settles.
down(3); assert.equal(input.held('attack'), true); touch.up(3);
assert.equal(input.held('attack'), false);
assert.equal(input.consume('attack', 5000), true);
// Cancellation never releases a simultaneous keyboard hold.
input.simHold('attack', true); down(4);
window.visualViewport.dispatchEvent(new Event('resize'));
assertReleased(); assert.equal(input.held('attack'), true); input.simHold('attack', false);
down(5); window.dispatchEvent(new Event('resize')); assertReleased();
// Optional API is absent on some older browsers.
delete window.visualViewport;
assert.doesNotThrow(() => new TouchControls({canvas: new Element(), game: {}, hud: {showStats() {}}}));
console.log('PASS visual viewport: multi-finger cancellation, repeated resize, late release, fresh gesture, keyboard isolation, and optional API');
