import { useCallback, useEffect, useRef, useState } from 'react';
import { loadFinanceLifeSummary, loadFoodLifeSummary, loadGoalLifeSummary, loadTrainingLifeSummary, loadWeightLifeSummary } from '../../services/lifeOverviewService.js';

const LOADERS = { finance: loadFinanceLifeSummary, training: loadTrainingLifeSummary,
  goals: loadGoalLifeSummary, weight: loadWeightLifeSummary, food: loadFoodLifeSummary };
const KEYS = Object.keys(LOADERS);
function emptySections() { return Object.fromEntries(KEYS.map(key => [key, { status: 'loading', data: null, error: '' }])); }

export function useLifeOverview(userId, requestedKeys = KEYS) {
  const requestedKey = [...new Set(requestedKeys.filter(key => KEYS.includes(key)))].sort().join(',');
  const selectedKeys = requestedKey ? requestedKey.split(',') : [];
  const [state, setState] = useState(() => ({ owner: userId, sections: emptySections() }));
  const owner = useRef(userId), generation = useRef(0), inFlight = useRef(new Map()), refreshRef = useRef(null);
  owner.current = userId;
  const refresh = useCallback((keys = selectedKeys) => {
    if (!userId) return Promise.resolve();
    const account = userId, epoch = generation.current;
    const jobs = [...new Set(keys.filter(key => KEYS.includes(key)))].map(key => {
      const requestKey = `${account}:${key}`;
      if (inFlight.current.has(requestKey)) return inFlight.current.get(requestKey);
      setState(current => current.owner === account ? { ...current, sections: { ...current.sections, [key]: { ...current.sections[key], status: 'loading', error: '' } } } : current);
      const operation = LOADERS[key](account).then(data => {
        if (owner.current === account && generation.current === epoch) setState(current => current.owner === account
          ? { ...current, sections: { ...current.sections, [key]: { status: 'ready', data, error: '' } } } : current);
      }).catch(error => {
        if (owner.current === account && generation.current === epoch) setState(current => current.owner === account
          ? { ...current, sections: { ...current.sections, [key]: { status: 'error', data: null, error: error?.message || 'This summary is unavailable.' } } } : current);
      }).finally(() => { if (inFlight.current.get(requestKey) === operation) inFlight.current.delete(requestKey); });
      inFlight.current.set(requestKey, operation);
      return operation;
    });
    return Promise.all(jobs);
  }, [userId, requestedKey]);
  refreshRef.current = refresh;
  useEffect(() => {
    generation.current++;
    inFlight.current.clear();
    setState({ owner: userId, sections: emptySections() });
    if (!userId) return undefined;
    const timer = window.setTimeout(() => refreshRef.current?.(), 250);
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') refreshRef.current?.(); };
    window.addEventListener('focus', refreshWhenVisible); document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => { window.clearTimeout(timer); generation.current++; inFlight.current.clear(); window.removeEventListener('focus', refreshWhenVisible); document.removeEventListener('visibilitychange', refreshWhenVisible); };
  }, [userId, requestedKey]);
  const sections = state.owner === userId ? state.sections : emptySections();
  return { sections, refresh };
}
