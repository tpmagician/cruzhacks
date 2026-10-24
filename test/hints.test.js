import test from 'node:test';
import assert from 'node:assert/strict';

let moduleId = 0;
function install(t, key, value) {
  const old = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, value });
  t.after(() => old ? Object.defineProperty(globalThis, key, old) : delete globalThis[key]);
}

test('the daily hint allowance persists across module reloads and resets at local midnight', async (t) => {
  const NativeDate = Date;
  let now = new NativeDate(2026, 9, 24, 23, 59, 59).getTime();
  install(t, 'Date', class extends NativeDate { constructor(...args) { super(...(args.length ? args : [now])); } });
  const saved = new Map();
  install(t, 'localStorage', { getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) });
  const hints = await import(`../frontend/js/hints.js?test=${++moduleId}`);
  assert.equal(hints.hintsLeftToday(), 3);
  hints.useHint(); hints.useHint(); hints.useHint();
  assert.equal(hints.hintsLeftToday(), 0);
  const reloaded = await import(`../frontend/js/hints.js?test=${++moduleId}`);
  assert.equal(reloaded.hintsLeftToday(), 0);
  now += 2000;
  assert.equal(reloaded.hintsLeftToday(), 3);
  reloaded.useHint();
  assert.equal(reloaded.hintsLeftToday(), 2);
});

test('blocked browser storage falls back to an in-memory hint allowance', async (t) => {
  install(t, 'localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
  const hints = await import(`../frontend/js/hints.js?test=${++moduleId}`);
  hints.useHint(); hints.useHint();
  assert.equal(hints.hintsLeftToday(), 1);
});

test('malformed saved hint data does not prevent practice', async (t) => {
  install(t, 'localStorage', { getItem: () => '{bad JSON', setItem() {} });
  const hints = await import(`../frontend/js/hints.js?test=${++moduleId}`);
  assert.equal(hints.hintsLeftToday(), 3);
});
