import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasPwaUpdateAvailable,
  PWA_UPDATE_AVAILABLE_EVENT,
  setPwaUpdateAvailable,
} from './updateCheckEvents.js';

test('update availability can be read on mount and notifies profile menu listeners', () => {
  const previousWindow = globalThis.window;
  const target = new EventTarget();
  const observed = [];
  globalThis.window = target;
  target.addEventListener(PWA_UPDATE_AVAILABLE_EVENT, () => {
    observed.push(hasPwaUpdateAvailable());
  });

  try {
    setPwaUpdateAvailable(false);
    setPwaUpdateAvailable(true);
    assert.equal(hasPwaUpdateAvailable(), true);
    setPwaUpdateAvailable(true);
    setPwaUpdateAvailable(false);
    assert.deepEqual(observed, [true, false]);
  } finally {
    setPwaUpdateAvailable(false);
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
