const NOTES_CACHE_PREFIX = 'cboard:notes-library:v1:';
const NOTES_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function classifyNotesError(error) {
  const code = String(error?.code || '').toUpperCase();
  const status = Number(error?.status || error?.statusCode || error?.context?.status || 0);
  const message = String(error?.message || '').toLowerCase();

  if (['PGRST202', 'PGRST204', 'PGRST205', '42P01', '42703'].includes(code)
    || /schema cache|does not exist|could not find the function/.test(message)) return 'QUERY_ERROR';
  if (code === '42501' || status === 401 || status === 403 || /jwt|not authenticated|permission denied/.test(message)) return 'AUTH_ERROR';
  if (status >= 500) return 'SERVER_ERROR';
  if (error instanceof TypeError || /network|fetch failed|failed to fetch|load failed|connection/.test(message)) return 'NETWORK_ERROR';
  if (code.startsWith('22')) return 'VALIDATION_ERROR';
  if (code === '23505') return 'CONFLICT';
  return 'UNKNOWN';
}

export function getNotesLoadMessage(errorType) {
  if (errorType === 'QUERY_ERROR') return 'Notes storage needs an update. Your notes have not been changed. Try again later.';
  if (errorType === 'AUTH_ERROR') return 'Your session could not access Notes. Sign in again, then retry.';
  if (errorType === 'NETWORK_ERROR') return 'Could not connect to Notes. Check your connection and retry.';
  if (errorType === 'SERVER_ERROR') return 'The Notes service is temporarily unavailable. Retry in a moment.';
  return 'Could not load Notes. Your notes have not been changed. Retry.';
}

export function reportNotesFailure(operation, error, startedAt, requestId = createNotesRequestId()) {
  console.warn('[notes] request failed', {
    operation,
    errorType: classifyNotesError(error),
    errorCode: String(error?.code || 'unknown').slice(0, 40),
    requestId,
    elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
  });
  return { errorType: classifyNotesError(error), requestId };
}

export function createNotesRequestId() {
  return globalThis.crypto?.randomUUID?.() || `notes-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function shouldShowNotesEmpty({ isLoading, error, notes }) {
  return !isLoading && !error && notes.length === 0;
}

export function readNotesCache(userId, { view, query, sortBy } = {}) {
  if (!userId || typeof sessionStorage === 'undefined') return null;
  try {
    const cached = JSON.parse(sessionStorage.getItem(`${NOTES_CACHE_PREFIX}${userId}`) || 'null');
    if (cached?.userId !== userId || !Array.isArray(cached.notes)
      || cached.view !== view || cached.query !== query || cached.sortBy !== sortBy
      || Date.now() - cached.savedAt > NOTES_CACHE_TTL_MS) return null;
    return { notes: cached.notes, hasMore: Boolean(cached.hasMore) };
  } catch {
    return null;
  }
}

export function writeNotesCache(userId, criteria, result) {
  if (!userId || typeof sessionStorage === 'undefined') return false;
  try {
    sessionStorage.setItem(`${NOTES_CACHE_PREFIX}${userId}`, JSON.stringify({
      userId,
      ...criteria,
      notes: result.notes,
      hasMore: Boolean(result.hasMore),
      savedAt: Date.now(),
    }));
    return true;
  } catch {
    return false;
  }
}

export function clearNotesListCache() {
  if (typeof sessionStorage === 'undefined') return;
  for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = sessionStorage.key(index);
    if (key?.startsWith(NOTES_CACHE_PREFIX)) sessionStorage.removeItem(key);
  }
}
