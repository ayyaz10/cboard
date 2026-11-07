import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialHabitData, getHabitSummary, getItemsForHabit, makeHabitArea, makeImprovementNode, makeBacklogItem, promoteBacklogItem, moveHabitToBacklog, getActiveHabits, getBacklogItems, getQuickReviewItemsForHabit, archiveBacklogItem, deleteBacklogItem,
  migrateHabitData, removeHabitArea, getDescendantNodes, getNodePath, getNodeProgress,
  getQuickReviewItems, archiveNodeBranch, restoreNodeBranch, isNodeBranchArchived, deleteNodeBranch, setNodeParent, validateHabitData, HABIT_STATUSES, archiveBacklogEntry, deleteBacklogEntry, archiveHabitArea, restoreArchivedBacklogEntry, searchImprovementNodes,
} from './drivingData.js';

const at = '2026-10-31T00:00:00.000Z';

test('new workspace has a recursive node collection and no seeded improvements', () => {
  assert.deepEqual(createInitialHabitData(), {
    version: 1, habitVersion: 6, habits: [], nodes: [], categories: [], mistakes: [], reminders: [], guidanceNotes: [], backlogItems: [],
  });
});

test('moving a Habit to Backlog and resuming it preserves identity, recursive progress, notes and Quick Review eligibility', () => {
  const data = createInitialHabitData(), habit = makeHabitArea({ name: 'Driving Improvement', description: 'Road confidence' }, [], 'user-a', at);
  const root = makeImprovementNode({ habitId: habit.id, parentId: null, title: 'Roundabouts', status: 'IMPROVING', priority: 'HIGH', focusNow: true, richNotes: '<p>Watch approach speed.</p>' }, 'user-a', at);
  const child = makeImprovementNode({ habitId: habit.id, parentId: root.id, title: 'Lane selection', status: 'STABLE', priority: 'LOW', whatIDoDifferently: '<p>Choose early.</p>' }, 'user-a', at);
  data.habits.push(habit); data.nodes = [root, child];
  const beforeNodes = structuredClone(data.nodes);
  const paused = moveHabitToBacklog(data, habit.id, '2026-11-03T12:00:00.000Z');
  assert.strictEqual(moveHabitToBacklog(paused, habit.id), paused);
  assert.deepEqual(getActiveHabits(paused), []);
  assert.equal(getBacklogItems(paused).length, 1);
  assert.equal(paused.habits[0].id, habit.id);
  assert.deepEqual(paused.nodes, beforeNodes);
  assert.deepEqual(getQuickReviewItemsForHabit(paused, habit.id), []);
  const item = getBacklogItems(paused)[0];
  const resumed = promoteBacklogItem(paused, item.id, habit.name, 'user-a', '2026-11-04T12:00:00.000Z');
  const resumedAgain = promoteBacklogItem(resumed.data, item.id, 'Ignored duplicate', 'user-a', '2026-11-05T12:00:00.000Z');
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.data.habits.length, 1);
  assert.equal(resumed.habit.id, habit.id);
  assert.equal(resumedAgain.changed, false);
  assert.equal(resumedAgain.data.habits.length, 1);
  assert.deepEqual(resumed.data.nodes, beforeNodes);
  assert.equal(getActiveHabits(resumed.data)[0].id, habit.id);
  assert.equal(getBacklogItems(resumed.data).length, 0);
  assert.deepEqual(getQuickReviewItemsForHabit(resumed.data, habit.id).map(node => node.id), [root.id]);
  assert.equal(resumed.data.backlogItems[0].promotedHabitId, habit.id);
  validateHabitData(resumed.data);
});

