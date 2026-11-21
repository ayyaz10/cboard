import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DASHBOARD_LAYOUT, DASHBOARD_WIDGETS, getAvailablePinnedTools, getWidgetRequirements, movePinnedTool, moveWidget, normalizeDashboardPreferences, resizeWidget, updateWidgetVisibility } from './dashboardWidgets.js';

const calculators = [{ id: 'percentage', name: 'Percentage Calculator', path: '/calculators/percentage' }];

test('default layout starts with seven useful widgets and no module summary queries outside visible requirements', () => {
  assert.equal(DEFAULT_DASHBOARD_LAYOUT.widgets.length, 7);
  assert.deepEqual(getWidgetRequirements(DEFAULT_DASHBOARD_LAYOUT), ['finance', 'training', 'goals']);
  assert.equal(DASHBOARD_WIDGETS.find(widget => widget.id === 'groceries').requirements.length, 0);
});

test('preference normalization removes unknown and duplicate widget and tool identifiers', () => {
  const value = { version: 1, widgets: [{ id: 'today-agenda', size: 'compact' }, { id: 'removed-widget', size: 'expanded' }, { id: 'today-agenda', size: 'expanded' }, { id: 'groceries', size: 'expanded' }], pinnedTools: ['calculator:percentage', 'module:finance', 'removed-tool', 'calculator:percentage'] };
  assert.deepEqual(normalizeDashboardPreferences(value, calculators), {
    version: 1,
    widgets: [{ id: 'next-action', size: 'compact' }, { id: 'today-agenda', size: 'compact' }, { id: 'groceries', size: 'compact' }],
    pinnedTools: ['calculator:percentage', 'module:finance'],
  });
});

test('widget visibility, order, and size changes are immutable and validated', () => {
  const start = structuredClone(DEFAULT_DASHBOARD_LAYOUT);
  const hidden = updateWidgetVisibility(start, 'finance-overview', false);
  assert.equal(hidden.widgets.some(widget => widget.id === 'finance-overview'), false);
  assert.equal(start.widgets.some(widget => widget.id === 'finance-overview'), true);
  const added = updateWidgetVisibility(hidden, 'weight-health', true);
  assert.equal(added.widgets.at(-1).id, 'weight-health');
  assert.equal(resizeWidget(added, 'weight-health', 'expanded').widgets.at(-1).size, 'expanded');
  assert.equal(resizeWidget(added, 'groceries', 'expanded').widgets.at(-1).size, 'compact');
  assert.equal(moveWidget(added, 'today-agenda', -1).widgets[0].id, 'today-agenda');
});

test('pinned tools resolve existing calculator and module routes and can reorder', () => {
  const tools = getAvailablePinnedTools(calculators);
  assert.equal(tools.find(tool => tool.id === 'calculator:percentage').path, '/calculators/percentage');
  assert.equal(tools.find(tool => tool.id === 'module:finance').path, '/finance');
  const next = movePinnedTool({ ...structuredClone(DEFAULT_DASHBOARD_LAYOUT), pinnedTools: ['calculator:percentage', 'module:finance'] }, 'module:finance', -1);
  assert.deepEqual(next.pinnedTools, ['module:finance', 'calculator:percentage']);
});

test('empty and removed preference layouts retain essential actions and do not request hidden module data', () => {
  const layout = normalizeDashboardPreferences({ version: 1, widgets: [{ id: 'groceries', size: 'compact' }], pinnedTools: [] }, calculators);
  assert.deepEqual(layout.widgets.slice(0, 2).map(widget => widget.id), ['next-action', 'today-agenda']);
  assert.deepEqual(getWidgetRequirements({ widgets: [{ id: 'groceries' }] }), []);
  assert.deepEqual(getWidgetRequirements({ widgets: [{ id: 'pinned-tools' }] }), []);
});