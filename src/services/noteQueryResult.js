export function parseNotesRows(result, mapRow = row => row) {
  if (result.error) throw result.error;
  if (!Array.isArray(result.data)) throw new Error('Notes returned an invalid response.');
  return result.data.map(mapRow);
}
