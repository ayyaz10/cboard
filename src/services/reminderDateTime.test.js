import test from 'node:test';
import assert from 'node:assert/strict';
import { localDateTimeToInstant } from './reminderDateTime.js';

test('local capture date and time become an absolute instant', () => {
  const instant = localDateTimeToInstant('2026-11-20', '14:35');
  assert.equal(new Date(instant).getFullYear(), 2026);
  assert.equal(new Date(instant).getMonth(), 10);
  assert.equal(new Date(instant).getDate(), 20);
  assert.equal(new Date(instant).getHours(), 14);
  assert.equal(new Date(instant).getMinutes(), 35);
});

test('invalid, incomplete, and nonexistent local date-times are rejected', () => {
  for (const [date, time] of [['', '12:00'], ['2026-02-30', '12:00'], ['2026-11-20', '24:00'], ['2026-11-20', '1:00']]) {
    assert.throws(() => localDateTimeToInstant(date, time), /valid date|invalid in your local timezone/);
  }
});
