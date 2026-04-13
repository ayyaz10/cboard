import { useEffect, useState } from 'react';
import { massUnitOptions } from './massMath';

const STORAGE_KEY = 'calculators:mass-unit-usage';
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

function readUnitUsage() {
  if (typeof window === 'undefined') {
    return {
      fromCounts: {},
      toCounts: {},
    };
  }

  try {
    const storedValue = window.localStorage.getItem(STORAGE_KEY);

    if (!storedValue) {
      return {
        fromCounts: {},
        toCounts: {},
      };
    }

    const parsedValue = JSON.parse(storedValue);

    return {
      fromCounts: normalizeCountMap(parsedValue?.fromCounts),
      toCounts: normalizeCountMap(parsedValue?.toCounts),
    };
  } catch {
    return {
      fromCounts: {},
      toCounts: {},
    };
  }
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
  const [unitUsage, setUnitUsage] = useState(readUnitUsage);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(unitUsage));
    } catch {
      // Ignore storage issues so conversions still work even if persistence fails.
    }
  }, [unitUsage]);

  const rememberUnits = ({ fromUnit, toUnit }) => {
    if (!validMassUnitValues.has(fromUnit) || !validMassUnitValues.has(toUnit)) {
      return;
    }

    setUnitUsage((currentUsage) => ({
      fromCounts: {
        ...currentUsage.fromCounts,
        [fromUnit]: (currentUsage.fromCounts[fromUnit] ?? 0) + 1,
      },
      toCounts: {
        ...currentUsage.toCounts,
        [toUnit]: (currentUsage.toCounts[toUnit] ?? 0) + 1,
      },
    }));
  };

  return {
    preferredUnits: buildPreferredUnits(unitUsage),
    rememberUnits,
  };
}
