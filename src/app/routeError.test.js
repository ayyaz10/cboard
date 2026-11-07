import test from 'node:test';
import assert from 'node:assert/strict';
import { getRouteErrorMessage, isChunkLoadError } from './routeError.js';

test('recognizes common lazy route and stale chunk failures', () => {
  assert.equal(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /assets/Recipes.js')), true);
  assert.equal(isChunkLoadError(new Error('Loading chunk 12 failed.')), true);
  assert.equal(isChunkLoadError(new Error('Unable to preload CSS for /assets/recipes.css')), true);
});

test('keeps ordinary route exceptions distinct from module load failures', () => {
  const error = new Error('Cannot read properties of undefined');
  assert.equal(isChunkLoadError(error), false);
  assert.equal(getRouteErrorMessage(error, false), 'This section ran into a problem. Please try again.');
});

test('shows detailed error text only in development', () => {
  const error = new Error('Failed to fetch dynamically imported module: /local/src/Recipes.jsx');
  assert.equal(getRouteErrorMessage(error, true), error.message);
  assert.equal(getRouteErrorMessage(error, false), 'A required app module failed to load.');
});
