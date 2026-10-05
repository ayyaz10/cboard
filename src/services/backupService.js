import { backupModuleRegistry, exportBackupData, getBackupModule, importBackupModule } from './backupRegistry.js';

export const BACKUP_FORMAT = 'cboard-backup';
export const BACKUP_VERSION = 1;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const stableJson = value => JSON.stringify(canonical(value));
const digest = async value => {
  const bytes = new TextEncoder().encode(stableJson(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};
const uuid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function expandDependencies(moduleIds, availableIds = backupModuleRegistry.map(module => module.moduleId)) {
  const selected = new Set(moduleIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...selected]) {
      const module = getBackupModule(id);
      for (const dependency of module?.dependencies || []) {
        if (availableIds.includes(dependency) && !selected.has(dependency)) { selected.add(dependency); changed = true; }
      }
    }
  }
  return backupModuleRegistry.filter(module => selected.has(module.moduleId)).map(module => module.moduleId);
}

export async function makeBackup(moduleIds, { safety = false } = {}) {
  const scope = expandDependencies(moduleIds);
  const data = await exportBackupData(scope);
  const backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    backupId: uuid(),
    createdAt: new Date().toISOString(),
    appVersion: import.meta.env?.VITE_APP_VERSION || '0.1.0',
    scope,
    safetyBackup: safety,
    data,
  };
  backup.integrity = { algorithm: 'SHA-256', digest: await digest(data) };
  return backup;
}

export function backupFilename(backup) {
  const date = new Date(backup.createdAt);
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}-${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
  const names = backup.scope.map(id => getBackupModule(id)?.displayName || id)
    .map(name => name.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')).filter(Boolean);
  const label = names.length === backupModuleRegistry.length ? 'All' : names.join('-') || 'Data';
  return `CBoard-${label}-${stamp}.cboardbackup`;
}

export function downloadBackup(backup, filename = backupFilename(backup)) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.rel = 'noopener';
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function countModuleRecords(moduleId, moduleData) {
  const module = getBackupModule(moduleId);
  return module?.recordCount(moduleData) ?? 0;
}

export async function parseBackupFile(file) {
  if (!file || file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error('Choose a non-empty CBoard backup under 100 MB.');
  let backup;
  try { backup = JSON.parse(await file.text()); } catch { throw new Error('This file is not valid backup JSON. Your data has not been changed.'); }
  if (!backup || backup.format !== BACKUP_FORMAT) throw new Error('This is not a CBoard backup file. Your data has not been changed.');
  if (!Number.isInteger(backup.version) || backup.version > BACKUP_VERSION) throw new Error('This backup was created by a newer CBoard version. Update CBoard before restoring it.');
  if (backup.version < 1) throw new Error('This backup version is not supported. Your data has not been changed.');
  if (!Array.isArray(backup.scope) || !backup.data || typeof backup.data !== 'object' || !backup.createdAt || !Number.isFinite(Date.parse(backup.createdAt))) throw new Error('This backup is incomplete or damaged. Your data has not been changed.');
  if (new Set(backup.scope).size !== backup.scope.length) throw new Error('This backup lists the same app more than once. Nothing was restored.');
  if (backup.integrity?.algorithm === 'SHA-256') {
    if (await digest(backup.data) !== backup.integrity.digest) throw new Error('The backup integrity check failed. The file may be incomplete or changed; nothing was restored.');
  } else if (backup.integrity) throw new Error('This backup uses an unsupported integrity check. Nothing was restored.');
  const modules = [];
  const skipped = [];
  for (const moduleId of Object.keys(backup.data)) {
    if (!backup.scope.includes(moduleId)) skipped.push({ moduleId, reason: 'This section is not listed in the backup scope and was ignored.' });
  }
  for (const moduleId of backup.scope) {
    if (typeof moduleId !== 'string' || !Object.hasOwn(backup.data, moduleId)) throw new Error('The backup scope does not match its saved data. Nothing was restored.');
    const registered = getBackupModule(moduleId);
    const item = backup.data[moduleId];
    if (!item || !Number.isInteger(item.schemaVersion) || !('data' in item)) throw new Error(`The ${moduleId} backup section is invalid. Nothing was restored.`);
    if (!registered) { skipped.push({ moduleId, reason: 'This CBoard version does not include this app.' }); continue; }
    if (item.schemaVersion > registered.schemaVersion) { skipped.push({ moduleId, reason: 'This backup uses a newer version of this app’s data format.' }); continue; }
    let moduleData = item.data;
    let version = item.schemaVersion;
    while (version < registered.schemaVersion) {
      const migrate = registered.migrations?.find(handler => handler.fromVersion === version);
      if (!migrate) { skipped.push({ moduleId, reason: 'This app’s saved data format cannot be updated safely.' }); moduleData = null; break; }
      moduleData = await migrate.migrate(moduleData);
      version = migrate.toVersion;
    }
    if (moduleData !== null) {
      registered.validate(moduleData);
      modules.push({ moduleId, data: moduleData, schemaVersion: registered.schemaVersion, displayName: registered.displayName });
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    const ids = new Set(modules.map(module => module.moduleId));
    for (const module of [...modules]) {
      const missing = (getBackupModule(module.moduleId)?.dependencies || []).filter(id => !ids.has(id));
      if (missing.length) {
        modules.splice(modules.indexOf(module), 1);
        skipped.push({ moduleId: module.moduleId, reason: `Its linked ${missing.map(id => getBackupModule(id)?.displayName || id).join(', ')} data is missing from this backup.` });
        changed = true;
      }
    }
  }
  return { backup, modules, skipped };
}

export async function restoreSelectedModules({ modules, selectedIds, onProgress }) {
  const available = modules.map(module => module.moduleId);
  const selected = expandDependencies(selectedIds, available);
  const chosen = modules.filter(module => selected.includes(module.moduleId));
  if (!chosen.length) throw new Error('Choose at least one app to restore.');
  for (const module of chosen) {
    const missing = (getBackupModule(module.moduleId)?.dependencies || []).filter(id => !selected.includes(id));
    if (missing.length) throw new Error(`${module.displayName} is linked to ${missing.map(id => getBackupModule(id)?.displayName || id).join(', ')}. Include the linked app to keep those records connected.`);
  }
  const safety = await makeBackup(chosen.map(module => module.moduleId), { safety: true });
  downloadBackup(safety, `CBoard-Before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.cboardbackup`);
  onProgress?.('A safety backup has been downloaded. Restoring selected apps…');
  const current = safety.data;
  const currentModules = chosen.map(module => ({ ...module, data: current[module.moduleId].data }));
  const attempted = [];
  try {
    for (const module of chosen) {
      attempted.push(module);
      onProgress?.(`Restoring ${module.displayName}…`);
      await importBackupModule(module.moduleId, module.data);
    }
    return { restored: chosen.map(module => ({ moduleId: module.moduleId, displayName: module.displayName, count: countModuleRecords(module.moduleId, module.data) })), skipped: [] };
  } catch (error) {
    const rollbackErrors = [];
    for (const module of attempted.reverse()) {
      const previous = currentModules.find(item => item.moduleId === module.moduleId);
      try { await importBackupModule(module.moduleId, previous.data); }
      catch (rollbackError) { rollbackErrors.push(`${module.displayName}: ${rollbackError.message || 'could not roll back'}`); }
    }
    const suffix = rollbackErrors.length ? ` Recovery needs attention: ${rollbackErrors.join('; ')}. Keep the downloaded safety backup.` : ' Your previous data was restored.';
    throw new Error(`Restore stopped: ${error.message || 'an app could not be restored'}.${suffix}`);
  }
}
