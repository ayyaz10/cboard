const MAX_PRESET_DURATION = (168 * 60 + 59) * 60_000;

export function readReminderPresets(raw) {
  try {
    const saved = JSON.parse(raw || '[]');
    return Array.isArray(saved) ? saved.filter((item) => item && typeof item.id === 'string'
      && typeof item.title === 'string' && item.title.trim() && item.title.length <= 120
      && typeof item.repeats === 'boolean' && Number.isSafeInteger(item.duration)
      && item.duration >= 60_000 && item.duration <= MAX_PRESET_DURATION
      && item.duration % 60_000 === 0) : [];
  } catch {
    return [];
  }
}

export function availableReminderPresets(presets, reminders) {
  return presets.filter((preset) => !reminders.some((reminder) => reminder.title === preset.title
    && reminder.durationMs === preset.duration
    && Boolean(reminder.repeatMs) === preset.repeats));
}
