import test from 'node:test';
import assert from 'node:assert/strict';
import { focusSessionStatuses, formatTimer, getPhaseRemainingSeconds } from './focusTimerHelpers.js';

test('focus timer shows MM:SS under an hour, HH:MM:SS under a day, and days above it', () => {
  assert.equal(formatTimer(0), '00:00');
  assert.equal(formatTimer(3599), '59:59');
  assert.equal(formatTimer(3600), '01:00:00');
  assert.equal(formatTimer(86399), '23:59:59');
  assert.equal(formatTimer(86400), '1d 00:00:00');
  assert.equal(formatTimer(176461), '2d 01:01:01');
  assert.equal(formatTimer(-1), '00:00');
});

test('running focus countdown keeps ticking by seconds', () => {
  const startedAt = Date.parse('2026-11-14T12:00:00Z');
  const session = {
    status: focusSessionStatuses.activeFocus,
    phaseStartedAt: new Date(startedAt).toISOString(),
    focusRemainingSeconds: 130,
    focusMinutes: 10,
  };
  const atStart = getPhaseRemainingSeconds(session, startedAt);
  const oneSecondLater = getPhaseRemainingSeconds(session, startedAt + 1000);
  assert.equal(formatTimer(atStart), '02:10');
  assert.equal(formatTimer(oneSecondLater), '02:09');
});
