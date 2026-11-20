export function localDateTimeToInstant(dateValue, timeValue) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || !/^\d{2}:\d{2}$/.test(timeValue)) throw new Error('Enter a valid date and time.');
  const [year, month, day] = dateValue.split('-').map(Number);
  const [hour, minute] = timeValue.split(':').map(Number);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (year < 1000 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) {
    throw new Error('That date or time is invalid in your local timezone. Check the values and try again.');
  }
  return date.toISOString();
}

