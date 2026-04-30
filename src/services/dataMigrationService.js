import { GOALS_STORAGE_KEY, ENTRIES_STORAGE_KEY } from '../features/progressTracker/progressTrackerStorage';
import { upsertGoal } from './goalService';
import { createEntry } from './entryService';
import { upsertCalculatorResult } from './calculatorResultService';
import { getPreference, setPreference } from './preferenceService';
import { assertSupabaseResult, getUserScopedClient } from './supabaseCrud';

const MIGRATION_KEY = 'local-storage-v1';
const MASS_UNIT_USAGE_KEY = 'calculators:mass-unit-usage';
const CALCULATOR_IDS = ['percentage', 'calorie', 'mass'];

function readJsonStorage(key, fallback) {
  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const rawValue = window.localStorage.getItem(key);
    return rawValue ? JSON.parse(rawValue) : fallback;
  } catch {
    return fallback;
  }
}

function removeStorageKeys(keys) {
  if (typeof window === 'undefined') {
    return;
  }

  keys.forEach((key) => {
    window.localStorage.removeItem(key);
  });
}

function getCalculatorStorageKey(calculatorId) {
  return `calculators:recent-results:${calculatorId}`;
}

function hasLegacyStorage() {
  if (typeof window === 'undefined') {
    return false;
  }

  return [
    GOALS_STORAGE_KEY,
    ENTRIES_STORAGE_KEY,
    MASS_UNIT_USAGE_KEY,
    ...CALCULATOR_IDS.map(getCalculatorStorageKey),
  ].some((key) => window.localStorage.getItem(key));
}

async function hasCompletedMigration() {
  const { client } = await getUserScopedClient();
  const { data, error } = await client
    .from('data_migrations')
    .select('key')
    .eq('key', MIGRATION_KEY)
    .maybeSingle();

  assertSupabaseResult({ error });
  return Boolean(data);
}

async function markMigrationComplete() {
  const { client, userId } = await getUserScopedClient();
  const result = await client.from('data_migrations').upsert(
    {
      user_id: userId,
      key: MIGRATION_KEY,
      completed_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,key' },
  );

  assertSupabaseResult(result);
}

function mapEntryValues(entry, metricIdMap) {
  return Object.fromEntries(
    Object.entries(entry.values ?? {})
      .map(([legacyMetricId, value]) => [
        metricIdMap.get(legacyMetricId) ?? legacyMetricId,
        value,
      ]),
  );
}

export async function migrateLocalStorageData() {
  if (!hasLegacyStorage()) {
    return { migrated: false };
  }

  const legacyKeys = [
    GOALS_STORAGE_KEY,
    ENTRIES_STORAGE_KEY,
    MASS_UNIT_USAGE_KEY,
    ...CALCULATOR_IDS.map(getCalculatorStorageKey),
  ];

  if (await hasCompletedMigration()) {
    removeStorageKeys(legacyKeys);
    return { migrated: false };
  }

  const legacyGoals = readJsonStorage(GOALS_STORAGE_KEY, []);
  const legacyEntries = readJsonStorage(ENTRIES_STORAGE_KEY, []);
  const goalIdMap = new Map();
  const metricIdMap = new Map();

  for (const legacyGoal of Array.isArray(legacyGoals) ? legacyGoals : []) {
    const savedGoal = await upsertGoal(legacyGoal);
    goalIdMap.set(legacyGoal.id, savedGoal.id);

    legacyGoal.metrics?.forEach((legacyMetric, index) => {
      const savedMetric = savedGoal.metrics[index];

      if (savedMetric) {
        metricIdMap.set(legacyMetric.id, savedMetric.id);
      }
    });
  }

  for (const legacyEntry of Array.isArray(legacyEntries) ? legacyEntries : []) {
    const goalId = goalIdMap.get(legacyEntry.goalId) ?? legacyEntry.goalId;

    await createEntry({
      ...legacyEntry,
      goalId,
      values: mapEntryValues(legacyEntry, metricIdMap),
    });
  }

  for (const calculatorId of CALCULATOR_IDS) {
    const legacyResults = readJsonStorage(getCalculatorStorageKey(calculatorId), []);

    if (!Array.isArray(legacyResults)) {
      continue;
    }

    for (const legacyResult of legacyResults.reverse()) {
      if (legacyResult?.summary && legacyResult?.detail) {
        await upsertCalculatorResult(calculatorId, legacyResult);
      }
    }
  }

  const legacyMassPreferences = readJsonStorage(MASS_UNIT_USAGE_KEY, null);

  if (legacyMassPreferences) {
    const currentPreference = await getPreference('mass-unit-usage', null);

    if (!currentPreference) {
      await setPreference('mass-unit-usage', legacyMassPreferences);
    }
  }

  await markMigrationComplete();
  removeStorageKeys(legacyKeys);
  return { migrated: true };
}