test('backlog ideas stay separate until explicit promotion and promote idempotently with preserved context', () => {
  const data = createInitialHabitData();
  const idea = makeBacklogItem({ title: 'Public Speaking', note: 'Practice short talks', type: 'SKILL', priority: 'HIGH' }, 'user-a', at);
  data.backlogItems.push(idea);
  assert.deepEqual(data.habits, []);
  assert.deepEqual(getQuickReviewItems(data.nodes), []);
  validateHabitData(data);
  const first = promoteBacklogItem(data, idea.id, 'Public Speaking Improvement', 'user-a', at);
  const again = promoteBacklogItem(first.data, idea.id, 'Changed name', 'user-a', at);
  assert.equal(first.changed, true);
  assert.equal(again.changed, false);
  assert.equal(first.data.habits.length, 1);
  assert.equal(first.data.habits[0].description, 'Practice short talks');
  assert.equal(again.data.habits.length, 1);
  assert.equal(first.data.backlogItems[0].state, 'PROMOTED');
  assert.equal(first.data.backlogItems[0].promotedHabitId, first.habit.id);
  assert.throws(() => validateHabitData({ ...first.data, backlogItems: [{ ...first.data.backlogItems[0], promotedHabitId: 'missing-habit' }] }), /promotion link/);
  assert.throws(() => validateHabitData({ ...first.data, habits: first.data.habits.map(habit => ({ ...habit, userId: 'another-user' })) }), /promotion link/);
});

test('backlog edit helpers archive or delete only unpromoted ideas', () => {
  const a = makeBacklogItem({ title: 'Negotiation' }, 'user-a', at), b = makeBacklogItem({ title: 'Sleep' }, 'user-a', at);
  const archived = archiveBacklogItem([a, b], a.id, at);
  assert.equal(archived[0].state, 'ARCHIVED');
  assert.equal(archived[1].state, 'BACKLOG');
  assert.deepEqual(deleteBacklogItem(archived, b.id).map(item => item.id), [a.id]);
});

test('archiving a previously active Backlog entry preserves but hides Habit records; deleting it cascades explicitly', () => {
  const data = createInitialHabitData(), habit = makeHabitArea({ name: 'Focus Improvement' }, [], 'user-a', at);
  const node = makeImprovementNode({ habitId: habit.id, parentId: null, title: 'Phone distraction', status: 'IMPROVING' }, 'user-a', at);
  data.habits.push({ ...habit, lifecycleState: 'BACKLOG', backloggedAt: at }); data.nodes.push(node);
  const item = makeBacklogItem({ title: habit.name }, 'user-a', at);
  data.backlogItems.push({ ...item, promotedHabitId: habit.id, promotedAt: at, backloggedAt: at });
  const archived = archiveBacklogEntry(data, item.id, at);
  assert.equal(archived.habits[0].archivedAt, at);
  assert.deepEqual(archived.nodes, data.nodes);
  assert.equal(archived.backlogItems[0].state, 'ARCHIVED');
  const restored = restoreArchivedBacklogEntry(archived, item.id, '2026-11-02T12:00:00.000Z');
  assert.equal(restored.habits[0].id, habit.id);
  assert.equal(restored.habits[0].lifecycleState, 'BACKLOG');
  assert.equal(restored.backlogItems[0].state, 'BACKLOG');
  assert.equal(restored.backlogItems[0].promotedHabitId, habit.id);
  assert.deepEqual(restored.nodes, data.nodes);
  const deleted = deleteBacklogEntry(data, item.id);
  assert.deepEqual(deleted.habits, []);
  assert.deepEqual(deleted.nodes, []);
  assert.deepEqual(deleted.backlogItems, []);
});

test('archiving an active Habit preserves its full tree while removing it from active counts and Quick Review', () => {
  const data = createInitialHabitData(), habit = makeHabitArea({ name: 'Sleep Improvement' }, [], 'user-a', at);
  const root = makeImprovementNode({ habitId: habit.id, parentId: null, title: 'Evening routine', status: 'NEEDS_WORK' }, 'user-a', at);
  data.habits.push(habit); data.nodes.push(root);
  const archived = archiveHabitArea(data, habit.id, at);
  assert.deepEqual(getActiveHabits(archived), []);
  assert.deepEqual(archived.nodes, data.nodes);
  assert.equal(archived.backlogItems[0].state, 'ARCHIVED');
  assert.deepEqual(getQuickReviewItemsForHabit(archived, habit.id), []);
});

