import { getUserScopedClient, assertSupabaseResult } from './supabaseCrud.js';
import { validateState as validateTrainingState } from '../features/training/trainingData.js';

const PAGE_SIZE = 500;
const secretField = key => /^(password|password_hash|passwd|session_token|access_token|refresh_token|auth_token|reset_token|cookie|auth_cookie|token|private_key|api_key|service_role_key|credentials|provider_id|user_id)$/i.test(key.replace(/([a-z])([A-Z])/g, '$1_$2'));
function omitSecrets(value) {
  if (Array.isArray(value)) return value.map(omitSecrets);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !secretField(key)).map(([key, nested]) => [key, omitSecrets(nested)]));
}
const safeArray = (value, label) => {
  if (!Array.isArray(value)) throw new Error(`${label} backup data is invalid.`);
  return value;
};

async function readRows(client, table, userId, foreignKey, foreignIds) {
  if (foreignKey && !foreignIds.length) return [];
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = client.from(table).select('*');
    if (table !== 'metrics' && table !== 'entry_values') query = query.eq('user_id', userId);
    else query = query.in(foreignKey, foreignIds);
    const result = await query.order('id').range(from, from + PAGE_SIZE - 1);
    assertSupabaseResult(result);
    rows.push(...(result.data || []).map(({ user_id: _owner, ...row }) => row));
    if ((result.data || []).length < PAGE_SIZE) return rows;
  }
}

async function readPrefs(client, userId, patterns) {
  const rows = [];
  for (const pattern of patterns) {
    let query = client.from('user_tool_preferences').select('key,value,updated_at').eq('user_id', userId);
    query = pattern.endsWith('*') ? query.like('key', `${pattern.slice(0, -1)}%`) : query.eq('key', pattern);
    const result = await query.order('key');
    assertSupabaseResult(result);
    rows.push(...(result.data || []));
  }
  return [...new Map(rows.map(row => [row.key, row])).values()];
}

async function writePrefs(client, userId, current, rows) {
  for (const row of current) {
    const result = await client.from('user_tool_preferences').delete().eq('user_id', userId).eq('key', row.key);
    assertSupabaseResult(result);
  }
  if (rows.length) {
    const result = await client.from('user_tool_preferences').upsert(rows.map(row => ({ ...row, user_id: userId })), { onConflict: 'user_id,key' });
    assertSupabaseResult(result);
  }
}

function preferenceModule({ id, name, patterns, version = 1, dependencies = [] }) {
  return {
    moduleId: id, displayName: name, schemaVersion: version, dependencies,
    async exportData({ client, userId }) { return { rows: await readPrefs(client, userId, patterns) }; },
    validate(data) {
      const rows = safeArray(data?.rows, name);
      if (rows.some(row => !row || typeof row.key !== 'string' || !patterns.some(pattern => pattern.endsWith('*') ? row.key.startsWith(pattern.slice(0, -1)) : row.key === pattern) || !('value' in row)))
        throw new Error(`${name} backup contains an invalid saved item.`);
    },
    async importData({ client, userId, data }) {
      const current = await readPrefs(client, userId, patterns);
      await writePrefs(client, userId, current, data.rows);
    },
    recordCount(data) { return data.rows.length; },
  };
}

function tableModule({ id, name, tables, validateData = () => {}, dependencies = [] }) {
  return {
    moduleId: id, displayName: name, schemaVersion: 1, dependencies,
    async exportData({ client, userId }) {
      const result = {};
      for (const table of tables) result[table] = await readRows(client, table, userId);
      return result;
    },
    validate(data) {
      for (const table of tables) safeArray(data?.[table], name);
      validateData(data);
    },
    async importData({ client, userId, data }) {
      for (const table of [...tables].reverse()) {
        const existing = await readRows(client, table, userId);
        if (existing.length) {
          const ids = existing.map(row => row.id).filter(Boolean);
          for (let from = 0; from < ids.length; from += 200) {
            const result = await client.from(table).delete().in('id', ids.slice(from, from + 200));
            assertSupabaseResult(result);
          }
        }
      }
      for (const table of tables) {
        const rows = data[table].map(row => ({ ...row, user_id: userId }));
        for (let from = 0; from < rows.length; from += 200) {
          const result = await client.from(table).insert(rows.slice(from, from + 200));
          assertSupabaseResult(result);
        }
      }
    },
    recordCount(data) { return tables.reduce((count, table) => count + data[table].length, 0); },
  };
}

