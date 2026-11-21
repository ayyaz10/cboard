import { useCallback, useEffect, useRef, useState } from 'react';
import { PageShell } from '../../components/layout/PageShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { FormField } from '../../components/ui/FormField.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { getAppHref, navigateTo } from '../../app/useRoute.js';
import { createLifeArea, createLifeItem, listLifeAreas, listLifeItems, listLifeItemNotes, listLifeItemTasks, linkLifeItemTask, reorderLifeAreas, setLifeAreaArchived, updateLifeArea, updateLifeItem } from '../../services/lifeAreasService.js';
import { completeTask, createTask } from '../../services/taskService.js';
import { getGoals } from '../../services/goalService.js';
import { localDateTimeToInstant } from '../../services/reminderDateTime.js';
import { LIFE_AREA_COLORS, LIFE_AREA_ICONS, createLifeRecordId, normalizeAreaInput, normalizeLifeItemInput, youtubeTimestampUrl } from './lifeAreaModel.js';
import './lifeAreas.css';

const blankArea = { name: '', description: '', icon: LIFE_AREA_ICONS[0], color: LIFE_AREA_COLORS[0] };
const blankItem = { name: '', description: '', itemType: 'project', status: 'active', targetDate: '' };
function readPendingSave(key) { try { return JSON.parse(window.sessionStorage.getItem(key) || 'null'); } catch { return null; } }
function persistPendingSave(key, value) { try { if (value) window.sessionStorage.setItem(key, JSON.stringify(value)); else window.sessionStorage.removeItem(key); return true; } catch { return false; } }

function AreaCard({ area, index, total, editing, setEditing, onSave, onArchive, onMove, onOpen }) {
  const [draft, setDraft] = useState({ name: area.name, description: area.description, icon: area.icon, color: area.color });
  useEffect(() => setDraft({ name: area.name, description: area.description, icon: area.icon, color: area.color }), [area.name, area.description, area.icon, area.color]);
  return <article className="life-area-card" style={{ '--life-area-color': area.color }}>
    {editing ? <form onSubmit={event => { event.preventDefault(); onSave(area, draft); }} className="life-edit-form">
      <FormField label="Area name" htmlFor={`area-name-${area.id}`}><input id={`area-name-${area.id}`} className="ui-control" maxLength={80} required value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })}/></FormField>
      <FormField label="Description" htmlFor={`area-description-${area.id}`}><input id={`area-description-${area.id}`} className="ui-control" maxLength={500} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })}/></FormField>
      <div className="life-inline-fields"><FormField label="Icon"><select className="ui-control" value={draft.icon} onChange={event => setDraft({ ...draft, icon: event.target.value })}>{LIFE_AREA_ICONS.map(icon => <option key={icon}>{icon}</option>)}</select></FormField><FormField label="Colour"><select className="ui-control" value={draft.color} onChange={event => setDraft({ ...draft, color: event.target.value })}>{LIFE_AREA_COLORS.map(color => <option key={color} value={color}>{color}</option>)}</select></FormField></div>
      <div className="life-actions"><Button type="submit" variant="primary">Save area</Button><Button type="button" onClick={() => setEditing('')}>Cancel</Button></div>
    </form> : <>
      <div className="life-area-title"><span aria-hidden="true">{area.icon}</span><div><h2>{area.name}</h2><p>{area.description || 'No description yet.'}</p></div></div>
      <div className="life-actions"><Button onClick={() => onOpen(area.id)}>Open area</Button><Button onClick={() => setEditing(area.id)}>Rename / edit</Button><Button disabled={index === 0} onClick={() => onMove(index, -1)} aria-label={`Move ${area.name} up`}>Move up</Button><Button disabled={index === total - 1} onClick={() => onMove(index, 1)} aria-label={`Move ${area.name} down`}>Move down</Button><Button onClick={() => onArchive(area)}>{area.archivedAt ? 'Restore area' : 'Archive area'}</Button></div>
    </>}
  </article>;
}

