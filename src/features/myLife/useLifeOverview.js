import { useCallback, useEffect, useRef, useState } from 'react';
import { loadFinanceLifeSummary, loadFoodLifeSummary, loadGoalLifeSummary, loadTrainingLifeSummary, loadWeightLifeSummary } from '../../services/lifeOverviewService.js';

const KEYS = ['finance', 'training', 'goals', 'weight', 'food'];
function emptySections() { return Object.fromEntries(KEYS.map(key => [key, { status: 'loading', data: null, error: '' }])); }

export function useLifeOverview(userId) {
  const [state, setState] = useState(() => ({ owner: userId, sections: emptySections() }));
  const generation = useRef(0), request = useRef(null), refreshRef = useRef(null);
  const refresh = useCallback(() => {
    if (!userId) return Promise.resolve();
    if (request.current) return request.current;
    const account = userId, seq = ++generation.current;
    setState({ owner: account, sections: emptySections() });
    const loaders = { finance: loadFinanceLifeSummary, training: loadTrainingLifeSummary,
      goals: loadGoalLifeSummary, weight: loadWeightLifeSummary, food: loadFoodLifeSummary };
    const jobs = Object.entries(loaders).map(async ([key, loader]) => {
      try {
        const data = await loader(account);
        if (generation.current === seq) setState(current => current.owner === account
          ? { ...current, sections: { ...current.sections, [key]: { status: 'ready', data, error: '' } } } : current);
      } catch (error) {
        if (generation.current === seq) setState(current => current.owner === account
          ? { ...current, sections: { ...current.sections, [key]: { status: 'error', data: null, error: error?.message || 'This summary is unavailable.' } } } : current);
      }
    });
    const operation = Promise.all(jobs).finally(() => { if (request.current === operation) request.current = null; });
    request.current = operation;
    return operation;
  }, [userId]);
  refreshRef.current = refresh;
  useEffect(() => {
    generation.current++; request.current = null;
    setState({ owner: userId, sections: emptySections() });
    if (!userId) return undefined;
    const timer = window.setTimeout(() => refreshRef.current?.(), 250);
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') refreshRef.current?.(); };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => { window.clearTimeout(timer); generation.current++; request.current = null;
      window.removeEventListener('focus', refreshWhenVisible); document.removeEventListener('visibilitychange', refreshWhenVisible); };
  }, [userId]);
  const sections = state.owner === userId ? state.sections : emptySections();
  return { sections, refresh };
}
