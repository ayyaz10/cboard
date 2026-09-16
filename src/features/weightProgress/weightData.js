export const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
export const displayWeight = (kg, unit) => Number((Number(kg) * (unit === 'lb' ? 2.2046226218 : 1)).toFixed(2));
export function weightInKg(value, unit) {
  if (!['kg', 'lb'].includes(unit) || String(value).trim() === '') throw new Error('Enter your weight.');
  const number = Number(value);
  const kg = number / (unit === 'lb' ? 2.2046226218 : 1);
  if (!Number.isFinite(kg) || kg <= 0 || kg > 1000) throw new Error('Enter a weight greater than zero and no more than 1,000 kg.');
  return Math.round(kg * 1000000) / 1000000;
}
export function validateEntry(entry) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !Number.isFinite(Date.parse(entry.date)) || new Date(entry.date).toISOString().slice(0,10) !== entry.date || entry.date > localDate())
    throw new Error('Choose a valid date up to today.');
  weightInKg(entry.weight_kg, 'kg');
  if (typeof entry.note !== 'string' || entry.note.length > 1000) throw new Error('Keep notes under 1,000 characters.');
}
export function weightSummary(entries) {
  const sorted = [...entries].sort((a,b) => a.date.localeCompare(b.date));
  if (!sorted.length) return null;
  const start = Number(sorted[0].weight_kg), latest = Number(sorted.at(-1).weight_kg);
  return { start, latest, change: latest - start, count: sorted.length };
}
