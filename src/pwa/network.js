export const CONNECTION_EVENT = 'cboard:connection';
function report(state) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CONNECTION_EVENT, { detail: state }));
}
export async function cloudFetch(input, init) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    report('offline');
    throw new TypeError('You are offline. Reconnect before loading or saving cloud data. Changes are not queued.');
  }
  try {
    const response = await fetch(input, init);
    if (response.status >= 500) report('unavailable');
    else if (response.ok) report('online');
    return response;
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    report('unavailable');
    throw new TypeError('Cannot reach CBoard cloud services. Check your connection and retry. If a save was interrupted, check its result before submitting it again.', { cause: error });
  }
}
