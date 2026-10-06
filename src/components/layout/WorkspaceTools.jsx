import { NoteEditor } from '../../features/notebook/NotesPanel';
import { sanitizeNoteHtml, getTextFromHtml } from '../../features/notebook/noteContent';
import { useEffect, useRef, useState } from 'react';
import { primaryNavItems } from './AppNavigation';
import { calculators } from '../../features/calculators/registry';
import { getAppHref, navigateTo } from '../../app/useRoute';
import { appendAppNote, getAppNote, subscribeToNotes, updateNote } from '../../services/noteService';
import './workspaceTools.css';

const apps = [...primaryNavItems, ...calculators.map(item => ({ path: item.path, label: item.name }))];
const escapeHtml = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function WorkspaceTools({ route, userId }) {
  const dialog = useRef(null);
  const input = useRef(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [editingNote, setEditingNote] = useState(null);
  const [savedNote, setSavedNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const app = [...apps].sort((a, b) => b.path.length - a.path.length).find(item => route === item.path || route.startsWith(`${item.path}/`)) || { label: 'C Board', path: '/board' };
  const draft = drafts[app.path] || { text: '', kind: 'Recommendation' };
  const matches = apps.filter(item => `${item.label} ${item.path} ${item.path === '/training' ? 'exercise workout' : ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => {
    if (!open) return;
    let live = true;
    const refresh = () => getAppNote(app.path, userId).then(note => { if (live) setSavedNote(note); }).catch(error => { if (live) setMessage(error.message); });
    setSavedNote(null); setEditingNote(null); refresh();
    const subscription = subscribeToNotes(userId, refresh);
    window.addEventListener('notes-changed', refresh);
    return () => { live = false; subscription.unsubscribe(); window.removeEventListener('notes-changed', refresh); };
  }, [open, app.path, userId]);
  function showSwitcher() {
    setQuery(''); setActive(0);
    if (!dialog.current.open) dialog.current.showModal();
    input.current.focus();
  }
  useEffect(() => {
    const handler = event => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.defaultPrevented) return;
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return;
      if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
      event.preventDefault(); event.stopImmediatePropagation(); showSwitcher();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);
  useEffect(() => { setMessage(''); }, [route]);
  function choose(item) {
    if (item.path !== route && !window.dispatchEvent(new CustomEvent('workspace:navigate', { cancelable: true, detail: { path: item.path } }))) return;
    dialog.current.close(); navigateTo(item.path);
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
      <button type="button" onClick={showSwitcher} aria-label="Switch app (slash)">Apps /</button>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="app-note-box">{open ? 'Close note' : '+ App note'}</button>
      {open && <form id="app-note-box" className={`workspace-note${editingNote ? ' workspace-note-editing' : ''}`} onSubmit={editingNote ? saveExisting : save}>
        <strong>{app.label} notes</strong>
        {editingNote ? <><NoteEditor value={editingNote.contentHtml} onChange={contentHtml => setEditingNote(current => ({ ...current, contentHtml }))} media={editingNote.media} onMediaChange={media => setEditingNote(current => ({ ...current, media }))} onError={setMessage} /><button disabled={busy}>Save app note</button><button type="button" disabled={busy} onClick={() => setEditingNote(null)}>Cancel edit</button></> : <>
        {savedNote && <details><summary>Saved app note</summary><p className="whitespace-pre-wrap max-h-48 overflow-y-auto">{savedNote.contentText}</p><button type="button" onClick={() => setEditingNote(structuredClone(savedNote))}>Edit this app note</button></details>}
        <label>Type<select disabled={busy} value={draft.kind} onChange={event => change({ kind: event.target.value })}>{['Recommendation', 'Change', 'Feature'].map(kind => <option key={kind}>{kind}</option>)}</select></label>
        <label>Your idea<textarea autoFocus required maxLength={12000} rows={5} disabled={busy} value={draft.text} onChange={event => change({ text: event.target.value })} placeholder="What would you like to improve?" /></label>
        <button disabled={busy || !draft.text.trim()}>{busy ? 'Saving…' : 'Save to Notes'}</button>
        </>}
        <a href={getAppHref('/notes')}>Open Notes</a>
        <p role="status">{message}</p>
      </form>}
    </div>
    <dialog ref={dialog} className="workspace-switcher" aria-labelledby="switcher-title" onClick={event => { if (event.target === dialog.current) dialog.current.close(); }}>
      <div className="workspace-switcher-heading"><strong id="switcher-title">Open an app</strong><button type="button" aria-label="Close popup" onClick={() => dialog.current.close()}>×</button></div>
      <input ref={input} aria-label="Search apps" role="combobox" aria-expanded="true" aria-controls="app-results" aria-activedescendant={matches[active] ? `app-result-${active}` : undefined} autoComplete="off" value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(index => matches.length ? (index + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length : 0); }
        if (event.key === 'Enter' && matches[active]) { event.preventDefault(); choose(matches[active]); }
      }} placeholder="Type an app name, then press Enter" />
      <div id="app-results" role="listbox" aria-label="Apps">{matches.map((item, index) => <button type="button" role="option" aria-selected={index === active} id={`app-result-${index}`} key={item.path} onClick={() => choose(item)}>{item.label}</button>)}</div>
      {!matches.length && <p>No apps found.</p>}
    </dialog>
  </>;
}
