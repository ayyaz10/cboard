export function isMissingLifecycleSchema(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ').toLowerCase();
  return (code === '42703' || code === 'PGRST204')
    && /(lifecycle_state|state_before_trash|pinned_at)/.test(message);
}

export function isMissingSearchFunction(error) {
  return String(error?.code || '').toUpperCase() === 'PGRST202'
    && /search_notes/i.test(String(error?.message || ''));
}
