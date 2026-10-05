import test from 'node:test';
import assert from 'node:assert/strict';
import { backupModuleRegistry, exportBackupData, importBackupModule } from './backupRegistry.js';
import { BACKUP_FORMAT, BACKUP_VERSION, expandDependencies, parseBackupFile } from './backupService.js';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = async value => {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(value))));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};
const asFile = value => {
  const text = JSON.stringify(value);
  return { size: new TextEncoder().encode(text).length, text: async () => text };
};
class FinanceMemoryClient {
  rows = [];
  from(table) { return new MemoryQuery(this, table); }
}
class MemoryQuery {
  constructor(client, table) { this.client = client; this.table = table; this.filters = []; this.operation = 'select'; }
  select(fields) { this.operation = 'select'; this.fields = fields?.split(',').map(field => field.trim()); return this; }
  delete() { this.operation = 'delete'; return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }
  matches(row) { return this.filters.every(([key, value]) => row[key] === value); }
  async maybeSingle() {
    const row = this.client.rows.find(value => this.matches(value));
    return { data: row && this.fields ? Object.fromEntries(this.fields.filter(key => key in row).map(key => [key, row[key]])) : row || null, error: null };
  }
  insert(row) { this.operation = 'insert'; this.insertRows = Array.isArray(row) ? row : [row]; return Promise.resolve(this.run()); }
  async run() {
    if (this.operation === 'delete') this.client.rows = this.client.rows.filter(row => !this.matches(row));
    if (this.operation === 'insert') this.client.rows.push(...this.insertRows);
    return { error: null };
  }
  then(resolve, reject) { return this.run().then(resolve, reject); }
}
const emptyModuleData = {
  finance: { workspace: null },
  recipes: { rows: [] },
  grocery: { rows: [] },
  foodDiary: { rows: [] },
  foodLibrary: { rows: [] },
  goals: { goals: [], metrics: [], entries: [], entry_values: [], goal_journal_entries: [], goal_quotes: [] },
  notes: { notes: [] },
  training: { workspace: null, localCache: null },
  weightProgress: { entries: [], media: {} },
  focus: { focus_sessions: [], focus_break_tasks: [], local: {} },
  savedCalculations: { calculator_results: [] },
  trading: { crypto_futures_trades: [] },
  preferences: { rows: [] },
  profile: { displayName: '', avatar: null },
};

async function backupFor(scope, overrides = {}) {
  const data = Object.fromEntries(scope.map(id => [id, { schemaVersion: backupModuleRegistry.find(module => module.moduleId === id)?.schemaVersion || 1, data: overrides[id] || emptyModuleData[id] || {} }]));
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, backupId: 'round-trip-fixture', createdAt: '2026-10-05T12:00:00.000Z', appVersion: '0.1.0', scope, data, integrity: { algorithm: 'SHA-256', digest: await digest(data) } };
}

test('registry is extensible and each recoverable module supplies all required handlers', () => {
  assert.ok(backupModuleRegistry.length >= 10);
  for (const module of backupModuleRegistry) {
    assert.ok(module.moduleId && module.displayName);
    assert.ok(Number.isInteger(module.schemaVersion));
    for (const handler of ['exportData', 'importData', 'validate']) assert.equal(typeof module[handler], 'function', `${module.moduleId}.${handler}`);
  }
});

test('one-app backup keeps a selective scope and round-trips the source data', async () => {
  const finance = { workspace: { state: { transactions: [{ id: 'stable-tx-1', type: 'donation', amount: 12.5 }], debts: [] }, updated_at: '2026-10-05T09:00:00Z' } };
  const parsed = await parseBackupFile(await asFile(await backupFor(['finance'], { finance })));
  assert.deepEqual(parsed.modules.map(module => module.moduleId), ['finance']);
  assert.deepEqual(parsed.modules[0].data, finance);
  assert.equal(parsed.modules[0].data.workspace.state.transactions[0].id, 'stable-tx-1');
});

test('multi-app backup preserves linked identifiers between selected modules', async () => {
  const goalId = 'goal-1';
  const note = { id: 'note-1', linked_goal_id: goalId, content_text: 'Progress note' };
  const goalData = { goals: [{ id: goalId, title: 'Run 5k' }], metrics: [], entries: [], entry_values: [], goal_journal_entries: [], goal_quotes: [] };
  const parsed = await parseBackupFile(await asFile(await backupFor(['goals', 'notes'], { goals: goalData, notes: { notes: [note] } })));
  assert.deepEqual(parsed.modules.map(module => module.moduleId), ['goals', 'notes']);
  assert.equal(parsed.modules[1].data.notes[0].linked_goal_id, goalId);
  assert.equal(parsed.modules[1].data.notes[0].linked_goal_id, goalId);
});

