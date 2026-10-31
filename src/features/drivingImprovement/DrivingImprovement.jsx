import { useEffect, useMemo, useRef, useState } from 'react';
import { getAppHref } from '../../app/useRoute.js';
import { AppNavigation } from '../../components/layout/AppNavigation.jsx';
import { PageShell } from '../../components/layout/PageShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.jsx';
import { Dialog } from '../../components/ui/Dialog.jsx';
import { notify } from '../../lib/notifications.js';
import { loadDrivingWorkspace, saveDrivingWorkspace } from '../../services/drivingImprovementService.js';
import { HABIT_STATUS_LABELS, HABIT_STATUSES, getHabitSummary, getItemsForHabit, makeImprovementItem, sortImprovementItems, validateHabitData } from './drivingData.js';
import './drivingImprovement.css';

const blankForm = item => ({ title: item?.title || '', description: item?.description || '', categoryId: item?.categoryId || '', correction: item?.correction || '', cause: item?.cause || '', status: item?.status || 'NEEDS_WORK' });

export function HabitImprovementDetail({ userId, habitSlug }) {
  const [data, setData] = useState(null), [revision, setRevision] = useState(0), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [dialog, setDialog] = useState(null), [form, setForm] = useState(blankForm()), [categoryName, setCategoryName] = useState(''), [filter, setFilter] = useState('ALL'), [expanded, setExpanded] = useState(''), [quickReview, setQuickReview] = useState(false), [confirm, setConfirm] = useState(null);
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

  const habit = data?.habits.find(item => item.slug === habitSlug && !item.archivedAt);
  const categories = useMemo(() => data?.categories.filter(category => category.habitId === habit?.id) || [], [data, habit?.id]);
  const items = useMemo(() => habit ? getItemsForHabit(data, habit.id) : [], [data, habit?.id]);
  const summary = useMemo(() => getHabitSummary(items), [items]);
  const ordered = useMemo(() => sortImprovementItems(items), [items]);
  const shown = ordered.filter(item => filter === 'ALL' || item.status === filter);
  const reviewItems = ordered.filter(item => item.status !== 'STABLE');
  const categoryById = id => categories.find(item => item.id === id)?.name || 'Category unavailable';

  function openItem(item = null) { setForm(blankForm(item)); setDialog({ type: 'item', item }); }
  async function saveItem(event) {
    event.preventDefault();
    if (!form.title.trim() || !categories.some(category => category.id === form.categoryId)) return;
    const now = new Date().toISOString();
    const item = dialog.item ? { ...dialog.item, ...form, title: form.title.trim(), description: form.description.trim(), cause: form.cause.trim(), correction: form.correction.trim(), updatedAt: now } : makeImprovementItem(form, userId, now);
    const next = { ...data, mistakes: dialog.item ? data.mistakes.map(saved => saved.id === item.id ? item : saved) : [...data.mistakes, item] };
    if (await commit(next, dialog.item ? 'Improvement updated.' : 'Improvement added.')) { setDialog(null); setExpanded(item.id); }
  }
  async function changeStatus(item, status) {
    if (status === item.status) return;
    await commit({ ...data, mistakes: data.mistakes.map(saved => saved.id === item.id ? { ...saved, status, updatedAt: new Date().toISOString() } : saved) }, 'Status updated.');
  }
  async function deleteItem(item) {
    if (await commit({ ...data, mistakes: data.mistakes.filter(saved => saved.id !== item.id) }, 'Improvement deleted.')) { setConfirm(null); setExpanded(''); }
  }
  async function createCategory(event) {
    event.preventDefault(); const name = categoryName.trim();
    if (!name || !habit || !data) return;
    if (categories.some(item => item.name.toLowerCase() === name.toLowerCase())) { setError('A category with that name already exists in this habit.'); return; }
    const now = new Date().toISOString(), category = { id: crypto.randomUUID(), userId, habitId: habit.id, name, createdAt: now, updatedAt: now };
    if (await commit({ ...data, categories: [...data.categories, category] }, 'Category created.')) {
      setCategoryName('');
      if (dialog?.type === 'item') setForm(current => ({ ...current, categoryId: category.id }));
      setDialog(dialog?.type === 'item' ? { ...dialog, categoryDialog: false } : null);
    }
  }
  async function renameCategory(category, name) {
    const normalized = name.trim();
    if (!normalized || normalized === category.name) return true;
    if (categories.some(item => item.id !== category.id && item.name.toLowerCase() === normalized.toLowerCase())) { setError('A category with that name already exists in this habit.'); return false; }
    return commit({ ...data, categories: data.categories.map(item => item.id === category.id ? { ...item, name: normalized, updatedAt: new Date().toISOString() } : item) }, 'Category renamed.');
  }
  async function removeCategory(category) {
    if (data.mistakes.some(item => item.categoryId === category.id) || (data.reminders || []).some(item => item.categoryId === category.id)) { setError('This category still has linked items or archived notes.'); return; }
    if (await commit({ ...data, categories: data.categories.filter(item => item.id !== category.id) }, 'Category removed.')) { setDialog(null); setConfirm(null); }
  }

  const archivedNotes = data?.reminders || [];
  if (!loading && data && !habit) return <PageShell><section className="panel driving-improvement p-5 sm:p-8 lg:p-10"><AppNavigation activePath="/habit-improvement" /><div className="di-not-found"><span className="pill">Habit Improvement</span><h1>Habit not found</h1><p>This improvement area may have been deleted or archived.</p><a className="di-back-link" href={getAppHref('/habit-improvement')}>Back to Habit Improvement</a></div></section></PageShell>;

  return <PageShell><section className="panel driving-improvement p-5 sm:p-8 lg:p-10"><AppNavigation activePath="/habit-improvement" />
    <div className="di-breadcrumb"><a href={getAppHref('/habit-improvement')}>← All habits</a><span aria-hidden="true">/</span><span>{habit?.name || 'Loading habit...'}</span></div>
    {error && <div className="di-error" role="alert"><span>{error}</span>{!data && <Button onClick={reload}>Retry</Button>}</div>}
    {loading && <p role="status" className="di-muted">Loading improvement area...</p>}
    {!loading && !data && !error && <p className="di-muted">Habit Improvement could not be loaded.</p>}
    {habit && <>
      <header className="di-heading"><div><span className="pill">Habit / improvement area</span><h1>{habit.name}</h1>{habit.description && <p>{habit.description}</p>}</div>
        <div className="di-heading-actions"><Button onClick={() => setQuickReview(true)} disabled={!data}>Quick Review</Button><Button variant="primary" onClick={() => openItem()} disabled={!data}>+ Add Improvement</Button></div>
      </header>
      {busy && <p className="di-saving" role="status">Saving...</p>}
      {quickReview ? <section aria-labelledby="di-review-heading" className="di-review"><div className="di-section-head"><div><span className="di-eyebrow">Before you start</span><h2 id="di-review-heading">Quick Review</h2></div><Button onClick={() => setQuickReview(false)}>Done</Button></div>
        {reviewItems.length ? <div className="di-list">{reviewItems.map(item => <article className="di-review-card" key={item.id}><span className="di-category">{categoryById(item.categoryId)}</span><h3>{item.title}</h3><span className="di-eyebrow">What I'll do differently</span><p className="di-correction">{item.correction || 'Action not added yet'}</p></article>)}</div> : <p className="di-empty">Nothing to review right now. Add an item with Needs Work or Improving status when a pattern comes up.</p>}
      </section> : <>
        <div className="di-summary" aria-label={`${habit.name} improvement summary`}>{[['ALL', 'Total', summary.total], ...HABIT_STATUSES.map(status => [status, HABIT_STATUS_LABELS[status], summary[status]])].map(([key, label, count]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(filter === key && key !== 'ALL' ? 'ALL' : key)} className="di-stat"><span>{label}</span><strong>{count}</strong></button>)}</div>
        <div className="di-toolbar"><h2>Things to improve <span>{shown.length}</span></h2><Button onClick={() => setDialog({ type: 'categories' })}>Manage categories</Button></div>
        {shown.length ? <div className="di-list">{shown.map(item => { const isOpen = expanded === item.id; return <article className="di-card" key={item.id}>
          <button type="button" className="di-card-toggle" aria-expanded={isOpen} aria-controls={`di-details-${item.id}`} onClick={() => setExpanded(isOpen ? '' : item.id)}>
            <span className="di-category">{categoryById(item.categoryId)}</span><span className="di-card-title-row"><strong>{item.title}</strong><span className={`di-status di-status-${item.status.toLowerCase()}`}>{HABIT_STATUS_LABELS[item.status]}</span></span>
            {item.correction && <span className="di-preview"><b>What I'll do differently:</b> {item.correction}</span>}
          </button>
          {isOpen && <div id={`di-details-${item.id}`} className="di-details"><div className="di-detail-correction"><span className="di-eyebrow">What I'll do differently</span><p>{item.correction || <em>Action not added yet</em>}</p>{!item.correction && <button type="button" className="di-text-button" onClick={() => openItem(item)}>Add an action</button>}</div>
            {item.description && <div className="di-pattern"><span className="di-eyebrow">More context</span><p>{item.description}</p></div>}
            <div className="di-detail-cause"><span className="di-eyebrow">Why it happens</span><p>{item.cause || <em>Not recorded</em>}</p></div>
            <label className="di-status-control">Status<select value={item.status} disabled={busy} onChange={event => changeStatus(item, event.target.value)}>{HABIT_STATUSES.map(status => <option key={status} value={status}>{HABIT_STATUS_LABELS[status]}</option>)}</select></label>
            <div className="di-actions"><Button onClick={() => openItem(item)}>Edit</Button><Button variant="danger" onClick={() => setConfirm(item)}>Delete</Button></div>
          </div>}
        </article>; })}</div> : <div className="di-empty"><h3>{items.length ? 'No items in this status' : 'No improvements added yet.'}</h3><p>{items.length ? 'Choose another status above to see the rest.' : `Add an improvement to ${habit.name}. You can create a category while adding the first one.`}</p>{!items.length && <Button variant="primary" onClick={() => openItem()}>+ Add Improvement</Button>}</div>}
      </>}
    </>}
  </section>

  <Dialog open={dialog?.type === 'item'} onClose={() => setDialog(null)} labelledBy="di-item-title" className="di-dialog"><h2 id="di-item-title">{dialog?.item ? 'Edit improvement' : 'Add improvement'}</h2><form className="di-form" onSubmit={saveItem}>
    <label>Thing to improve<input autoFocus required maxLength={160} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label>
    <label>More context (optional)<textarea rows="2" maxLength={2000} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
    <label>Category<select required value={form.categoryId} onChange={event => setForm({ ...form, categoryId: event.target.value })}><option value="">Choose category</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
    <button type="button" className="di-text-button" onClick={() => { setCategoryName(''); setDialog(current => ({ ...current, categoryDialog: true })); }}>+ New category</button>
    <label>Why does it happen?<textarea rows="2" maxLength={5000} value={form.cause} onChange={event => setForm({ ...form, cause: event.target.value })} /></label>
    <label>What will I do differently?<textarea rows="3" maxLength={5000} value={form.correction} onChange={event => setForm({ ...form, correction: event.target.value })} placeholder="Add an action now or later" /></label>
    <label>Status<select value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}>{HABIT_STATUSES.map(status => <option key={status} value={status}>{HABIT_STATUS_LABELS[status]}</option>)}</select></label>
    <div className="di-actions"><Button variant="primary" type="submit" disabled={busy || !form.categoryId}>{dialog?.item ? 'Save changes' : 'Add Improvement'}</Button><Button type="button" onClick={() => setDialog(null)}>Cancel</Button></div>
  </form></Dialog>

  <Dialog open={dialog?.type === 'item' && dialog.categoryDialog} onClose={() => setDialog(current => ({ ...current, categoryDialog: false }))} labelledBy="di-category-create-title" className="di-dialog"><h2 id="di-category-create-title">New category</h2><form className="di-form" onSubmit={createCategory}><label>Category name<input autoFocus required maxLength={80} value={categoryName} onChange={event => setCategoryName(event.target.value)} /></label><div className="di-actions"><Button variant="primary" type="submit" disabled={busy}>Create category</Button><Button type="button" onClick={() => setDialog(current => ({ ...current, categoryDialog: false }))}>Cancel</Button></div></form></Dialog>

  <Dialog open={dialog?.type === 'categories'} onClose={() => setDialog(null)} labelledBy="di-categories-title" className="di-dialog"><h2 id="di-categories-title">Manage categories for {habit?.name}</h2><p className="di-muted">Categories belong to this improvement area. Categories linked to items or archived notes can't be deleted.</p><form className="di-inline-create" onSubmit={createCategory}><label className="sr-only" htmlFor="di-manage-new-category">New category name</label><input id="di-manage-new-category" placeholder="New category name" maxLength={80} value={categoryName} onChange={event => setCategoryName(event.target.value)} /><Button type="submit" disabled={busy || !categoryName.trim()}>Add</Button></form>{categories.length ? <div className="di-category-list">{categories.map(category => { const count = items.filter(item => item.categoryId === category.id).length, archivedCount = archivedNotes.filter(item => item.categoryId === category.id).length; return <CategoryRow key={category.id} category={category} busy={busy} count={count} archivedCount={archivedCount} rename={renameCategory} remove={value => setConfirm({ type: 'category', category: value })} />; })}</div> : <p className="di-muted">No categories yet. Create one here or while adding an improvement.</p>}<div className="di-actions"><Button onClick={() => setDialog(null)}>Done</Button></div></Dialog>

  <ConfirmDialog isOpen={Boolean(confirm)} title={confirm?.type === 'category' ? 'Delete category?' : 'Delete improvement?'} message={confirm?.type === 'category' ? `"${confirm.category.name}" will be removed. It has no linked records.` : confirm ? `${confirm.title} will be removed from ${habit?.name}.` : ''} onCancel={() => setConfirm(null)} onConfirm={() => confirm?.type === 'category' ? removeCategory(confirm.category) : confirm && deleteItem(confirm)} />
  </PageShell>;
}

function CategoryRow({ category, count, archivedCount = 0, busy, rename, remove }) {
  const [name, setName] = useState(category.name);
  useEffect(() => setName(category.name), [category.name]);
  const linked = count + archivedCount;
  return <div className="di-category-row"><label><span className="sr-only">Category name</span><input maxLength={80} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label><span className="di-category-count">{count} items{archivedCount ? ` + ${archivedCount} archived notes` : ''}</span><Button disabled={busy || !name.trim() || name.trim() === category.name} onClick={() => rename(category, name)}>Rename</Button><Button variant="danger" disabled={busy || linked > 0} title={linked ? 'Move or delete linked records first' : 'Delete category'} onClick={() => remove(category)}>Delete</Button></div>;
}