const finance = {
  moduleId: 'finance', displayName: 'Finance', schemaVersion: 1,
  async exportData({ client, userId }) {
    const result = await client.from('finance_workspaces').select('state,updated_at').eq('user_id', userId).maybeSingle();
    assertSupabaseResult(result); return { workspace: result.data || null };
  },
  validate(data) { if (!data || !(data.workspace === null || (data.workspace && typeof data.workspace.state === 'object'))) throw new Error('Finance backup data is invalid.'); },
  async importData({ client, userId, data }) {
    const deleted = await client.from('finance_workspaces').delete().eq('user_id', userId); assertSupabaseResult(deleted);
    if (data.workspace) { const result = await client.from('finance_workspaces').insert({ ...data.workspace, user_id: userId }); assertSupabaseResult(result); }
  },
  recordCount(data) {
    const state = data.workspace?.state;
    if (!state) return 0;
    return ['categories', 'transactions', 'budgetPresets', 'goals', 'goalContributions', 'investments', 'debts', 'debtPayments', 'recurring', 'transactionPresets', 'allocationRules'].reduce((count, key) => count + (Array.isArray(state[key]) ? state[key].length : 0), 0)
      + (state.budgets && typeof state.budgets === 'object' ? Object.keys(state.budgets).length : 0);
  },
};

const goals = {
  moduleId: 'goals', displayName: 'Goals & progress', schemaVersion: 1, dependencies: ['notes'],
  async exportData({ client, userId }) {
    const goalRows = await readRows(client, 'goals', userId);
    const goalIds = goalRows.map(row => row.id);
    const metrics = goalIds.length ? await readRows(client, 'metrics', userId, 'goal_id', goalIds) : [];
    const entries = await readRows(client, 'entries', userId);
    const entryIds = entries.map(row => row.id);
    const entryValues = entryIds.length ? await readRows(client, 'entry_values', userId, 'entry_id', entryIds) : [];
    const [journals, quotes] = goalIds.length ? await Promise.all([
      readRows(client, 'goal_journal_entries', userId).then(rows => rows.filter(row => goalIds.includes(row.goal_id))),
      readRows(client, 'goal_quotes', userId).then(rows => rows.filter(row => goalIds.includes(row.goal_id))),
    ]) : [[], []];
    return { goals: goalRows, metrics, entries, entry_values: entryValues, goal_journal_entries: journals, goal_quotes: quotes };
  },
  validate(data) { for (const table of ['goals', 'metrics', 'entries', 'entry_values', 'goal_journal_entries', 'goal_quotes']) safeArray(data?.[table], 'Goals'); },
  async importData({ client, userId, data }) {
    const tables = ['goal_quotes', 'goal_journal_entries', 'entry_values', 'entries', 'metrics', 'goals'];
    for (const table of tables) {
      if (table === 'entry_values' || table === 'metrics') continue; // These child rows have no owner column; parent deletes cascade safely.
      const existing = await readRows(client, table, userId);
      if (existing.length) {
        const result = await client.from(table).delete().in('id', existing.map(row => row.id)); assertSupabaseResult(result);
      }
    }
    for (const table of [...tables].reverse()) {
      const rows = data[table].map(row => ({ ...row, ...(table === 'metrics' || table === 'entry_values' ? {} : { user_id: userId }) }));
      if (rows.length) { const result = await client.from(table).insert(rows); assertSupabaseResult(result); }
    }
  },
  recordCount(data) { return ['goals', 'metrics', 'entries', 'entry_values', 'goal_journal_entries', 'goal_quotes'].reduce((n, table) => n + data[table].length, 0); },
};

const training = {
  moduleId: 'training', displayName: 'Training', schemaVersion: 1,
  async exportData({ client, userId }) {
    const result = await client.from('training_workspaces').select('data,revision,updated_at').eq('user_id', userId).maybeSingle();
    assertSupabaseResult(result);
    let local = null;
    try { const raw = localStorage.getItem(`cboard:training:v1:${userId}`); local = raw ? JSON.parse(raw) : null; } catch { /* cloud copy remains usable */ }
    const workspace = local && (local.dirty || local.revision > (result.data?.revision || 0)) ? { data: local.data, revision: local.revision, updated_at: result.data?.updated_at || null } : result.data;
    return { workspace, localCache: workspace === result.data ? null : local };
  },
  validate(data) { if (!data || !(data.workspace === null || typeof data.workspace.data === 'object')) throw new Error('Training backup data is invalid.'); if (data.workspace?.data) validateTrainingState(data.workspace.data); },
  async importData({ client, userId, data }) {
    const remove = await client.from('training_workspaces').delete().eq('user_id', userId); assertSupabaseResult(remove);
    const revision = Math.max(1, Number(data.workspace?.revision) || 1);
    if (data.workspace) { const save = await client.from('training_workspaces').insert({ ...data.workspace, user_id: userId, revision }); assertSupabaseResult(save); }
    if (data.localCache) localStorage.setItem(`cboard:training:v1:${userId}`, JSON.stringify({ ...data.localCache, revision, dirty: true }));
    else localStorage.removeItem(`cboard:training:v1:${userId}`);
  },
  recordCount(data) {
    const state = data.workspace?.data;
    return state ? (state.exercises?.length || 0) + (state.sessions?.length || 0) + (state.sessions || []).reduce((n, session) => n + (session.sets?.length || 0), 0)
      + (state.plan?.days || []).reduce((n, day) => n + (day.exercises?.length || 0), 0) + Object.keys(state.checkins || {}).length : 0;
  },
};

