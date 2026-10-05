import { useMemo, useState } from 'react';
import { backupModuleRegistry } from '../../services/backupRegistry.js';
import { backupFilename, countModuleRecords, downloadBackup, expandDependencies, makeBackup, parseBackupFile, restoreSelectedModules } from '../../services/backupService.js';

const button = 'rounded-full border-2 border-black bg-white px-4 py-2 text-sm font-bold hover:bg-[#c5ff6f] disabled:cursor-wait disabled:opacity-60';
const selected = ids => new Set(ids);

export function BackupRestorePanel() {
  const allIds = useMemo(() => backupModuleRegistry.map(module => module.moduleId), []);
  const [backupIds, setBackupIds] = useState(() => selected(allIds));
  const [backupPreview, setBackupPreview] = useState(null);
  const [restorePreview, setRestorePreview] = useState(null);
  const [restoreIds, setRestoreIds] = useState(new Set());
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  function updateIds(setter, current, id, checked, available = allIds) {
    const next = new Set(current);
    if (checked) next.add(id); else next.delete(id);
    setter(new Set(expandDependencies([...next], available)));
  }

  async function reviewBackup(ids = [...backupIds]) {
    setError(''); setMessage(''); setBackupPreview(null); setBusy('backup');
    try { setBackupPreview(await makeBackup(ids)); }
    catch (err) { setError(err.message || 'Could not prepare the backup.'); }
    finally { setBusy(''); }
  }

  function saveBackup() {
    if (!backupPreview) return;
    downloadBackup(backupPreview);
    setMessage(`Backup downloaded as ${backupFilename(backupPreview)}.`);
    setBackupPreview(null);
  }

  async function selectFile(file) {
    if (!file) return;
    setError(''); setMessage(''); setRestorePreview(null); setConfirmReplace(false); setBusy('file');
    try {
      const preview = await parseBackupFile(file);
      const ids = preview.modules.map(module => module.moduleId);
      setRestorePreview(preview);
      setRestoreIds(new Set(expandDependencies(ids, ids)));
    } catch (err) { setError(err.message || 'This backup could not be read.'); }
    finally { setBusy(''); }
  }

  async function restore() {
    setError(''); setMessage(''); setBusy('restore');
    try {
      const result = await restoreSelectedModules({ modules: restorePreview.modules, selectedIds: [...restoreIds], onProgress: setProgress });
      setMessage(`Restore complete. ${result.restored.map(item => `${item.displayName}: ${item.count} saved items`).join(' · ')}.`);
      setRestorePreview(null); setConfirmReplace(false); setProgress('');
    } catch (err) { setError(err.message || 'The restore could not be completed.'); }
    finally { setBusy(''); }
  }

  const previewEntries = backupPreview ? backupPreview.scope.map(id => {
    const module = backupModuleRegistry.find(item => item.moduleId === id);
    return { id, name: module.displayName, count: countModuleRecords(id, backupPreview.data[id].data) };
  }) : [];
  const restoreAvailable = restorePreview?.modules || [];

  return <section className="account-card mt-5 grid gap-6" aria-labelledby="backup-title">
    <header><span className="pill">Your data</span><h2 id="backup-title" className="mt-3 text-2xl font-bold">Backup &amp; Restore</h2><p className="mt-1 max-w-2xl text-sm font-semibold leading-6 text-black/60">Create a private backup file you can keep offline or use on another device. Sign-in credentials are never included.</p></header>
    {(error || message) && <p className={`auth-message ${error ? 'auth-error' : 'auth-success'}`} role={error ? 'alert' : 'status'}>{error || message}</p>}

    <section className="grid gap-4" aria-labelledby="backup-heading">
      <div><h3 id="backup-heading" className="text-lg font-bold">Back up</h3><p className="text-sm font-semibold text-black/60">Choose all apps or just the data you want to keep.</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={Boolean(busy)} onClick={() => { setBackupIds(new Set(allIds)); reviewBackup(allIds); }}>Back up everything</button><button type="button" className={button} disabled={Boolean(busy)} onClick={() => { setBackupIds(new Set(allIds)); setBackupPreview(null); }}>Select all apps</button><button type="button" className={button} disabled={Boolean(busy) || !backupIds.size} onClick={() => reviewBackup([...backupIds])}>Review selected apps</button></div>
      <div className="grid gap-2 sm:grid-cols-2">{backupModuleRegistry.map(module => <label key={module.moduleId} className="flex items-start gap-2 rounded-xl border-2 border-black/15 bg-white p-3 text-sm font-semibold"><input className="mt-1 accent-lime-500" type="checkbox" checked={backupIds.has(module.moduleId)} onChange={event => { setBackupPreview(null); updateIds(setBackupIds, backupIds, module.moduleId, event.target.checked); }}/><span>{module.displayName}{module.dependencies?.length ? <small className="block font-medium text-black/55">Includes linked {module.dependencies.map(id => backupModuleRegistry.find(item => item.moduleId === id)?.displayName).join(', ')}</small> : null}</span></label>)}</div>
      {backupPreview && <div className="grid gap-3 rounded-xl border-2 border-black bg-[#fffdf8] p-4"><div><strong>Backup summary</strong><p className="text-sm text-black/60">{previewEntries.map(item => `${item.name}: ${item.count}`).join(' · ')}</p><p className="text-sm text-black/60">Estimated file size: {(new Blob([JSON.stringify(backupPreview)]).size / 1024 / 1024).toFixed(2)} MB · Format version {backupPreview.version}</p></div><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={Boolean(busy)} onClick={saveBackup}>Create backup file</button><button type="button" className={button} onClick={() => setBackupPreview(null)}>Cancel</button></div></div>}
      {busy === 'backup' && <p role="status" className="text-sm font-bold">Preparing your backup…</p>}
    </section>

    <section className="grid gap-4 border-t-2 border-black/10 pt-5" aria-labelledby="restore-heading">
      <div><h3 id="restore-heading" className="text-lg font-bold">Restore</h3><p className="text-sm font-semibold text-black/60">Choose a CBoard backup. You’ll review it before any saved data is changed.</p></div>
      <label className={`${button} w-fit cursor-pointer`}>{busy === 'file' ? 'Reading backup…' : 'Choose backup file'}<input className="sr-only" type="file" accept=".cboardbackup,.json,application/json" disabled={Boolean(busy)} onChange={event => { selectFile(event.target.files?.[0]); event.target.value = ''; }}/></label>
      {restorePreview && <div className="grid gap-4 rounded-xl border-2 border-black bg-[#fffdf8] p-4">
        <div><strong>Backup created</strong><p className="text-sm text-black/65">{new Date(restorePreview.backup.createdAt).toLocaleString()} · {restorePreview.backup.backupId}</p>{!restorePreview.backup.integrity && <p className="mt-1 text-sm font-semibold text-amber-800">This older backup has no integrity checksum.</p>}</div>
        {!restoreAvailable.length && <p className="rounded-xl border border-amber-700/30 bg-amber-50 p-3 text-sm font-semibold">No app data in this file can be safely restored by this CBoard version.</p>}
        <div><strong>Choose data to replace</strong><p className="text-sm text-black/60">Replace only changes the selected apps. Other apps stay as they are.</p></div>
        <div className="grid gap-2 sm:grid-cols-2">{restoreAvailable.map(module => <label key={module.moduleId} className="flex items-start gap-2 rounded-xl border border-black/15 bg-white p-3 text-sm font-semibold"><input className="mt-1 accent-lime-500" type="checkbox" checked={restoreIds.has(module.moduleId)} onChange={event => updateIds(setRestoreIds, restoreIds, module.moduleId, event.target.checked, restoreAvailable.map(item => item.moduleId))}/><span>{module.displayName} <small className="block font-medium text-black/55">{countModuleRecords(module.moduleId, module.data)} saved items</small></span></label>)}</div>
        {restorePreview.skipped.length > 0 && <div className="rounded-xl border border-amber-700/30 bg-amber-50 p-3 text-sm"><strong>Not available to restore</strong>{restorePreview.skipped.map(item => <p key={item.moduleId}>{item.moduleId}: {item.reason}</p>)}</div>}
        {!confirmReplace ? <button type="button" className={`${button} justify-self-start`} disabled={Boolean(busy) || !restoreIds.size} onClick={() => setConfirmReplace(true)}>Review replacement</button> : <div className="grid gap-3 rounded-xl border-2 border-[#a64b00] bg-[#fff4e5] p-4"><strong>This replaces: {restoreAvailable.filter(item => restoreIds.has(item.moduleId)).map(item => item.displayName).join(', ') || 'No apps selected'}.</strong><p className="text-sm">This will not change: {restoreAvailable.filter(item => !restoreIds.has(item.moduleId)).map(item => item.displayName).join(', ') || 'no other apps in this backup'}. Apps not included in the backup will also stay as they are. A safety backup of the current selected data downloads before restoring.</p><div className="flex flex-wrap gap-2"><button type="button" className={`${button} !bg-[#c5ff6f]`} disabled={Boolean(busy) || !restoreIds.size} onClick={restore}>Restore selected data</button><button type="button" className={button} disabled={Boolean(busy)} onClick={() => setConfirmReplace(false)}>Cancel</button></div></div>}
      </div>}
      {busy === 'restore' && <p role="status" className="text-sm font-bold">{progress || 'Preparing restore…'}</p>}
    </section>
    <p className="border-t border-black/10 pt-4 text-xs font-semibold leading-5 text-black/55">Backups are created and read on this device. They aren’t uploaded to another service. Account passwords, sessions, usernames, and private tokens aren’t included. Older app data that this CBoard version doesn’t understand is safely skipped and reported.</p>
  </section>;
}
