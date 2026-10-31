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

test('legacy Driving Improvement backups restore under one parent habit and map CONFIDENT to STABLE', async () => {
  const category = { id: 'driving-category-1', name: 'Mirrors', createdAt: '2025-01-02T00:00:00.000Z' };
  const item = {
    id: 'driving-item-1', userId: 'old-account', categoryId: category.id, title: 'Late mirror check',
    cause: 'Original reason', correction: 'Original next action', status: 'CONFIDENT',
    createdAt: '2025-02-01T00:00:00.000Z', updatedAt: '2025-02-02T00:00:00.000Z',
  };
  const client = new FinanceMemoryClient();
  client.rows = [{ user_id: 'new-account', data: { replaced: true }, revision: 3 }];
  await importBackupModule('drivingImprovement', {
    workspace: { data: { version: 1, categories: [category], mistakes: [item] }, revision: 7, updated_at: '2025-02-02T00:00:00.000Z' },
  }, { client, userId: 'new-account' });
  const restored = client.rows[0];
  assert.equal(restored.user_id, 'new-account');
  assert.equal(restored.revision, 7);
  assert.equal(restored.data.categories[0].id, category.id);
  assert.equal(restored.data.categories[0].name, 'Mirrors');
  assert.equal(restored.data.habits.length, 1);
  assert.equal(restored.data.habits[0].name, 'Driving Improvement');
  assert.equal(restored.data.habits[0].slug, 'driving-improvement');
  assert.equal(restored.data.categories[0].habitId, restored.data.habits[0].id);
  assert.equal(restored.data.habits[0].userId, 'new-account');
  assert.deepEqual(restored.data.mistakes[0], { ...item, userId: 'new-account', status: 'STABLE' });
  assert.equal(backupModuleRegistry.find(module => module.moduleId === 'drivingImprovement').displayName, 'Habit Improvement');
});

test('older Driving Improvement backup schema remains parseable through the parent-area upgrade', async () => {
  const legacyData = { workspace: { data: { version: 1, categories: [{ id: 'cat-old', name: 'Roundabouts' }], mistakes: [] }, revision: 4 } };
  const backup = await backupFor(['drivingImprovement'], { drivingImprovement: legacyData });
  backup.data.drivingImprovement.schemaVersion = 1;
  backup.integrity.digest = await digest(backup.data);
  const parsed = await parseBackupFile(await asFile(backup));
  const module = parsed.modules[0];
  assert.equal(module.schemaVersion, 2);
  assert.equal(module.displayName, 'Habit Improvement');
  assert.equal(module.data.workspace.data.categories[0].name, 'Roundabouts');
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
  const state = { version: 1, settings: { currency: 'GBP', refresh_token: 'never-export-this' }, categories: [], donationCategories: [{ id: 'donation-category-1', name: 'Education', archived: false }], donationTargets: [{ id: 'donation-target-1', categoryId: 'donation-category-1', targetAmount: 50000, status: 'active' }], donationAccruals: [{ id: 'due-1', categoryId: 'donation-category-1', amount: 5000, accruedAmount: 5000, paidAmount: 0, effectiveDate: '2026-10-01', status: 'outstanding' }], donationPayments: [{ id: 'payment-1', categoryId: 'donation-category-1', amount: 1000, financeTransactionId: 'tx-stable-1', date: '2026-10-05', reversedAt: '2026-10-06', reversalId: 'reversal-1', sourceAccruals: [{ accrualId: 'due-1', amount: 1000 }] }], donationReversals: [{ id: 'reversal-1', paymentId: 'payment-1', financeTransactionId: 'tx-stable-1', categoryId: 'donation-category-1', amount: 1000, date: '2026-10-06', sourceType: 'manual_undo', sourceAccruals: [{ accrualId: 'due-1', amount: 1000 }] }], transactions: [{ id: 'tx-stable-1', type: 'expense', amount: 2250, date: '2026-10-05', reversedAt: '2026-10-06', donationReversalId: 'reversal-1', donationPaymentId: 'payment-1', financeGroup: 'donation', donationCategoryId: 'donation-category-1', linkedDonationTargetId: 'donation-target-1', merchantId: 'merchant-custom-1' }], merchantProfiles: [{ id: 'merchant-custom-1', displayName: 'Spice of India', aliases: ['Spice India'], normalizedAliases: ['spice of india', 'spice india'], logoType: 'custom', logoData: 'data:image/webp;base64,AA==' }], budgets: {}, openingBalances: {}, budgetPresets: [], goals: [], goalContributions: [], investments: [], debts: [], debtPayments: [{ id: 'repay-1', debtId: 'debt-stable-1', amount: 300 }], recurring: [{ id: 'repeat-1', frequency: 'weekly' }], transactionPresets: [], allocationRules: [] };
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
  const grocery = { rows: [{ key: 'groceries:v1', value: { items: [{ id: 'stock-1', name: 'Lentils', quantity: 0, unit: 'g', threshold: 300, thresholdEnabled: true, shortage: 150, stockTrackingPaused: false }], stockAlerts: [{ id: 'stock-event-1', type: 'out', itemIds: ['stock-1'], read: false }], migrations: { negativeStockV1: true, negativeStockV1Count: 1 } } }] };
  const recipes = { rows: [{ key: `recipe:v1:${recipeId}`, value: { recipe: { slug: recipeId, ingredients: [{ name: 'Lentils' }] }, image: 'data:image/webp;base64,AA==' }, updated_at: '2026-10-01T00:00:00Z' }] };
  const diary = { rows: [{ key: 'food-diary:v1:2026-10-05', value: { date: '2026-10-05', meals: [{ items: [{ recipeSlug: recipeId, inventoryUsage: [{ key: 'stock-1', id: 'stock-1' }] }] }] } }] };
  const parsed = await parseBackupFile(await asFile(await backupFor(['recipes', 'grocery', 'foodDiary'], { recipes, grocery, foodDiary: diary })));
  assert.equal(parsed.modules.find(module => module.moduleId === 'recipes').data.rows[0].value.recipe.slug, recipeId);
  assert.equal(parsed.modules.find(module => module.moduleId === 'foodDiary').data.rows[0].value.meals[0].items[0].recipeSlug, recipeId);
  const restoredGrocery = parsed.modules.find(module => module.moduleId === 'grocery').data.rows[0].value;
  assert.deepEqual([restoredGrocery.items[0].threshold, restoredGrocery.items[0].shortage, restoredGrocery.items[0].stockTrackingPaused, restoredGrocery.stockAlerts[0].id, restoredGrocery.migrations.negativeStockV1Count], [300, 150, false, 'stock-event-1', 1]);
});