function ItemCard({ item: entry, onOpen }) {
  return <button type="button" className="life-item-card" onClick={() => onOpen(entry.id)}><span className="life-item-kind">{entry.itemType}</span><strong>{entry.name}</strong><span>{entry.description || 'Open to see notes and tasks.'}</span><span className="life-item-meta">{entry.status}{entry.targetDate ? `  |  target ${entry.targetDate}` : ''}{entry.linkedGoalId ? '  |  linked goal' : ''}</span></button>;
}

function LearningNotes({ rows, onPractice, disabled = false }) {
  return <section className="life-detail-section" aria-labelledby="learning-notes-heading"><header><div><p className="life-area-eyebrow">Learn and apply</p><h2 id="learning-notes-heading">Learning notes</h2></div></header>
    <p className="life-help">Create or attach a note in your existing Notebook. Link it back to this Project or Skill there.</p>
    <a className="life-notebook-link" href={getAppHref(`/notes?lifeItemId=${encodeURIComponent(window.location.pathname.split('/').at(-1) || '')}`)}>Create or attach a Notebook note</a>
    {rows.status === 'loading' ? <p role="status">Loading linked notes...</p> : rows.error ? <p role="alert">{rows.error}</p> : rows.notes.length ? <ul className="life-note-list">{rows.notes.map(note => <li key={note.id}><div><h3><a href={getAppHref(`/notes/${encodeURIComponent(note.id)}`)}>{note.title}</a></h3><p>{note.preview || note.keyTakeaways || 'No preview text.'}</p><small>{note.sourceType}{note.sourceUrl && <>  |  <a href={youtubeTimestampUrl(note.sourceUrl, note.youtubeSeconds) || note.sourceUrl} target="_blank" rel="noreferrer">Open source{note.youtubeSeconds != null ? ` at ${Math.floor(note.youtubeSeconds / 60)}:${String(note.youtubeSeconds % 60).padStart(2, '0')}` : ''}</a></>}</small>{note.keyTakeaways && <p><strong>Takeaway:</strong> {note.keyTakeaways}</p>}</div><Button disabled={disabled} onClick={() => onPractice(note)}>Create practice task</Button></li>)}</ul> : <p className="life-empty">No learning notes linked yet.</p>}
  </section>;
}

