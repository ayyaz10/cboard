import { useEffect, useMemo, useRef, useState } from 'react';
import { navigateTo } from '../../app/useRoute.js';
import { AppNavigation } from '../../components/layout/AppNavigation.jsx';
import { PageShell } from '../../components/layout/PageShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.jsx';
import { Dialog } from '../../components/ui/Dialog.jsx';
import { IconButton } from '../../components/ui/IconButton.jsx';
import { hasUnsavedNodeChanges } from './nodeEditor.js';
import { NoteEditor } from '../notebook/NotesPanel.jsx';
import { sanitizeNoteHtml } from '../notebook/noteContent.js';
import { notify } from '../../lib/notifications.js';
import { loadDrivingWorkspace, saveDrivingWorkspace, getCachedDrivingWorkspace, publishCachedDrivingWorkspace } from '../../services/drivingImprovementService.js';
import { getExecutionStats, localDateKey, recordExecution, startExecution } from './habitExecution.js';
import { archiveNodeBranch, restoreNodeBranch, isNodeBranchArchived, deleteNodeBranch, getActiveNodes, getHabitSummary, getNodeChildren, getNodePath, getNodeProgress, getQuickReviewItemsForHabit, getDescendantNodes, HABIT_STATUS_LABELS, HABIT_STATUSES, IMPROVEMENT_PRIORITIES, IMPROVEMENT_PRIORITY_LABELS, makeImprovementNode, moveHabitToBacklog, searchImprovementNodes, setNodeParent, sortImprovementItems, validateHabitData } from './drivingData.js';
import './drivingImprovement.css';
import './habitTree.css';

const emptyForm = habitId => ({ habitId, parentId: null, title: '', description: '', whyItHappens: '', whatIDoDifferently: '', richNotes: '', status: 'NEEDS_WORK', priority: 'MEDIUM', focusNow: false });
const readHabitSetting = (userId, habitSlug, key, fallback) => { try { return sessionStorage.getItem(`habit-ui:${userId}:${habitSlug}:${key}`) ?? fallback; } catch { return fallback; } };

function TreeBranch({ nodes, node, depth, selectedId, expanded, showArchived = false, onToggle, onSelect, onCreate }) {
  const children = getNodeChildren(nodes, node.id, showArchived), open = expanded.has(node.id), progress = getNodeProgress(nodes, node.id), execution = node.focusNow && node.actionContract ? getExecutionStats(node) : null;
  return <li className="di-tree-branch" style={{ '--tree-indent-step': depth > 0 && depth <= 3 ? '.42rem' : '0px' }}>
    <div className={`di-tree-row ${selectedId === node.id ? 'is-selected' : ''} ${node.archivedAt ? 'is-archived' : ''}`} style={{ '--tree-depth': Math.min(depth, 4) }}>
      <button type="button" className="di-tree-main" onClick={() => onSelect(node.id)} aria-current={selectedId === node.id ? 'page' : undefined}>
        <span className="di-tree-mark" aria-hidden="true" />
        <span className="di-tree-title">{node.title}</span>
        <span className={`di-status di-status-${node.status.toLowerCase()}`}>{HABIT_STATUS_LABELS[node.status]}</span>
        <span className={`di-priority di-priority-${node.priority.toLowerCase()}`}>{IMPROVEMENT_PRIORITY_LABELS[node.priority]}</span>
        {node.focusNow && <span className="di-focus-tag">Focus</span>}{execution && <span className="di-tree-execution" aria-label={`Current streak ${execution.currentStreak} days, best ${execution.bestStreak} days`}>Streak {execution.currentStreak} · Best {execution.bestStreak}</span>}
        {isNodeBranchArchived(nodes, node.id) && <span className="di-archived-tag">Archived</span>}
        {children.length > 0 && <span className="di-tree-count">{children.length}</span>}
        {progress.total > 0 && <span className="di-rollup">{progress.STABLE}/{progress.total} stable</span>}
      </button>
      {children.length > 0 && <button type="button" className="di-expand" aria-label={`${open ? 'Collapse' : 'Expand'} ${node.title}`} aria-expanded={open} onClick={() => onToggle(node.id)}>{open ? '−' : '+'}</button>}
      <button type="button" className="di-add-child" onClick={() => onCreate(node.id)} aria-label={`Add sub-improvement to ${node.title}`}>+ child</button>
    </div>
    {open && children.length > 0 && <ul className="di-tree-children">{children.map(child => <TreeBranch key={child.id} nodes={nodes} node={child} depth={depth + 1} selectedId={selectedId} expanded={expanded} showArchived={showArchived} onToggle={onToggle} onSelect={onSelect} onCreate={onCreate} />)}</ul>}
  </li>;
}