const focus = {
  moduleId: 'focus', displayName: 'Focus sessions & reminders', schemaVersion: 1,
  async exportData(context) {
    const sessions = await tableModule({ id: 'focus', name: 'Focus', tables: ['focus_sessions', 'focus_break_tasks'] }).exportData(context);
    const { userId } = context;
    const local = {};
    for (const [name, key] of Object.entries({ reminders: `cboard:reminders:${userId}`, presets: `cboard:reminder-presets:${userId}` })) {
      try { const value = localStorage.getItem(key); if (value != null) local[name] = JSON.parse(value); } catch { throw new Error('Focus reminders could not be read for backup.'); }
    }
    return { ...sessions, local };
  },
  validate(data) { for (const table of ['focus_sessions', 'focus_break_tasks']) safeArray(data?.[table], 'Focus'); if (!data?.local || typeof data.local !== 'object') throw new Error('Focus backup data is invalid.'); },
  async importData(context) {
    const { client, userId, data } = context;
    await tableModule({ id: 'focus', name: 'Focus', tables: ['focus_sessions', 'focus_break_tasks'] }).importData(context);
    for (const [name, key] of Object.entries({ reminders: `cboard:reminders:${userId}`, presets: `cboard:reminder-presets:${userId}` })) {
      if (name in data.local) localStorage.setItem(key, JSON.stringify(data.local[name])); else localStorage.removeItem(key);
    }
    window.dispatchEvent(new CustomEvent('cboard:reminder-presets-changed', { detail: { userId, presets: data.local.presets || [] } }));
  },
  recordCount(data) { return data.focus_sessions.length + data.focus_break_tasks.length + (data.local.reminders?.reminders?.length || 0) + (data.local.reminders?.history?.length || 0) + (data.local.presets?.length || 0); },
};

function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

const weights = {
  moduleId: 'weightProgress', displayName: 'Weight progress', schemaVersion: 1,
  async exportData({ client, userId }) {
    const rows = await readRows(client, 'weight_entries', userId);
    const media = {};
    for (const row of rows) if (row.photo_path) {
      const result = await client.storage.from('weight-photos').download(row.photo_path);
      assertSupabaseResult(result);
      if (result.data.size > 1500000) throw new Error('A weight progress photo is too large to include in a backup.');
      media[row.id] = { type: 'image/webp', base64: bytesToBase64(new Uint8Array(await result.data.arrayBuffer())) };
    }
    return { entries: rows.map(row => ({ ...row, photo_path: null })), media };
  },
  validate(data) {
    const rows = safeArray(data?.entries, 'Weight progress');
    if (!data.media || typeof data.media !== 'object' || rows.some(row => !row.date || !Number.isFinite(Number(row.weight_kg)))) throw new Error('Weight progress backup contains an invalid entry.');
    for (const image of Object.values(data.media)) if (image?.type !== 'image/webp' || typeof image.base64 !== 'string' || image.base64.length > 2200000) throw new Error('Weight progress backup contains an invalid photo.');
  },
  async importData({ client, userId, data }) {
    const existing = await readRows(client, 'weight_entries', userId);
    if (existing.length) { const result = await client.from('weight_entries').delete().in('id', existing.map(row => row.id)); assertSupabaseResult(result); }
    const rows = [];
    for (const row of data.entries) {
      let photo_path = null;
      const image = data.media[row.id];
      if (image) {
        photo_path = `${userId}/${crypto.randomUUID()}.webp`;
        const result = await client.storage.from('weight-photos').upload(photo_path, new Blob([base64ToBytes(image.base64)], { type: image.type }), { contentType: image.type, upsert: false });
        assertSupabaseResult(result);
      }
      rows.push({ ...row, user_id: userId, photo_path });
    }
    for (let from = 0; from < rows.length; from += 200) { const result = await client.from('weight_entries').insert(rows.slice(from, from + 200)); assertSupabaseResult(result); }
  },
  recordCount(data) { return data.entries.length; },
};

