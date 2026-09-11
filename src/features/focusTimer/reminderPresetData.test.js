import test from 'node:test';
import assert from 'node:assert/strict';
import { availableReminderPresets, readReminderPresets } from './reminderPresetData.js';

test('preset dropdown accepts saved presets and excludes reminders already active', () => {
  const presets = readReminderPresets(JSON.stringify([
    { id: 'once', title: 'Tea', duration: 300_000, repeats: false },
    { id: 'repeat', title: 'Stretch', duration: 2_700_000, repeats: true },
    { id: 'bad', title: '', duration: 0, repeats: false },
  ]));
  assert.equal(presets.length, 2);
  assert.deepEqual(availableReminderPresets(presets, [{
    id: 'active', title: 'Stretch', durationMs: 2_700_000, repeatMs: 2_700_000, status: 'ringing',
  }]).map((preset) => preset.id), ['once']);
});
