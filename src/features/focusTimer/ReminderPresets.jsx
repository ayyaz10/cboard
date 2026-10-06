import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useReminders } from './ReminderProvider.jsx';
import { formatReminderInterval } from './reminderHelpers.js';
import { readReminderPresets } from './reminderPresetData.js';

const buttonClass = 'ui-button ui-button--sm';

export function ReminderPresets(props) {
  const { user } = useAuth();
  return <PresetList key={user?.id || 'signed-out'} userId={user?.id} {...props} />;
}

function PresetList({ userId, title, duration, repeats, onEdit }) {
  const storageKey = `cboard:reminder-presets:${userId}`;
  const { addReminder } = useReminders();
  const [presets, setPresets] = useState(() => {
    try { return userId ? readReminderPresets(localStorage.getItem(storageKey)) : []; } catch { return []; }
  });
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [removed, setRemoved] = useState(null);

  function persist(items) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(items));
      setPresets(items);
      window.dispatchEvent(new CustomEvent('cboard:reminder-presets-changed', { detail: { userId, presets: items } }));
      setError('');
      return true;
    } catch {
      setError('Could not save presets on this browser. Please try again.');
      return false;
    }
  }

  function save() {
    if (!title.trim() || !duration) {
      setError('Enter a reminder title and a duration of at least 1 minute in the form above.');
      setMessage('');
      return;
    }
    const preset = { id: editingId || crypto.randomUUID(), title: title.trim(), duration, repeats };
    const duplicate = presets.find((item) => item.id !== editingId && item.title === preset.title
      && item.duration === duration && item.repeats === repeats);
    if (duplicate) {
      setError('This preset is already saved. Use its Start button below.');
      setMessage('');
      return;
    }
    const next = editingId ? presets.map((item) => item.id === editingId ? preset : item) : [...presets, preset];
    if (persist(next)) {
      setMessage(`${editingId ? 'Updated' : 'Saved'} preset: ${preset.title}.`);
      setEditingId(null);
    }
  }

  function remove(preset) {
    if (persist(presets.filter((item) => item.id !== preset.id))) {
      setRemoved(preset);
      if (editingId === preset.id) setEditingId(null);
      setMessage(`Deleted preset: ${preset.title}.`);
    }
  }

  return (
    <section aria-labelledby="reminder-presets-heading" className="mt-6 border-t border-[var(--color-border)] pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="reminder-presets-heading" className="text-xl font-bold">Saved presets</h3>
        <button type="button" onClick={save} className="ui-button ui-button--primary">{editingId ? 'Save preset changes' : 'Save current settings as preset'}</button>
      </div>
      <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">Save the title, duration, and Just once or Repeat setting from the form above. Start a saved preset whenever you need it. Presets are saved on this browser.</p>
      {editingId && <div className="ui-badge ui-badge--warning mt-3 flex flex-wrap items-center gap-3 p-3 text-sm">
        <p>Edit the form above, then choose Save preset changes.</p>
        <button type="button" onClick={() => { setEditingId(null); setMessage('Preset editing cancelled.'); setError(''); }} className={buttonClass}>Cancel editing</button>
      </div>}
      {error && <p role="alert" className="ui-badge ui-badge--danger mt-3 text-sm">{error}</p>}
      <p role="status" className="mt-2 text-sm font-semibold">{message}</p>
      {presets.length === 0 ? <p className="ui-card mt-3 border-dashed p-4 text-sm text-[var(--color-text-muted)]">No saved presets yet. Try “Drink water” every 45 minutes or “Check the oven” after 30 minutes.</p> : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {presets.map((preset) => (
            <li key={preset.id} className="ui-card p-4">
              <p className="break-words font-bold">{preset.title}</p>
              <p className="mt-1 text-xs font-semibold text-[var(--color-text-secondary)]">{preset.repeats ? 'Repeating · Every' : 'Just once · After'} {formatReminderInterval(preset.duration)}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" aria-label={`Start preset ${preset.title}`} onClick={() => {
                  addReminder(preset.title, preset.duration, preset.repeats);
                  setMessage(`Started ${preset.title}${preset.repeats ? ', repeating every' : ', due after'} ${formatReminderInterval(preset.duration)}.`);
                  setError('');
                }} className="ui-button ui-button--primary ui-button--sm">Start</button>
                <button type="button" aria-label={`Edit preset ${preset.title}`} onClick={() => { setEditingId(preset.id); setError(''); setMessage(''); onEdit(preset); }} className={buttonClass}>Edit</button>
                <button type="button" aria-label={`Delete preset ${preset.title}`} onClick={() => remove(preset)} className={buttonClass}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {removed && <button type="button" className={`${buttonClass} mt-3`} onClick={() => {
        if (persist([...presets, removed])) { setMessage(`Restored preset: ${removed.title}.`); setRemoved(null); }
      }}>Undo delete</button>}
    </section>
  );
}
