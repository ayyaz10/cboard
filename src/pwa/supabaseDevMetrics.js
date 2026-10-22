const ENABLE_KEY = 'cboard:measure-supabase';
const METRICS_KEY = '__cboardSupabaseMetrics';
const buckets = new Map();
const MAX_BUCKETS = 200;

function enabled() {
  if (!import.meta.env?.DEV || typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(ENABLE_KEY) === '1'; }
  catch { return false; }
}

function endpointKind(input) {
  try {
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.origin);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'rest' && parts[1] === 'v1') return `rest:${parts[2] || 'unknown'}`;
    if (parts[0] === 'auth' && parts[1] === 'v1') return `auth:${parts[2] || 'unknown'}`;
    if (parts[0] === 'functions' && parts[1] === 'v1') return `function:${parts[2] || 'unknown'}`;
    if (parts[0] === 'storage' && parts[1] === 'v1') return `storage:${parts[2] || 'unknown'}`;
    return 'other';
  } catch { return 'other'; }
}

function serviceCaller(stack) {
  const line = stack?.split('\n').find(value => /\/src\/(services|features)\//.test(value));
  if (!line) return 'unavailable';
  return line.trim().replace(/https?:\/\/[^/]+/, '').slice(0, 180);
}

function exposeControls() {
  if (!import.meta.env?.DEV || typeof window === 'undefined' || window[METRICS_KEY]) return;
  window[METRICS_KEY] = {
    snapshot: () => [...buckets.values()].map(value => ({ ...value })),
    reset: () => buckets.clear(),
  };
}

function record(metric, status, bytes) {
  if (!metric) return;
  const key = [metric.route, metric.endpoint, metric.method, status, metric.caller].join('|');
  let entry = buckets.get(key);
  if (!entry) {
    if (buckets.size >= MAX_BUCKETS) return;
    entry = { route: metric.route, endpoint: metric.endpoint, method: metric.method, status, caller: metric.caller, requests: 0, responseBytes: 0 };
    buckets.set(key, entry);
  }
  entry.requests += 1;
  entry.responseBytes += bytes;
}

export function beginSupabaseMetric(input, init) {
  exposeControls();
  if (!enabled()) return null;
  return {
    route: window.location.pathname,
    endpoint: endpointKind(input),
    method: String(init?.method || input?.method || 'GET').toUpperCase(),
    caller: serviceCaller(new Error().stack),
  };
}

export function finishSupabaseMetric(metric, response) {
  if (!metric) return;
  response.clone().arrayBuffer()
    .then(bytes => record(metric, response.status, bytes.byteLength))
    .catch(() => record(metric, response.status, 0));
}

export function failSupabaseMetric(metric) {
  record(metric, 0, 0);
}