test('archived Habits restore to their previous lifecycle with the same identity and recursive data', () => {
  const data = createInitialHabitData(), habit = makeHabitArea({ name: 'Sleep Improvement', description: 'A full tree' }, [], 'user-a', at);
  const root = makeImprovementNode({ habitId: habit.id, parentId: null, title: 'Evening routine', status: 'IMPROVING', priority: 'HIGH', focusNow: true, richNotes: '<p>Wind down.</p>' }, 'user-a', at);
  const child = makeImprovementNode({ habitId: habit.id, parentId: root.id, title: 'Put phone away', status: 'STABLE' }, 'user-a', at);
  data.habits.push(habit); data.nodes = [root, child];
  const archived = archiveHabitArea(data, habit.id, '2026-11-01T12:00:00.000Z');
  const restored = restoreArchivedBacklogEntry(archived, archived.backlogItems[0].id, '2026-11-02T12:00:00.000Z');
  assert.equal(restored.habits[0].id, habit.id);
  assert.equal(restored.habits[0].archivedAt, null);
  assert.deepEqual(restored.nodes, data.nodes);
  assert.equal(restored.backlogItems[0].state, 'PROMOTED');
  assert.equal(restored.backlogItems[0].promotedHabitId, habit.id);
  assert.deepEqual(getActiveHabits(restored).map(item => item.id), [habit.id]);
  validateHabitData(restored);
});

test('archived Backlog ideas restore without becoming active or changing ID', () => {
  const idea = makeBacklogItem({ title: 'Improve cooking', note: 'Practice knife skills' }, 'user-a', at);
  const data = { ...createInitialHabitData(), backlogItems: [{ ...idea, state: 'ARCHIVED', archivedAt: at }] };
  const restored = restoreArchivedBacklogEntry(data, idea.id, '2026-11-02T12:00:00.000Z');
  assert.equal(restored.backlogItems[0].id, idea.id);
  assert.equal(restored.backlogItems[0].state, 'BACKLOG');
  assert.equal(restored.backlogItems[0].archivedAt, null);
  assert.equal(restored.habits.length, 0);
});

test('restoring an archived parent keeps independently archived descendants archived', () => {
  const habit = makeHabitArea({ name: 'Driving Improvement' }, [], 'user-a', at);
  const root = makeImprovementNode({ habitId: habit.id, parentId: null, title: 'Roundabouts' }, 'user-a', at);
  const child = makeImprovementNode({ habitId: habit.id, parentId: root.id, title: 'Lane selection' }, 'user-a', at);
  const grandchild = makeImprovementNode({ habitId: habit.id, parentId: child.id, title: 'Choose early' }, 'user-a', at);
  const independentlyArchived = archiveNodeBranch([root, child, grandchild], child.id, '2026-10-01T12:00:00.000Z');
  const withParentArchived = archiveNodeBranch(independentlyArchived, root.id, '2026-11-01T12:00:00.000Z');
  assert.equal(withParentArchived.find(node => node.id === child.id).archivedAt, '2026-10-01T12:00:00.000Z');
  const restored = restoreNodeBranch(withParentArchived, child.id);
  assert.equal(isNodeBranchArchived(restored, root.id), false);
  assert.equal(isNodeBranchArchived(restored, child.id), true);
  assert.equal(restored.find(node => node.id === child.id).archivedAt, '2026-10-01T12:00:00.000Z');
});

test('search matches rich Notes and ancestor path within the lifecycle collection supplied by the caller', () => {
  const habit = makeHabitArea({ name: 'Driving Improvement' }, [], 'user-a', at);
  const root = makeImprovementNode({ habitId: habit.id, parentId: null, title: 'Roundabouts' }, 'user-a', at);
  const child = makeImprovementNode({ habitId: habit.id, parentId: root.id, title: 'Lane choice', richNotes: '<p>Check mirrors and road markings.</p>' }, 'user-a', at);
  const backlogOnly = makeImprovementNode({ habitId: habit.id, parentId: null, title: 'Old junction note', richNotes: '<p>Roundabouts</p>' }, 'user-a', at);
  assert.deepEqual(searchImprovementNodes([root, child], 'road markings').map(node => node.id), [child.id]);
  assert.deepEqual(searchImprovementNodes([root, child], 'roundabouts').map(node => node.id), [root.id, child.id]);
  assert.deepEqual(searchImprovementNodes([backlogOnly], 'roundabouts').map(node => node.id), [backlogOnly.id]);
});

