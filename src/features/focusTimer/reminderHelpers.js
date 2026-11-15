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

const paymentDatePattern = /\((\d{4}-\d{2}-\d{2})\)$/;
const creditReminderEvents = new Set(['before_due', 'due_date', 'manual']);

export function reminderTitle(item) {
  const title = typeof item?.title === 'string' ? item.title : '';
  return creditReminderEvents.has(item?.creditReminderEvent)
    ? title.replace(/\s+\(\d{4}-\d{2}-\d{2}\)$/, '').trim()
    : title;
}

export function reminderPaymentDueDate(item) {
  if (!creditReminderEvents.has(item?.creditReminderEvent)) return '';
  if (typeof item.paymentDueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.paymentDueDate)) {
    return item.paymentDueDate;
  }
  return item.title?.match(paymentDatePattern)?.[1] || '';
}

export function formatReminderDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return '';
  const value = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) return '';
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(value);
}

export function formatReminderAlertDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric', hour: 'numeric', minute: '2-digit', month: 'short',
  }).format(date);
}

export function reminderCountdown(dueAt, now) {
  const milliseconds = Number(dueAt) - Number(now);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 'Due now';
  if (milliseconds < 60_000) return 'In <1 min';
  if (milliseconds >= 86_400_000) {
    const totalHours = Math.floor(milliseconds / 3_600_000);
    return `In ${Math.floor(totalHours / 24)}d ${totalHours % 24}h`;
  }
  const totalMinutes = Math.min(1_439, Math.ceil(milliseconds / 60_000));
  if (milliseconds < 3_600_000) return `In ${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `In ${hours}h ${minutes}m` : `In ${minutes}m`;
}
