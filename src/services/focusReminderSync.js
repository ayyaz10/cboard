import { getUserScopedClient } from './supabaseCrud.js';
import { createReminderId } from './reminderService.js';

export const REMINDER_PAGE_SIZE = 100;
export const REMINDER_REQUEST_TIMEOUT_MS = 12_000;
const DAY_MS = 86_400_000;
const MAX_REMINDER_RANGE_MS = 10 * 365 * DAY_MS;

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Reminder time is invalid.');
  return date.toISOString();
}

function mapReminder(row) {
  return {
    id: row.id,
    title: row.title,
    dueAt: Date.parse(row.due_at),
    completedAt: row.completed_at ? Date.parse(row.completed_at) : null,
    repeatMs: Number(row.repeat_ms) || 0,
    durationMs: Number(row.duration_ms) || 0,
    status: row.status,
    alertAt: row.alert_at ? Date.parse(row.alert_at) : undefined,
    revision: Number(row.revision) || 1,
    updatedAt: row.updated_at,
    ...Object.fromEntries(Object.entries(row.metadata && typeof row.metadata === 'object' ? row.metadata : {})
      .filter(([key]) => ['creditAgreementId', 'creditInstalmentId', 'creditReminderEvent', 'paymentDueDate'].includes(key))),
  };
}

function mapEvent(row) {
  return {
    id: row.event_key,
    eventId: row.event_id,
    reminderId: row.reminder_id,
    title: row.title,
    repeatMs: Number(row.repeat_ms) || 0,
    durationMs: Number(row.duration_ms) || 0,
    dueAt: Date.parse(row.due_at),
    type: row.event_type,
    at: Date.parse(row.occurred_at),
  };
}

export function createFocusReminderSync({
  getContext = getUserScopedClient,
  offline = () => typeof navigator !== 'undefined' && navigator.onLine === false,
  timeoutMs = REMINDER_REQUEST_TIMEOUT_MS,
} = {}) {
  async function rpc(name, args) {
    if (offline()) throw new Error('You are offline. This reminder stays saved on this device until you reconnect.');
    const { client } = await getContext();
    const controller = new AbortController();
    let timer;
    try {
      const pending = client.rpc(name, args).abortSignal(controller.signal);
      const timedOut = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Reminder sync timed out. Reopen Focus Timer to reconcile the saved state.'));
        }, timeoutMs);
      });
      const result = await Promise.race([pending, timedOut]);
      if (result.error) throw result.error;
      return result.data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function listReminders(now = Date.now()) {
    const startAt = toIso(now - 30 * DAY_MS);
    const endAt = toIso(now + MAX_REMINDER_RANGE_MS);
    const items = [];
    let after = null;
    do {
      const rows = await rpc('list_focus_timer_reminders', {
        p_start_at: startAt,
        p_end_at: endAt,
        p_after_due_at: after?.dueAt ?? null,
        p_after_id: after?.id ?? null,
        p_limit: REMINDER_PAGE_SIZE,
      });
      const page = (Array.isArray(rows) ? rows : []).slice(0, REMINDER_PAGE_SIZE).map(mapReminder);
      items.push(...page);
      if (!Array.isArray(rows) || rows.length <= REMINDER_PAGE_SIZE || !page.length) break;
      const last = page.at(-1);
      after = { dueAt: toIso(last.dueAt), id: last.id };
    } while (true);
    return items;
  }

  async function listHistory() {
    const events = [];
    let after = null;
    do {
      const rows = await rpc('list_focus_timer_history', {
        p_start_at: '1970-01-01T00:00:00.000Z',
        p_after_at: after?.at ?? null,
        p_after_id: after?.eventId ?? null,
        p_limit: REMINDER_PAGE_SIZE,
      });
      const page = (Array.isArray(rows) ? rows : []).slice(0, REMINDER_PAGE_SIZE).map(mapEvent);
      events.push(...page);
      if (!Array.isArray(rows) || rows.length <= REMINDER_PAGE_SIZE || !page.length) break;
      const last = page.at(-1);
      after = { at: toIso(last.at), eventId: last.eventId };
    } while (true);
    return events;
  }

  function importReminderArgs(item) {
    const metadata = Object.fromEntries(Object.entries(item)
      .filter(([key]) => ['creditAgreementId', 'creditInstalmentId', 'creditReminderEvent', 'paymentDueDate'].includes(key)));
    return {
      p_id: item.id,
      p_title: item.title,
      p_due_at: toIso(item.dueAt),
      p_repeat_ms: item.repeatMs || 0,
      p_duration_ms: item.durationMs || 0,
      p_status: item.status || 'waiting',
      p_alert_at: item.status === 'ringing' ? toIso(item.alertAt ?? item.dueAt) : null,
      p_metadata: metadata,
    };
  }

  async function importReminder(item) {
    const rows = await rpc('import_focus_timer_reminder', importReminderArgs(item));
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error('Reminder import returned no saved record.');
    return mapReminder(row);
  }

  async function importHistory(items) {
    let inserted = 0;
    for (let offset = 0; offset < items.length; offset += REMINDER_PAGE_SIZE) {
      const batch = items.slice(offset, offset + REMINDER_PAGE_SIZE).map(event => ({
        event_key: event.id,
        reminder_id: event.reminderId,
        title: event.title,
        repeat_ms: event.repeatMs || 0,
        duration_ms: event.durationMs || 0,
        due_at: toIso(event.dueAt),
        event_type: event.type,
        occurred_at: toIso(event.at),
      }));
      inserted += Number(await rpc('import_focus_timer_history', { p_events: batch })) || 0;
    }
    return inserted;
  }

  async function beginOccurrence(id, expectedDueAt) {
    const rows = await rpc('begin_focus_timer_occurrence', {
      p_id: id, p_expected_due_at: toIso(expectedDueAt),
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error('Starting the reminder returned no state.');
    return { reminder: mapReminder(row), applied: Boolean(row.applied) };
  }

  async function applyAction(id, action, expectedRevision, eventKey) {
    const rows = await rpc('apply_focus_timer_action', {
      p_id: id,
      p_action: action,
      p_expected_revision: expectedRevision,
      p_event_key: eventKey,
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error('Updating the reminder returned no state.');
    return { reminder: mapReminder(row), applied: Boolean(row.applied) };
  }

  async function subscribe(userId, onChange, onStatus = () => {}) {
    const { client } = await getContext();
    const channel = client.channel('focus-reminders:' + userId)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'user_reminders', filter: 'user_id=eq.' + userId,
      }, onChange)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'user_reminder_events', filter: 'user_id=eq.' + userId,
      }, onChange)
      .subscribe(onStatus);
    return () => { void client.removeChannel(channel); };
  }

  return { listReminders, listHistory, importReminder, importHistory, beginOccurrence, applyAction, subscribe };
}

const sync = createFocusReminderSync();
export { createReminderId };
export const listFocusTimerReminders = (...args) => sync.listReminders(...args);
export const listFocusTimerHistory = (...args) => sync.listHistory(...args);
export const importFocusTimerReminder = (...args) => sync.importReminder(...args);
export const importFocusTimerHistory = (...args) => sync.importHistory(...args);
export const beginFocusTimerOccurrence = (...args) => sync.beginOccurrence(...args);
export const applyFocusTimerReminderAction = (...args) => sync.applyAction(...args);
export const subscribeFocusTimerReminders = (...args) => sync.subscribe(...args);
