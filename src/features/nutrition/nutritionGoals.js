export const GOAL_KEY = 'nutrition:daily-goals:v1';
export const GOAL_FIELDS = [
  ['calories', 'Calories', 'kcal'],
  ['protein', 'Protein', 'g'],
  ['carbs', 'Carbs', 'g'],
  ['fat', 'Fat', 'g'],
  ['fiber', 'Fibre', 'g'],
];
export const emptyGoals = () => Object.fromEntries(GOAL_FIELDS.map(([key]) => [key, null]));

export function validateGoals(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Could not read your daily targets.');
  return Object.fromEntries(GOAL_FIELDS.map(([key, label]) => {
    const raw = value[key];
    if (raw == null || (typeof raw === 'string' && !raw.trim())) return [key, null];
    const number = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 100000)
      throw new Error(`${label}: enter a number between 0 and 100,000, or leave it blank.`);
    return [key, number];
  }));
}

export function compareGoal(total, target, key) {
  if (target == null) return { status: 'unset' };
  if (!total.known && !total.missing) return { status: 'empty' };
  const difference = total.value - target;
  const incomplete = total.missing > 0;
  // Avoid treating normal floating-point addition noise as exceeding the target.
  if (key === 'fiber' && total.known > 0 && difference >= -1e-8)
    return { status: 'reached', amount: Math.max(0, difference), incomplete };
  if (difference > 1e-8)
    return { status: 'over', amount: difference, incomplete };
  if (incomplete) return { status: 'incomplete' };
  if (Math.abs(difference) < 1e-8) return { status: 'met', amount: 0 };
  return { status: 'remaining', amount: -difference };
}

export const formatMacro = (value) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
export function comparisonText(comparison, unit) {
  const amount = comparison.amount > 0 && comparison.amount < 0.1 ? '<0.1' : formatMacro(comparison.amount ?? 0);
  switch (comparison.status) {
    case 'unset': return 'No target set';
    case 'empty': return 'Choose meals to compare';
    case 'over': return `${comparison.incomplete ? 'At least ' : ''}${amount} ${unit} over target`;
    case 'incomplete': return 'Comparison incomplete — nutrition is missing';
    case 'reached': return comparison.amount > 1e-8 ? `Target reached (${comparison.incomplete ? 'at least ' : ''}${amount} ${unit} above)` : 'Target reached';
    case 'met': return 'Target met';
    default: return `${amount} ${unit} remaining`;
  }
}