export function LifeAreasPage({ areaId = '', itemId = '' }) {
  const { user } = useAuth();
  const [areas, setAreas] = useState([]), [areaLoading, setAreaLoading] = useState(true), [areaError, setAreaError] = useState('');
  const areaPendingKey = `cboard:life-area-pending:${user?.id || 'signed-out'}`;
  const itemPendingKey = `cboard:life-item-pending:${user?.id || 'signed-out'}:${areaId || 'new'}`;
  const taskPendingKey = `cboard:life-task-pending:${user?.id || 'signed-out'}:${itemId || 'new'}`;
  const restoredTaskPending = readPendingSave(taskPendingKey);
  const [pendingArea, setPendingArea] = useState(() => readPendingSave(areaPendingKey));
  const [pendingItem, setPendingItem] = useState(() => readPendingSave(itemPendingKey));
  const [areaDraft, setAreaDraft] = useState(() => readPendingSave(areaPendingKey)?.values || blankArea), [itemDraft, setItemDraft] = useState(() => readPendingSave(itemPendingKey)?.values || blankItem);
  const [editingAreaId, setEditingAreaId] = useState(''), [saving, setSaving] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [taskTitle, setTaskTitle] = useState(restoredTaskPending?.values?.title || ''), [taskDate, setTaskDate] = useState(restoredTaskPending?.values?.date || ''), [taskTime, setTaskTime] = useState(restoredTaskPending?.values?.time || ''), [practiceNote, setPracticeNote] = useState(null), [pendingTaskId, setPendingTaskId] = useState(restoredTaskPending?.id || '');
  const pendingTaskIdRef = useRef(restoredTaskPending?.id || ''), pendingTaskValues = useRef(restoredTaskPending?.values || null), submitLock = useRef(false);
  const areaPendingRef = useRef(pendingArea), itemPendingRef = useRef(pendingItem), areaSubmitLock = useRef(false), itemSubmitLock = useRef(false);
  const [tasksState, setTasksState] = useState({ status: 'loading', tasks: [], error: '' });
  const [notesState, setNotesState] = useState({ status: 'loading', notes: [], error: '' });
  const [goals, setGoals] = useState([]), [goalsError, setGoalsError] = useState('');
  const [itemEditDraft, setItemEditDraft] = useState(null);

  const refreshAreas = useCallback(async () => {
    setAreaLoading(true); setAreaError('');
    try { setAreas(await listLifeAreas({ includeArchived: true })); }
    catch (problem) { setAreaError(problem?.message || 'Life Areas could not be loaded.'); }
    finally { setAreaLoading(false); }
  }, [user?.id]);
  const selectedArea = areas.find(entry => entry.id === areaId) || null;
  const items = useCallback(async () => areaId ? listLifeItems(areaId) : [], [areaId]);
  const [areaItems, setAreaItems] = useState([]), [itemsLoading, setItemsLoading] = useState(false);

  useEffect(() => { setAreas([]); void refreshAreas(); }, [refreshAreas, user?.id]);
  useEffect(() => {
    let alive = true;
    if (!areaId) { setAreaItems([]); return () => { alive = false; }; }
    setItemsLoading(true);
    items().then(rows => { if (alive) setAreaItems(rows); }).catch(problem => { if (alive) setError(problem?.message || 'Projects and Skills could not be loaded.'); }).finally(() => { if (alive) setItemsLoading(false); });
    return () => { alive = false; };
  }, [areaId, items]);
  const selectedItem = areaItems.find(entry => entry.id === itemId) || null;
  const refreshItemDetail = useCallback(async () => {
    if (!itemId) return;
    setTasksState({ status: 'loading', tasks: [], error: '' }); setNotesState({ status: 'loading', notes: [], error: '' });
    const [taskResult, noteResult] = await Promise.allSettled([listLifeItemTasks(itemId), listLifeItemNotes(itemId)]);
    setTasksState(taskResult.status === 'fulfilled' ? { status: 'ready', tasks: taskResult.value, error: '' } : { status: 'error', tasks: [], error: taskResult.reason?.message || 'Tasks could not be loaded.' });
    setNotesState(noteResult.status === 'fulfilled' ? { status: 'ready', notes: noteResult.value, error: '' } : { status: 'error', notes: [], error: noteResult.reason?.message || 'Notes could not be loaded.' });
  }, [itemId]);
  useEffect(() => { const pending = readPendingSave(taskPendingKey); pendingTaskIdRef.current = pending?.id || ''; pendingTaskValues.current = pending?.values || null; setPendingTaskId(pending?.id || ''); setTaskTitle(pending?.values?.title || ''); setTaskDate(pending?.values?.date || ''); setTaskTime(pending?.values?.time || ''); setPracticeNote(null); }, [taskPendingKey]);
  useEffect(() => { void refreshItemDetail(); }, [refreshItemDetail]);
  useEffect(() => { let active = true; getGoals().then(rows => { if (active) setGoals(rows); }).catch(problem => { if (active) setGoalsError(problem?.message || 'Goals could not be loaded.'); }); return () => { active = false; }; }, [user?.id]);

  async function saveArea(event) {
    event.preventDefault();
    if (areaSubmitLock.current) return;
    areaSubmitLock.current = true; setSaving(true); setError(''); setMessage('');
    try {
      if (!areaPendingRef.current) {
        const values = normalizeAreaInput(areaDraft);
        areaPendingRef.current = { id: createLifeRecordId(), values };
        setPendingArea(areaPendingRef.current);
      }
      if (!persistPendingSave(areaPendingKey, areaPendingRef.current)) throw new Error('This browser could not keep a retry record. Free session storage and retry before saving the area.');
      const saved = await createLifeArea({ id: areaPendingRef.current.id, ...areaPendingRef.current.values });
      setAreas(current => current.some(entry => entry.id === saved.id) ? current : [...current, saved]); setAreaDraft(blankArea); areaPendingRef.current = null; setPendingArea(null); persistPendingSave(areaPendingKey, null); setMessage('Life area saved.');
    } catch (problem) { setError(`${problem?.message || 'Life area could not be saved.'} Retry to safely finish the same save.`); }
    finally { setSaving(false); areaSubmitLock.current = false; }
  }
  async function commitAreaEdit(area, draft) {
    setSaving(true); setError('');
    try { const saved = await updateLifeArea(area.id, draft, area.updatedAt); setAreas(current => current.map(entry => entry.id === area.id ? saved : entry)); setEditingAreaId(''); setMessage('Life area updated.'); }
    catch (problem) { setError(problem?.message || 'Life area could not be updated.'); }
    finally { setSaving(false); }
  }
  async function archiveArea(area) {
    setError('');
    try { const saved = await setLifeAreaArchived(area.id, !area.archivedAt, area.updatedAt); setAreas(current => current.map(entry => entry.id === area.id ? saved : entry)); setMessage(area.archivedAt ? 'Life area restored.' : 'Life area archived. Its Projects, Skills and links are preserved.'); }
    catch (problem) { setError(problem?.message || 'Life area could not be updated.'); }
  }
  async function moveArea(index, direction) {
    const next = [...areas], other = index + direction;
    if (other < 0 || other >= next.length) return;
    [next[index], next[other]] = [next[other], next[index]];
    setAreas(next);
    try { await reorderLifeAreas(next.map(entry => entry.id)); setMessage('Life area order saved.'); }
    catch (problem) { setAreaError(problem?.message || 'Order could not be saved.'); await refreshAreas(); }
  }
  async function saveItem(event) {
    event.preventDefault(); if (!areaId || selectedArea?.archivedAt || itemSubmitLock.current) return;
    itemSubmitLock.current = true; setSaving(true); setError('');
    try {
      if (!itemPendingRef.current) {
        const values = normalizeLifeItemInput(itemDraft);
        itemPendingRef.current = { id: createLifeRecordId(), areaId, values };
        setPendingItem(itemPendingRef.current);
      }
      const pending = itemPendingRef.current;
      if (!persistPendingSave(itemPendingKey, pending)) throw new Error('This browser could not keep a retry record. Free session storage and retry before saving the Project or Skill.');
      if (pending.areaId !== areaId) throw new Error('This pending save belongs to another Life Area.');
      const saved = await createLifeItem(areaId, { id: pending.id, ...pending.values });
      setAreaItems(current => current.some(entry => entry.id === saved.id) ? current : [...current, saved]); setItemDraft(blankItem); itemPendingRef.current = null; setPendingItem(null); persistPendingSave(itemPendingKey, null); setMessage(`${saved.itemType === 'skill' ? 'Skill' : 'Project'} created.`);
    } catch (problem) { setError(`${problem?.message || 'Project or Skill could not be saved.'} Retry to safely finish the same save.`); }
    finally { setSaving(false); itemSubmitLock.current = false; }
  }
  async function saveItemEdits(event) {
    event.preventDefault();
    if (!selectedItem || !itemEditDraft) return;
    setSaving(true); setError('');
    try { const saved = await updateLifeItem(selectedItem.id, { ...selectedItem, ...itemEditDraft }, selectedItem.updatedAt); setAreaItems(current => current.map(entry => entry.id === saved.id ? saved : entry)); setItemEditDraft(null); setMessage('Project or Skill updated.'); }
    catch (problem) { setError(problem?.message || 'Project or Skill could not be updated. Refresh before retrying.'); }
    finally { setSaving(false); }
  }

  async function saveItemStatus(status) {
    if (!selectedItem) return;
    setError('');
    try { const saved = await updateLifeItem(selectedItem.id, { ...selectedItem, status, linkedGoalId: selectedItem.linkedGoalId }, selectedItem.updatedAt); setAreaItems(current => current.map(entry => entry.id === saved.id ? saved : entry)); setMessage('Project or Skill updated.'); }
    catch (problem) { setError(problem?.message || 'Project or Skill could not be updated.'); }
  }
  async function changeGoal(goalId) {
    if (!selectedItem) return;
    try { const saved = await updateLifeItem(selectedItem.id, { ...selectedItem, linkedGoalId: goalId }, selectedItem.updatedAt); setAreaItems(current => current.map(entry => entry.id === saved.id ? saved : entry)); setMessage(goalId ? 'Existing goal linked.' : 'Goal unlinked.'); }
    catch (problem) { setError(problem?.message || 'Goal link could not be saved.'); }
  }
  function startPractice(note) { if (pendingTaskIdRef.current) return; setPracticeNote(note); setTaskTitle(`Practice: ${note.title}`.slice(0, 120)); setTaskDate(''); setTaskTime(''); setPendingTaskId(''); pendingTaskIdRef.current = ''; pendingTaskValues.current = null; setError(''); }
  async function saveLinkedTask(event) {
    event.preventDefault();
    if (!selectedItem || submitLock.current) return;
    submitLock.current = true; setSaving(true); setError('');
    try {
      if (!pendingTaskIdRef.current) {
        const title = taskTitle.trim();
        if (!title || title.length > 120) throw new Error('Enter a task title up to 120 characters.');
        if (Boolean(taskDate) !== Boolean(taskTime)) throw new Error('Enter both date and time, or leave both blank.');
        const dueAt = taskDate ? localDateTimeToInstant(taskDate, taskTime) : null;
        pendingTaskIdRef.current = createLifeRecordId();
        pendingTaskValues.current = { title, dueAt, date: taskDate, time: taskTime };
      }
      setPendingTaskId(pendingTaskIdRef.current);
      if (!persistPendingSave(taskPendingKey, { id: pendingTaskIdRef.current, values: pendingTaskValues.current })) throw new Error('This browser could not keep a retry record. Free session storage and retry before saving the task.');
      const task = await createTask({ id: pendingTaskIdRef.current, title: pendingTaskValues.current.title, dueAt: pendingTaskValues.current.dueAt, priority: 'normal', description: '' });
      await linkLifeItemTask(selectedItem.id, task.id);
      setPendingTaskId(''); pendingTaskIdRef.current = ''; pendingTaskValues.current = null; persistPendingSave(taskPendingKey, null); setTaskTitle(''); setTaskDate(''); setTaskTime(''); setPracticeNote(null); setMessage('Task saved and linked.'); await refreshItemDetail();
    } catch (problem) { setError(`${problem?.message || 'Task save or link could not be confirmed.'} Retry to safely finish the same save.`); }
    finally { setSaving(false); submitLock.current = false; }
  }
  async function markTaskDone(task) {
    setError('');
    try { await completeTask(task.id); setMessage('Task completed.'); await refreshItemDetail(); }
    catch (problem) { setError(problem?.message || 'Task completion could not be confirmed. Refresh and retry.'); }
  }

  return <PageShell><main className="life-areas-page" aria-labelledby="life-areas-title">
    <nav className="life-breadcrumbs" aria-label="Breadcrumb"><a href={getAppHref('/board')}>My Life</a>{areaId && <><span aria-hidden="true">/</span><a href={getAppHref('/life-areas')}>Life Areas</a></>}{selectedArea && <><span aria-hidden="true">/</span><a href={getAppHref(`/life-areas/${areaId}`)}>{selectedArea.name}</a></>}{selectedItem && <><span aria-hidden="true">/</span><span>{selectedItem.name}</span></>}</nav>
    {error && <p className="life-form-error" role="alert">{error}</p>}{message && <p className="life-save-message" role="status">{message}</p>}
    {!areaId ? <>
      <header className="life-areas-heading"><div><p className="life-area-eyebrow">Organize what matters</p><h1 id="life-areas-title">Life Areas</h1><p>Keep your Projects, Skills, notes, goals and tasks together.</p></div></header>
      <form className="life-area-create panel" onSubmit={saveArea}><h2>New life area</h2><div className="life-area-form-grid"><FormField label="Name" htmlFor="life-area-name"><input id="life-area-name" className="ui-control" disabled={Boolean(pendingArea)} maxLength={80} required value={areaDraft.name} onChange={event => setAreaDraft({ ...areaDraft, name: event.target.value })} placeholder="e.g. Fitness & Health"/></FormField><FormField label="Description" htmlFor="life-area-description"><input id="life-area-description" className="ui-control" disabled={Boolean(pendingArea)} maxLength={500} value={areaDraft.description} onChange={event => setAreaDraft({ ...areaDraft, description: event.target.value })} placeholder="What belongs in this area?"/></FormField><FormField label="Icon"><select className="ui-control" disabled={Boolean(pendingArea)} value={areaDraft.icon} onChange={event => setAreaDraft({ ...areaDraft, icon: event.target.value })}>{LIFE_AREA_ICONS.map(icon => <option key={icon}>{icon}</option>)}</select></FormField><FormField label="Colour"><select className="ui-control" disabled={Boolean(pendingArea)} value={areaDraft.color} onChange={event => setAreaDraft({ ...areaDraft, color: event.target.value })}>{LIFE_AREA_COLORS.map(color => <option value={color} key={color}>{color}</option>)}</select></FormField></div><Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving...' : pendingArea ? 'Retry save' : 'Create area'}</Button></form>
      <section className="life-area-list" aria-label="Your Life Areas"><h2>Your areas</h2>{areaLoading ? <p role="status">Loading Life Areas...</p> : areaError ? <div role="alert"><p>{areaError}</p><Button onClick={refreshAreas}>Retry</Button></div> : areas.length ? areas.map((entry, index) => <AreaCard key={entry.id} area={entry} index={index} total={areas.length} editing={editingAreaId === entry.id} setEditing={setEditingAreaId} onSave={commitAreaEdit} onArchive={archiveArea} onMove={moveArea} onOpen={id => navigateTo(`/life-areas/${encodeURIComponent(id)}`)}/>) : <p className="life-empty">No areas yet. Create one to get started.</p>}</section>
    </> : !selectedArea ? areaLoading ? <p role="status">Loading Life Area...</p> : <section className="panel"><h1 id="life-areas-title">Life Area unavailable</h1><p>This area may have been archived or belongs to another account.</p><Button onClick={() => navigateTo('/life-areas')}>Back to Life Areas</Button></section>
      : !itemId ? <>
        <header className="life-area-detail-heading" style={{ '--life-area-color': selectedArea.color }}><span aria-hidden="true">{selectedArea.icon}</span><div><p className="life-area-eyebrow">Life Area</p><h1 id="life-areas-title">{selectedArea.name}</h1><p>{selectedArea.description}</p></div>{selectedArea.archivedAt && <span className="life-archived-label">Archived</span>}</header>
        <section className="life-detail-section"><header><div><p className="life-area-eyebrow">Build toward something</p><h2>Projects and Skills</h2></div></header>
          {!selectedArea.archivedAt && <form className="life-item-create" onSubmit={saveItem}><FormField label="Name" htmlFor="life-item-name"><input id="life-item-name" className="ui-control" disabled={Boolean(pendingItem)} maxLength={100} required value={itemDraft.name} onChange={event => setItemDraft({ ...itemDraft, name: event.target.value })}/></FormField><div className="life-inline-fields"><FormField label="Type" htmlFor="life-item-type"><select id="life-item-type" className="ui-control" disabled={Boolean(pendingItem)} value={itemDraft.itemType} onChange={event => setItemDraft({ ...itemDraft, itemType: event.target.value })}><option value="project">Project</option><option value="skill">Skill</option></select></FormField><FormField label="Target date (optional)" htmlFor="life-item-target-date"><input id="life-item-target-date" className="ui-control" disabled={Boolean(pendingItem)} type="date" value={itemDraft.targetDate} onChange={event => setItemDraft({ ...itemDraft, targetDate: event.target.value })}/></FormField></div><FormField label="Description (optional)" htmlFor="life-item-description"><textarea id="life-item-description" className="ui-control" disabled={Boolean(pendingItem)} maxLength={1000} value={itemDraft.description} onChange={event => setItemDraft({ ...itemDraft, description: event.target.value })}/></FormField><Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving...' : pendingItem ? 'Retry save' : 'Add Project or Skill'}</Button></form>}
          {itemsLoading ? <p role="status">Loading Projects and Skills...</p> : areaItems.length ? <div className="life-item-grid">{areaItems.map(entry => <ItemCard key={entry.id} item={entry} onOpen={id => navigateTo(`/life-areas/${encodeURIComponent(areaId)}/${encodeURIComponent(id)}`)}/>)}</div> : <p className="life-empty">No Projects or Skills in this area yet.</p>}
        </section>
      </> : !selectedItem ? itemsLoading ? <p role="status">Loading Project or Skill...</p> : <section className="panel"><h1 id="life-areas-title">Project or Skill unavailable</h1><p>It may have been archived or belongs to another account.</p><Button onClick={() => navigateTo(`/life-areas/${encodeURIComponent(areaId)}`)}>Back to area</Button></section>
      : <>
        <header className="life-area-detail-heading" style={{ '--life-area-color': selectedArea.color }}><span aria-hidden="true">{selectedArea.icon}</span><div><p className="life-area-eyebrow">{selectedItem.itemType} in {selectedArea.name}</p><h1 id="life-areas-title">{selectedItem.name}</h1><p>{selectedItem.description}</p></div><label className="life-status-control">Status<select className="ui-control" value={selectedItem.status} onChange={event => saveItemStatus(event.target.value)}><option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option><option value="archived">Archived</option></select></label></header>
        <section className="life-detail-section"><header><div><p className="life-area-eyebrow">Details</p><h2>Project or Skill</h2></div><Button onClick={() => setItemEditDraft({ name: selectedItem.name, description: selectedItem.description, itemType: selectedItem.itemType, status: selectedItem.status, targetDate: selectedItem.targetDate || '' })}>Edit details</Button></header>{itemEditDraft && <form className="life-item-create" onSubmit={saveItemEdits}><FormField label="Name" htmlFor="life-item-edit-name"><input id="life-item-edit-name" className="ui-control" required maxLength={100} value={itemEditDraft.name} onChange={event => setItemEditDraft({ ...itemEditDraft, name: event.target.value })}/></FormField><div className="life-inline-fields"><FormField label="Type" htmlFor="life-item-edit-type"><select id="life-item-edit-type" className="ui-control" value={itemEditDraft.itemType} onChange={event => setItemEditDraft({ ...itemEditDraft, itemType: event.target.value })}><option value="project">Project</option><option value="skill">Skill</option></select></FormField><FormField label="Target date" htmlFor="life-item-edit-date"><input id="life-item-edit-date" className="ui-control" type="date" value={itemEditDraft.targetDate} onChange={event => setItemEditDraft({ ...itemEditDraft, targetDate: event.target.value })}/></FormField></div><FormField label="Description" htmlFor="life-item-edit-description"><textarea id="life-item-edit-description" className="ui-control" maxLength={1000} value={itemEditDraft.description} onChange={event => setItemEditDraft({ ...itemEditDraft, description: event.target.value })}/></FormField><div className="life-actions"><Button type="submit" variant="primary" disabled={saving}>Save details</Button><Button type="button" onClick={() => setItemEditDraft(null)}>Cancel</Button></div></form>}</section>
        <section className="life-detail-section"><header><div><p className="life-area-eyebrow">Progress Tracker</p><h2>Linked goal</h2></div></header>{goalsError && <p role="alert">{goalsError}</p>}<FormField label="Existing goal" htmlFor="life-item-linked-goal"><select id="life-item-linked-goal" className="ui-control life-goal-select" value={selectedItem.linkedGoalId} onChange={event => changeGoal(event.target.value)}><option value="">No linked goal</option>{goals.map(goal => <option value={goal.id} key={goal.id}>{goal.title}</option>)}</select></FormField>{selectedItem.targetDate && <p className="life-muted">Target date: {selectedItem.targetDate}</p>}</section>
        <section className="life-detail-section" aria-labelledby="life-tasks-heading"><header><div><p className="life-area-eyebrow">Take action</p><h2 id="life-tasks-heading">Tasks</h2></div><span>{tasksState.status === 'ready' ? tasksState.tasks.length : ''}</span></header>
          {!practiceNote && <form className="life-task-create" onSubmit={saveLinkedTask}><FormField label="Task title" htmlFor="life-task-title"><input id="life-task-title" className="ui-control" required maxLength={120} value={pendingTaskId ? pendingTaskValues.current?.title || taskTitle : taskTitle} disabled={Boolean(pendingTaskId)} onChange={event => setTaskTitle(event.target.value)} placeholder="What will you do next?"/></FormField><div className="life-inline-fields"><FormField label="Date (optional)" htmlFor="life-task-date"><input id="life-task-date" className="ui-control" type="date" value={taskDate} disabled={Boolean(pendingTaskId)} onChange={event => setTaskDate(event.target.value)}/></FormField><FormField label="Time (optional)" htmlFor="life-task-time"><input id="life-task-time" className="ui-control" type="time" value={taskTime} disabled={Boolean(pendingTaskId)} onChange={event => setTaskTime(event.target.value)}/></FormField></div><Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving...' : pendingTaskId ? 'Retry save' : 'Add task'}</Button></form>}
          {tasksState.status === 'loading' ? <p role="status">Loading linked tasks...</p> : tasksState.status === 'error' ? <p role="alert">{tasksState.error}<Button onClick={refreshItemDetail}>Retry</Button></p> : tasksState.tasks.length ? <ul className="life-task-list">{tasksState.tasks.map(task => <li key={task.id}><div><strong>{task.title}</strong><span>{task.dueAt ? new Date(task.dueAt).toLocaleString() : 'Undated'}  |  {task.completedAt ? 'Completed' : task.priority}</span></div>{!task.completedAt && <Button onClick={() => markTaskDone(task)}>Complete</Button>}</li>)}</ul> : <p className="life-empty">No linked tasks yet.</p>}
        </section>
        <LearningNotes rows={notesState} onPractice={startPractice} disabled={Boolean(pendingTaskId)}/>
        {practiceNote && <section className="life-detail-section"><form className="life-task-create" onSubmit={saveLinkedTask}><h2>Create practice task from {practiceNote.title}</h2><p>Review the title and choose a date and time if you want. Nothing is created until you save.</p><FormField label="Practice task title" htmlFor="practice-task-title"><input id="practice-task-title" className="ui-control" required maxLength={120} value={pendingTaskId ? pendingTaskValues.current?.title || taskTitle : taskTitle} disabled={Boolean(pendingTaskId)} onChange={event => setTaskTitle(event.target.value)}/></FormField><div className="life-inline-fields"><FormField label="Date (optional)" htmlFor="practice-task-date"><input id="practice-task-date" className="ui-control" type="date" value={taskDate} disabled={Boolean(pendingTaskId)} onChange={event => setTaskDate(event.target.value)}/></FormField><FormField label="Time (optional)" htmlFor="practice-task-time"><input id="practice-task-time" className="ui-control" type="time" value={taskTime} disabled={Boolean(pendingTaskId)} onChange={event => setTaskTime(event.target.value)}/></FormField></div><div className="life-actions"><Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving...' : pendingTaskId ? 'Retry save' : 'Save practice task'}</Button><Button type="button" disabled={Boolean(pendingTaskId)} onClick={() => { setPracticeNote(null); }}>Cancel</Button></div></form></section>}
      </>}
  </main></PageShell>;
}
