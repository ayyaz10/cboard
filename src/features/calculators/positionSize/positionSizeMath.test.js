import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePosition, defaults } from './positionSizeMath.js';

const calculate = (changes = {}) => calculatePosition({ ...defaults, ...changes });
test('requested wallet and leverage examples', () => {
  for (const [leverage, margin] of [['10', 10], ['30', 5], ['50', 2.5]]) {
    const result = calculate({ leverage });
    assert.deepEqual(result.errors, {});
    assert.equal(result.recommendedMargin, margin);
    assert.equal(result.notional, margin * Number(leverage));
  }
  assert.equal(calculate({ mode: 'spot' }).allocationAmount, 50);
  assert.equal(calculate({ mode: 'spot' }).remaining, 950);
});
test('long and short produce matching 2% stop, 4% target estimates', () => {
  for (const setup of [{ side: 'long', stop: '98', target: '104' }, { side: 'short', stop: '102', target: '96' }]) {
    const result = calculate({ entry: '100', ...setup });
    assert.deepEqual(result.errors, {});
    assert.equal(result.stopPercent, 2);
    assert.equal(result.loss, 2);
    assert.equal(result.profit, 4);
    assert.equal(result.ratio, 2);
    assert.equal(result.walletRisk, 0.2);
  }
});
test('custom margin changes exposure and warns above recommendation', () => {
  const result = calculate({ margin: '20' });
  assert.equal(result.recommendedMargin, 10);
  assert.equal(result.notional, 200);
  assert.equal(result.loss, 4);
  assert.ok(result.warnings.some((warning) => warning.includes('Your margin exceeds')));
});
test('rejects wrong-side, equal, missing and non-positive prices', () => {
  for (const key of ['entry', 'stop', 'target']) {
    for (const value of ['', '0', '-1', 'Infinity', 'abc', '12abc']) assert.ok(calculate({ [key]: value }).errors[key]);
  }
  for (const side of ['long', 'short']) {
    assert.ok(calculate({ side, stop: defaults.entry }).errors.stop);
    assert.ok(calculate({ side, target: defaults.entry }).errors.target);
  }
  assert.ok(calculate({ side: 'short' }).errors.stop);
  assert.ok(calculate({ stop: '66000', target: '64000' }).errors.target);
});
test('warning thresholds, low-leverage fallback, and wallet reserve', () => {
  assert.equal(calculate({ leverage: '5' }).recommendedMargin, 10);
  assert.equal(calculate({ leverage: '20', openTrades: '2' }).warnings.length, 0);
  assert.equal(calculate({ leverage: '30', openTrades: '3' }).warnings.length, 2);
  assert.ok(calculate({ margin: '1000' }).errors.margin);
  assert.ok(calculate({ wallet: '0' }).errors.wallet);
  for (const openTrades of ['', '-1', '1.5']) assert.ok(calculate({ openTrades }).errors.openTrades);
  assert.ok(calculate({ leverage: '25' }).errors.leverage);
});
test('spot validates allocation, warns above 10%, and ignores hidden futures prices', () => {
  assert.deepEqual(calculate({ mode: 'spot', entry: '', stop: '', target: '' }).errors, {});
  assert.equal(calculate({ mode: 'spot', allocation: '10' }).warnings.length, 1);
  assert.equal(calculate({ mode: 'spot', allocation: '11' }).warnings.length, 2);
  for (const allocation of ['0', '-5', '100', '101', 'Infinity']) assert.ok(calculate({ mode: 'spot', allocation }).errors.allocation);
});
