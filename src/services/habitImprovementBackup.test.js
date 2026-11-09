import test from 'node:test';
import assert from 'node:assert/strict';
import { getBackupModule } from './backupRegistry.js';
import { createInitialHabitData, makeBacklogItem, makeHabitArea, makeImprovementNode } from '../features/drivingImprovement/drivingData.js';

const at = '2026-11-09T10:00:00.000Z';
const userId = 'backup-user';

function fakeClient({ row = null } = {}) {
  const writes = [];
  const client = {
    from(table) {
      const query = {
        select() { return this; },
        delete() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({ data: row, error: null }),
        insert: async value => { writes.push({ table, value }); return { error: null }; },
      };
      return query;
    },
  };
  return { client, writes };
}

function sampleData() {
  const data = createInitialHabitData();
  const habit = makeHabitArea({ name: 'Reading', description: 'Daily reading' }, [], userId, at);
  const parent = makeImprovementNode({ habitId: habit.id, title: 'Read consistently', focusNow: true }, userId, at);
  const child = makeImprovementNode({ habitId: habit.id, parentId: parent.id, title: 'Read before breakfast' }, userId, at);
  parent.actionContract = {
    action: 'Read 10 pages', minimum: 'Read 2 pages', trigger: 'After breakfast',
    triggerType: 'AFTER_BEHAVIOR', triggerTime: '', schedule: { type: 'DAILY' },
    mode: 'ADD', currentResponse: '', replacement: '', location: '', obstacle: '', environment: '',
    useFocusTimer: true, focusMinutes: 25, minimumFocusMinutes: 5, createdAt: at, updatedAt: at, version: 2,
  };
  parent.executionHistory = [{
    id: 'execution-1', date: '2026-11-08', outcome: 'MINIMUM_DONE', reason: null,
    recordedAt: at, startedAt: at, focusSessionId: 'focus-1', contract: structuredClone(parent.actionContract),
  }];
  parent.activeSession = { date: '2026-11-09', startedAt: at };
  data.habits.push(habit);
  data.nodes.push(parent, child);
  data.backlogItems.push(makeBacklogItem({ title: 'Learn piano', note: 'Maybe next month' }, userId, at));
  return data;
}

test('Habit Improvement backup export/import preserves tree, contract, outcomes, active session, and Backlog', async () => {
  const module = getBackupModule('drivingImprovement');
  const sourceData = sampleData();
  const { client: sourceClient } = fakeClient({ row: { data: sourceData, revision: 7, updated_at: at } });
  const exported = await module.exportData({ client: sourceClient, userId });
  module.validate(exported);

  const { client: restoreClient, writes } = fakeClient();
  await module.importData({ client: restoreClient, userId, data: exported });
  const restored = writes.find(write => write.table === 'driving_workspaces').value;
  assert.equal(restored.user_id, userId);
  assert.equal(restored.revision, 7);
  assert.deepEqual(restored.data.nodes.map(node => node.id), sourceData.nodes.map(node => node.id));
  assert.equal(restored.data.nodes[0].actionContract.version, 2);
  assert.equal(restored.data.nodes[0].executionHistory[0].focusSessionId, 'focus-1');
  assert.deepEqual(restored.data.nodes[0].activeSession, sourceData.nodes[0].activeSession);
  assert.equal(restored.data.backlogItems[0].title, 'Learn piano');
});

test('Habit Improvement backup keeps legacy migration handlers and accepts old workspace data', () => {
  const module = getBackupModule('drivingImprovement');
  assert.equal(module.schemaVersion, 6);
  for (let version = 1; version < module.schemaVersion; version += 1) {
    assert.ok(module.migrations.some(migration => migration.fromVersion === version && migration.toVersion === version + 1));
  }
  const legacy = {
    workspace: {
      revision: 1, updated_at: at,
      data: { version: 1, categories: [{ id: 'legacy-category', userId, name: 'Reading', createdAt: at, updatedAt: at }], mistakes: [] },
    },
  };
  module.validate(legacy);
  let current = legacy;
  for (let version = 1; version < module.schemaVersion; version += 1) {
    const migration = module.migrations.find(item => item.fromVersion === version);
    current = migration.migrate(current);
  }
  assert.ok(current.workspace.data.nodes.some(node => node.id === 'legacy-category'));
  assert.ok(current.workspace.data.habits.length > 0);
});
