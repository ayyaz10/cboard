import { useEffect, useRef, useState } from 'react';
import { loadFinance, saveFinance } from '../../services/financeService.js';

export function useFinance() {
  const [data, setData] = useState(null), [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const current = useRef(null), lock = useRef(false), mounted = useRef(true);
  async function reload() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { current.current = await loadFinance(); if (mounted.current) setData(current.current.state); }
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
      setData(next);
      const version = await saveFinance(next, before.version, before.userId);
      current.current = { state: next, version, userId: before.userId };
      setNotice(message); return true;
    } catch (saveError) { setData(before.state); setError(saveError.message || 'Could not save your change.'); return false; }
    finally { lock.current = false; setBusy(false); }
  }
  return { data, busy, error, notice, setNotice, setError, reload, change };
}