test('food library backups preserve independent nutrition, Grocery and shopping preferences', async () => {
  const food = { id: 'salt', name: 'Salt', nutritionTrackingEnabled: true, groceryTrackingEnabled: false, shoppingListEnabled: false };
  const library = { rows: [{ key: 'food-catalog:v1', value: { version: 1, items: [food] } }] };
  const parsed = await parseBackupFile(await asFile(await backupFor(['foodLibrary'], { foodLibrary: library })));
  const restored = parsed.modules.find(module => module.moduleId === 'foodLibrary').data.rows[0].value.items[0];
  assert.deepEqual([restored.nutritionTrackingEnabled, restored.groceryTrackingEnabled, restored.shoppingListEnabled], [true, false, false]);
});

test('finance, receipt product links, redacted OCR text, grocery purchase ledger, and product mappings survive backup parsing',async()=>{
  const finance={workspace:{state:{transactions:[{id:'tx-1',type:'expense',amount:886,receipt:{version:2,rawText:'ALDI STORES\n[redacted]',items:[{id:'item-1',canonicalFoodId:'food-oats',retailerProductCode:'335763',packSize:1,packUnit:'kg'}]}}]},updated_at:'2026-10-20T00:00:00Z'}};
  const grocery={rows:[{key:'groceries:v1',value:{items:[{id:'stock-1',foodId:'food-oats',quantity:1500,unit:'g'}],receiptPurchaseLedger:{'tx-1:item-1':{transactionId:'tx-1',receiptItemId:'item-1',foodId:'food-oats',stockItemId:'stock-1',stockAmount:1000,stockUnit:'g'}}}}]};
  const foodLibrary={rows:[{key:'food-catalog:v1',value:{version:1,items:[{id:'food-oats',name:'Oats',quantity:100,unit:'g',receiptMappings:[{retailer:'ALDI STORES',productCode:'335763',alias:'OATS PORRIDGE'}]}]}}]};
  const recipes={rows:[]},foodDiary={rows:[]};
  const parsed=await parseBackupFile(await asFile(await backupFor(['finance','recipes','grocery','foodDiary','foodLibrary'],{finance,recipes,grocery,foodDiary,foodLibrary})));
  assert.equal(parsed.modules.find(module=>module.moduleId==='finance').data.workspace.state.transactions[0].receipt.items[0].canonicalFoodId,'food-oats');
  assert.equal(parsed.modules.find(module=>module.moduleId==='finance').data.workspace.state.transactions[0].receipt.rawText,'ALDI STORES\n[redacted]');
  assert.equal(parsed.modules.find(module=>module.moduleId==='grocery').data.rows[0].value.receiptPurchaseLedger['tx-1:item-1'].stockAmount,1000);
  assert.equal(parsed.modules.find(module=>module.moduleId==='foodLibrary').data.rows[0].value.items[0].receiptMappings[0].productCode,'335763');
});