export function HabitImprovementDetail({ userId, habitSlug, nodeId = '' }) {
  const [cached] = useState(() => getCachedDrivingWorkspace(userId));
  const [data, setData] = useState(cached?.data || null), [revision, setRevision] = useState(cached?.revision || 0), [loading, setLoading] = useState(!cached), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [retryDraft, setRetryDraft] = useState(null);
  const [dialog, setDialog] = useState(null), [form, setForm] = useState(emptyForm('')), [filter, setFilter] = useState(() => readHabitSetting(userId, habitSlug, 'filter', 'ALL')), [mode, setMode] = useState(() => readHabitSetting(userId, habitSlug, 'mode', 'TREE')), [expanded, setExpanded] = useState(() => new Set()), [quickReview, setQuickReview] = useState(false), [showArchived, setShowArchived] = useState(() => readHabitSetting(userId, habitSlug, 'archived', 'false') === 'true'), [itemSearch, setItemSearch] = useState(() => readHabitSetting(userId, habitSlug, 'search', '')), [confirm, setConfirm] = useState(null), [discardNodeChanges, setDiscardNodeChanges] = useState(false), [includeStable, setIncludeStable] = useState(false), [filtersOpen, setFiltersOpen] = useState(false);
  const lock = useRef(false), active = useRef(true);

  async function reload(force = false) {
    if (!data) setLoading(true);
    setError('');
    try { const result = await loadDrivingWorkspace(userId, 0, force); if (active.current) { setData(result.data); setRevision(result.revision); } }
    catch { if (active.current) setError(data ? 'Could not refresh Habit Improvement.' : 'Could not load Habit Improvement.'); }
    finally { if (active.current) setLoading(false); }
  }
  useEffect(() => { active.current = true; reload(); return () => { active.current = false; }; }, [userId]);

  async function commit(nextData, message) {
    if (lock.current || !data) return false;
    lock.current = true; setBusy(true); setError(''); setRetryDraft(null); const prior = data;
    try { const safe = validateHabitData(nextData); setData(safe); publishCachedDrivingWorkspace(userId, safe, revision); const nextRevision = await saveDrivingWorkspace(userId, safe, revision); if (active.current) { setRevision(nextRevision); if (message) notify.success(message); } return true; }
    catch (err) { const conflict = /changed on another device/i.test(err.message || ''); if (active.current) { setData(prior); setError(conflict ? 'Habit Improvement data changed elsewhere. Refresh before saving again.' : 'Could not save improvement. Your previous version is still available.'); if (!conflict) setRetryDraft({ data: nextData, message }); notify.error(conflict ? 'Habit Improvement data changed elsewhere.' : 'Could not save improvement.'); } return false; }
    finally { lock.current = false; if (active.current) setBusy(false); }
  }

  const habit = data?.habits.find(item => item.slug === habitSlug && !item.archivedAt && item.lifecycleState !== 'BACKLOG');
  const allNodes = useMemo(() => habit ? (data.nodes || []).filter(node => node.habitId === habit.id) : [], [data, habit?.id]);
  const activeNodes = useMemo(() => getActiveNodes(allNodes, habit?.id), [allNodes, habit?.id]);
  const archivedNodes = useMemo(() => allNodes.filter(node => node.archivedAt || getNodePath(allNodes, node.id).some(part => part.archivedAt)), [allNodes]);
  const listedNodes = showArchived ? allNodes.filter(node => node.archivedAt || getNodePath(allNodes, node.id).some(part => part.archivedAt)) : activeNodes;
  const summary = getHabitSummary(allNodes);
  const selectedNode = allNodes.find(node => node.id === nodeId && node.habitId === habit?.id) || null;
  const selectedPath = selectedNode ? getNodePath(allNodes, selectedNode.id) : [];
  useEffect(() => { if (!loading && data && habit && nodeId && !selectedNode) goNode(''); }, [loading, data, habit?.id, nodeId, selectedNode]);
  const query = itemSearch.trim().toLocaleLowerCase();
  const searchMatches = new Set(searchImprovementNodes(listedNodes, query).map(node => node.id));
  const matches = listedNodes.filter(node => (filter === 'ALL' || (HABIT_STATUSES.includes(filter) ? node.status === filter : filter === 'HIGH' ? node.priority === 'HIGH' : filter === 'FOCUS' ? node.focusNow : true)) && searchMatches.has(node.id));
  const listedIds = new Set(listedNodes.map(node => node.id));
  const treeRoots = listedNodes.filter(node => showArchived ? !listedIds.has(node.parentId) : node.parentId === null);
  const reviewItems = habit ? getQuickReviewItemsForHabit(data, habit.id, includeStable) : [];

  function goNode(id) { try { sessionStorage.setItem(`habit-ui:${userId}:${habitSlug}:lastNode`, id || ''); } catch {} navigateTo(`/habit-improvement/${habitSlug}${id ? `/${encodeURIComponent(id)}` : ''}`); }
  useEffect(() => { if (!selectedNode || quickReview) return undefined; const closeInspector = event => { if (event.key === 'Escape' && !dialog && !confirm) goNode(''); }; window.addEventListener('keydown', closeInspector); return () => window.removeEventListener('keydown', closeInspector); }, [selectedNode?.id, quickReview, dialog, confirm]);
  function toggle(id) { setExpanded(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); try { sessionStorage.setItem(`habit-tree:${userId}:${habit?.id}`, JSON.stringify([...next])); } catch {} return next; }); }
  useEffect(() => { try { const saved = JSON.parse(sessionStorage.getItem(`habit-tree:${userId}:${habit?.id}`) || '[]'); setExpanded(new Set(saved)); } catch {} }, [userId, habit?.id]);
  useEffect(() => {
    if (!habit) return;
    const validIds = new Set(allNodes.map(node => node.id));
    setExpanded(current => {
      const next = new Set([...current].filter(id => validIds.has(id)));
      if (next.size === current.size) return current;
      try { sessionStorage.setItem(`habit-tree:${userId}:${habit.id}`, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, [allNodes, habit?.id, userId]);
  useEffect(() => {
    if (selectedPath.length < 2) return;
    setExpanded(current => {
      const next = new Set([...current, ...selectedPath.slice(0, -1).map(node => node.id)]);
      try { sessionStorage.setItem(`habit-tree:${userId}:${habit?.id}`, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, [nodeId, userId, habit?.id, allNodes]);
  useEffect(() => { try { sessionStorage.setItem(`habit-ui:${userId}:${habitSlug}:filter`, filter); } catch {} }, [userId, habitSlug, filter]);
  useEffect(() => { try { sessionStorage.setItem(`habit-ui:${userId}:${habitSlug}:mode`, mode); } catch {} }, [userId, habitSlug, mode]);
  useEffect(() => { try { sessionStorage.setItem(`habit-ui:${userId}:${habitSlug}:archived`, String(showArchived)); } catch {} }, [userId, habitSlug, showArchived]);
  useEffect(() => { try { sessionStorage.setItem(`habit-ui:${userId}:${habitSlug}:search`, itemSearch); } catch {} }, [userId, habitSlug, itemSearch]);
  function openNode(node = null, parentId = null) { const initialForm = node ? { ...node } : { ...emptyForm(habit.id), parentId }; setForm(initialForm); setDialog({ type: 'node', node, initialForm }); }
  function closeNodeEditor() { setDiscardNodeChanges(false); setDialog(null); }
  function requestCloseNodeEditor() {
    if (dialog?.type !== 'node') { setDialog(null); return; }
    const baseline = { ...emptyForm(habit?.id || ''), ...(dialog.initialForm || dialog.node || {}) };
    if (hasUnsavedNodeChanges(form, baseline)) setDiscardNodeChanges(true);
    else closeNodeEditor();
  }
  function editInInspector(node) { openNode(node); }
  async function saveNode(event) {
    event.preventDefault(); if (!form.title.trim() || !habit) return;
    const now = new Date().toISOString();
    const safeForm = { ...form, whyItHappens: sanitizeNoteHtml(form.whyItHappens), whatIDoDifferently: sanitizeNoteHtml(form.whatIDoDifferently), richNotes: sanitizeNoteHtml(form.richNotes) };
    const node = dialog.node ? { ...dialog.node, ...safeForm, title: form.title.trim(), description: form.description.trim(), updatedAt: now } : makeImprovementNode({ ...safeForm, title: form.title.trim(), habitId: habit.id, sortOrder: getNodeChildren(allNodes, form.parentId).length }, userId, now);
    const nodes = dialog.node ? allNodes.map(item => item.id === node.id ? node : item) : [...allNodes, node];
    if (await commit({ ...data, nodes }, dialog.node ? 'Improvement updated.' : 'Improvement added.')) { closeNodeEditor(); if (node.parentId) setExpanded(current => { const next = new Set([...current, node.parentId]); try { sessionStorage.setItem(`habit-tree:${userId}:${habit.id}`, JSON.stringify([...next])); } catch {} return next; }); if (!dialog.node) goNode(node.id); }
  }
  async function updateNode(node, changes, message) { if (Object.entries(changes).every(([key, value]) => node[key] === value)) return; await commit({ ...data, nodes: allNodes.map(item => item.id === node.id ? { ...item, ...changes, updatedAt: new Date().toISOString() } : item) }, message); }
  async function pauseHabit() { if (!habit) return; if (await commit(moveHabitToBacklog(data, habit.id), 'Moved to Backlog. Your tree and progress are preserved.')) { setDialog(null); navigateTo('/habit-improvement/backlog'); } }
  async function archiveNode(node) { if (await commit({ ...data, nodes: archiveNodeBranch(allNodes, node.id) }, 'Improvement archived.')) { setConfirm(null); goNode(node.parentId); } }
  async function deleteNode(node) { if (await commit({ ...data, nodes: deleteNodeBranch(allNodes, node.id) }, 'Improvement branch deleted.')) { setConfirm(null); goNode(node.parentId); } }
  async function moveNode(node, parentId) { try { const nodes = setNodeParent(allNodes, node.id, parentId || null); if (await commit({ ...data, nodes }, 'Improvement moved.')) goNode(node.id); } catch (err) { setError(err.message); } }
  async function reorder(node, direction) {
    const siblings = getNodeChildren(allNodes, node.parentId), index = siblings.findIndex(item => item.id === node.id), target = index + direction;
    if (target < 0 || target >= siblings.length) return;
    const reordered = [...siblings]; [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const ranks = new Map(reordered.map((item, rank) => [item.id, rank]));
    await commit({ ...data, nodes: allNodes.map(item => ranks.has(item.id) ? { ...item, sortOrder: ranks.get(item.id) } : item) }, 'Sibling order updated.');
  }

  if (!loading && data && !habit) return <PageShell><section className="panel driving-improvement p-5 sm:p-8 lg:p-10"><AppNavigation activePath="/habit-improvement" /><div className="di-not-found"><span className="pill">Habit Improvement</span><h1>Habit not found</h1><p>This improvement area may have been deleted, archived or moved to Backlog.</p><Button onClick={() => navigateTo('/habit-improvement')}>Back to Habit Improvement</Button></div></section></PageShell>;
  const compactCrumbs = selectedPath.length > 3 ? [{ ...selectedPath.at(-3), crumbLabel: '…' }, ...selectedPath.slice(-2)] : selectedPath;
  return <PageShell><section className="panel driving-improvement p-4 sm:p-7 lg:p-9"><AppNavigation activePath="/habit-improvement" />
    <nav className="di-breadcrumb" aria-label="Breadcrumb"><button type="button" onClick={() => navigateTo('/habit-improvement')}>← All habits</button>{habit && <><span aria-hidden="true">›</span><button type="button" onClick={() => goNode('')}>{habit.name}</button></>}{compactCrumbs.map((part, index) => <span className="di-crumb-part" key={part.id}><span aria-hidden="true">›</span>{index === compactCrumbs.length - 1 ? <span aria-current="page">{part.crumbLabel || part.title}</span> : <button type="button" aria-label={part.crumbLabel ? `Navigate to ${part.title}` : undefined} onClick={() => goNode(part.id)}>{part.crumbLabel || part.title}</button>}</span>)}</nav>
    {error && <div className="di-error" role="alert"><span>{error}</span>{retryDraft ? <Button onClick={() => commit(retryDraft.data, retryDraft.message)} disabled={busy}>Retry save</Button> : (!data || /changed elsewhere|Could not refresh/i.test(error)) && <Button onClick={() => reload(true)}>{data ? 'Refresh data' : 'Retry'}</Button>}</div>}
    {loading && !data && <div className="di-skeleton" role="status" aria-label="Loading improvement area"><span /><span /><span /></div>}
    {!loading && !data && !error && <p className="di-muted">Habit Improvement could not be loaded.</p>}
    {habit && <>
      <header className="di-heading"><div><span className="pill">Habit / improvement area</span><h1>{habit.name}</h1>{habit.description && <p>{habit.description}</p>}</div><div className="di-heading-actions di-detail-actions"><Button variant="primary" onClick={() => openNode()}>+ Add Improvement</Button><Button onClick={() => { setQuickReview(true); goNode(''); }}>Quick Review</Button><Button onClick={() => setDialog({ type: 'move-habit' })}>Move to Backlog</Button></div></header>
      {busy && <p className="di-saving" role="status">Saving...</p>}
      {quickReview ? <section className="di-review"><div className="di-section-head"><div><span className="di-eyebrow">Before you start</span><h2>Quick Review</h2></div><div className="di-view-tabs"><label><input type="checkbox" checked={includeStable} onChange={event => setIncludeStable(event.target.checked)} /> Include Stable</label><Button onClick={() => setQuickReview(false)}>Done</Button></div></div>
        {reviewItems.length ? <div className="di-list">{reviewItems.map(node => <article className="di-review-card" key={node.id}><button type="button" className="di-review-open" onClick={() => { setQuickReview(false); goNode(node.id); }}><h3>{node.title}</h3><span className="di-node-path">{habit.name} › {getNodePath(allNodes, node.id).map(part => part.title).join(' › ')}</span></button><div className="di-card-badges"><span className={`di-priority di-priority-${node.priority.toLowerCase()}`}>{IMPROVEMENT_PRIORITY_LABELS[node.priority]} Priority</span><span className={`di-status di-status-${node.status.toLowerCase()}`}>{HABIT_STATUS_LABELS[node.status]}</span>{node.focusNow && <span className="di-focus-tag">Focus Now</span>}</div><span className="di-eyebrow">What I'll do differently</span>{node.whatIDoDifferently ? <div className="di-correction" dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(node.whatIDoDifferently) }} /> : <p className="di-correction">Action not added yet</p>}</article>)}</div> : <p className="di-empty">Nothing to review right now. Add an improvement with Needs Work or Improving status.</p>}
      </section> : <>
        <div className="di-summary" aria-label={`${habit.name} improvement summary`}>{[['ALL', 'Total', summary.total], ...HABIT_STATUSES.map(status => [status, HABIT_STATUS_LABELS[status], summary[status]])].map(([key, label, count]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(filter === key && key !== 'ALL' ? 'ALL' : key)} className="di-stat"><span>{label}</span><strong>{key === 'ALL' ? activeNodes.length : count}</strong></button>)}</div>
        <div className={`di-tree-inspector-layout ${selectedNode && !quickReview ? 'has-inspector' : ''}`}><div className="di-tree-column">
        <div className="di-toolbar"><h2>Improvements</h2><div className="di-toolbar-actions"><label className="di-search"><span className="sr-only">Search improvements</span><input type="search" value={itemSearch} onChange={event => setItemSearch(event.target.value)} placeholder="Search title, why, notes..." /></label><div className="di-view-tabs" role="group" aria-label="Improvement view"><button type="button" aria-pressed={mode === 'TREE'} onClick={() => { setQuickReview(false); setMode('TREE'); }}>Tree</button><button type="button" aria-pressed={mode === 'LIST'} onClick={() => { setQuickReview(false); setMode('LIST'); }}>List</button><button type="button" aria-pressed={quickReview} onClick={() => { setQuickReview(true); goNode(''); }}>Quick Review</button></div><Button className="di-mobile-filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(value => !value)}>Filter{filter !== 'ALL' ? ` · ${filter === 'HIGH' ? 'High' : filter === 'FOCUS' ? 'Focus' : HABIT_STATUS_LABELS[filter]}` : ''}</Button><Button onClick={() => setShowArchived(value => !value)} aria-pressed={showArchived}>{showArchived ? 'Hide archived' : 'Archived'}</Button></div></div>
        <div className={`di-list-filters ${filtersOpen ? 'is-open' : ''}`} role="group" aria-label="Filter improvements">{[['ALL','All'],...HABIT_STATUSES.map(status=>[status,HABIT_STATUS_LABELS[status]]),['HIGH','High priority'],['FOCUS','Focus Now']].map(([key,label])=><button key={key} type="button" aria-pressed={filter===key} onClick={()=>{setFilter(key);setFiltersOpen(false)}}>{label}</button>)}</div>
        {mode === 'TREE' && !query && filter === 'ALL' ? <ul className="di-tree-list" aria-label="Improvement hierarchy">{treeRoots.sort((a,b)=>a.sortOrder-b.sortOrder).map(node => <TreeBranch key={node.id} nodes={listedNodes} node={node} depth={0} selectedId={nodeId} expanded={expanded} showArchived={showArchived} onToggle={toggle} onSelect={goNode} onCreate={parentId => openNode(null, parentId)} />)}</ul> : <div className="di-list">{sortImprovementItems(matches).map(node => <article className={`di-card di-flat-card ${node.archivedAt ? 'is-archived' : ''}`} key={node.id}><button type="button" className="di-review-open" onClick={() => goNode(node.id)}><strong>{node.title}</strong><span className="di-node-path">{habit.name} › {getNodePath(allNodes, node.id).map(part => part.title).join(' › ')}</span></button><div className="di-card-badges"><span className={`di-priority di-priority-${node.priority.toLowerCase()}`}>{IMPROVEMENT_PRIORITY_LABELS[node.priority]}</span><span className={`di-status di-status-${node.status.toLowerCase()}`}>{HABIT_STATUS_LABELS[node.status]}</span>{node.focusNow && <span className="di-focus-tag">Focus</span>}{node.archivedAt && <span className="di-archived-tag">Archived</span>}</div></article>)}</div>}
        {!allNodes.length && <div className="di-empty"><h3>No improvements yet.</h3><p>Break a habit or pattern into specific things you can practice.</p><Button variant="primary" onClick={() => openNode()}>+ Add Improvement</Button></div>}
        {query && matches.length === 0 && <div className="di-empty"><h3>No improvements match “{itemSearch.trim()}”.</h3><p>Try another search or status filter.</p><Button onClick={() => setItemSearch('')}>Clear Search</Button></div>}
        {showArchived && archivedNodes.length > 0 && <p className="di-muted">Archived branches are shown dimmed. Restoring a branch is available in its detail.</p>}
        </div>
      {selectedNode && !quickReview && <>
        <button type="button" className="di-inspector-backdrop" aria-label="Close improvement inspector" onClick={() => goNode('')} />
        <aside className="di-node-detail di-inspector" aria-labelledby="di-node-title" aria-label="Improvement inspector"><div className="di-detail-heading"><div><span className="di-eyebrow">Improvement detail</span><h2 id="di-node-title">{selectedNode.title}</h2><div className="di-card-badges"><span className={`di-priority di-priority-${selectedNode.priority.toLowerCase()}`}>{IMPROVEMENT_PRIORITY_LABELS[selectedNode.priority]} Priority</span><span className={`di-status di-status-${selectedNode.status.toLowerCase()}`}>{HABIT_STATUS_LABELS[selectedNode.status]}</span>{selectedNode.focusNow && <span className="di-focus-tag">Focus Now</span>}</div></div><div className="di-actions"><Button className="di-inspector-close" aria-label="Close improvement inspector" onClick={() => goNode('')}>Close</Button><Button variant="primary" onClick={() => editInInspector(selectedNode)}>Edit</Button><Button onClick={() => updateNode(selectedNode, { focusNow: !selectedNode.focusNow }, selectedNode.focusNow ? 'Removed from Focus.' : 'Added to Focus.')}>{selectedNode.focusNow ? 'Remove from Focus' : 'Add to Focus'}</Button><details className="di-overflow di-node-more"><summary aria-label="More improvement actions">More</summary><div><Button onClick={() => document.getElementById('di-move-under')?.focus()}>Move under</Button><Button onClick={() => setConfirm({ type: 'archive', node: selectedNode })}>{isNodeBranchArchived(allNodes, selectedNode.id) ? 'Restore improvement' : 'Archive improvement'}</Button><Button variant="danger" onClick={() => setConfirm({ type: 'delete', node: selectedNode })}>Delete branch</Button></div></details></div></div>

        <div className="di-node-controls"><label>Status<select value={selectedNode.status} disabled={busy} onChange={event => updateNode(selectedNode, { status: event.target.value }, 'Status updated.')}>{HABIT_STATUSES.map(status => <option key={status} value={status}>{HABIT_STATUS_LABELS[status]}</option>)}</select></label><label>Priority<select value={selectedNode.priority} disabled={busy} onChange={event => updateNode(selectedNode, { priority: event.target.value }, 'Priority updated.')}>{IMPROVEMENT_PRIORITIES.map(priority => <option key={priority} value={priority}>{IMPROVEMENT_PRIORITY_LABELS[priority]}</option>)}</select></label><label>Move under<select id="di-move-under" value={selectedNode.parentId || ''} disabled={busy} onChange={event => moveNode(selectedNode, event.target.value)}><option value="">Habit root</option>{activeNodes.filter(node => node.id !== selectedNode.id && !getDescendantNodes(allNodes, selectedNode.id).some(child => child.id === node.id)).map(node => <option key={node.id} value={node.id}>{getNodePath(allNodes, node.id).map(part => part.title).join(' › ')}</option>)}</select></label><div className="di-actions"><Button disabled={busy} onClick={() => reorder(selectedNode, -1)}>Move up</Button><Button disabled={busy} onClick={() => reorder(selectedNode, 1)}>Move down</Button></div></div>
        {selectedNode.actionContract ? <section className="di-action-contract-read"><span className="di-eyebrow">Execution · {selectedNode.focusNow ? 'Focus Now' : 'Not active'}</span><h3>{selectedNode.actionContract.action}</h3><p>{selectedNode.actionContract.trigger}{selectedNode.actionContract.location ? ` · ${selectedNode.actionContract.location}` : ''}</p><p><strong>Minimum:</strong> {selectedNode.actionContract.minimum}</p>{selectedNode.actionContract.environment && <p><strong>Environment:</strong> {selectedNode.actionContract.environment}</p>}{selectedNode.focusNow && <p className="di-streak">Current streak {getExecutionStats(selectedNode).currentStreak} · Best {getExecutionStats(selectedNode).bestStreak}</p>}<Button onClick={() => navigateTo('/habit-improvement')}>Open Today to start or adjust</Button></section> : selectedNode.focusNow && <section className="di-action-contract-read"><span className="di-eyebrow">Execution setup needed</span><p>This Focus Now improvement needs an Action Contract before it can appear in Today.</p><Button variant="primary" onClick={() => navigateTo('/habit-improvement')}>Set up in Today</Button></section>}
        {selectedNode.whyItHappens && <section className="di-rich-read"><h3>Why does it happen?</h3><div dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(selectedNode.whyItHappens) }} /></section>}{selectedNode.whatIDoDifferently && <section className="di-rich-read"><h3>What will I do differently?</h3><div dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(selectedNode.whatIDoDifferently) }} /></section>}{selectedNode.richNotes && <section className="di-rich-read"><h3>Notes</h3><div dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(selectedNode.richNotes) }} /></section>}
        <div className="di-actions"><Button onClick={() => openNode(null, selectedNode.id)}>+ Add sub-improvement</Button></div>
        <div className="di-subnodes"><h3>Sub-improvements <span>{getNodeChildren(activeNodes, selectedNode.id).length}</span></h3>{getNodeChildren(activeNodes, selectedNode.id).length ? getNodeChildren(activeNodes, selectedNode.id).map(child => <button type="button" key={child.id} onClick={() => goNode(child.id)}><span>{child.title}</span><span className={`di-status di-status-${child.status.toLowerCase()}`}>{HABIT_STATUS_LABELS[child.status]}</span></button>) : <p className="di-muted">No sub-improvements yet.</p>}</div>
        {selectedPath.length > 0 && <p className="di-rollup-summary">Descendant progress: {getNodeProgress(allNodes, selectedNode.id).STABLE} / {getNodeProgress(allNodes, selectedNode.id).total} Stable</p>}
      </aside>
      </>}
      </div>
      </>}
    </>}
  </section>
  <Dialog open={dialog?.type === 'node'} onClose={requestCloseNodeEditor} labelledBy="di-node-dialog-title" className="di-dialog di-node-dialog" aria-modal="true">
    <form className="di-node-form" onSubmit={saveNode}>
      <header className="di-node-dialog-header">
        <div className="di-node-dialog-heading">
          <span className="di-eyebrow">{habit?.name}</span>
          <h2 id="di-node-dialog-title">{dialog?.node ? 'Edit improvement' : form.parentId ? 'Add sub-improvement' : 'Add improvement'}</h2>
          <p>{dialog?.node ? getNodePath(allNodes, dialog.node.id).map(part => part.title).join(' \u203a ') : form.parentId ? 'Under ' + getNodePath(allNodes, form.parentId).map(part => part.title).join(' \u203a ') : 'New improvement in this area'}</p>
        </div>
        <IconButton label="Close" onClick={requestCloseNodeEditor}>{'\u00d7'}</IconButton>
      </header>
      <div className="di-node-dialog-scroll">
        <section className="di-node-form-section" aria-labelledby="di-node-basics-title">
          <h3 id="di-node-basics-title">Basics</h3>
          <label>Name<input autoFocus required maxLength={160} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label>
          <div className="di-node-form-grid">
            <label>Status<select value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}>{HABIT_STATUSES.map(status => <option key={status} value={status}>{HABIT_STATUS_LABELS[status]}</option>)}</select></label>
            <label>Priority<select value={form.priority} onChange={event => setForm({ ...form, priority: event.target.value })}>{IMPROVEMENT_PRIORITIES.map(priority => <option key={priority} value={priority}>{IMPROVEMENT_PRIORITY_LABELS[priority]}</option>)}</select></label>
          </div>
          <label className="di-focus-checkbox"><input type="checkbox" checked={form.focusNow} onChange={event => setForm({ ...form, focusNow: event.target.checked })} /> Focus Now</label>
        </section>
        <section className="di-node-form-section" aria-labelledby="di-node-placement-title">
          <h3 id="di-node-placement-title">Placement</h3>
          <label>Parent<select value={form.parentId || ''} onChange={event => setForm({ ...form, parentId: event.target.value || null })}><option value="">Habit root</option>{activeNodes.filter(node => !form.id || (node.id !== form.id && !getDescendantNodes(allNodes, form.id).some(child => child.id === node.id))).map(node => <option key={node.id} value={node.id}>{getNodePath(allNodes, node.id).map(part => part.title).join(' \u203a ')}</option>)}</select></label>
        </section>
        <section className="di-node-form-section" aria-labelledby="di-node-behavior-title">
          <h3 id="di-node-behavior-title">Behavior</h3>
          <div className="di-editor-field"><span>Why does this matter?</span><NoteEditor compact ariaLabel="Why does this matter?" value={form.whyItHappens} onChange={value => setForm(current => ({ ...current, whyItHappens: value }))} /></div>
          <div className="di-editor-field"><span>What will you do differently?</span><NoteEditor compact ariaLabel="What will you do differently?" value={form.whatIDoDifferently} onChange={value => setForm(current => ({ ...current, whatIDoDifferently: value }))} /></div>
        </section>
        {dialog?.node?.actionContract && <section className="di-node-form-section di-contract-summary" aria-labelledby="di-node-contract-title">
          <h3 id="di-node-contract-title">Action Contract</h3>
          <p className="di-muted">Action steps are managed in Today; this editor preserves your existing contract.</p>
          <dl><div><dt>What will you do?</dt><dd>{dialog.node.actionContract.action}</dd></div><div><dt>When?</dt><dd>{dialog.node.actionContract.trigger}</dd></div><div><dt>Minimum version</dt><dd>{dialog.node.actionContract.minimum}</dd></div><div><dt>Schedule</dt><dd>{dialog.node.actionContract.schedule?.type || 'Daily'}</dd></div></dl>
          <details><summary>More options</summary><dl>{['location','obstacle','environment','currentResponse','replacement','focusMinutes','minimumFocusMinutes'].filter(key => dialog.node.actionContract[key] != null).map(key => <div key={key}><dt>{key.replace(/[A-Z]/g, letter => ' ' + letter.toLowerCase())}</dt><dd>{String(dialog.node.actionContract[key])}</dd></div>)}</dl></details>
        </section>}
        <section className="di-node-form-section" aria-labelledby="di-node-advanced-title">
          <h3 id="di-node-advanced-title">Advanced</h3>
          <label>Context<textarea maxLength={2000} rows={3} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
          <div className="di-editor-field"><span>Notes</span><NoteEditor compact ariaLabel="Improvement notes" value={form.richNotes} onChange={value => setForm(current => ({ ...current, richNotes: value }))} /></div>
        </section>
      </div>
      <footer className="di-node-dialog-footer">
        <Button type="button" onClick={requestCloseNodeEditor}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={busy || !form.title.trim()}>{dialog?.node ? 'Save changes' : 'Add improvement'}</Button>
      </footer>
    </form>
  </Dialog>
  <Dialog open={dialog?.type === 'move-habit'} onClose={() => setDialog(null)} labelledBy="di-detail-move-title" className="di-dialog di-transition-dialog"><h2 id="di-detail-move-title">Move “{habit?.name}” to Backlog?</h2><p>Your improvement tree, notes, statuses and progress will be preserved. It will be removed from Active Habits and Quick Review until you resume improving it.</p><div className="di-actions"><Button variant="primary" onClick={pauseHabit} disabled={busy}>Move to Backlog</Button><Button onClick={() => setDialog(null)}>Cancel</Button></div></Dialog>
  <ConfirmDialog isOpen={discardNodeChanges} title="Discard unsaved changes?" message="Your edits to this improvement have not been saved." confirmLabel="Discard changes" cancelLabel="Keep editing" onCancel={() => setDiscardNodeChanges(false)} onConfirm={closeNodeEditor} />
  <ConfirmDialog isOpen={Boolean(confirm)} title={confirm?.type === 'delete' ? 'Delete improvement branch?' : isNodeBranchArchived(allNodes, confirm?.node?.id) ? 'Restore improvement branch?' : 'Archive improvement branch?'} message={confirm?.type === 'delete' ? `This improvement contains ${getDescendantNodes(allNodes, confirm.node.id).length} sub-improvements. Deleting removes the entire branch and its notes.` : isNodeBranchArchived(allNodes, confirm?.node?.id) ? 'Restore this improvement branch to the active tree?' : 'This improvement and its sub-improvements will be hidden from the active tree and Quick Review.'} confirmLabel={confirm?.type === 'delete' ? 'Delete branch' : isNodeBranchArchived(allNodes, confirm?.node?.id) ? 'Restore branch' : 'Archive branch'} onCancel={() => setConfirm(null)} onConfirm={() => { if (!confirm) return; if (confirm.type === 'delete') deleteNode(confirm.node); else if (isNodeBranchArchived(allNodes, confirm.node.id)) commit({ ...data, nodes: restoreNodeBranch(allNodes, confirm.node.id) }, 'Improvement restored.').then(() => setConfirm(null)); else archiveNode(confirm.node); }} />
  </PageShell>;
}
