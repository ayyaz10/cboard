import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialHabitData, getHabitSummary, getItemsForHabit, makeHabitArea, makeImprovementItem,
  migrateHabitData, removeHabitArea, sortImprovementItems, validateHabitData,
} from './drivingData.js';

const at = '2026-10-31T00:00:00.000Z';

test('new workspaces contain no seeded habits, categories, improvements, or reminders', () => {
  assert.deepEqual(createInitialHabitData(), {
    version: 1, habitVersion: 2, habits: [], categories: [], mistakes: [], reminders: [], guidanceNotes: [],
  });
});

test('a new habit starts empty and receives its own user-created categories and improvements', () => {
  const data = createInitialHabitData();
  const focus = makeHabitArea({ name: 'Focus Improvement', description: 'Reduce distractions.' }, data.habits, 'user-a', at);
  const sleep = makeHabitArea({ name: 'Sleep Improvement' }, [focus], 'user-a', at);
  data.habits.push(focus, sleep);
  assert.equal(focus.slug, 'focus-improvement');
  assert.equal(sleep.slug, 'sleep-improvement');
  assert.equal(data.categories.length, 0);
  assert.equal(data.mistakes.length, 0);
  const distraction = { id: 'focus-category', userId: 'user-a', habitId: focus.id, name: 'Distractions', createdAt: at };
  const bedtime = { id: 'sleep-category', userId: 'user-a', habitId: sleep.id, name: 'Bedtime', createdAt: at };
  data.categories.push(distraction, bedtime);
  data.mistakes.push(makeImprovementItem({ title: 'Phone distraction while working', categoryId: distraction.id, cause: 'User-entered reason', correction: 'User-entered next step', status: 'NEEDS_WORK' }, 'user-a', at));
  data.mistakes.push(makeImprovementItem({ title: 'Going to bed too late', categoryId: bedtime.id, cause: '', correction: 'Wind down earlier', status: 'IMPROVING' }, 'user-a', at));
  validateHabitData(data);
  assert.equal(getItemsForHabit(data, focus.id).length, 1);
  assert.equal(getItemsForHabit(data, sleep.id).length, 1);
  assert.equal(getItemsForHabit(data, focus.id)[0].cause, 'User-entered reason');
  assert.deepEqual(getHabitSummary(getItemsForHabit(data, focus.id)), { total: 1, NEEDS_WORK: 1, IMPROVING: 0, STABLE: 0 });
});

test('habit slugs are unique and can remain stable when a name changes', () => {
  const first = makeHabitArea({ name: 'Focus Improvement' }, [], 'user-a', at);
  const second = makeHabitArea({ name: 'Focus Improvement' }, [first], 'user-a', at);
  const renamed = { ...first, name: 'Deep Focus' };
  assert.equal(first.slug, 'focus-improvement');
  assert.equal(second.slug, 'focus-improvement-2');
  assert.equal(renamed.slug, first.slug);
  assert.equal(renamed.id, first.id);
});

test('deleting an empty or populated area removes only its children', () => {
  const data = createInitialHabitData();
  const focus = makeHabitArea({ name: 'Focus Improvement' }, data.habits, 'user-a', at);
  const sleep = makeHabitArea({ name: 'Sleep Improvement' }, [focus], 'user-a', at);
  data.habits.push(focus, sleep);
  data.categories.push({ id: 'focus-cat', userId: 'user-a', habitId: focus.id, name: 'Distractions' });
  data.categories.push({ id: 'sleep-cat', userId: 'user-a', habitId: sleep.id, name: 'Bedtime' });
  data.mistakes.push(makeImprovementItem({ title: 'Phone distraction', categoryId: 'focus-cat', cause: '', correction: '', status: 'NEEDS_WORK' }, 'user-a', at));
  const after = removeHabitArea(data, focus.id);
  assert.deepEqual(after.habits.map(habit => habit.id), [sleep.id]);
  assert.deepEqual(after.categories.map(category => category.id), ['sleep-cat']);
  assert.equal(after.mistakes.length, 0);
  assert.equal(getItemsForHabit(after, sleep.id).length, 0);
  assert.deepEqual(removeHabitArea(after, 'missing').habits, after.habits);
});

