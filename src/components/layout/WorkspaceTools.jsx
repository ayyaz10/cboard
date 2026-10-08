import { NoteEditor } from '../../features/notebook/NotesPanel';
import { sanitizeNoteHtml, getTextFromHtml } from '../../features/notebook/noteContent';
import { useEffect, useRef, useState } from 'react';
import { primaryNavItems } from './AppNavigation';
import { AppPicker } from './AppPicker.jsx';
import { Button } from '../ui/Button.jsx';
import { calculators } from '../../features/calculators/registry';
import { getAppHref, navigateTo } from '../../app/useRoute';
import { appendAppNote, getAppNote, subscribeToNotes, updateNote } from '../../services/noteService';
import './workspaceTools.css';

const apps = [...primaryNavItems, ...calculators.map(item => ({ path: item.path, label: item.name }))];
const escapeHtml = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function WorkspaceTools({ route, userId }) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [editingNote, setEditingNote] = useState(null);
  const [savedNote, setSavedNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const app = [...apps].sort((a, b) => b.path.length - a.path.length).find(item => route === item.path || route.startsWith(`${item.path}/`)) || { label: 'C Board', path: '/board' };
  const draft = drafts[app.path] || { text: '', kind: 'Recommendation' };
  useEffect(() => {
    if (!open) return;
    let live = true;
    const refresh = () => getAppNote(app.path, userId).then(note => { if (live) setSavedNote(note); }).catch(error => { if (live) setMessage(error.message); });
    setSavedNote(null); setEditingNote(null); refresh();
    const subscription = subscribeToNotes(userId, refresh);
    window.addEventListener('notes-changed', refresh);
    return () => { live = false; subscription.unsubscribe(); window.removeEventListener('notes-changed', refresh); };
  }, [open, app.path, userId]);
  useEffect(() => { setMessage(''); }, [route]);
  function choose(item) {
    if (item.path !== route && !window.dispatchEvent(new CustomEvent('workspace:navigate', { cancelable: true, detail: { path: item.path } }))) return false;
    navigateTo(item.path);
    return true;
  }
  function change(patch) { setDrafts(current => ({ ...current, [app.path]: { ...draft, ...patch } })); setMessage(''); }
  async function saveExisting(event) {
    event.preventDefault();
    if (lock.current || !editingNote) return;
    lock.current = true; setBusy(true); setMessage('');
    try {
      const contentHtml = sanitizeNoteHtml(editingNote.contentHtml);
      const saved = await updateNote(editingNote.id, { ...editingNote, contentHtml, contentText: getTextFromHtml(contentHtml) });
      setSavedNote(saved); setEditingNote(null); setMessage('App note updated in Notes.');
    } catch (error) { setMessage(error.message); }
    finally { lock.current = false; setBusy(false); }
  }
  async function save(event) {
    event.preventDefault();
    if (lock.current || !draft.text.trim()) return;
    lock.current = true; setBusy(true); setMessage('');
    try {
      const text = draft.text.trim();
      await appendAppNote(app.path, { title: `${app.label} Notes`, contentText: `${draft.kind}: ${text}\n\nApp: ${app.label} (${route})`,
        contentHtml: `<p><strong>${escapeHtml(draft.kind)}</strong></p><p>${escapeHtml(text).replace(/\n/g, '<br>')}</p><p><a href="${escapeHtml(getAppHref(route))}">Open ${escapeHtml(app.label)}</a></p>`,
        tags: [app.label, draft.kind.toLowerCase()] }, userId);
      setDrafts(current => ({ ...current, [app.path]: { ...draft, text: '' } }));
      setMessage('Saved to Notes.');
      window.dispatchEvent(new Event('notes-changed'));
    } catch (error) { setMessage(error.message || 'Could not save. Your text is still here.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <>
    <div className="workspace-tools">
      <AppPicker apps={apps} onChoose={choose} />
      <Button size="sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="app-note-box">{open ? 'Close note' : '+ App note'}</Button>
      {open && <form id="app-note-box" className={`workspace-note${editingNote ? ' workspace-note-editing' : ''}`} onSubmit={editingNote ? saveExisting : save}>
        <strong>{app.label} notes</strong>
        {editingNote ? <><NoteEditor value={editingNote.contentHtml} onChange={contentHtml => setEditingNote(current => ({ ...current, contentHtml }))} media={editingNote.media} onMediaChange={media => setEditingNote(current => ({ ...current, media }))} onError={setMessage} /><Button type="submit" disabled={busy}>Save app note</Button><Button type="button" disabled={busy} onClick={() => setEditingNote(null)}>Cancel edit</Button></> : <>
        {savedNote && <details><summary>Saved app note</summary><p className="workspace-note-saved">{savedNote.contentText}</p><Button type="button" size="sm" onClick={() => setEditingNote(structuredClone(savedNote))}>Edit this app note</Button></details>}
        <label>Type<select className="ui-control" disabled={busy} value={draft.kind} onChange={event => change({ kind: event.target.value })}>{['Recommendation', 'Change', 'Feature'].map(kind => <option key={kind}>{kind}</option>)}</select></label>
        <label>Your idea<textarea className="ui-control" autoFocus required maxLength={12000} rows={5} disabled={busy} value={draft.text} onChange={event => change({ text: event.target.value })} placeholder="What would you like to improve?" /></label>
        <Button type="submit" disabled={busy || !draft.text.trim()}>{busy ? 'Saving…' : 'Save to Notes'}</Button>
        </>}
        <a href={getAppHref('/notes')}>Open Notes</a>
        <p role="status">{message}</p>
      </form>}
    </div>
  </>;
}
