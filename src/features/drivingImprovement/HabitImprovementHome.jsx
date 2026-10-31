import { useEffect, useRef, useState } from 'react';
import { navigateTo } from '../../app/useRoute.js';
import { AppNavigation } from '../../components/layout/AppNavigation.jsx';
import { PageShell } from '../../components/layout/PageShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.jsx';
import { Dialog } from '../../components/ui/Dialog.jsx';
import { notify } from '../../lib/notifications.js';
import { loadDrivingWorkspace, saveDrivingWorkspace } from '../../services/drivingImprovementService.js';
import { HABIT_STATUS_LABELS, HABIT_STATUSES, getHabitSummary, getItemsForHabit, makeHabitArea, removeHabitArea, validateHabitData } from './drivingData.js';
import './drivingImprovement.css';

export function HabitImprovementHome({ userId }) {
  const [data, setData] = useState(null), [revision, setRevision] = useState(0), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [dialog, setDialog] = useState(null), [form, setForm] = useState({ name: '', description: '' }), [confirmHabit, setConfirmHabit] = useState(null);
  const lock = useRef(false), active = useRef(true);

  async function reload() {
    setLoading(true); setError('');
    try { const result = await loadDrivingWorkspace(userId); if (active.current) { setData(result.data); setRevision(result.revision); } }
    catch (err) { if (active.current) setError(err.message || 'Could not load Habit Improvement.'); }
    finally { if (active.current) setLoading(false); }
  }
  useEffect(() => { active.current = true; reload(); return () => { active.current = false; }; }, [userId]);

  async function commit(nextData, successMessage) {
    if (lock.current || !data) return false;
    lock.current = true; setBusy(true); setError('');
    const prior = data;
    try {
      const safe = validateHabitData(nextData); setData(safe);
      const nextRevision = await saveDrivingWorkspace(userId, safe, revision);
      if (active.current) { setRevision(nextRevision); if (successMessage) notify.success(successMessage); }
      return true;
    } catch (err) {
      if (active.current) { setData(prior); setError(err.message || 'Could not save your changes.'); notify.error(err.message || 'Could not save your changes.'); }
      return false;
    } finally { lock.current = false; if (active.current) setBusy(false); }
  }

  function openHabit(habit = null) {
    setForm({ name: habit?.name || '', description: habit?.description || '' });
    setDialog({ type: habit ? 'edit' : 'create', habit });
  }
  async function saveHabit(event) {
    event.preventDefault();
    const name = form.name.trim();
    if (!name || name.length > 100) return;
    const habit = dialog.type === 'edit'
      ? { ...dialog.habit, name, description: form.description.trim(), updatedAt: new Date().toISOString() }
      : makeHabitArea({ ...form, name }, data.habits, userId);
    if (await commit({ ...data, habits: dialog.type === 'edit' ? data.habits.map(saved => saved.id === habit.id ? habit : saved) : [...data.habits, habit] }, dialog.type === 'edit' ? 'Habit updated.' : 'Habit created.')) {
      setDialog(null); setForm({ name: '', description: '' });
    }
  }
  async function deleteHabit(habit) {
    if (await commit(removeHabitArea(data, habit.id), 'Habit and its improvement records deleted.')) setConfirmHabit(null);
  }

  const habits = (data?.habits || []).filter(habit => !habit.archivedAt).sort((a, b) => a.name.localeCompare(b.name));
  return <PageShell><section className="panel driving-improvement p-5 sm:p-8 lg:p-10"><AppNavigation activePath="/habit-improvement" />
    <header className="di-heading"><div><span className="pill">Personal improvement tracker</span><h1>Habit Improvement</h1><p>Understand patterns. Change one thing at a time.</p></div>
      <div className="di-heading-actions di-heading-actions-single"><Button variant="primary" onClick={() => openHabit()} disabled={!data}>+ Add Habit</Button></div>
    </header>
    {error && <div className="di-error" role="alert"><span>{error}</span>{!data && <Button onClick={reload}>Retry</Button>}</div>}
    {loading && <p role="status" className="di-muted">Loading improvement areas...</p>}
    {!loading && !data && !error && <p className="di-muted">Habit Improvement could not be loaded.</p>}
    {busy && <p className="di-saving" role="status">Saving...</p>}
    {data && <section className="di-habit-section" aria-labelledby="di-areas-heading"><div className="di-section-head"><div><span className="di-eyebrow">Your improvement areas</span><h2 id="di-areas-heading">Habits and patterns</h2></div></div>
      {habits.length ? <div className="di-habit-grid">{habits.map(habit => {
        const items = getItemsForHabit(data, habit.id), summary = getHabitSummary(items);
        return <article className="di-habit-card" key={habit.id}>
          <span className="di-category">Habit / improvement area</span><h3>{habit.name}</h3>
          {habit.description && <p className="di-habit-description">{habit.description}</p>}
          <p className="di-habit-total">{summary.total} {summary.total === 1 ? 'thing' : 'things'} to improve</p>
          <div className="di-habit-statuses" aria-label={`${habit.name} status summary`}>{HABIT_STATUSES.map(status => <span key={status}><strong>{summary[status]}</strong> {HABIT_STATUS_LABELS[status]}</span>)}</div>
          <div className="di-habit-actions"><Button variant="primary" onClick={() => navigateTo(`/habit-improvement/${habit.slug}`)}>Open</Button><Button onClick={() => openHabit(habit)}>Edit habit</Button><Button variant="danger" onClick={() => setConfirmHabit(habit)}>Delete</Button></div>
        </article>;
      })}</div> : <div className="di-empty"><h3>No improvement areas yet.</h3><p>Create an area for something you want to work on.</p><Button variant="primary" onClick={() => openHabit()}>+ Add Habit</Button></div>}
    </section>}
  </section>

  <Dialog open={dialog?.type === 'create' || dialog?.type === 'edit'} onClose={() => setDialog(null)} labelledBy="di-habit-title" className="di-dialog"><h2 id="di-habit-title">{dialog?.type === 'edit' ? 'Edit habit' : 'Add habit'}</h2><form className="di-form" onSubmit={saveHabit}>
    <label>Name<input autoFocus required maxLength={100} value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} /></label>
    <label>Description (optional)<textarea rows="3" maxLength={2000} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} /></label>
    <div className="di-actions"><Button variant="primary" type="submit" disabled={busy || !form.name.trim()}>{dialog?.type === 'edit' ? 'Save changes' : 'Create Habit'}</Button><Button type="button" onClick={() => setDialog(null)}>Cancel</Button></div>
  </form></Dialog>

  <ConfirmDialog isOpen={Boolean(confirmHabit)} title="Delete habit?" message={confirmHabit ? `${confirmHabit.name} contains ${getItemsForHabit(data, confirmHabit.id).length} improvement items and ${data.categories.filter(category => category.habitId === confirmHabit.id).length} categories. Deleting it will remove those tracker records.` : ''} confirmLabel="Delete Habit" onCancel={() => setConfirmHabit(null)} onConfirm={() => confirmHabit && deleteHabit(confirmHabit)} />
  </PageShell>;
}
