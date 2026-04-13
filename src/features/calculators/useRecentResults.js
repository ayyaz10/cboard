import { useEffect, useState } from 'react';

const MAX_RECENT_RESULTS = 5;

function normalizeEntry(entry, index) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  if (typeof entry.summary !== 'string' || typeof entry.detail !== 'string') {
    return null;
  }

  return {
    id:
      typeof entry.id === 'string'
        ? entry.id
        : `stored-result-${index}-${entry.savedAt ?? 'unknown'}`,
    summary: entry.summary,
    detail: entry.detail,
    savedAt: typeof entry.savedAt === 'string' ? entry.savedAt : new Date().toISOString(),
  };
}

function readRecentResults(storageKey) {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const storedValue = window.localStorage.getItem(storageKey);

    if (!storedValue) {
      return [];
    }

    const parsedValue = JSON.parse(storedValue);

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue
      .map(normalizeEntry)
      .filter(Boolean)
      .slice(0, MAX_RECENT_RESULTS);
  } catch {
    return [];
  }
}

export function useRecentResults(calculatorId) {
  const storageKey = `calculators:recent-results:${calculatorId}`;
  const [recentResults, setRecentResults] = useState(() => readRecentResults(storageKey));

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(recentResults));
    } catch {
      // Ignore storage issues so calculations still work even if persistence fails.
    }
  }, [recentResults, storageKey]);

  const saveResult = ({ summary, detail }) => {
    const nextEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      summary,
      detail,
      savedAt: new Date().toISOString(),
    };

    setRecentResults((currentResults) => [
      nextEntry,
      ...currentResults.filter(
        (entry) => entry.summary !== nextEntry.summary || entry.detail !== nextEntry.detail,
      ),
    ].slice(0, MAX_RECENT_RESULTS));
  };

  const removeResult = (entryId) => {
    setRecentResults((currentResults) =>
      currentResults.filter((entry) => entry.id !== entryId),
    );
  };

  return {
    recentResults,
    saveResult,
    removeResult,
  };
}