const profile = {
  moduleId: 'profile', displayName: 'Profile', schemaVersion: 1,
  async exportData({ client }) {
    const result = await client.from('profiles').select('display_name,avatar_path').maybeSingle(); assertSupabaseResult(result);
    let avatar = null;
    if (result.data?.avatar_path) {
      const file = await client.storage.from('profile-avatars').download(result.data.avatar_path); assertSupabaseResult(file);
      if (file.data.size > 524288) throw new Error('Your profile picture is too large to include in the backup.');
      avatar = { type: 'image/webp', base64: bytesToBase64(new Uint8Array(await file.data.arrayBuffer())) };
    }
    return { displayName: result.data?.display_name || '', avatar };
  },
  validate(data) { if (!data || typeof data.displayName !== 'string' || data.displayName.length > 80 || (data.avatar && (data.avatar.type !== 'image/webp' || typeof data.avatar.base64 !== 'string' || data.avatar.base64.length > 720000))) throw new Error('Profile backup data is invalid.'); },
  async importData({ client, userId, data }) {
    let avatar_path = null;
    if (data.avatar) {
      avatar_path = `${userId}/${crypto.randomUUID()}.webp`;
      const result = await client.storage.from('profile-avatars').upload(avatar_path, new Blob([base64ToBytes(data.avatar.base64)], { type: data.avatar.type }), { contentType: data.avatar.type, upsert: false }); assertSupabaseResult(result);
    }
    const result = await client.from('profiles').update({ display_name: data.displayName, avatar_path }).eq('user_id', userId); assertSupabaseResult(result);
  },
  recordCount(data) { return Number(Boolean(data.displayName)) + Number(Boolean(data.avatar)); },
};

export const backupModuleRegistry = [
  finance,
  preferenceModule({ id: 'recipes', name: 'Recipes & meal planning', patterns: ['recipe:v1:*', 'recipe-favourite:v1:*', 'recipes:routine-presets:v1', 'recipes:daily-plan:v1'] }),
  preferenceModule({ id: 'grocery', name: 'Grocery', patterns: ['groceries:v1'], dependencies: ['foodDiary'] }),
  preferenceModule({ id: 'foodDiary', name: 'Food diary', patterns: ['food-diary:v1:*'], dependencies: ['recipes', 'grocery'] }),
  preferenceModule({ id: 'foodLibrary', name: 'Food library & nutrition targets', patterns: ['food-catalog:v1', 'nutrition:daily-goals:v1'] }),
  goals,
  tableModule({ id: 'notes', name: 'Notes', tables: ['notes'], dependencies: ['goals'] }),
  training,
  weights,
  focus,
  tableModule({ id: 'savedCalculations', name: 'Saved calculations', tables: ['calculator_results'] }),
  tableModule({ id: 'trading', name: 'Trading journal', tables: ['crypto_futures_trades'] }),
  preferenceModule({ id: 'preferences', name: 'App preferences', patterns: ['mass-unit-usage'] }),
  profile,
].map(module => Object.freeze(module));

export const getBackupModules = () => backupModuleRegistry;
export const getBackupModule = moduleId => backupModuleRegistry.find(module => module.moduleId === moduleId);

export async function exportBackupData(moduleIds, contextOverride) {
  const { client, userId } = contextOverride || await getUserScopedClient();
  const modules = backupModuleRegistry.filter(module => moduleIds.includes(module.moduleId));
  const data = {};
  for (const module of modules) {
    const moduleData = omitSecrets(await module.exportData({ client, userId }));
    module.validate(moduleData);
    data[module.moduleId] = { schemaVersion: module.schemaVersion, data: moduleData };
  }
  return data;
}

export async function importBackupModule(moduleId, moduleData, contextOverride) {
  const module = getBackupModule(moduleId);
  if (!module) throw new Error(`Unknown backup module: ${moduleId}`);
  const { client, userId } = contextOverride || await getUserScopedClient();
  module.validate(moduleData);
  await module.importData({ client, userId, data: moduleData });
}

export async function countCurrentModule(moduleId) {
  const module = getBackupModule(moduleId);
  const data = await exportBackupData([moduleId]);
  return module.recordCount(data[moduleId].data);
}
