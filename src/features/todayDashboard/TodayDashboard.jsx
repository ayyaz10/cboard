import { useCallback, useEffect, useRef, useState } from 'react';
import { requireSupabase } from '../../lib/supabaseClient.js';
import { completeReminder, deleteReminder, listReminders, updateReminder } from '../../services/reminderService.js';
import { completeTask, deleteTask, listTasks, updateTask } from '../../services/taskService.js';
import { localDateTimeToInstant } from '../../services/reminderDateTime.js';
import { getAppHref } from '../../app/useRoute.js';
import { buildAttentionItems } from '../myLife/lifeOverview.js';
import { formatMoney } from '../finance/financeMath.js';
import { Button } from '../../components/ui/Button.jsx';
import { Dialog } from '../../components/ui/Dialog.jsx';
import { FormField } from '../../components/ui/FormField.jsx';
import { getAvailablePinnedTools } from './dashboardWidgets.js';
import { DASHBOARD_PAGE_SIZE, getGreeting, getTodayWindow, getTimelineWindow, formatReminderTime, formatTodayDate } from './todayDashboard.js';
import './todayDashboard.css';

function itemKey(item) { return `${item.type}:${item.id}`; }
function sortItems(items, now) {
  const unique = new Map(items.map(item => [itemKey(item), item]));
  return [...unique.values()].sort((a, b) => {
    const aDue = a.dueAt ? Date.parse(a.dueAt) : Infinity, bDue = b.dueAt ? Date.parse(b.dueAt) : Infinity;
    const aLate = !a.completedAt && aDue <= now.getTime(), bLate = !b.completedAt && bDue <= now.getTime();
    return Number(bLate) - Number(aLate) || aDue - bDue || ({ high: 0, normal: 1, low: 2 }[a.priority] ?? 1) - ({ high: 0, normal: 1, low: 2 }[b.priority] ?? 1) || a.id.localeCompare(b.id) || a.type.localeCompare(b.type);
  });
}
function dateTimeParts(item) {
  if (!item.dueAt) return { date: '', time: '' };
  const d = new Date(item.dueAt), pad = n => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
const VIEWS = [['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'Next 7 Days'], ['all', 'All Tasks']];

export function TodayDashboard({ userId, onOpenModules, onRefreshReady, lifeSections = {}, onRefreshLife, layout, calculators = [], onCustomize, customizationDisabled = false }) {
  const [view, setView] = useState('today'), [items, setItems] = useState([]), [cursors, setCursors] = useState({ task: null, reminder: null });
  const [loading, setLoading] = useState(true), [loadingMore, setLoadingMore] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(() => new Set()), [editing, setEditing] = useState(null), [edit, setEdit] = useState({}), [showAllAttention, setShowAllAttention] = useState(false);
  const req = useRef(null), sequence = useRef(0), accountEpoch = useRef(0), owner = useRef(userId), refreshRef = useRef(null);
  const refresh = useCallback(() => {
    if (req.current) return req.current;
    const account = userId, seq = ++sequence.current, current = new Date(), range = getTimelineWindow(view, current);
    setNow(current); setError(''); if (!items.length) setLoading(true);
    const operation = Promise.all([
      listTasks({ ...range, limit: DASHBOARD_PAGE_SIZE }),
      listReminders({ startAt: range.startAt, endAt: range.endAt, limit: DASHBOARD_PAGE_SIZE }),
    ]).then(([taskPage, reminderPage]) => {
      if (owner.current !== account || sequence.current !== seq) return null;
      const merged = [...taskPage.items.map(item => ({ ...item, type: 'task' })), ...reminderPage.items.map(item => ({ ...item, type: 'reminder', description: '', priority: 'normal' }))];
      setItems(sortItems(merged, current)); setCursors({ task: taskPage.nextCursor, reminder: reminderPage.nextCursor }); return merged;
    }).catch(problem => { if (owner.current === account && sequence.current === seq) setError(problem?.message || 'Tasks and reminders could not be loaded.'); return null; })
      .finally(() => { if (owner.current === account && sequence.current === seq) setLoading(false); });
    req.current = operation; operation.finally(() => { if (req.current === operation) req.current = null; }); return operation;
  }, [userId, view, items.length]);
  refreshRef.current = refresh;
  useEffect(() => { if (!onRefreshReady) return undefined; onRefreshReady(() => () => refreshRef.current?.()); return () => onRefreshReady(() => () => {}); }, [onRefreshReady]);
  useEffect(() => {
    owner.current = userId; sequence.current++; accountEpoch.current++; req.current = null;
    setItems([]); setCursors({ task: null, reminder: null }); setLoading(true); setError(''); setMessage(''); setBusy(new Set()); setEditing(null); setEdit({}); setView('today');
  }, [userId]);
  useEffect(() => { sequence.current++; req.current = null; setLoading(true); refresh(); return () => { sequence.current++; req.current = null; }; }, [userId, view]);
  useEffect(() => {
    const visibility = () => { if (document.visibilityState === 'visible') refreshRef.current?.(); };
    window.addEventListener('focus', visibility); document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('focus', visibility); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => {
    if (!userId) return undefined;
    let client; try { client = requireSupabase(); } catch { return undefined; }
    const channel = client.channel(`board-timeline:${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'user_tasks', filter: `user_id=eq.${userId}` }, () => refreshRef.current?.()).on('postgres_changes', { event: '*', schema: 'public', table: 'user_reminders', filter: `user_id=eq.${userId}` }, () => refreshRef.current?.()).subscribe();
    return () => { client.removeChannel(channel); };
  }, [userId]);

  async function loadMore() {
    if (loadingMore || (!cursors.task && !cursors.reminder)) return;
    const account = userId, seq = sequence.current; setLoadingMore(true); setError('');
    try {
      const range = getTimelineWindow(view, now);
      const [taskPage, reminderPage] = await Promise.all([
        cursors.task ? listTasks({ ...range, after: cursors.task, limit: DASHBOARD_PAGE_SIZE }) : Promise.resolve({ items: [], nextCursor: null }),
        cursors.reminder ? listReminders({ ...range, after: cursors.reminder, limit: DASHBOARD_PAGE_SIZE }) : Promise.resolve({ items: [], nextCursor: null }),
      ]);
      if (owner.current !== account || sequence.current !== seq) return;
      setItems(current => sortItems([...current, ...taskPage.items.map(item => ({ ...item, type: 'task' })), ...reminderPage.items.map(item => ({ ...item, type: 'reminder', description: '', priority: 'normal' }))], now));
      setCursors({ task: taskPage.nextCursor, reminder: reminderPage.nextCursor });
    } catch (problem) { if (owner.current === account && sequence.current === seq) setError(problem?.message || 'More items could not be loaded.'); }
    finally { if (owner.current === account && sequence.current === seq) setLoadingMore(false); }
  }
  async function complete(item) {
    const key = itemKey(item), account = userId, epoch = accountEpoch.current; if (busy.has(key)) return;
    setBusy(current => new Set(current).add(key)); setError('');
    try {
      if (item.type === 'task') await completeTask(item.id); else await completeReminder(item.id);
      if (owner.current !== account || accountEpoch.current !== epoch) return;
      setMessage(`${item.type === 'task' ? 'Task' : 'Reminder'} completed.`); await refresh();
    } catch (problem) {
      if (owner.current === account && accountEpoch.current === epoch) { setError(problem?.message || 'Completion could not be confirmed. Refresh and retry.'); await refresh(); }
    } finally { if (owner.current === account && accountEpoch.current === epoch) setBusy(current => { const next = new Set(current); next.delete(key); return next; }); }
  }
  function beginEdit(item) { const parts = dateTimeParts(item); setEditing(item); setEdit({ ...parts, title: item.title, description: item.description || '', priority: item.priority || 'normal' }); setError(''); }
  async function saveEdit(event) {
    event.preventDefault(); if (!editing) return;
    const key = itemKey(editing), account = userId, epoch = accountEpoch.current; if (busy.has(key)) return;
    setBusy(current => new Set(current).add(key)); setError('');
    try {
      let dueAt = null;
      if (edit.date || edit.time) { if (!edit.date || !edit.time) throw new Error('Choose both a date and time, or clear both fields.'); dueAt = localDateTimeToInstant(edit.date, edit.time); }
      if (editing.type === 'reminder' && !dueAt) throw new Error('A reminder needs a date and time.');
      if (editing.type === 'task') await updateTask({ id: editing.id, expectedUpdatedAt: editing.updatedAt, title: edit.title.trim(), description: edit.description.trim(), priority: edit.priority, dueAt });
      else await updateReminder({ id: editing.id, expectedUpdatedAt: editing.updatedAt, title: edit.title.trim(), dueAt });
      if (owner.current !== account || accountEpoch.current !== epoch) return;
      setEditing(null); setMessage(`${editing.type === 'task' ? 'Task' : 'Reminder'} updated.`); await refresh();
    } catch (problem) { if (owner.current === account && accountEpoch.current === epoch) setError(problem?.message || 'Changes could not be saved. Refresh and try again.'); }
    finally { if (owner.current === account && accountEpoch.current === epoch) setBusy(current => { const next = new Set(current); next.delete(key); return next; }); }
  }
  async function remove(item) {
    if (!window.confirm(`Delete ${item.title}?`)) return;
    const key = itemKey(item), account = userId, epoch = accountEpoch.current; setBusy(current => new Set(current).add(key)); setError('');
    try {
      if (item.type === 'task') await deleteTask(item.id, item.updatedAt); else await deleteReminder(item.id, item.updatedAt);
      if (owner.current !== account || accountEpoch.current !== epoch) return;
      setMessage(`${item.type === 'task' ? 'Task' : 'Reminder'} deleted.`); await refresh();
    } catch (problem) { if (owner.current === account && accountEpoch.current === epoch) { setError(problem?.message || 'Delete could not be confirmed. Refresh and try again.'); await refresh(); } }
    finally { if (owner.current === account && accountEpoch.current === epoch) setBusy(current => { const next = new Set(current); next.delete(key); return next; }); }
  }
  async function snooze(item) {
    const key = itemKey(item), account = userId, epoch = accountEpoch.current; if (busy.has(key)) return;
    setBusy(current => new Set(current).add(key)); setError('');
    try {
      const dueAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await updateReminder({ id: item.id, expectedUpdatedAt: item.updatedAt, title: item.title, dueAt });
      if (owner.current !== account || accountEpoch.current !== epoch) return;
      setMessage('Reminder snoozed for 10 minutes.'); await refresh();
    } catch (problem) { if (owner.current === account && accountEpoch.current === epoch) { setError(problem?.message || 'Reminder could not be snoozed. Refresh and retry.'); await refresh(); } }
    finally { if (owner.current === account && accountEpoch.current === epoch) setBusy(current => { const next = new Set(current); next.delete(key); return next; }); }
  }

  const todayWindow = getTodayWindow(now), todayStart = Date.parse(todayWindow.startAt), todayEnd = Date.parse(todayWindow.endAt);
  const todayItems = items.filter(item => item.dueAt && Date.parse(item.dueAt) >= todayStart && Date.parse(item.dueAt) < todayEnd), dueToday = items.filter(item => item.dueAt && Date.parse(item.dueAt) < todayEnd && !item.completedAt);
  const next = sortItems(dueToday, now)[0], completedToday = todayItems.filter(item => item.completedAt).length;
  const dateLabel = formatTodayDate(now), heading = VIEWS.find(([id]) => id === view)?.[1] || 'Today';
  const attention = buildAttentionItems({ items, finance: lifeSections.finance?.status === 'ready' ? lifeSections.finance.data : null, training: lifeSections.training?.status === 'ready' ? lifeSections.training.data : null, now });
  const visibleWidgets = new Set((layout?.widgets || []).map(widget => widget.id));
  const order = id => (layout?.widgets || []).findIndex(widget => widget.id === id);
  const size = id => layout?.widgets?.find(widget => widget.id === id)?.size || 'compact';

  return <section className="today-dashboard" aria-labelledby="today-dashboard-title">
    <header className="today-dashboard-header"><div><p className="today-dashboard-date">{dateLabel}</p><h1 id="today-dashboard-title">{getGreeting(now)}</h1><p className="today-dashboard-subtitle">Your day at a glance.</p></div><div className="today-dashboard-header-actions"><Button disabled={customizationDisabled} onClick={onCustomize}>Customize Dashboard</Button><Button onClick={onOpenModules}>View modules</Button></div></header>
    <nav className="timeline-views" aria-label="Task timeline">{VIEWS.map(([id, label]) => <Button key={id} variant={view === id ? 'primary' : 'secondary'} aria-pressed={view === id} onClick={() => setView(id)}>{label}</Button>)}</nav>
    {error && <div className="today-dashboard-alert" role="alert"><span>{error}</span><Button onClick={refresh}>Retry</Button></div>}{message && <p className="today-dashboard-status" role="status">{message}</p>}
    <div className="today-dashboard-grid">
      {view === 'today' && visibleWidgets.has('next-action') && <section data-dashboard-widget="next-action" data-widget-size={layout?.widgets?.find(widget => widget.id === 'next-action')?.size || 'compact'} style={{ order: order('next-action') }} className="today-card today-next-card" aria-labelledby="today-next-heading"><p className="today-card-eyebrow">Next Action</p><h2 id="today-next-heading">{next ? (Date.parse(next.dueAt) <= now.getTime() ? 'Bring this back on track' : 'Up next') : 'You are all caught up'}</h2>{loading && !items.length ? <p>Loading your schedule...</p> : next ? <div className="today-next-content"><p className="today-next-title">{next.title}</p><p className={Date.parse(next.dueAt) <= now.getTime() ? 'today-reminder-overdue' : 'today-reminder-time'}>{Date.parse(next.dueAt) <= now.getTime() ? 'Overdue' : `Today at ${formatReminderTime(next.dueAt)}`}</p><Button variant="primary" disabled={busy.has(itemKey(next))} onClick={() => complete(next)}>Mark Complete</Button></div> : <p className="today-empty-copy">No incomplete items are due today.</p>}</section>}
      {view === 'today' && visibleWidgets.has('needs-attention') && <section data-dashboard-widget="needs-attention" data-widget-size={layout?.widgets?.find(widget => widget.id === 'needs-attention')?.size || 'compact'} style={{ order: order('needs-attention') }} className="today-card today-attention-card" aria-labelledby="today-attention-heading"><div className="today-card-heading"><div><p className="today-card-eyebrow">Important next steps</p><h2 id="today-attention-heading">Needs Your Attention</h2></div><span className="today-count">{attention.length}</span></div>{attention.length ? <><ul className="today-attention-list">{(showAllAttention ? attention : attention.slice(0, 3)).map(item => <li key={item.id}><div><span className="today-attention-meta">{item.urgency} / {item.source}{item.dueDate ? ` / ${item.dueDate}` : ''}</span><strong>{item.title}</strong></div><a className="today-attention-action" href={getAppHref(item.href)}>{item.action}</a></li>)}</ul>{attention.length > 3 && <Button onClick={() => setShowAllAttention(value => !value)}>{showAllAttention ? 'Show fewer' : 'View All'}</Button>}</> : <p className="today-empty-copy">Nothing else needs your attention right now.</p>}{onRefreshLife && <Button className="today-attention-refresh" onClick={onRefreshLife}>Refresh module signals</Button>}</section>}
      {visibleWidgets.has('today-agenda') && <section data-dashboard-widget="today-agenda" data-widget-size={layout?.widgets?.find(widget => widget.id === 'today-agenda')?.size || 'expanded'} style={{ order: order('today-agenda') }} className="today-card timeline-card" aria-labelledby="today-agenda-heading"><div className="today-card-heading"><div><p className="today-card-eyebrow">Your schedule</p><h2 id="today-agenda-heading">{heading} Timeline</h2></div><span className="today-count">{view === 'today' ? todayItems.length : items.length}</span></div>
        {loading && !items.length ? <p>Loading your tasks and reminders...</p> : items.length ? <ul className="today-reminder-list">{sortItems(items, now).map(item => <li key={itemKey(item)} className={item.completedAt ? 'is-completed' : ''}><div className="today-reminder-main"><span className="today-reminder-time">{item.dueAt ? formatReminderTime(item.dueAt, { month: 'short', day: 'numeric' }) : 'No due date'}</span><span className="today-reminder-name">{item.title}</span><span className="today-reminder-state">{item.type === 'task' ? 'Task' : 'Reminder'} / {item.completedAt ? 'Completed' : item.dueAt && Date.parse(item.dueAt) <= now.getTime() ? 'Overdue' : 'Upcoming'}{item.type === 'task' ? ` / ${item.priority[0].toUpperCase()}${item.priority.slice(1)}` : ''}</span></div><div className="timeline-actions">{!item.completedAt && <Button disabled={busy.has(itemKey(item))} onClick={() => complete(item)} aria-label={`Complete ${item.title}`}>Complete</Button>}<Button disabled={busy.has(itemKey(item))} onClick={() => beginEdit(item)}>Edit</Button>{item.type === 'reminder' && !item.completedAt && <Button disabled={busy.has(itemKey(item))} onClick={() => snooze(item)}>Snooze 10m</Button>}<Button disabled={busy.has(itemKey(item))} onClick={() => remove(item)}>Delete</Button></div></li>)}</ul> : <p className="today-empty-copy">{view === 'all' ? 'No tasks or reminders yet.' : 'Nothing scheduled for this time period.'}</p>}
        {view === 'today' && <div className="today-agenda-progress"><p><strong>{completedToday} / {todayItems.length}</strong> items completed today</p><progress aria-label="Today's completion" value={todayItems.length ? completedToday : 0} max={todayItems.length || 1}/></div>}
        {(cursors.task || cursors.reminder) && <Button disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Loading...' : 'Load more'}</Button>}
      </section>}
      {view === 'today' && visibleWidgets.has('finance-overview') && <FinanceWidget section={lifeSections.finance} order={order('finance-overview')} size={size('finance-overview')} />}
      {view === 'today' && visibleWidgets.has('goals-progress') && <GoalsWidget section={lifeSections.goals} order={order('goals-progress')} size={size('goals-progress')} />}
      {view === 'today' && visibleWidgets.has('training') && <TrainingWidget section={lifeSections.training} order={order('training')} size={size('training')} />}
      {view === 'today' && visibleWidgets.has('weight-health') && <HealthWidget weight={lifeSections.weight} food={lifeSections.food} order={order('weight-health')} size={size('weight-health')} onRetry={onRefreshLife} />}
      {view === 'today' && visibleWidgets.has('groceries') && <section data-dashboard-widget="groceries" data-widget-size={layout?.widgets?.find(widget => widget.id === 'groceries')?.size || 'compact'} style={{ order: order('groceries') }} className="today-card"><p className="today-card-eyebrow">Home</p><h2>Groceries</h2><p className="today-empty-copy">Open your pantry and shopping list.</p><a className="today-attention-action" href={getAppHref('/groceries')}>Open Groceries</a></section>}
      {view === 'today' && visibleWidgets.has('pinned-tools') && <PinnedToolsWidget layout={layout} calculators={calculators} order={order('pinned-tools')} size={size('pinned-tools')} />}
    </div>
    <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} labelledBy="timeline-edit-heading" className="quick-capture-dialog"><form onSubmit={saveEdit} noValidate><h2 id="timeline-edit-heading">Edit {editing?.type || 'item'}</h2><FormField label="Title" htmlFor="timeline-edit-title"><input id="timeline-edit-title" className="ui-control" maxLength={120} required value={edit.title || ''} onChange={event => setEdit(value => ({ ...value, title: event.target.value }))}/></FormField>{editing?.type === 'task' && <><FormField label="Description" htmlFor="timeline-edit-description"><textarea id="timeline-edit-description" className="ui-control" maxLength={2000} value={edit.description || ''} onChange={event => setEdit(value => ({ ...value, description: event.target.value }))}/></FormField><FormField label="Priority" htmlFor="timeline-edit-priority"><select id="timeline-edit-priority" className="ui-control" value={edit.priority || 'normal'} onChange={event => setEdit(value => ({ ...value, priority: event.target.value }))}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></FormField></> }<div className="quick-capture-datetime"><FormField label="Date" htmlFor="timeline-edit-date"><input id="timeline-edit-date" className="ui-control" type="date" value={edit.date || ''} onChange={event => setEdit(value => ({ ...value, date: event.target.value }))}/></FormField><FormField label="Time" htmlFor="timeline-edit-time"><input id="timeline-edit-time" className="ui-control" type="time" value={edit.time || ''} onChange={event => setEdit(value => ({ ...value, time: event.target.value }))}/></FormField></div>{error && <p role="alert" className="quick-capture-error">{error}</p>}<div className="quick-capture-actions"><Button type="submit" variant="primary">Save changes</Button><Button type="button" onClick={() => setEditing(null)}>Cancel</Button></div></form></Dialog>
    <p className="timeline-alert-note">Items stay visible in the timeline and refresh when reopened, returned to, or changed on another open device. This phase adds no toast or background alert for general tasks and reminders; closed apps deliver no alerts. Focus Timer alerts are unchanged.</p>
  </section>;
}

function SummaryWidget({ id, title, eyebrow, section, order, size = 'compact', onRetry, children }) {
  return <section data-dashboard-widget={id} data-widget-size={size} style={{ order }} className="today-card dashboard-summary-widget"><p className="today-card-eyebrow">{eyebrow}</p><h2>{title}</h2>{section?.status === 'loading' || !section ? <p role="status" className="today-empty-copy">Loading summary…</p> : section.status === 'error' ? <div role="alert"><p className="today-empty-copy">{section.error}</p>{onRetry && <Button onClick={onRetry}>Retry</Button>}</div> : children(section.data)}</section>;
}
function FinanceWidget({ section, order, size, onRetry }) { return <SummaryWidget id="finance-overview" title="Finance Overview" eyebrow="Money" section={section} order={order} size={size} onRetry={onRetry}>{data => <><dl className="dashboard-metrics"><div><dt>Spendable now</dt><dd>{formatMoney(data.spendable, data.currency)}</dd></div><div><dt>Debt outstanding</dt><dd>{formatMoney(data.debtOutstanding, data.currency)}</dd></div><div><dt>Income this month</dt><dd>{formatMoney(data.monthlyIncome, data.currency)}</dd></div><div><dt>Spending this month</dt><dd>{formatMoney(data.monthlyExpenses, data.currency)}</dd></div></dl><a className="today-attention-action" href={getAppHref('/finance')}>Open Finance</a></>}</SummaryWidget>; }
function GoalsWidget({ section, order, size, onRetry }) { return <SummaryWidget id="goals-progress" title="Goals & Progress" eyebrow="Progress" section={section} order={order} size={size} onRetry={onRetry}>{data => <><p className="today-empty-copy">{data.count ? `${data.count} goal${data.count === 1 ? '' : 's'} in Progress Tracker.` : 'No Progress Tracker goals yet.'}</p>{data.nextDeadline && <p className="today-empty-copy">Next target: {data.nextDeadline.title} · {new Date(`${data.nextDeadline.date}T00:00:00`).toLocaleDateString()}</p>}<a className="today-attention-action" href={getAppHref('/progress-tracker')}>Open goals</a></>}</SummaryWidget>; }
function TrainingWidget({ section, order, size, onRetry }) { return <SummaryWidget id="training" title="Training" eyebrow="Movement" section={section} order={order} size={size} onRetry={onRetry}>{data => <><p className="today-empty-copy">{!data.configured ? 'No saved Training plan is available yet.' : data.active ? 'A workout is in progress.' : data.todayPlan ? `${data.todayPlan.name} is planned today, ${data.todayPlan.exercises} exercises.` : data.upcomingPlan ? `Next planned session: ${data.upcomingPlan.name}, ${data.upcomingPlan.exercises} exercises.` : 'No exercises are scheduled in the next 7 days.'}</p>{data.recent && <p className="today-empty-copy">Recent workout: {data.recent.name} · {data.recent.sets} sets</p>}<a className="today-attention-action" href={getAppHref('/training')}>{data.active ? 'Resume Training' : 'Open Training'}</a></>}</SummaryWidget>; }
function HealthWidget({ weight, food, order, size, onRetry }) { return <section data-dashboard-widget="weight-health" data-widget-size={size} style={{ order }} className="today-card dashboard-summary-widget"><p className="today-card-eyebrow">Wellbeing</p><h2>Weight & Health</h2>{weight?.status === 'error' && <p role="alert">{weight.error}</p>}{food?.status === 'error' && <p role="alert">{food.error}</p>}{weight?.status === 'ready' ? weight.data.length ? <p className="today-empty-copy">Latest weight: {weight.data[0].weightKg} kg · {new Date(`${weight.data[0].date}T00:00:00`).toLocaleDateString()}</p> : <p className="today-empty-copy">No weigh-ins recorded yet.</p> : <p role="status">Loading weight summary…</p>}{food?.status === 'ready' ? <p className="today-empty-copy">{food.data.foodCount ? `${food.data.foodCount} foods logged across ${food.data.mealCount} meals today.` : 'No food logged today.'}</p> : <p role="status">Loading food summary…</p>}<div className="dashboard-widget-links"><a className="today-attention-action" href={getAppHref('/weight-progress')}>Weight</a><a className="today-attention-action" href={getAppHref('/food-diary')}>Food Diary</a></div></section>; }
function PinnedToolsWidget({ layout, calculators, order, size }) {
  const tools = getAvailablePinnedTools(calculators), byId = new Map(tools.map(tool => [tool.id, tool]));
  return <section data-dashboard-widget="pinned-tools" data-widget-size={size} style={{ order }} className="today-card dashboard-summary-widget"><p className="today-card-eyebrow">Your shortcuts</p><h2>Pinned Tools</h2>{layout?.pinnedTools?.length ? <ul className="pinned-tools-list">{layout.pinnedTools.map(id => byId.get(id)).filter(Boolean).map(tool => <li key={tool.id}><a href={getAppHref(tool.path)}>{tool.name}</a><span>{tool.kind === 'calculator' ? 'Calculator' : 'Module'}</span></li>)}</ul> : <p className="today-empty-copy">Pin calculators or modules while customizing your dashboard.</p>}</section>;
}