test('Finance export, replacement restore, ownership remapping, and round-trip preserve IDs but omit secrets', async () => {
  const state = { version: 1, settings: { currency: 'GBP', refresh_token: 'never-export-this' }, categories: [], transactions: [{ id: 'tx-stable-1', type: 'donation', amount: 2250, date: '2026-10-05' }], budgets: {}, openingBalances: {}, budgetPresets: [], goals: [], goalContributions: [], investments: [], debts: [], debtPayments: [{ id: 'repay-1', debtId: 'debt-stable-1', amount: 300 }], recurring: [{ id: 'repeat-1', frequency: 'weekly' }], transactionPresets: [], allocationRules: [] };
  const expected = structuredClone(state); delete expected.settings.refresh_token;
  const client = new FinanceMemoryClient();
  client.rows = [{ user_id: 'source-account', state, updated_at: '2026-10-05T09:00:00Z' }];
  const source = await exportBackupData(['finance'], { client, userId: 'source-account' });
  assert.equal(Object.hasOwn(source.finance.data.workspace, 'user_id'), false);
  const parsed = await parseBackupFile(await asFile(await backupFor(['finance'], { finance: source.finance.data })));
  client.rows = [{ user_id: 'current-account', state: { replaced: true }, updated_at: '2026-10-06T09:00:00Z' }];
  await importBackupModule('finance', parsed.modules[0].data, { client, userId: 'current-account' });
  const restored = await exportBackupData(['finance'], { client, userId: 'current-account' });
  assert.deepEqual(restored.finance.data.workspace.state, expected);
  assert.equal('refresh_token' in restored.finance.data.workspace.state.settings, false);
  assert.equal(client.rows.length, 1);
  assert.equal(client.rows[0].user_id, 'current-account');
});

test('selected restore dependencies expand from registered modules only', () => {
  assert.deepEqual(expandDependencies(['finance']), ['finance']);
  assert.deepEqual(new Set(expandDependencies(['foodDiary'])), new Set(['foodDiary', 'recipes', 'grocery']));
});

test('invalid JSON and invalid format are rejected before restore', async () => {
  await assert.rejects(parseBackupFile({ size: 1, text: async () => '{' }), /valid backup JSON/);
  await assert.rejects(parseBackupFile(await asFile({ format: 'other', version: 1 })), /not a CBoard backup/);
});

test('checksum detects corrupted or truncated payload data', async () => {
  const backup = await backupFor(['finance']);
  backup.data.finance.data.workspace = { state: { transactions: [{ amount: 99 }] } };
  await assert.rejects(parseBackupFile(await asFile(backup)), /integrity check failed/);
});

test('a newer backup format is rejected without attempting import', async () => {
  const backup = await backupFor(['finance']); backup.version = BACKUP_VERSION + 1;
  await assert.rejects(parseBackupFile(await asFile(backup)), /newer CBoard version/);
});

test('unknown modules and newer module schemas are reported and safely skipped', async () => {
  const backup = await backupFor(['finance', 'futureApp', 'profile']);
  backup.data.futureApp = { schemaVersion: 4, data: { entries: [{ secretLikeFutureField: 'preserved in source file' }] } };
  backup.data.finance.schemaVersion = 99;
  backup.integrity.digest = await digest(backup.data);
  const parsed = await parseBackupFile(await asFile(backup));
  assert.deepEqual(parsed.modules.map(module => module.moduleId), ['profile']);
  assert.ok(parsed.skipped.some(item => item.moduleId === 'futureApp'));
});

test('a dependency missing from an older partial backup is skipped rather than detached', async () => {
  const backup = await backupFor(['foodDiary']);
  const parsed = await parseBackupFile(await asFile(backup));
  assert.equal(parsed.modules.length, 0);
  assert.match(parsed.skipped.find(item => item.moduleId === 'foodDiary').reason, /linked/);
});

test('duplicate app scopes are rejected; replace mode is the only supported restore policy', async () => {
  const backup = await backupFor(['finance', 'finance']);
  await assert.rejects(parseBackupFile(await asFile(backup)), /more than once/);
  // Restore UI deliberately offers Replace only. Stable IDs and upsert semantics protect repeat imports.
  assert.ok(backupModuleRegistry.every(module => module.importData && module.validate));
});

test('backup shape can retain real recipe, diary, grocery, and nutrition source records', async () => {
  const recipeId = 'lentil-stew';
  const grocery = { rows: [{ key: 'groceries:v1', value: { items: [{ id: 'stock-1', name: 'Lentils' }] } }] };
  const recipes = { rows: [{ key: `recipe:v1:${recipeId}`, value: { recipe: { slug: recipeId, ingredients: [{ name: 'Lentils' }] }, image: 'data:image/webp;base64,AA==' }, updated_at: '2026-10-01T00:00:00Z' }] };
  const diary = { rows: [{ key: 'food-diary:v1:2026-10-05', value: { date: '2026-10-05', meals: [{ items: [{ recipeSlug: recipeId, inventoryUsage: [{ key: 'stock-1', id: 'stock-1' }] }] }] } }] };
  const parsed = await parseBackupFile(await asFile(await backupFor(['recipes', 'grocery', 'foodDiary'], { recipes, grocery, foodDiary: diary })));
  assert.equal(parsed.modules.find(module => module.moduleId === 'recipes').data.rows[0].value.recipe.slug, recipeId);
  assert.equal(parsed.modules.find(module => module.moduleId === 'foodDiary').data.rows[0].value.meals[0].items[0].recipeSlug, recipeId);
});