test('legacy category and item records migrate idempotently to recursive nodes preserving content and IDs', () => {
  const names = ['Mirrors', 'Roundabouts'];
  const legacy = {
    version: 1,
    categories: names.map((name, index) => ({ id: `category-${index + 1}`, userId: 'user-a', name, createdAt: at, updatedAt: at })),
    mistakes: [{ id: 'item-1', userId: 'user-a', categoryId: 'category-2', title: 'Lane choice', cause: '<p>Late decision</p>', correction: '<ul><li>Choose early</li></ul>', status: 'NEEDS_WORK', createdAt: at, updatedAt: at }],
  };
  const first = migrateHabitData(legacy, 'user-a'), second = migrateHabitData(first.data, 'user-a');
  const driving = first.data.habits[0], root = first.data.nodes.find(node => node.id === 'category-2'), child = first.data.nodes.find(node => node.id === 'item-1');
  assert.equal(first.changed, true); assert.equal(second.changed, false);
  assert.deepEqual(first.data.categories, []); assert.deepEqual(first.data.mistakes, []);
  assert.equal(legacy.categories.length, 2); assert.equal(legacy.mistakes.length, 1);
  assert.equal(driving.name, 'Driving Improvement');
  assert.equal(driving.lifecycleState, 'ACTIVE');
  assert.equal(root.parentId, null); assert.equal(root.habitId, driving.id);
  assert.equal(child.parentId, root.id); assert.equal(child.id, 'item-1');
  assert.equal(child.whyItHappens, '<p>Late decision</p>');
  assert.equal(child.whatIDoDifferently, '<ul><li>Choose early</li></ul>');
  assert.equal(second.data.nodes.length, 3);
  assert.deepEqual(second.data, first.data);
});

test('nodes support arbitrary depth, breadcrumb paths, descendant progress, and independent parent status', () => {
  const data = createInitialHabitData(), habit = makeHabitArea({ name: 'Focus Improvement' }, [], 'user-a', at);
  data.habits.push(habit);
  let parentId = null;
  const nodes = [];
  for (let depth = 0; depth < 12; depth++) {
    const node = makeImprovementNode({ habitId: habit.id, parentId, title: `Level ${depth}`, status: depth === 11 ? 'STABLE' : 'NEEDS_WORK' }, 'user-a', at);
    nodes.push(node); parentId = node.id;
  }
  nodes[0].status = 'IMPROVING'; data.nodes = nodes;
  validateHabitData(data);
  assert.equal(getDescendantNodes(nodes, nodes[0].id).length, 11);
  assert.equal(getNodePath(nodes, nodes[11].id).length, 12);
  assert.deepEqual(getNodeProgress(nodes, nodes[0].id), { total: 11, NEEDS_WORK: 10, IMPROVING: 0, STABLE: 1 });
  assert.equal(nodes[0].status, 'IMPROVING');
  assert.deepEqual(getHabitSummary(getItemsForHabit(data, habit.id)), { total: 12, NEEDS_WORK: 10, IMPROVING: 1, STABLE: 1 });
});

test('a 120-node multi-branch habit validates and derives complete summaries', () => {
  const data = createInitialHabitData(), habit = makeHabitArea({ name: 'Driving Improvement' }, [], 'user-a', at);
  data.habits.push(habit);
  data.nodes = Array.from({ length: 120 }, (_, index) => makeImprovementNode({ habitId: habit.id, parentId: index < 10 ? null : `root-${Math.floor((index - 10) / 11)}`, title: `Node ${index}`, sortOrder: index % 12, status: HABIT_STATUSES[index % HABIT_STATUSES.length] }, 'user-a', at));
  for (let index = 0; index < 10; index += 1) data.nodes[index].id = `root-${index}`;
  validateHabitData(data);
  assert.equal(getHabitSummary(data.nodes).total, 120);
  assert.equal(getDescendantNodes(data.nodes, 'root-0').length, 11);
});

