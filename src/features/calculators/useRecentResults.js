import { useEffect, useState } from 'react';
import {
  createCalculatorResult,
  deleteCalculatorResult,
  getCalculatorResults,
} from '../../services/calculatorResultService';

export function useRecentResults(calculatorId) {
  const [recentResults, setRecentResults] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isActive = true;
    setIsLoading(true);
    setError('');

    getCalculatorResults(calculatorId)
      .then((results) => {
        if (isActive) {
          setRecentResults(results);
        }
      })
      .catch((loadError) => {
        if (isActive) {
          setError(loadError.message);
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [calculatorId]);

  const saveResult = async ({ summary, detail }) => {
    setError('');

    try {
      const results = await createCalculatorResult(calculatorId, {
        summary,
        detail,
        savedAt: new Date().toISOString(),
      });
      setRecentResults(results);
    } catch (saveError) {
      setError(saveError.message);
    }
  };

  const removeResult = async (entryId) => {
    setError('');
    setRecentResults((currentResults) =>
      currentResults.filter((entry) => entry.id !== entryId),
    );

    try {
      await deleteCalculatorResult(entryId);
    } catch (deleteError) {
      setError(deleteError.message);
      const results = await getCalculatorResults(calculatorId);
      setRecentResults(results);
    }
  };

  return {
    recentResults,
    isLoading,
    error,
    saveResult,
    removeResult,
  };
}
