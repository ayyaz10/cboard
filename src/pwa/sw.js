/* PWA_BUILD_CONFIG */
// Only build-owned, public files are eligible. No API, auth, user media or tokens.
const PREFIX = `cboard-shell:${CONFIG.base}:`;
const CACHE = PREFIX + CONFIG.version;
const assets = new Map(CONFIG.assets.map(asset => [new URL(asset.url, self.location.origin).href, asset]));
const shellURL = new URL(`${CONFIG.base}index.html`, self.location.origin).href;

function publicRequest(asset) {
  return new Request(new URL(asset.url, self.location.origin), { cache: 'reload', credentials: 'omit', integrity: asset.integrity });
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      await cache.addAll(CONFIG.assets.filter(asset => !asset.optional).map(publicRequest));
    } catch (error) {
      await caches.delete(CACHE);
      throw error; // Keep the previous worker if a deployment is incomplete.
    }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Keep one preceding build for open tabs' lazy chunks. Never touch app storage.
    const previous = (await caches.keys()).filter(key => key.startsWith(PREFIX) && key !== CACHE);
    await Promise.all(previous.slice(0, -1).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});
async function readCache(url, older = false) {
  try {
    const cached = await (await caches.open(CACHE)).match(url);
    if (cached) return cached;
    if (older) {
      for (const key of (await caches.keys()).filter(key => key.startsWith(PREFIX) && key !== CACHE)) {
        const response = await (await caches.open(key)).match(url);
        if (response) return response;
      }
    }
  } catch { /* Storage unavailable: use the network. */ }
}
async function staticAsset(request, asset) {
  const hit = await readCache(request.url, !asset);
  if (hit) return hit;
  const response = await fetch(asset ? publicRequest(asset) : request);
  if (asset && response.ok && !response.redirected) {
    try { await (await caches.open(CACHE)).put(asset.url, response.clone()); } catch { /* Quota failure must not break online loading. */ }
  }
  return response;
}
async function appShell() {
  const hit = await readCache(shellURL);
  if (hit) return hit;
  try {
    // Do not mix a new online document into an old build's cache.
    const response = await fetch(new Request(shellURL, { cache: 'no-cache', credentials: 'omit' }));
    if (response.ok) return response;
  } catch { /* A readable fallback when storage was evicted. */ }
  return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>CBoard offline</title><main><h1>CBoard is offline</h1><p>The saved app files are unavailable. Reconnect, then reload. Your browser storage has not been cleared.</p><button onclick="location.reload()">Try again</button></main>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('authorization')) return;
  if (!url.pathname.startsWith(CONFIG.base)) return;
  // Extensionless application routes only, never endpoints or file downloads.
  const route = url.pathname.slice(CONFIG.base.length);
  const appRoute = /^(?:|index\.html|login|board|calculators(?:\/[^.]+)?|progress-tracker|notes|groceries|weight-progress|finance|training|food-diary|recipes(?:\/[^.]+)?|focus-timer)\/?$/.test(route);
  if (request.mode === 'navigate' && appRoute) {
    event.respondWith(appShell());
    return;
  }
  if (url.search) return; // Never cache token-bearing or other query variants.
  const asset = assets.get(url.href);
  // Old hashed assets can be served from the previous build for open tabs.
  if (asset || url.pathname.startsWith(`${CONFIG.base}assets/`)) {
    event.respondWith(staticAsset(request, asset));
  }
});