test('reparent rejects cycles, self-parenting, and cross-habit relationships while preserving descendant IDs', () => {
  const habit = makeHabitArea({ name: 'Driving Improvement' }, [], 'user-a', at);
  const otherHabit = makeHabitArea({ name: 'Focus Improvement' }, [habit], 'user-a', at);
  const a = makeImprovementNode({ habitId: habit.id, parentId: null, title: 'A' }, 'user-a', at);
  const b = makeImprovementNode({ habitId: habit.id, parentId: a.id, title: 'B' }, 'user-a', at);
  const c = makeImprovementNode({ habitId: habit.id, parentId: b.id, title: 'C' }, 'user-a', at);
  const d = makeImprovementNode({ habitId: otherHabit.id, parentId: null, title: 'Other' }, 'user-a', at);
  assert.throws(() => setNodeParent([a, b, c], a.id, c.id), /itself|sub-improvements/);
  assert.throws(() => setNodeParent([a, b, c], a.id, a.id), /itself/);
  assert.throws(() => setNodeParent([a, b, c, d], a.id, d.id), /same habit/);
  const moved = setNodeParent([a, b, c], c.id, a.id);
  assert.deepEqual(moved.map(node => node.id), [a.id, b.id, c.id]);
  assert.equal(moved.find(node => node.id === c.id).parentId, a.id);
});

test('archive hides the full branch from Quick Review and delete removes the full branch without orphans', () => {
  const habit = makeHabitArea({ name: 'Driving Improvement' }, [], 'user-a', at);
  const root = makeImprovementNode({ habitId: habit.id, parentId: null, title: 'Roundabouts', status: 'NEEDS_WORK' }, 'user-a', at);
  const child = makeImprovementNode({ habitId: habit.id, parentId: root.id, title: 'Lane selection', status: 'NEEDS_WORK', priority: 'HIGH' }, 'user-a', at);
  const nodes = [root, child];
  const archived = archiveNodeBranch(nodes, root.id, at);
  assert.ok(archived.every(node => node.archivedAt === at));
  assert.equal(getQuickReviewItems(archived).length, 0);
  assert.deepEqual(deleteNodeBranch(nodes, root.id), []);
});

test('Quick Review prioritizes focus and high priority, hides Stable, and prefers actionable leaves', () => {
  const habit = makeHabitArea({ name: 'Driving Improvement' }, [], 'user-a', at);
  const root = makeImprovementNode({ habitId: habit.id, parentId: null, title: 'Roundabouts', status: 'NEEDS_WORK', focusNow: true, whyItHappens: '<p>Unclear entry.</p>' }, 'user-a', at);
  const leaf = makeImprovementNode({ habitId: habit.id, parentId: root.id, title: 'Lane selection', status: 'NEEDS_WORK', priority: 'HIGH' }, 'user-a', at);
  const focus = makeImprovementNode({ habitId: habit.id, parentId: null, title: 'Focus', status: 'NEEDS_WORK', focusNow: true }, 'user-a', at);
  const highImproving = makeImprovementNode({ habitId: habit.id, parentId: null, title: 'High improving', status: 'IMPROVING', priority: 'HIGH' }, 'user-a', at);
  const stable = makeImprovementNode({ habitId: habit.id, parentId: null, title: 'Stable', status: 'STABLE', focusNow: true }, 'user-a', at);
  assert.deepEqual(getQuickReviewItems([root, leaf, focus, highImproving, stable]).map(node => node.id), [focus.id, root.id, leaf.id, highImproving.id]);
  assert.ok(getQuickReviewItems([root, leaf, focus, highImproving, stable], true).some(node => node.id === stable.id));
});

test('deleting a habit removes only its recursive nodes and associated legacy data', () => {
  const first = makeHabitArea({ name: 'Focus Improvement' }, [], 'user-a', at), second = makeHabitArea({ name: 'Sleep Improvement' }, [first], 'user-a', at);
  const node = makeImprovementNode({ habitId: first.id, parentId: null, title: 'Distraction' }, 'user-a', at);
  const data = { ...createInitialHabitData(), habits: [first, second], nodes: [node] };
  const after = removeHabitArea(data, first.id);
  assert.deepEqual(after.habits.map(habit => habit.id), [second.id]);
  assert.deepEqual(after.nodes, []);
});
