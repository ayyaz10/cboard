import { activateDueReminders, dismissReminder, isReminderDue, readReminders } from './reminderHelpers.js';

export const reminderEventLabels = {
  created: 'Set', restored: 'Already active', triggered: 'Triggered',
  snoozed: 'Snoozed for 5 min', dismissed: 'Dismissed', cancelled: 'Cancelled', stopped: 'Stopped repeating',
};

export function eventFor(item, type, at) {
  const id = type === 'triggered'
    ? `trigger:${item.id}:${Math.trunc(item.dueAt)}`
    : `${item.id}:${type}:${at}:${item.dueAt}`;
  return {
    id, reminderId: item.id, title: item.title, repeatMs: item.repeatMs || 0,
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
function actionEvent(item, type, at, expectedRevision) {
  const event = eventFor(item, type, at);
  if (Number.isInteger(expectedRevision) && expectedRevision > 0) event.expectedRevision = expectedRevision;
  return event;
}
export function reminderReducer(state, action) {
  const { reminders, history } = state;
  if (action.type === 'replaceAll') {
    const remoteEvents = Array.isArray(action.history) ? action.history : [];
    const ids = new Set(remoteEvents.map(event => event.id));
    const mergedHistory = [...remoteEvents, ...history.filter(event => !ids.has(event.id))]
      .sort((left, right) => right.at - left.at);
    const remote = new Map();
    const terminalEvents = new Map();
    for (const event of mergedHistory) {
      if (event.type === 'cancelled' || event.type === 'stopped' || (event.type === 'dismissed' && !event.repeatMs)) {
        const previous = terminalEvents.get(event.reminderId);
        if (!previous || previous.at < event.at) terminalEvents.set(event.reminderId, event);
      }
    }
    for (const item of action.reminders || []) {
      const terminal = terminalEvents.get(item.id);
      if (terminal && (!item.updatedAt || terminal.at >= Date.parse(item.updatedAt))) continue;
      remote.set(item.id, item);
    }
    // A refresh started before a local action must not replace a newer revision or local snooze.
    for (const item of reminders) {
      const saved = remote.get(item.id);
      const terminal = terminalEvents.get(item.id);
      if (terminal && (!item.updatedAt || terminal.at >= Date.parse(item.updatedAt))) continue;
      if (!saved || (item.revision && saved.revision && item.revision > saved.revision)
        || (item.revision === saved?.revision && (item.dueAt !== saved.dueAt || item.status !== saved.status))) {
        remote.set(item.id, item);
      }
    }
    return { reminders: [...remote.values()], history: mergedHistory };
  }
  if (action.type === 'syncReminder') {
    const current = reminders.find(item => item.id === action.reminder.id);
    const latest = current?.revision && action.reminder.revision && current.revision > action.reminder.revision
      ? current : action.reminder;
    const next = reminders.filter(item => item.id !== latest.id);
    if (!latest.completedAt) next.push(latest);
    const events = action.events || [];
    const ids = new Set(events.map(event => event.id));
    return { reminders: next, history: [...events, ...history.filter(event => !ids.has(event.id))]
      .sort((left, right) => right.at - left.at) };
  }
  if (action.type === 'removeHistoryEvent') {
    return { reminders, history: history.filter(event => event.id !== action.id) };
  }
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
    return { reminders: dismissReminder(reminders, item.id), history: [actionEvent(item, 'dismissed', action.now, action.expectedRevision), ...history] };
  }
  if (action.type === 'cancel') {
    return {
      reminders: reminders.filter((entry) => entry.id !== item.id),
      history: [actionEvent(item, item.repeatMs > 0 ? 'stopped' : 'cancelled', action.now, action.expectedRevision), ...history],
    };
  }
  if (action.type === 'snooze') {
    if (item.status !== 'ringing') return state;
    const snoozed = { ...item, dueAt: action.now + 5 * 60_000, alertAt: undefined, status: 'waiting' };
    return {
      reminders: reminders.map((entry) => entry.id === item.id ? snoozed : entry),
      history: [actionEvent(snoozed, 'snoozed', action.now, action.expectedRevision), ...history],
    };
  }
  return state;
}
