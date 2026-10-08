import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '../ui/Button.jsx';
import { Dialog } from '../ui/Dialog.jsx';
import { IconButton } from '../ui/IconButton.jsx';
import { filterApps, nextAppIndex } from './appPicker.js';

export function AppPicker({ apps, onChoose }) {
  const id = useId();
  const input = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const matches = useMemo(() => filterApps(apps, query), [apps, query]);
  useEffect(() => {
    if (!open) return;
    setQuery(''); setActive(0);
    requestAnimationFrame(() => input.current?.focus());
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const option = document.getElementById(`${id}-result-${active}`);
    option?.scrollIntoView({ block: 'nearest' });
  }, [active, id, open]);
  useEffect(() => {
    const handler = event => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.defaultPrevented) return;
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return;
      if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
      event.preventDefault(); event.stopImmediatePropagation(); setOpen(true);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);
  function choose(item) { if (onChoose(item) !== false) setOpen(false); }
  return <>
    <Button size="sm" className="app-picker-trigger" onClick={() => setOpen(true)} aria-label="Switch app (slash)">Apps /</Button>
    <Dialog open={open} onClose={() => setOpen(false)} labelledBy={`${id}-title`} className="workspace-switcher">
      <div className="workspace-switcher-heading"><strong id={`${id}-title`}>Open an app</strong><IconButton label="Close app launcher" onClick={() => setOpen(false)}>×</IconButton></div>
      <input ref={input} className="ui-control" aria-label="Search apps" role="combobox" aria-expanded="true" aria-controls={`${id}-results`} aria-activedescendant={matches[active] ? `${id}-result-${active}` : undefined} autoComplete="off" value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(index => nextAppIndex(index, matches.length, event.key)); }
        if (event.key === 'Enter' && matches[active]) { event.preventDefault(); choose(matches[active]); }
      }} placeholder="Search apps" />
      <div id={`${id}-results`} className="app-picker-results" role="listbox" aria-label="Apps">{matches.map((item, index) => <Button variant="ghost" size="sm" role="option" aria-selected={index === active} id={`${id}-result-${index}`} className="app-picker-option" key={item.path} onClick={() => choose(item)}>{item.label}</Button>)}</div>
      {!matches.length && <p className="app-picker-empty">No apps found.</p>}
    </Dialog>
  </>;
}
