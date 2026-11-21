import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button.jsx';
import { DASHBOARD_WIDGETS, getAvailablePinnedTools } from './dashboardWidgets.js';

export function DashboardCustomization({ layout, calculators, onChange, onReset, onDone, saveStatus, saveError, onRetry }) {
  const [search, setSearch] = useState('');
  const tools = useMemo(() => getAvailablePinnedTools(calculators), [calculators]);
  const visible = new Set(layout.widgets.map(widget => widget.id));
  const pinned = new Set(layout.pinnedTools);
  const ordered = layout.widgets.map(entry => ({ entry, definition: DASHBOARD_WIDGETS.find(widget => widget.id === entry.id) })).filter(row => row.definition);
  const results = tools.filter(tool => `${tool.name} ${tool.description}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  function toggleWidget(id, checked) { onChange({ ...layout, widgets: checked ? [...layout.widgets, { id, size: DASHBOARD_WIDGETS.find(widget => widget.id === id).sizes[0] }] : layout.widgets.filter(widget => widget.id !== id) }); }
  function moveWidget(id, direction) {
    const index = layout.widgets.findIndex(widget => widget.id === id), target = index + direction;
    if (target < 0 || target >= layout.widgets.length) return;
    const widgets = [...layout.widgets]; [widgets[index], widgets[target]] = [widgets[target], widgets[index]]; onChange({ ...layout, widgets });
  }
  function moveTool(id, direction) {
    const index = layout.pinnedTools.indexOf(id), target = index + direction;
    if (target < 0 || target >= layout.pinnedTools.length) return;
    const pinnedTools = [...layout.pinnedTools]; [pinnedTools[index], pinnedTools[target]] = [pinnedTools[target], pinnedTools[index]]; onChange({ ...layout, pinnedTools });
  }
  function toggleTool(id, checked) { onChange({ ...layout, pinnedTools: checked ? [...layout.pinnedTools, id] : layout.pinnedTools.filter(value => value !== id) }); }
  return <section className="dashboard-customizer" aria-labelledby="dashboard-customizer-title">
    <header><div><p className="today-card-eyebrow">Dashboard settings</p><h2 id="dashboard-customizer-title">Customize Dashboard</h2><p>Changes preview on the dashboard as you edit.</p></div><Button onClick={onDone} variant="primary">Save layout</Button></header>
    <p role="status" className="dashboard-save-status">{saveStatus === 'saving' ? 'Saving your layout…' : saveStatus === 'saved' ? 'Layout saved to your account.' : saveStatus === 'unsaved' ? 'Previewing edits. Save your layout to sync across your devices.' : 'Changes are saved to your account.'}</p>
    {saveError && <div className="today-dashboard-alert" role="alert"><span>{saveError}</span>{saveStatus === 'error' && <Button onClick={onRetry}>Retry save</Button>}</div>}
    <fieldset><legend>Widgets</legend><ul className="dashboard-editor-list">{ordered.map(({ entry, definition }, index) => <li key={entry.id}>
      <div className="dashboard-editor-title"><label><input type="checkbox" checked disabled={Boolean(definition.required)} aria-label={`${definition.name} widget visibility${definition.required ? ' (always shown)' : ''}`} onChange={event => toggleWidget(entry.id, event.target.checked)}/><span><strong>{definition.name}</strong><small>{definition.description}</small></span></label></div>
      <div className="dashboard-editor-actions"><label>Size<select aria-label={`${definition.name} size`} value={entry.size} onChange={event => onChange({ ...layout, widgets: layout.widgets.map(item => item.id === entry.id ? { ...item, size: event.target.value } : item) })}>{definition.sizes.map(size => <option key={size} value={size}>{size[0].toUpperCase() + size.slice(1)}</option>)}</select></label><Button aria-label={`Move ${definition.name} up`} disabled={index === 0} onClick={() => moveWidget(entry.id, -1)}>Move up</Button><Button aria-label={`Move ${definition.name} down`} disabled={index === ordered.length - 1} onClick={() => moveWidget(entry.id, 1)}>Move down</Button></div>
    </li>)}</ul><div className="dashboard-widget-choices"><p>Add a widget</p>{DASHBOARD_WIDGETS.filter(widget => !visible.has(widget.id)).map(widget => <label key={widget.id}><input type="checkbox" checked={false} aria-label={`${widget.name} widget visibility`} onChange={event => toggleWidget(widget.id, event.target.checked)}/><span><strong>{widget.name}</strong><small>{widget.description}</small></span></label>)}</div></fieldset>
    <fieldset><legend>Pinned tools</legend><label className="dashboard-tool-search">Search calculators and modules<input className="ui-control" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search tools"/></label>
      {layout.pinnedTools.length > 0 && <ul className="dashboard-pinned-order">{layout.pinnedTools.map((id, index) => { const tool = tools.find(entry => entry.id === id); return tool ? <li key={id}><span>{tool.name}</span><Button aria-label={`Move ${tool.name} up`} disabled={index === 0} onClick={() => moveTool(id, -1)}>Move up</Button><Button aria-label={`Move ${tool.name} down`} disabled={index === layout.pinnedTools.length - 1} onClick={() => moveTool(id, 1)}>Move down</Button></li> : null; })}</ul>}
      <div className="dashboard-tool-choices">{results.map(tool => <label key={tool.id}><input type="checkbox" checked={pinned.has(tool.id)} aria-label={`${tool.name} pin`} onChange={event => toggleTool(tool.id, event.target.checked)}/><span><strong>{tool.name}</strong><small>{tool.kind === 'calculator' ? 'Calculator' : 'CBoard module'} · {tool.description}</small></span></label>)}{!results.length && <p>No matching tools.</p>}</div>
    </fieldset>
    <Button onClick={onReset}>Restore default layout</Button>
  </section>;
}
