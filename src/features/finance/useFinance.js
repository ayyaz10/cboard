import { useEffect, useRef, useState } from 'react';
import { loadFinance, saveFinance } from '../../services/financeService.js';
import { notify } from '../../lib/notifications.js';
import { setBankTransactionHidden } from '../../services/bankingService.js';

export function useFinance() {
  const [data, setData] = useState(null), [bankData, setBankData] = useState({ connections: [], accounts: [], transactions: [] }), [bankError, setBankError] = useState(''), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const current = useRef(null), lock = useRef(false), mounted = useRef(true);
  async function reload() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { current.current = await loadFinance(); if (mounted.current) { setData(current.current.state); setBankData(current.current.bankData || { connections: [], accounts: [], transactions: [] }); setBankError(current.current.bankError || ''); } }
    catch (loadError) { if (mounted.current) setError(loadError.message || 'Could not load Finance. Apply the finance migration and retry.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  useEffect(() => { mounted.current = true; reload(); return () => { mounted.current = false; }; }, []);
  async function change(transform, message = 'Saved') {
    if (!current.current || lock.current) return false;
    lock.current = true; setBusy(true); setError('');
    const before = current.current;
    try {
      const next = transform(structuredClone(before.state));
      const retained = new Set(next.transactions.map(item => item.id));
      for (const item of before.state.transactions) {
        if (item.source === 'bank' && !retained.has(item.id)) await setBankTransactionHidden(item.id, true);
      }
      setData(next);
      const version = await saveFinance(next, before.version, before.userId);
      current.current = { ...before, state: next, version, userId: before.userId };
      notify.success(message); return true;
    } catch (saveError) { setData(before.state); setError(saveError.message || 'Could not save your change.'); notify.error(saveError.message || 'Could not save your change.'); return false; }
    finally { lock.current = false; setBusy(false); }
  }
  return { data, bankData, bankError, busy, error, setError, reload, change };
}
