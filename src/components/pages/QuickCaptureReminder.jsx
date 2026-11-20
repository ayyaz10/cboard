import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button.jsx';
import { Dialog } from '../ui/Dialog.jsx';
import { FormField } from '../ui/FormField.jsx';
import { createReminder, createReminderId } from '../../services/reminderService.js';
import './quickCaptureReminder.css';
import { localDateTimeToInstant } from '../../services/reminderDateTime.js';

function storageKey(userId) { return `cboard:quick-capture:${userId}:v1`; }
function createEmptyDraft() {
  const due = new Date(Date.now() + 60 * 60 * 1000);
  due.setMinutes(0, 0, 0);
  const pad = value => String(value).padStart(2, '0');
  return { title: '', date: `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`, time: `${pad(due.getHours())}:${pad(due.getMinutes())}`, attempt: null };
}

function readDraft(userId) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(userId)) || 'null');
    if (saved && typeof saved.title === 'string' && typeof saved.date === 'string' && typeof saved.time === 'string') return saved;
  } catch {}
  return createEmptyDraft();
}



export function QuickCaptureReminder({ userId }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => readDraft(userId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const titleRef = useRef(null);
  const saveLock = useRef(false);
  const ownerRef = useRef(userId);

  useEffect(() => {
    ownerRef.current = userId;
    setDraft(readDraft(userId));
    setOpen(false);
    setSaving(false);
    setError('');
    setSaved(false);
    saveLock.current = false;
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    try { localStorage.setItem(storageKey(userId), JSON.stringify(draft)); } catch { /* The in-memory draft remains available in this tab. */ }
  }, [draft, userId]);

  useEffect(() => { if (open) requestAnimationFrame(() => titleRef.current?.focus()); }, [open]);

  function changeDraft(changes) {
    setDraft(current => ({ ...current, ...changes, attempt: null }));
    setError('');
    setSaved(false);
  }

  async function submit(event, retry = false) {
    event.preventDefault();
    if (saveLock.current || !userId) return;
    const unchangedAttempt = draft.attempt && draft.attempt.title === draft.title.trim() && draft.attempt.date === draft.date && draft.attempt.time === draft.time;
    const attempt = (retry || unchangedAttempt) && draft.attempt ? draft.attempt : (() => {
      const title = draft.title.trim();
      if (!title || title.length > 120) { setError('Enter a title from 1 to 120 characters.'); return null; }
      let dueAt;
      try { dueAt = localDateTimeToInstant(draft.date, draft.time); } catch (problem) { setError(problem.message); return null; }
      if (Date.parse(dueAt) <= Date.now()) { setError('Choose a date and time in the future.'); return null; }
      return { id: createReminderId(), title, dueAt, date: draft.date, time: draft.time };
    })();
    if (!attempt) return;
    saveLock.current = true;
    setSaving(true);
    setError('');
    setSaved(false);
    setDraft(current => ({ ...current, title: attempt.title, date: attempt.date, time: attempt.time, attempt }));
    try {
      await createReminder({ id: attempt.id, title: attempt.title, dueAt: attempt.dueAt });
      if (ownerRef.current !== userId) return;
      try { localStorage.removeItem(storageKey(userId)); } catch {}
      setDraft(createEmptyDraft());
      setOpen(false);
      setSaved(true);
    } catch (problem) {
      if (ownerRef.current !== userId) return;
      setError(problem?.message || 'Reminder could not be confirmed. Keep this form open and retry.');
    } finally {
      if (ownerRef.current === userId) { saveLock.current = false; setSaving(false); }
    }
  }

  function close() {
    if (saving) return;
    setOpen(false);
  }

  return <>
    <div className="quick-capture-entry">
      <Button variant="primary" onClick={() => { setError(''); setSaved(false); setOpen(true); }}>Quick Capture</Button>
      {saved && <span role="status" className="quick-capture-saved">Reminder saved</span>}
    </div>
    <Dialog open={open} onClose={close} labelledBy="quick-capture-title" className="quick-capture-dialog">
      <form onSubmit={event => submit(event)} noValidate>
        <header className="quick-capture-heading"><div><span className="ui-eyebrow">Quick Capture</span><h2 id="quick-capture-title">New reminder</h2></div></header>
        <FormField label="Reminder title" htmlFor="quick-capture-reminder-title">
          <input ref={titleRef} id="quick-capture-reminder-title" className="ui-control" autoComplete="off" maxLength={120} required value={draft.title} onChange={event => changeDraft({ title: event.target.value })} />
        </FormField>
        <div className="quick-capture-datetime">
          <FormField label="Date" htmlFor="quick-capture-reminder-date"><input id="quick-capture-reminder-date" className="ui-control" type="date" required value={draft.date} onChange={event => changeDraft({ date: event.target.value })} /></FormField>
          <FormField label="Time" htmlFor="quick-capture-reminder-time"><input id="quick-capture-reminder-time" className="ui-control" type="time" required value={draft.time} onChange={event => changeDraft({ time: event.target.value })} /></FormField>
        </div>
        <p className="quick-capture-timezone">Saved using your device local timezone.</p>
        {error && <p className="quick-capture-error" role="alert">{error}</p>}
        <div className="quick-capture-actions">
          {draft.attempt && <Button type="button" disabled={saving} onClick={event => submit(event, true)}>{saving ? 'Saving...' : 'Retry save'}</Button>}
          <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save reminder'}</Button>
          <Button type="button" disabled={saving} onClick={close}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  </>;
}
