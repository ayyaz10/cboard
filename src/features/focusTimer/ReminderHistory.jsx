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
    <section aria-labelledby="reminder-history-heading" className="mt-6 border-t border-black/15 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="reminder-history-heading" className="text-xl font-bold">Reminder history</h3>
        <label className="text-sm font-semibold">Show
          <select value={filter} onChange={(event) => { setFilter(event.target.value); setVisibleCount(20); }} className="ml-2 rounded-xl border-2 border-black bg-white px-3 py-2 text-black">
            <option value="all">All reminders</option>
            <option value="once">Just once</option>
            <option value="repeat">Repeating</option>
          </select>
        </label>
      </div>
      <p className="mt-2 text-xs leading-5 text-black/60">Your reminder activity, newest first. History stays here after a reminder ends and is saved on this browser.</p>
      {filtered.length === 0 ? <p className="mt-3 rounded-xl border-2 border-dashed border-black/20 p-4 text-sm text-black/60">No history yet. Set a reminder to start your history.</p> : (
        <ol className="mt-4 max-h-96 space-y-3 overflow-y-auto p-1">
          {filtered.slice(0, visibleCount).map((event) => (
            <li key={event.id} className="rounded-xl border-2 border-black/20 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 break-words font-bold">{event.title}</p>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${event.type === 'triggered' ? 'bg-[#ffd166]' : 'bg-[#f0f0e8]'}`}>{reminderEventLabels[event.type]}</span>
              </div>
              <p className="mt-1 text-xs font-semibold text-black/70">{event.repeatMs > 0 ? `Repeating · Every ${formatReminderInterval(event.repeatMs)}` : `Just once${event.durationMs > 0 ? ` · After ${formatReminderInterval(event.durationMs)}` : ''}`}</p>
              <time dateTime={new Date(event.at).toISOString()} className="mt-2 block text-xs text-black/60">{new Date(event.at).toLocaleString()}</time>
              {event.type === 'triggered' && <p className="mt-1 text-xs text-black/60">Scheduled for {new Date(event.dueAt).toLocaleString()}</p>}
            </li>
          ))}
        </ol>
      )}
      {filtered.length > visibleCount && <button type="button" onClick={() => setVisibleCount((count) => count + 20)} className="mt-3 rounded-full border-2 border-black bg-white px-4 py-2 text-sm font-bold">Show more ({filtered.length - visibleCount} remaining)</button>}
    </section>
  );
}
