const CHUNK_LOAD_ERROR = /failed to fetch dynamically imported module|importing a module script failed|chunkloaderror|loading chunk\s+\S+\s+failed|unable to preload css for/i;

export function isChunkLoadError(error) {
  return CHUNK_LOAD_ERROR.test(String(error?.message || error || ''));
}

export function getRouteErrorMessage(error, isDevelopment) {
  if (isDevelopment) return error?.message || String(error || 'Unknown route error');
  return isChunkLoadError(error)
    ? 'A required app module failed to load.'
    : 'This section ran into a problem. Please try again.';
}
