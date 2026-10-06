import { useState } from 'react';
import { useReminders } from './ReminderProvider';
import { formatReminderInterval } from './reminderHelpers';
import { reminderEventLabels } from './reminderHistoryState.js';

export function ReminderHistory() {
  const { history } = useReminders();
  const [filter, setFilter] = useState('all');
  const [visibleCount, setVisibleCount] = useState(20);
  const filtered = history.filter((event) => filter === 'all'
    || (filter === 'repeat' ? event.repeatMs > 0 : !event.repeatMs));
  return (
    <section aria-labelledby="reminder-history-heading" className="mt-6 border-t border-[var(--color-border)] pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="reminder-history-heading" className="text-xl font-bold">Reminder history</h3>
        <label className="text-sm font-semibold">Show
          <select value={filter} onChange={(event) => { setFilter(event.target.value); setVisibleCount(20); }} className="ui-control ml-2 w-auto">
            <option value="all">All reminders</option>
            <option value="once">Just once</option>
            <option value="repeat">Repeating</option>
          </select>
        </label>
      </div>
      <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">Your reminder activity, newest first. History stays here after a reminder ends and is saved on this browser.</p>
      {filtered.length === 0 ? <p className="ui-card mt-3 border-dashed p-4 text-sm text-[var(--color-text-muted)]">No history yet. Set a reminder to start your history.</p> : (
        <ol className="mt-4 max-h-96 space-y-3 overflow-y-auto p-1">
          {filtered.slice(0, visibleCount).map((event) => (
            <li key={event.id} className="ui-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 break-words font-bold">{event.title}</p>
                <span className={`ui-badge ${event.type === 'triggered' ? 'ui-badge--warning' : ''}`}>{reminderEventLabels[event.type]}</span>
              </div>
              <p className="mt-1 text-xs font-semibold text-[var(--color-text-secondary)]">{event.repeatMs > 0 ? `Repeating · Every ${formatReminderInterval(event.repeatMs)}` : `Just once${event.durationMs > 0 ? ` · After ${formatReminderInterval(event.durationMs)}` : ''}`}</p>
              <time dateTime={new Date(event.at).toISOString()} className="mt-2 block text-xs text-[var(--color-text-muted)]">{new Date(event.at).toLocaleString()}</time>
              {event.type === 'triggered' && <p className="mt-1 text-xs text-[var(--color-text-muted)]">Scheduled for {new Date(event.dueAt).toLocaleString()}</p>}
            </li>
          ))}
        </ol>
      )}
      {filtered.length > visibleCount && <button type="button" onClick={() => setVisibleCount((count) => count + 20)} className="ui-button ui-button--sm mt-3">Show more ({filtered.length - visibleCount} remaining)</button>}
    </section>
  );
}
