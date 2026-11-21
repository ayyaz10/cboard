import { APP_MODULES } from '../../components/layout/appModules.js';

export const DASHBOARD_PREFERENCES_VERSION = 1;
export const DASHBOARD_PREFERENCES_KEY = 'cboard:dashboard-widgets:v1';

export const DASHBOARD_WIDGETS = Object.freeze([
  { id: 'next-action', required: true, defaultSize: 'compact', name: 'Next Action', description: 'The next task or reminder due today.', requirements: [], destination: '/board', sizes: ['compact', 'expanded'], defaultVisible: true, position: 10 },
  { id: 'today-agenda', required: true, defaultSize: 'expanded', name: "Today's Agenda", description: 'Your tasks and reminders for the selected time period.', requirements: [], destination: '/board', sizes: ['compact', 'expanded'], defaultVisible: true, position: 20 },
  { id: 'needs-attention', defaultSize: 'compact', name: 'Needs Attention', description: 'Overdue work, upcoming Finance payments, and today’s Training plan.', requirements: ['finance', 'training'], destination: '/board', sizes: ['compact', 'expanded'], defaultVisible: true, position: 30 },
  { id: 'finance-overview', defaultSize: 'compact', name: 'Finance Overview', description: 'A short summary from the existing Finance ledger.', requirements: ['finance'], destination: '/finance', sizes: ['compact', 'expanded'], defaultVisible: true, position: 40 },
  { id: 'goals-progress', defaultSize: 'compact', name: 'Goals & Progress', description: 'Configured Progress Tracker goals and the next deadline.', requirements: ['goals'], destination: '/progress-tracker', sizes: ['compact', 'expanded'], defaultVisible: true, position: 50 },
  { id: 'training', defaultSize: 'compact', name: 'Training', description: 'Your saved Training plan and recent session.', requirements: ['training'], destination: '/training', sizes: ['compact', 'expanded'], defaultVisible: true, position: 60 },
  { id: 'pinned-tools', defaultSize: 'compact', name: 'Pinned Tools', description: 'Shortcuts to calculators and CBoard modules you choose.', requirements: [], destination: '/calculators', sizes: ['compact', 'expanded'], defaultVisible: true, position: 70 },
  { id: 'weight-health', defaultSize: 'compact', name: 'Weight & Health', description: 'Recent weigh-ins and today’s food diary summary.', requirements: ['weight', 'food'], destination: '/weight-progress', sizes: ['compact', 'expanded'], defaultVisible: false, position: 80 },
  { id: 'groceries', defaultSize: 'compact', name: 'Groceries', description: 'A shortcut to your existing pantry and shopping list.', requirements: [], destination: '/groceries', sizes: ['compact'], defaultVisible: false, position: 90 },
]);

export const DEFAULT_DASHBOARD_LAYOUT = Object.freeze({
  version: DASHBOARD_PREFERENCES_VERSION,
  widgets: Object.freeze(DASHBOARD_WIDGETS.filter(widget => widget.defaultVisible).map(widget => Object.freeze({ id: widget.id, size: widget.defaultSize }))),
  pinnedTools: Object.freeze([]),
});

export function getAvailablePinnedTools(calculators = []) {
  const moduleTools = APP_MODULES.filter(module => module.navigation !== false && module.id !== 'calculator-board')
    .map(module => ({ id: `module:${module.id}`, name: module.name, description: module.description, path: module.path, kind: 'module' }));
  const calculatorTools = calculators.map(calculator => ({ id: `calculator:${calculator.id}`, name: calculator.name, description: calculator.boardDescription || calculator.description || '', path: calculator.path, kind: 'calculator' }));
  return [...calculatorTools, ...moduleTools];
}

export function normalizeDashboardPreferences(value, calculators = []) {
  if (!value || value.version !== DASHBOARD_PREFERENCES_VERSION || !Array.isArray(value.widgets)) return structuredClone(DEFAULT_DASHBOARD_LAYOUT);
  const definitions = new Map(DASHBOARD_WIDGETS.map(widget => [widget.id, widget]));
  const seen = new Set();
  const widgets = value.widgets.flatMap(entry => {
    const definition = definitions.get(entry?.id);
    if (!definition || seen.has(entry.id)) return [];
    seen.add(entry.id);
    return [{ id: entry.id, size: definition.sizes.includes(entry.size) ? entry.size : definition.defaultSize }];
  });
  const toolIds = new Set(getAvailablePinnedTools(calculators).map(tool => tool.id));
  const pinnedSeen = new Set();
  const pinnedTools = (Array.isArray(value.pinnedTools) ? value.pinnedTools : []).filter(id => {
    if (!toolIds.has(id) || pinnedSeen.has(id)) return false;
    pinnedSeen.add(id);
    return true;
  });
  const required = DASHBOARD_WIDGETS.filter(widget => widget.required && !seen.has(widget.id)).map(widget => ({ id: widget.id, size: widget.defaultSize }));
  return { version: DASHBOARD_PREFERENCES_VERSION, widgets: [...required, ...widgets], pinnedTools };
}

export function getWidgetRequirements(layout) {
  const definitions = new Map(DASHBOARD_WIDGETS.map(widget => [widget.id, widget]));
  return [...new Set((layout?.widgets || []).flatMap(entry => definitions.get(entry.id)?.requirements || []))];
}

export function updateWidgetVisibility(layout, widgetId, visible) {
  const definition = DASHBOARD_WIDGETS.find(widget => widget.id === widgetId);
  if (!definition) return layout;
  const widgets = layout.widgets.filter(entry => entry.id !== widgetId);
  if (visible) widgets.push({ id: widgetId, size: definition.defaultSize });
  return { ...layout, widgets };
}

export function moveWidget(layout, widgetId, direction) {
  const index = layout.widgets.findIndex(widget => widget.id === widgetId), target = index + direction;
  if (index < 0 || target < 0 || target >= layout.widgets.length) return layout;
  const widgets = [...layout.widgets];
  [widgets[index], widgets[target]] = [widgets[target], widgets[index]];
  return { ...layout, widgets };
}

export function resizeWidget(layout, widgetId, size) {
  const definition = DASHBOARD_WIDGETS.find(widget => widget.id === widgetId);
  if (!definition?.sizes.includes(size)) return layout;
  return { ...layout, widgets: layout.widgets.map(widget => widget.id === widgetId ? { ...widget, size } : widget) };
}

export function movePinnedTool(layout, toolId, direction) {
  const index = layout.pinnedTools.indexOf(toolId), target = index + direction;
  if (index < 0 || target < 0 || target >= layout.pinnedTools.length) return layout;
  const pinnedTools = [...layout.pinnedTools];
  [pinnedTools[index], pinnedTools[target]] = [pinnedTools[target], pinnedTools[index]];
  return { ...layout, pinnedTools };
}
