export async function importLocalRemindersIndependently(reminders, importReminder) {
  const imported = [];
  const errors = [];
  for (const item of reminders) {
    try {
      imported.push(item.revision ? item : await importReminder(item));
    } catch (error) {
      errors.push({ item, error });
    }
  }
  return { imported, errors };
}