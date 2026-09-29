import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getRecipes } from '../../services/recipeService';
import { getFoodDiary } from '../../services/foodDiaryService';
import { getFoodCatalog } from '../../services/foodCatalogService';
import { loadGroceries } from '../../services/groceryService';
import { buildSavedFoods } from './savedFoods.js';

export function useSavedFoods(enabled = true) {
  const { user } = useAuth();
  const [state, setState] = useState({ library: [], loading: false, error: '' });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('food-catalog-changed', refresh);
    return () => window.removeEventListener('food-catalog-changed', refresh);
  }, []);
  useEffect(() => {
    if (!enabled || !user?.id) return;
    let cancelled = false;
    setState({ library: [], loading: true, error: '' });
    Promise.allSettled([getRecipes(), getFoodDiary(user.id), getFoodCatalog(user.id), loadGroceries()]).then(results => {
      if (cancelled) return;
      const values = results.map(result => result.status === 'fulfilled' ? result.value : undefined);
      setState({
        library: buildSavedFoods(values[0], values[1], values[2], values[3]?.state),
        loading: false,
        error: results.some(result => result.status === 'rejected') ? 'Some saved foods could not be loaded. Reopen to retry.' : '',
      });
    });
    return () => { cancelled = true; };
  }, [enabled, user?.id, revision]);
  return state;
}
