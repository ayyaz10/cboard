import { useEffect, useMemo, useRef, useState } from 'react';
import { AppNavigation } from '../../components/layout/AppNavigation.jsx';
import { PageShell } from '../../components/layout/PageShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.jsx';
import { Dialog } from '../../components/ui/Dialog.jsx';
import { notify } from '../../lib/notifications.js';
import { loadDrivingWorkspace, saveDrivingWorkspace } from '../../services/drivingImprovementService.js';
import { DRIVING_STATUS_LABELS, DRIVING_STATUSES, getDrivingSummary, makeDrivingMistake, sortDrivingMistakes, validateDrivingData } from './drivingData.js';
import './drivingImprovement.css';

const blankForm = item => ({ title: item?.title || '', categoryId: item?.categoryId || '', correction: item?.correction || '', cause: item?.cause || '', status: item?.status || 'NEEDS_WORK' });

export function DrivingImprovement({ userId }) {
  const [data, setData] = useState(null), [revision, setRevision] = useState(0), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [dialog, setDialog] = useState(null), [form, setForm] = useState(blankForm()), [categoryName, setCategoryName] = useState(''), [filter, setFilter] = useState('ALL'), [expanded, setExpanded] = useState(''), [quickReview, setQuickReview] = useState(false), [confirm, setConfirm] = useState(null);
  const lock = useRef(false), active = useRef(true);
  async function reload() {
    setLoading(true); setError('');
    try { const result = await loadDrivingWorkspace(userId); if (active.current) { setData(result.data); setRevision(result.revision); } }
    catch (err) { if (active.current) setError(err.message || 'Could not load Driving Improvement.'); }
    finally { if (active.current) setLoading(false); }
  }
  useEffect(() => { active.current = true; reload(); return () => { active.current = false; }; }, [userId]);

  async function commit(nextData, successMessage) {
    if (lock.current || !data) return;
    lock.current = true; setBusy(true); setError('');
    const prior = data;
    try {
      const safe = validateDrivingData(nextData); setData(safe);
      const nextRevision = await saveDrivingWorkspace(userId, safe, revision);
      if (active.current) { setRevision(nextRevision); if (successMessage) notify.success(successMessage); }
      return true;
    } catch (err) {
      if (active.current) { setData(prior); setError(err.message || 'Could not save your changes.'); notify.error(err.message || 'Could not save your changes.'); }
      return false;
    } finally { lock.current = false; if (active.current) setBusy(false); }
  }
  function openMistake(item = null) { setForm(blankForm(item)); setDialog({ type: 'mistake', item }); }
  async function saveMistake(event) {
    event.preventDefault();
    if (!form.title.trim() || !form.categoryId) return;
    const now = new Date().toISOString();
    const mistake = dialog.item ? { ...dialog.item, ...form, title: form.title.trim(), cause: form.cause.trim(), correction: form.correction.trim(), updatedAt: now } : makeDrivingMistake(form, userId, now);
    const next = { ...data, mistakes: dialog.item ? data.mistakes.map(item => item.id === mistake.id ? mistake : item) : [...data.mistakes, mistake] };
    if (await commit(next, dialog.item ? 'Mistake updated.' : 'Mistake added.')) { setDialog(null); setExpanded(mistake.id); }
  }
  async function changeStatus(mistake, status) {
    if (status === mistake.status) return;
    await commit({ ...data, mistakes: data.mistakes.map(item => item.id === mistake.id ? { ...item, status, updatedAt: new Date().toISOString() } : item) }, 'Status updated.');
  }
  async function deleteMistake(mistake) {
    if (await commit({ ...data, mistakes: data.mistakes.filter(item => item.id !== mistake.id) }, 'Mistake deleted.')) { setConfirm(null); setExpanded(''); }
  }
  async function createCategory(event) {
    event.preventDefault(); const name = categoryName.trim();
    if (!name || !data) return;
    if (data.categories.some(item => item.name.toLowerCase() === name.toLowerCase())) { setError('A category with that name already exists.'); return; }
    const now = new Date().toISOString(), category = { id: crypto.randomUUID(), name, createdAt: now, updatedAt: now };
    if (await commit({ ...data, categories: [...data.categories, category] }, 'Category created.')) {
      setCategoryName('');
      if (dialog?.type === 'mistake') setForm(current => ({ ...current, categoryId: category.id }));
      setDialog(dialog?.type === 'mistake' ? { ...dialog, categoryDialog: false } : null);
    }
  }
  async function renameCategory(category, name) {
    const normalized = name.trim();
    if (!normalized || normalized === category.name) return true;
    if (data.categories.some(item => item.id !== category.id && item.name.toLowerCase() === normalized.toLowerCase())) { setError('A category with that name already exists.'); return false; }
    return commit({ ...data, categories: data.categories.map(item => item.id === category.id ? { ...item, name: normalized, updatedAt: new Date().toISOString() } : item) }, 'Category renamed.');
  }
  async function removeCategory(category) {
    if (data.mistakes.some(item => item.categoryId === category.id)) { setError('Move or delete this category’s mistakes before removing it.'); return; }
    if (await commit({ ...data, categories: data.categories.filter(item => item.id !== category.id) }, 'Category removed.')) { setDialog(null); setConfirm(null); }
  }

  const categories = data?.categories || [], mistakes = data?.mistakes || [], summary = useMemo(() => getDrivingSummary(mistakes), [mistakes]);
  const ordered = useMemo(() => sortDrivingMistakes(mistakes), [mistakes]);
  const shown = ordered.filter(item => filter === 'ALL' || item.status === filter);
  const reviewItems = ordered.filter(item => item.status !== 'CONFIDENT');
  const categoryById = id => categories.find(item => item.id === id)?.name || 'Category unavailable';

  return <PageShell><section className="panel driving-improvement p-5 sm:p-8 lg:p-10"><AppNavigation activePath="/driving-improvement" />
    <header className="di-heading"><div><span className="pill">Personal tracker</span><h1>Driving Improvement</h1><p>Learn from mistakes. Fix one thing at a time.</p></div>
      <div className="di-heading-actions"><Button onClick={() => setQuickReview(true)} disabled={!data}>Quick Review</Button><Button variant="primary" onClick={() => openMistake()} disabled={!data || !categories.length}>＋ Add Mistake</Button></div>
    </header>
    {error && <div className="di-error" role="alert"><span>{error}</span>{!data && <Button onClick={reload}>Retry</Button>}</div>}
    {loading && <p role="status" className="di-muted">Loading your driving tracker…</p>}
    {!loading && !data && !error && <p className="di-muted">Your tracker could not be loaded.</p>}
    {data && (quickReview ? <section aria-labelledby="di-review-heading" className="di-review"><div className="di-section-head"><div><span className="di-eyebrow">Before you practise</span><h2 id="di-review-heading">Quick Review</h2></div><Button onClick={() => setQuickReview(false)}>Done</Button></div>
      {reviewItems.length ? <div className="di-list">{reviewItems.map(item => <article className="di-review-card" key={item.id}><span className="di-category">{categoryById(item.categoryId)}</span><h3>{item.title}</h3><span className="di-eyebrow">Next time</span><p className="di-correction">{item.correction || 'Correction not added yet'}</p></article>)}</div> : <p className="di-empty">No Needs Work or Improving mistakes to review.</p>}
    </section> : <>
      <div className="di-summary" aria-label="Driving mistake summary">{[['ALL','Total',summary.total], ...DRIVING_STATUSES.map(status => [status, DRIVING_STATUS_LABELS[status], summary[status]])].map(([key,label,count]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(filter === key && key !== 'ALL' ? 'ALL' : key)} className="di-stat"><span>{label}</span><strong>{count}</strong></button>)}</div>
      <div className="di-toolbar"><h2>Mistakes <span>{shown.length}</span></h2><Button onClick={() => setDialog({ type: 'categories' })}>Manage categories</Button></div>
      {busy && <p className="di-saving" role="status">Saving…</p>}
      {shown.length ? <div className="di-list">{shown.map(item => { const isOpen = expanded === item.id; return <article className="di-card" key={item.id}>
        <button type="button" className="di-card-toggle" aria-expanded={isOpen} aria-controls={`di-details-${item.id}`} onClick={() => setExpanded(isOpen ? '' : item.id)}>
          <span className="di-category">{categoryById(item.categoryId)}</span><span className="di-card-title-row"><strong>{item.title}</strong><span className={`di-status di-status-${item.status.toLowerCase()}`}>{DRIVING_STATUS_LABELS[item.status]}</span></span>
          {item.correction && <span className="di-preview"><b>Next time:</b> {item.correction}</span>}
        </button>
        {isOpen && <div id={`di-details-${item.id}`} className="di-details"><div className="di-detail-correction"><span className="di-eyebrow">Next time</span><p>{item.correction || <em>Correction not added yet</em>}</p>{!item.correction && <button type="button" className="di-text-button" onClick={() => openMistake(item)}>Add correction</button>}</div>
          <div className="di-detail-cause"><span className="di-eyebrow">Why it happened</span><p>{item.cause || <em>Not recorded</em>}</p></div>
          <label className="di-status-control">Status<select value={item.status} disabled={busy} onChange={event => changeStatus(item, event.target.value)}>{DRIVING_STATUSES.map(status => <option key={status} value={status}>{DRIVING_STATUS_LABELS[status]}</option>)}</select></label>
          <div className="di-actions"><Button onClick={() => openMistake(item)}>Edit</Button><Button variant="danger" onClick={() => setConfirm(item)}>Delete</Button></div>
        </div>}
      </article>; })}</div> : <div className="di-empty"><h3>{mistakes.length ? 'No mistakes in this filter' : 'No mistakes recorded yet'}</h3><p>{mistakes.length ? 'Choose another status above to see the rest.' : 'Add a mistake when you are ready. Your categories are here to organise them.'}</p>{!mistakes.length && <Button variant="primary" onClick={() => openMistake()}>＋ Add Mistake</Button>}</div>}
    </>)}
  </section>

  <Dialog open={dialog?.type === 'mistake'} onClose={() => setDialog(null)} labelledBy="di-mistake-title" className="di-dialog"><h2 id="di-mistake-title">{dialog?.item ? 'Edit mistake' : 'Add mistake'}</h2><form className="di-form" onSubmit={saveMistake}>
    <label>Mistake<input autoFocus required maxLength={160} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label>
    <label>Category<select required value={form.categoryId} onChange={event => setForm({ ...form, categoryId: event.target.value })}><option value="">Choose category</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
    <button type="button" className="di-text-button" onClick={() => { setCategoryName(''); setDialog(current => ({ ...current, categoryDialog: true })); }}>＋ New category</button>
    <label>What will I do differently?<textarea rows="3" maxLength={5000} value={form.correction} onChange={event => setForm({ ...form, correction: event.target.value })} placeholder="Add a correction later" /></label>
    <label>Why did it happen?<textarea rows="2" maxLength={5000} value={form.cause} onChange={event => setForm({ ...form, cause: event.target.value })} /></label>
    <label>Status<select value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}>{DRIVING_STATUSES.map(status => <option key={status} value={status}>{DRIVING_STATUS_LABELS[status]}</option>)}</select></label>
    <div className="di-actions"><Button variant="primary" type="submit" disabled={busy}>{dialog?.item ? 'Save changes' : 'Add mistake'}</Button><Button type="button" onClick={() => setDialog(null)}>Cancel</Button></div>
  </form></Dialog>

  <Dialog open={dialog?.type === 'mistake' && dialog.categoryDialog} onClose={() => setDialog(current => ({ ...current, categoryDialog: false }))} labelledBy="di-category-create-title" className="di-dialog"><h2 id="di-category-create-title">New category</h2><form className="di-form" onSubmit={createCategory}><label>Category name<input autoFocus required maxLength={80} value={categoryName} onChange={event => setCategoryName(event.target.value)} /></label><div className="di-actions"><Button variant="primary" type="submit" disabled={busy}>Create category</Button><Button type="button" onClick={() => setDialog(current => ({ ...current, categoryDialog: false }))}>Cancel</Button></div></form></Dialog>

  <Dialog open={dialog?.type === 'categories'} onClose={() => setDialog(null)} labelledBy="di-categories-title" className="di-dialog"><h2 id="di-categories-title">Manage categories</h2><p className="di-muted">Categories organise mistakes. A category with mistakes must be empty before it can be removed.</p><form className="di-inline-create" onSubmit={createCategory}><label className="sr-only" htmlFor="di-manage-new-category">New category name</label><input id="di-manage-new-category" placeholder="New category name" maxLength={80} value={categoryName} onChange={event => setCategoryName(event.target.value)} /><Button type="submit" disabled={busy || !categoryName.trim()}>Add</Button></form><div className="di-category-list">{categories.map(category => <CategoryRow key={category.id} category={category} busy={busy} count={mistakes.filter(item => item.categoryId === category.id).length} rename={renameCategory} remove={value => setConfirm({ type: 'category', category: value })} />)}</div><div className="di-actions"><Button onClick={() => setDialog(null)}>Done</Button></div></Dialog>

  <ConfirmDialog isOpen={Boolean(confirm)} title={confirm?.type === 'category' ? 'Delete category?' : 'Delete mistake?'} message={confirm?.type === 'category' ? `“${confirm.category.name}” will be removed. It has no linked mistakes.` : confirm ? `${confirm.title} will be removed from your tracker.` : ''} onCancel={() => setConfirm(null)} onConfirm={() => confirm?.type === 'category' ? removeCategory(confirm.category) : confirm && deleteMistake(confirm)} />
  </PageShell>;
}

function CategoryRow({ category, count, busy, rename, remove }) {
  const [name, setName] = useState(category.name);
  useEffect(() => setName(category.name), [category.name]);
  return <div className="di-category-row"><label><span className="sr-only">Category name</span><input maxLength={80} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label><span className="di-category-count">{count} {count === 1 ? 'mistake' : 'mistakes'}</span><Button disabled={busy || !name.trim() || name.trim() === category.name} onClick={() => rename(category, name)}>Rename</Button><Button variant="danger" disabled={busy || count > 0} title={count ? 'Reassign or delete its mistakes first' : 'Delete category'} onClick={() => remove(category)}>Delete</Button></div>;
}
