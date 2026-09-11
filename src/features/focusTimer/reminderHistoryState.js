import { activateDueReminders, dismissReminder, isReminderDue, readReminders } from './reminderHelpers.js';

export const reminderEventLabels = {
  created: 'Set', restored: 'Already active', triggered: 'Triggered',
  snoozed: 'Snoozed for 5 min', dismissed: 'Dismissed', cancelled: 'Cancelled', stopped: 'Stopped repeating',
};

function eventFor(item, type, at) {
  return {
    id: `${item.id}:${type}:${at}:${item.dueAt}`,
    reminderId: item.id, title: item.title, repeatMs: item.repeatMs || 0,
    durationMs: item.durationMs || 0, dueAt: item.dueAt, type, at,
  };
}

export function readReminderState(raw, now) {
  try {
    const saved = JSON.parse(raw || '[]');
    const legacy = Array.isArray(saved);
    const reminders = readReminders(JSON.stringify(legacy ? saved : saved?.reminders));
    const history = legacy
      ? reminders.map((item) => eventFor(item, 'restored', now))
      : (Array.isArray(saved?.history) ? saved.history : []).filter((event) => event
        && typeof event.id === 'string' && typeof event.title === 'string'
        && Object.hasOwn(reminderEventLabels, event.type) && Number.isFinite(event.at)
        && Math.abs(event.at) <= 8.64e15 && Number.isFinite(event.dueAt)
        && Math.abs(event.dueAt) <= 8.64e15 && Number.isFinite(event.repeatMs));
    return { reminders, history };
  } catch {
    return { reminders: [], history: [] };
  }
}

// Update active reminders and their history together so refreshes cannot split them.
export function reminderReducer(state, action) {
  const { reminders, history } = state;
  if (action.type === 'tick') {
    const due = reminders.filter((item) => isReminderDue(item, action.now));
    if (!due.length) return state;
    return {
      reminders: activateDueReminders(reminders, action.now),
      history: [...due.map((item) => eventFor(item, 'triggered', action.now)), ...history],
    };
  }
  if (action.type === 'add') {
    return { reminders: [...reminders, action.item], history: [eventFor(action.item, 'created', action.now), ...history] };
  }
  const item = reminders.find((entry) => entry.id === action.id);
  if (!item) return state;
  if (action.type === 'dismiss') {
    if (item.status !== 'ringing') return state;
    return { reminders: dismissReminder(reminders, item.id), history: [eventFor(item, 'dismissed', action.now), ...history] };
  }
  if (action.type === 'cancel') {
    return {
      reminders: reminders.filter((entry) => entry.id !== item.id),
      history: [eventFor(item, item.repeatMs > 0 ? 'stopped' : 'cancelled', action.now), ...history],
    };
  }
  if (action.type === 'snooze') {
    if (item.status !== 'ringing') return state;
    const snoozed = { ...item, dueAt: action.now + 5 * 60_000, alertAt: undefined, status: 'waiting' };
    return {
      reminders: reminders.map((entry) => entry.id === item.id ? snoozed : entry),
      history: [eventFor(snoozed, 'snoozed', action.now), ...history],
    };
  }
  return state;
}
