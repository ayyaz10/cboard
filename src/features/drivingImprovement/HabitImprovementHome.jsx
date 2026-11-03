import { useEffect, useRef, useState } from 'react';
import { navigateTo } from '../../app/useRoute.js';
import { AppNavigation } from '../../components/layout/AppNavigation.jsx';
import { PageShell } from '../../components/layout/PageShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.jsx';
import { Dialog } from '../../components/ui/Dialog.jsx';
import { notify } from '../../lib/notifications.js';
import { loadDrivingWorkspace, saveDrivingWorkspace, getCachedDrivingWorkspace, publishCachedDrivingWorkspace } from '../../services/drivingImprovementService.js';
import { BACKLOG_TYPE_LABELS, BACKLOG_TYPES, HABIT_STATUS_LABELS, HABIT_STATUSES, IMPROVEMENT_PRIORITIES, getActiveHabits, getBacklogItems, getHabitSummary, getItemsForHabit, makeBacklogItem, makeHabitArea, promoteBacklogItem, moveHabitToBacklog, archiveHabitArea, removeHabitArea, archiveBacklogEntry, deleteBacklogEntry, validateHabitData } from './drivingData.js';
import './drivingImprovement.css';

export function HabitImprovementHome({ userId, view = 'active' }) {
  const [cached] = useState(() => getCachedDrivingWorkspace(userId));
  const [data, setData] = useState(cached?.data || null), [revision, setRevision] = useState(cached?.revision || 0), [loading, setLoading] = useState(!cached), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [dialog, setDialog] = useState(null), [form, setForm] = useState({ name: '', description: '' }), [confirmHabit, setConfirmHabit] = useState(null), [habitSearch, setHabitSearch] = useState('');
  const [backlogForm, setBacklogForm] = useState({ title: '', note: '', type: '', priority: '' }), [backlogQuery, setBacklogQuery] = useState(''), [showPromoted, setShowPromoted] = useState(false), [confirmBacklog, setConfirmBacklog] = useState(null), [moveHabit, setMoveHabit] = useState(null), [archiveHabit, setArchiveHabit] = useState(null);
  const lock = useRef(false), active = useRef(true);

  async function reload(force = false) {
    if (!data) setLoading(true); setError('');
    try { const result = await loadDrivingWorkspace(userId, 0, force); if (active.current) { setData(result.data); setRevision(result.revision); } }
    catch (err) { if (active.current) setError(err.message || 'Could not load Habit Improvement.'); }
    finally { if (active.current) setLoading(false); }
  }
  useEffect(() => { active.current = true; reload(); return () => { active.current = false; }; }, [userId]);

  async function commit(nextData, successMessage) {
    if (lock.current || !data) return false;
    lock.current = true; setBusy(true); setError('');
    const prior = data;
    try {
      const safe = validateHabitData(nextData); setData(safe); publishCachedDrivingWorkspace(userId, safe, revision);
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
  async function pauseHabit(habit) {
    if (await commit(moveHabitToBacklog(data, habit.id), 'Moved to Backlog. Your improvement tree was preserved.')) setMoveHabit(null);
  }
  async function archiveArea(habit) {
    if (await commit(archiveHabitArea(data, habit.id), 'Habit archived. Its improvement data is preserved.')) setArchiveHabit(null);
  }

  function openBacklogItem(item = null) {
    setBacklogForm({ title: item?.title || '', note: item?.note || '', type: item?.type || '', priority: item?.priority || '' });
    setDialog({ type: item ? 'edit-backlog' : 'add-backlog', item });
  }
  async function saveBacklogItem(event) {
    event.preventDefault();
    const title = backlogForm.title.trim();
    if (!title || title.length > 160 || busy) return;
    const now = new Date().toISOString();
    const item = dialog.type === 'edit-backlog'
      ? { ...dialog.item, ...backlogForm, title, note: backlogForm.note.trim(), type: backlogForm.type || null, priority: backlogForm.priority || null, updatedAt: now }
      : makeBacklogItem({ ...backlogForm, title }, userId, now);
    const backlogItems = dialog.type === 'edit-backlog' ? data.backlogItems.map(saved => saved.id === item.id ? item : saved) : [...data.backlogItems, item];
    if (await commit({ ...data, backlogItems }, dialog.type === 'edit-backlog' ? 'Idea updated.' : 'Idea saved.')) { setDialog(null); setBacklogForm({ title: '', note: '', type: '', priority: '' }); }
  }
  async function promote(item) {
    if (busy || lock.current) return;
    const result = promoteBacklogItem(data, item.id, dialog.habitName, userId);
    if (await commit(result.data, result.resumed ? 'Your previous improvement work is active again.' : 'Improvement area started.')) {
      setDialog(null);
      let lastNode = '';
      if (result.resumed) { try { lastNode = sessionStorage.getItem(`habit-ui:${userId}:${result.habit.slug}:lastNode`) || ''; } catch {} }
      navigateTo(`/habit-improvement/${result.habit.slug}${lastNode ? `/${encodeURIComponent(lastNode)}` : ''}`);
    }
  }
  async function archiveIdea(item) {
    if (await commit(archiveBacklogEntry(data, item.id), 'Idea archived.')) setConfirmBacklog(null);
  }
  async function deleteIdea(item) {
    if (await commit(deleteBacklogEntry(data, item.id), item.promotedHabitId ? 'Backlog item and its Habit data deleted.' : 'Idea deleted.')) setConfirmBacklog(null);
  }

  const habits = data ? getActiveHabits(data).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const habitQuery = habitSearch.trim().toLocaleLowerCase();
  const visibleHabits = habits.filter(habit => !habitQuery || `${habit.name} ${habit.description || ''}`.toLocaleLowerCase().includes(habitQuery));
  const backlogPriorityRank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const backlogItems = data ? getBacklogItems(data).sort((a, b) => (backlogPriorityRank[a.priority] ?? 3) - (backlogPriorityRank[b.priority] ?? 3) || b.createdAt.localeCompare(a.createdAt)) : [];
  const shownBacklog = backlogItems.filter(item => !backlogQuery.trim() || `${item.title} ${item.note}`.toLocaleLowerCase().includes(backlogQuery.trim().toLocaleLowerCase()));
  const promotedItems = (data?.backlogItems || []).filter(item => item.state === 'PROMOTED');
  const confirmBacklogHabit = confirmBacklog?.item?.promotedHabitId ? data?.habits.find(habit => habit.id === confirmBacklog.item.promotedHabitId) : null;
  const confirmBacklogCount = confirmBacklogHabit ? getItemsForHabit(data, confirmBacklogHabit.id).length : 0;
  const confirmBacklogMessage = !confirmBacklog ? '' : confirmBacklog.type === 'archive' && confirmBacklogHabit
    ? `“${confirmBacklog.item.title}” and its Habit will be hidden from Active and Backlog. Its ${confirmBacklogCount} improvements and notes will remain archived.`
    : `“${confirmBacklog.item.title}” will be ${confirmBacklog.type === 'archive' ? 'moved to archive' : confirmBacklogHabit ? `permanently deleted with its Habit and ${confirmBacklogCount} improvements and their notes` : 'permanently removed'}.`;
  return <PageShell><section className="panel driving-improvement p-5 sm:p-8 lg:p-10"><AppNavigation activePath="/habit-improvement" />
    <header className="di-heading"><div><span className="pill">Personal improvement tracker</span><h1>Habit Improvement</h1><p>Understand patterns. Change one thing at a time.</p></div>
      <div className="di-heading-actions di-heading-actions-single">{view === 'backlog' ? <Button variant="primary" onClick={() => openBacklogItem()} disabled={!data}>+ Add idea</Button> : <Button variant="primary" onClick={() => openHabit()} disabled={!data}>+ Add Habit</Button>}</div>
    </header>
    <nav className="di-home-tabs" aria-label="Habit Improvement views"><Button variant={view === 'backlog' ? 'secondary' : 'primary'} aria-current={view !== 'backlog' ? 'page' : undefined} onClick={() => navigateTo('/habit-improvement')}>Active · {habits.length}</Button><Button variant={view === 'backlog' ? 'primary' : 'secondary'} aria-current={view === 'backlog' ? 'page' : undefined} onClick={() => navigateTo('/habit-improvement/backlog')}>Backlog · {backlogItems.length}</Button></nav>
    {error && <div className="di-error" role="alert"><span>{error}</span>{(!data || /changed on another device/i.test(error)) && <Button onClick={() => reload(true)}>{data ? 'Refresh data' : 'Retry'}</Button>}</div>}
    {loading && <p role="status" className="di-muted">Loading improvement areas...</p>}
    {!loading && !data && !error && <p className="di-muted">Habit Improvement could not be loaded.</p>}
    {busy && <p className="di-saving" role="status">Saving...</p>}
    {data && view === 'backlog' && <section className="di-habit-section di-backlog" aria-labelledby="di-backlog-heading"><div className="di-section-head"><div><span className="di-eyebrow">Maybe later</span><h2 id="di-backlog-heading">Improvement Backlog</h2></div></div>
      {backlogItems.length > 2 && <label className="di-search"><span className="sr-only">Search ideas</span><input type="search" value={backlogQuery} onChange={event => setBacklogQuery(event.target.value)} placeholder="Search ideas..." /></label>}
      {shownBacklog.length ? <div className="di-backlog-list">{shownBacklog.map(item => <article className="di-backlog-item" key={item.id}><div className="di-backlog-copy"><h3>{item.title}</h3><p>{[item.promotedHabitId ? 'Previously active' : item.type && BACKLOG_TYPE_LABELS[item.type], item.priority && `${item.priority[0]}${item.priority.slice(1).toLowerCase()} priority`].filter(Boolean).join(' · ') || 'Idea'}{item.note && <span className="di-backlog-note"> · {item.note}</span>}</p></div><div className="di-backlog-actions"><Button variant="primary" onClick={() => setDialog({ type: 'promote', item, habitName: item.promotedHabitId ? data.habits.find(habit => habit.id === item.promotedHabitId)?.name || item.title : /\bimprovement$/i.test(item.title) ? item.title : `${item.title} Improvement` })}>{item.promotedHabitId ? 'Resume Improving' : 'Start Improving'}</Button><details className="di-overflow"><summary>More</summary><div><Button onClick={() => openBacklogItem(item)}>Edit</Button><Button onClick={() => setConfirmBacklog({ type: 'archive', item })}>Archive</Button><Button variant="danger" onClick={() => setConfirmBacklog({ type: 'delete', item })}>Delete</Button></div></details></div></article>)}</div> : <div className="di-empty"><h3>{backlogItems.length ? 'No matching ideas.' : 'Your Backlog is empty.'}</h3><p>{backlogItems.length ? 'Try another search or clear it.' : 'Add habits, skills or behaviors you may want to improve later.'}</p>{backlogItems.length ? <Button onClick={() => setBacklogQuery('')}>Clear search</Button> : <Button variant="primary" onClick={() => openBacklogItem()}>+ Add idea</Button>}</div>}
      {promotedItems.length > 0 && <div className="di-promoted-history"><Button onClick={() => setShowPromoted(value => !value)}>{showPromoted ? 'Hide' : 'Show'} started ideas · {promotedItems.length}</Button>{showPromoted && <div className="di-backlog-list">{promotedItems.map(item => { const habit = data.habits.find(saved => saved.id === item.promotedHabitId); return <article className="di-backlog-item di-backlog-promoted" key={item.id}><div className="di-backlog-copy"><h3>{item.title}</h3><p>Started {new Date(item.promotedAt).toLocaleDateString()}</p></div>{habit && <Button onClick={() => navigateTo(`/habit-improvement/${habit.slug}`)}>Open {habit.name}</Button>}</article>; })}</div>}</div>}
    </section>}
    {data && view !== 'backlog' && <section className="di-habit-section" aria-labelledby="di-areas-heading"><div className="di-section-head"><div><span className="di-eyebrow">Your improvement areas</span><h2 id="di-areas-heading">Habits and patterns</h2></div></div>
      {habits.length > 0 && <label className="di-search"><span className="sr-only">Search all habits</span><input type="search" value={habitSearch} onChange={event => setHabitSearch(event.target.value)} placeholder="Search habits..." /></label>}
      {visibleHabits.length ? <div className="di-habit-grid">{visibleHabits.map(habit => {
        const items = getItemsForHabit(data, habit.id), summary = getHabitSummary(items);
        return <article className="di-habit-card" key={habit.id}>
          <span className="di-category">Habit / improvement area</span><h3>{habit.name}</h3>
          {habit.description && <p className="di-habit-description">{habit.description}</p>}
          <p className="di-habit-total">{summary.total} {summary.total === 1 ? 'thing' : 'things'} to improve</p>
          <div className="di-habit-statuses" aria-label={`${habit.name} status summary`}>{HABIT_STATUSES.map(status => <span key={status}><strong>{summary[status]}</strong> {HABIT_STATUS_LABELS[status]}</span>)}</div>
          <p className="di-habit-focus">Focus: {items.filter(item => item.focusNow && !item.archivedAt).length}</p>
          <div className="di-habit-actions"><Button variant="primary" onClick={() => navigateTo(`/habit-improvement/${habit.slug}`)}>Open</Button><details className="di-overflow"><summary>More</summary><div><Button onClick={() => setMoveHabit(habit)}>Move to Backlog</Button><Button onClick={() => setArchiveHabit(habit)}>Archive Habit</Button><Button onClick={() => openHabit(habit)}>Edit habit</Button><Button variant="danger" onClick={() => setConfirmHabit(habit)}>Delete</Button></div></details></div>
        </article>;
      })}</div> : habits.length ? <div className="di-empty"><h3>No matching habits.</h3><p>Try another search or clear the search field.</p><Button onClick={() => setHabitSearch('')}>Clear search</Button></div> : <div className="di-empty"><h3>No active improvements.</h3><p>Start improving something from your Backlog or create a new Habit.</p><div className="di-actions"><Button onClick={() => navigateTo('/habit-improvement/backlog')}>Browse Backlog</Button><Button variant="primary" onClick={() => openHabit()}>+ New Habit</Button></div></div>}
    </section>}
  </section>

  <Dialog open={dialog?.type === 'create' || dialog?.type === 'edit'} onClose={() => setDialog(null)} labelledBy="di-habit-title" className="di-dialog"><h2 id="di-habit-title">{dialog?.type === 'edit' ? 'Edit habit' : 'Add habit'}</h2><form className="di-form" onSubmit={saveHabit}>
    <label>Name<input autoFocus required maxLength={100} value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} /></label>
    <label>Description (optional)<textarea rows="3" maxLength={2000} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} /></label>
    <div className="di-actions"><Button variant="primary" type="submit" disabled={busy || !form.name.trim()}>{dialog?.type === 'edit' ? 'Save changes' : 'Create Habit'}</Button><Button type="button" onClick={() => setDialog(null)}>Cancel</Button></div>
  </form></Dialog>

  <Dialog open={dialog?.type === 'add-backlog' || dialog?.type === 'edit-backlog'} onClose={() => setDialog(null)} labelledBy="di-backlog-form-title" className="di-dialog"><h2 id="di-backlog-form-title">{dialog?.type === 'edit-backlog' ? 'Edit idea' : 'Add an idea'}</h2><form className="di-form" onSubmit={saveBacklogItem}>
    <label>Title<input autoFocus required maxLength={160} value={backlogForm.title} onChange={event => setBacklogForm(current => ({ ...current, title: event.target.value }))} /></label>
    <label>Note (optional)<textarea rows="2" maxLength={2000} value={backlogForm.note} onChange={event => setBacklogForm(current => ({ ...current, note: event.target.value }))} /></label>
    <details className="di-optional-fields"><summary>More options</summary><div className="di-backlog-meta-fields"><label>Type (optional)<select value={backlogForm.type} onChange={event => setBacklogForm(current => ({ ...current, type: event.target.value }))}><option value="">No type</option>{BACKLOG_TYPES.map(type => <option key={type} value={type}>{BACKLOG_TYPE_LABELS[type]}</option>)}</select></label><label>Priority (optional)<select value={backlogForm.priority} onChange={event => setBacklogForm(current => ({ ...current, priority: event.target.value }))}><option value="">No priority</option>{IMPROVEMENT_PRIORITIES.map(priority => <option key={priority} value={priority}>{priority[0]}{priority.slice(1).toLowerCase()}</option>)}</select></label></div></details>
    <div className="di-actions"><Button variant="primary" type="submit" disabled={busy || !backlogForm.title.trim()}>{dialog?.type === 'edit-backlog' ? 'Save changes' : 'Save idea'}</Button><Button type="button" onClick={() => setDialog(null)}>Cancel</Button></div>
  </form></Dialog>

  <Dialog open={dialog?.type === 'promote'} onClose={() => setDialog(null)} labelledBy="di-promote-title" className="di-dialog"><h2 id="di-promote-title">Start improving</h2><p className="di-muted">This creates an active Habit Improvement area. You can add recursive improvements after it is created.</p><form className="di-form" onSubmit={event => { event.preventDefault(); promote(dialog.item); }}><label>Habit Improvement name<input autoFocus required maxLength={100} value={dialog?.habitName || ''} onChange={event => setDialog(current => ({ ...current, habitName: event.target.value }))} /></label>{dialog?.item?.note && <p className="di-backlog-note">Your note will be saved as the habit description: {dialog.item.note}</p>}<div className="di-actions"><Button variant="primary" type="submit" disabled={busy || !dialog?.habitName?.trim()}>Start Improving</Button><Button type="button" onClick={() => setDialog(null)}>Cancel</Button></div></form></Dialog>

  <Dialog open={Boolean(moveHabit)} onClose={() => setMoveHabit(null)} labelledBy="di-move-backlog-title" className="di-dialog di-transition-dialog"><h2 id="di-move-backlog-title">Move “{moveHabit?.name}” to Backlog?</h2><p>Your improvement tree, notes, statuses and progress will be preserved. It will be removed from Active Habits and Quick Review until you resume improving it.</p><div className="di-actions"><Button variant="primary" onClick={() => moveHabit && pauseHabit(moveHabit)} disabled={busy}>Move to Backlog</Button><Button onClick={() => setMoveHabit(null)}>Cancel</Button></div></Dialog>
  <Dialog open={Boolean(archiveHabit)} onClose={() => setArchiveHabit(null)} labelledBy="di-archive-habit-title" className="di-dialog di-transition-dialog"><h2 id="di-archive-habit-title">Archive “{archiveHabit?.name}”?</h2><p>This removes the Habit from Active and Backlog. Its improvement tree, notes and progress remain preserved in your data.</p><div className="di-actions"><Button variant="primary" onClick={() => archiveHabit && archiveArea(archiveHabit)} disabled={busy}>Archive Habit</Button><Button onClick={() => setArchiveHabit(null)}>Cancel</Button></div></Dialog>

  <ConfirmDialog isOpen={Boolean(confirmHabit)} title="Delete habit?" message={confirmHabit ? `${confirmHabit.name} contains ${getItemsForHabit(data, confirmHabit.id).length} improvements. Deleting it will remove those tracker records.` : ''} confirmLabel="Delete Habit" onCancel={() => setConfirmHabit(null)} onConfirm={() => confirmHabit && deleteHabit(confirmHabit)} />
  <ConfirmDialog isOpen={Boolean(confirmBacklog)} title={confirmBacklog?.type === 'archive' ? 'Archive idea?' : 'Delete idea?'} message={confirmBacklogMessage} confirmLabel={confirmBacklog?.type === 'archive' ? 'Archive idea' : confirmBacklogHabit ? 'Delete idea & Habit' : 'Delete idea'} onCancel={() => setConfirmBacklog(null)} onConfirm={() => confirmBacklog?.type === 'archive' ? archiveIdea(confirmBacklog.item) : confirmBacklog && deleteIdea(confirmBacklog.item)} />
  </PageShell>;
}