test('legacy driving workspace migrates to one Driving Improvement parent exactly once', () => {
  const names = ['Mirrors', 'Roundabouts', 'Stopping & Braking', 'Speed Management', 'Speed Bumps', 'Lane Discipline', 'Changing Lanes', 'Traffic Signals & Junctions', 'General Awareness & Driving Habits', 'Road Signs'];
  const legacy = {
    version: 1,
    categories: names.map((name, index) => ({ id: `category-${index + 1}`, userId: 'user-a', name, createdAt: `2026-01-${String(index + 1).padStart(2, '0')}`, updatedAt: at })),
    mistakes: Array.from({ length: 26 }, (_, index) => ({
      id: `item-${index + 1}`, userId: 'user-a', categoryId: `category-${index % names.length + 1}`,
      title: `Driving item ${index + 1}`, cause: `Why ${index + 1}`, correction: `Next step ${index + 1}`,
      status: index === 25 ? 'CONFIDENT' : index === 24 ? 'IMPROVING' : 'NEEDS_WORK',
      createdAt: `2026-02-${String(index + 1).padStart(2, '0')}`, updatedAt: at,
    })),
  };
  const migrated = migrateHabitData(legacy, 'user-a');
  const repeated = migrateHabitData(migrated.data, 'user-a');
  const driving = migrated.data.habits[0];
  assert.equal(migrated.changed, true);
  assert.equal(repeated.changed, false);
  assert.equal(migrated.data.habits.length, 1);
  assert.equal(driving.name, 'Driving Improvement');
  assert.equal(driving.slug, 'driving-improvement');
  assert.equal(migrated.data.categories.length, 10);
  assert.ok(migrated.data.categories.every(category => category.habitId === driving.id));
  assert.equal(migrated.data.mistakes.length, 26);
  assert.deepEqual(getHabitSummary(getItemsForHabit(migrated.data, driving.id)), { total: 26, NEEDS_WORK: 24, IMPROVING: 1, STABLE: 1 });
  assert.deepEqual(migrated.data.categories.map(category => [category.id, category.name, category.createdAt]), legacy.categories.map(category => [category.id, category.name, category.createdAt]));
  assert.deepEqual(migrated.data.mistakes.map(item => ({ ...item, status: item.status === 'CONFIDENT' ? 'STABLE' : item.status })), legacy.mistakes.map(item => ({ ...item, status: item.status === 'CONFIDENT' ? 'STABLE' : item.status })));
  assert.deepEqual(repeated.data, migrated.data);
});

test('Quick Review order is Needs Work then Improving and excludes Stable', () => {
  const items = [
    { id: 'stable', status: 'STABLE', updatedAt: '2026-10-30' },
    { id: 'improving', status: 'IMPROVING', updatedAt: '2026-10-29' },
    { id: 'needs-old', status: 'NEEDS_WORK', updatedAt: '2026-10-29' },
    { id: 'needs-new', status: 'NEEDS_WORK', updatedAt: '2026-10-30' },
  ];
  const ordered = sortImprovementItems(items);
  assert.deepEqual(ordered.map(item => item.id), ['needs-new', 'needs-old', 'improving', 'stable']);
  assert.deepEqual(ordered.filter(item => item.status !== 'STABLE').map(item => item.id), ['needs-new', 'needs-old', 'improving']);
});

test('status transitions stay reversible and validation rejects cross-habit category links', () => {
  const data = createInitialHabitData();
  const focus = makeHabitArea({ name: 'Focus Improvement' }, [], 'user-a', at);
  const driving = makeHabitArea({ name: 'Driving Improvement' }, [focus], 'user-a', at);
  data.habits.push(focus, driving);
  const category = { id: 'focus-category', userId: 'user-a', habitId: focus.id, name: 'Distractions' };
  data.categories.push(category);
  const item = makeImprovementItem({ title: 'Phone distraction', categoryId: category.id, cause: '', correction: '', status: 'NEEDS_WORK' }, 'user-a', at);
  data.mistakes.push(item);
  for (const status of ['IMPROVING', 'STABLE', 'IMPROVING', 'NEEDS_WORK']) { item.status = status; validateHabitData(data); }
  category.habitId = 'missing-habit';
  assert.throws(() => validateHabitData(data), /invalid/i);
});
