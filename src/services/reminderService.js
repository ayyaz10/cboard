import { getUserScopedClient } from './supabaseCrud.js';

export const REMINDER_PAGE_SIZE = 50;
export const MAX_REMINDER_PAGE_SIZE = 100;
export const REMINDER_REQUEST_TIMEOUT_MS = 12_000;

const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ReminderServiceError extends Error {
  constructor(message, { outcome = 'rejected', cause = undefined } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ReminderServiceError';
    this.outcome = outcome;
    this.retryable = outcome === 'offline' || outcome === 'unknown';
  }
}

export function createReminderId() {
  if (!globalThis.crypto?.randomUUID) throw new Error('Secure reminder IDs are unavailable in this browser.');
  return globalThis.crypto.randomUUID();
}

function normalizeId(value, field = 'Reminder ID') {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new TypeError(field + ' must be a UUID.');
  return value;
}

function normalizeInstant(value, field) {
  if (typeof value === 'string') {
    if (!instantPattern.test(value)) throw new TypeError(field + ' must be a valid timezone-aware instant.');
    const parts = value.slice(0, 19).split(/[-T:]/).map(Number);
    const [year, month, day, hour, minute, second] = parts;
    const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (year < 1000 || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1
      || calendar.getUTCDate() !== day || calendar.getUTCHours() !== hour
      || calendar.getUTCMinutes() !== minute || calendar.getUTCSeconds() !== second) {
      throw new TypeError(field + ' must be a valid timezone-aware instant.');
    }
  }
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) throw new TypeError(field + ' must be a valid timezone-aware instant.');
  return date.toISOString();
}

function normalizePageSize(value) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_REMINDER_PAGE_SIZE) {
    throw new RangeError('Reminder page size must be between 1 and ' + MAX_REMINDER_PAGE_SIZE + '.');
  }
  return value;
}

function toReminder(row) {
  return { id: row.id, title: row.title, dueAt: row.due_at, completedAt: row.completed_at,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function isConfirmedServerError(error) {
  return (Number.isInteger(error?.status) && error.status >= 400 && error.status < 600)
    || (typeof error?.code === 'string' && (/^[0-9A-Z]{5}$/i.test(error.code) || /^PGRST[0-9]{3}$/i.test(error.code)));
}

function classifyRequestError(error, action) {
  if (error instanceof ReminderServiceError) return error;
  const outcome = isConfirmedServerError(error) ? 'rejected' : 'unknown';
  const message = outcome === 'rejected' ? error?.message || ('The reminder ' + action + ' was rejected.')
    : 'The reminder ' + action + ' outcome is unknown. Check the reminder, then retry with the same ID.';
  return new ReminderServiceError(message, { outcome, cause: error });
}

function rpcRow(result, action) {
  if (result.error) throw classifyRequestError(result.error, action);
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!row) throw new Error('The ' + action + ' did not return a saved reminder.');
  return toReminder(row);
}

export function createReminderService({ getContext = getUserScopedClient, offline = isOffline, timeoutMs = REMINDER_REQUEST_TIMEOUT_MS } = {}) {
  async function runRpc(client, name, args, action) {
    if (offline()) throw new ReminderServiceError('You are offline. Reconnect before retrying this reminder.', { outcome: 'offline' });
    const controller = new AbortController();
    let timeout;
    try {
      const query = client.rpc(name, args).abortSignal(controller.signal);
      const timedOut = new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new ReminderServiceError('The reminder ' + action + ' timed out. Its save may have completed; check it and retry with the same ID.', { outcome: 'unknown' }));
        }, timeoutMs);
      });
      return await Promise.race([query, timedOut]);
    } catch (error) {
      throw classifyRequestError(error, action);
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async createReminder({ id, title, dueAt }) {
      const reminderId = normalizeId(id);
      if (typeof title !== 'string' || title.trim().length === 0 || title.length > 120 || title !== title.trim()) {
        throw new TypeError('Reminder title must be trimmed and contain 1 to 120 characters.');
      }
      const dueInstant = normalizeInstant(dueAt, 'Reminder due time');
      const { client } = await getContext();
      const result = await runRpc(client, 'create_user_reminder', { p_id: reminderId, p_title: title, p_due_at: dueInstant }, 'save');
      return rpcRow(result, 'create');
    },

    async listReminders({ startAt, endAt, after = null, limit = REMINDER_PAGE_SIZE }) {
      const start = normalizeInstant(startAt, 'Window start');
      const end = normalizeInstant(endAt, 'Window end');
      if (Date.parse(start) >= Date.parse(end)) throw new RangeError('Reminder window end must be after its start.');
      const pageSize = normalizePageSize(limit);
      const afterDueAt = after == null ? null : normalizeInstant(after.dueAt, 'Cursor due time');
      const afterId = after == null ? null : normalizeId(after.id, 'Cursor ID');
      const { client } = await getContext();
      const result = await runRpc(client, 'list_user_reminders', {
        p_start_at: start, p_end_at: end, p_after_due_at: afterDueAt, p_after_id: afterId, p_limit: pageSize,
      }, 'load');
      if (result.error) throw classifyRequestError(result.error, 'load');
      const rows = Array.isArray(result.data) ? result.data : [];
      const hasMore = rows.length > pageSize;
      const items = rows.slice(0, pageSize).map(toReminder);
      const last = items.at(-1);
      return { items, nextCursor: hasMore && last ? { dueAt: last.dueAt, id: last.id } : null };
    },

    async completeReminder(id) {
      const reminderId = normalizeId(id);
      const { client } = await getContext();
      const result = await runRpc(client, 'complete_user_reminder', { p_id: reminderId }, 'completion');
      return rpcRow(result, 'complete');
    },
  };
}

const reminders = createReminderService();
export const createReminder = input => reminders.createReminder(input);
export const listReminders = input => reminders.listReminders(input);
export const completeReminder = id => reminders.completeReminder(id);