export function durationMilliseconds(hours, minutes) {
  const h = Number(hours);
  const m = Number(minutes);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 168 || m < 0 || m > 59) return 0;
  return (h * 60 + m) * 60_000;
}

export function readReminders(raw) {
  try {
    const items = JSON.parse(raw || '[]');
    if (!Array.isArray(items)) return [];
    return items.filter((item) => item && typeof item.id === 'string'
      && typeof item.title === 'string' && item.title.trim()
      && Number.isFinite(item.dueAt) && ['waiting', 'ringing'].includes(item.status))
      .map((item) => ({ ...item, repeatMs: validRepeatInterval(item.repeatMs) ? item.repeatMs : 0 }));
  } catch {
    return [];
  }
}

export function activateDueReminders(items, now) {
  return items.map((item) => {
    if (!isReminderDue(item, now)) return item;
    if (!validRepeatInterval(item.repeatMs)) return { ...item, status: 'ringing' };
    // Skip missed intervals after sleep, keeping the original cadence and one alert.
    const elapsedIntervals = Math.floor((now - item.dueAt) / item.repeatMs) + 1;
    return { ...item, status: 'ringing', alertAt: item.dueAt, dueAt: item.dueAt + elapsedIntervals * item.repeatMs };
  });
}

function validRepeatInterval(value) {
  return Number.isSafeInteger(value) && value >= 60_000 && value <= (168 * 60 + 59) * 60_000;
}

export function isReminderDue(item, now) {
  return item.dueAt <= now && (item.status === 'waiting' || validRepeatInterval(item.repeatMs));
}

export function dismissReminder(items, id) {
  return items.flatMap((item) => item.id !== id ? [item]
    : validRepeatInterval(item.repeatMs) ? [{ ...item, status: 'waiting' }] : []);
}

export function formatReminderInterval(milliseconds) {
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return [hours ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : '', minutes ? `${minutes} min` : ''].filter(Boolean).join(' ');
}

export function reminderCountdown(dueAt, now) {
  const seconds = Math.max(0, Math.ceil((dueAt - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return `${hours ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
