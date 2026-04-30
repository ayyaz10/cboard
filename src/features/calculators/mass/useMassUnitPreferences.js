import { useEffect, useState } from 'react';
import { getPreference, setPreference } from '../../../services/preferenceService';
import { massUnitOptions } from './massMath';

const PREFERENCE_KEY = 'mass-unit-usage';
const FALLBACK_FROM_UNIT = 'kilogram';
const FALLBACK_TO_UNIT = 'gram';
const validMassUnitValues = new Set(massUnitOptions.map((unit) => unit.value));

function normalizeCountMap(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return Object.fromEntries(
    massUnitOptions
      .map((unit) => {
        const nextCount = Number(value[unit.value]);

        if (!Number.isFinite(nextCount) || nextCount <= 0) {
          return null;
        }

        return [unit.value, nextCount];
      })
      .filter(Boolean),
  );
}

function emptyUnitUsage() {
  return {
    fromCounts: {},
    toCounts: {},
  };
}

function getMostUsedUnit(counts, fallbackUnit, excludedUnit) {
  const rankedUnits = massUnitOptions
    .map((unit, index) => ({
      value: unit.value,
      count: counts[unit.value] ?? 0,
      index,
    }))
    .filter((unit) => unit.value !== excludedUnit)
    .sort((leftUnit, rightUnit) => {
      if (rightUnit.count !== leftUnit.count) {
        return rightUnit.count - leftUnit.count;
      }

      return leftUnit.index - rightUnit.index;
    });

  const bestMatch = rankedUnits.find((unit) => unit.count > 0);

  if (bestMatch) {
    return bestMatch.value;
  }

  if (fallbackUnit !== excludedUnit) {
    return fallbackUnit;
  }

  return rankedUnits[0]?.value ?? fallbackUnit;
}

function buildPreferredUnits(unitUsage) {
  const fromUnit = getMostUsedUnit(unitUsage.fromCounts, FALLBACK_FROM_UNIT);
  const fallbackToUnit = fromUnit === FALLBACK_TO_UNIT ? FALLBACK_FROM_UNIT : FALLBACK_TO_UNIT;
  const toUnit = getMostUsedUnit(unitUsage.toCounts, fallbackToUnit, fromUnit);

  return {
    fromUnit,
    toUnit,
  };
}

export function useMassUnitPreferences() {
  const [unitUsage, setUnitUsage] = useState(emptyUnitUsage);
  const [error, setError] = useState('');

  useEffect(() => {
    let isActive = true;

    getPreference(PREFERENCE_KEY, emptyUnitUsage())
      .then((savedUsage) => {
        if (!isActive) {
          return;
        }

        setUnitUsage({
          fromCounts: normalizeCountMap(savedUsage?.fromCounts),
          toCounts: normalizeCountMap(savedUsage?.toCounts),
        });
      })
      .catch((loadError) => {
        if (isActive) {
          setError(loadError.message);
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  const rememberUnits = async ({ fromUnit, toUnit }) => {
    if (!validMassUnitValues.has(fromUnit) || !validMassUnitValues.has(toUnit)) {
      return;
    }

    const nextUsage = {
      fromCounts: {
        ...unitUsage.fromCounts,
        [fromUnit]: (unitUsage.fromCounts[fromUnit] ?? 0) + 1,
      },
      toCounts: {
        ...unitUsage.toCounts,
        [toUnit]: (unitUsage.toCounts[toUnit] ?? 0) + 1,
      },
    };

    setUnitUsage(nextUsage);

    try {
      await setPreference(PREFERENCE_KEY, nextUsage);
      setError('');
    } catch (saveError) {
      setError(saveError.message);
    }
  };

  return {
    preferredUnits: buildPreferredUnits(unitUsage),
    rememberUnits,
    error,
  };
}
