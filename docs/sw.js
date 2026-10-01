const CONFIG = {"base":"/cboard/","version":"3a3b6057d9ef8fb15bac","assets":[{"url":"/cboard/assets/cal-favicon-DZznJFUc.png","integrity":"sha256-mLATQtBwt3rvspkMDRkSvH3j5Fbrh5xuDK4VuAHUqeY=","optional":false},{"url":"/cboard/assets/cal-logo-BXGQSWxo.png","integrity":"sha256-p3LVKrGZFYju4IzigOY+CEPSqrXwCzV+Xmqu/+RcgMM=","optional":false},{"url":"/cboard/assets/index-BaPYCZ8g.js","integrity":"sha256-J9iBekZ8J7KqvE1ZzQKj5IEh5my9XVJrZ7/SR3ax91Q=","optional":false},{"url":"/cboard/assets/index-CJ5sQYvB.js","integrity":"sha256-sqvP6sDqRQv0xMDyqzj5fdkQUJ1ayAeKOM/mVcfgxWw=","optional":false},{"url":"/cboard/assets/index-DdsoYd6R.css","integrity":"sha256-LteZ3wewaEBAD9BR+zWMAW9BeE5oscTkHso5YgD2Z1c=","optional":false},{"url":"/cboard/assets/Training-CuoB7NFe.css","integrity":"sha256-/4lT+saZu/Fppk3zv0DPWsJQpaG3hGlrv8U/y2WQjnk=","optional":false},{"url":"/cboard/assets/Training-f7MGNAE4.js","integrity":"sha256-YySz9djKT+bCfpK9Mr4ATnA/5lJ4ZHXaq6JZ6lo6qAg=","optional":false},{"url":"/cboard/icons/apple-touch-icon.png","integrity":"sha256-iyMeSTvCpWeVYhwPQzNVK52e0YeflZmroLZyAKX49ic=","optional":false},{"url":"/cboard/icons/icon-192.png","integrity":"sha256-uq+0LuH6C3+LTuT2zdJYwk2TtIAA5wlOckcFH4B8XBY=","optional":false},{"url":"/cboard/icons/icon-512.png","integrity":"sha256-ixx0nTziT3vjBTGrzDcPeiBGoAmQhMOvwwnfXFP5lQM=","optional":false},{"url":"/cboard/icons/maskable-512.png","integrity":"sha256-BuxIPUFYDD0hbcXxqqPAGig8lDnieyHcagWQDDsplGA=","optional":false},{"url":"/cboard/index.html","integrity":"sha256-6MDiDIGJG1Nu9NbGM7dappBCDvXszyO8sU9jKOj6Ji8=","optional":false},{"url":"/cboard/manifest.webmanifest","integrity":"sha256-PHVnceEUqdGA40Oe8qIxWTVr8lkjLLtwB6NDpRbcLDc=","optional":false},{"url":"/cboard/nutrition/usda-foods.json","integrity":"sha256-CqMRC0QbdUTM4NzLMS9sG6uxMQb6Wnru6E+vAih//cc=","optional":true},{"url":"/cboard/recipes/batch-example.json","integrity":"sha256-ha3NQMrzZpCvXCZAWt+dOVVGyjAT6T0YyNtNMsPh3bQ=","optional":true},{"url":"/cboard/recipes/batch.schema.json","integrity":"sha256-JwRix/49bGlxsxuhonFy4MMgJ8X6cqsRjA0TnoczRzU=","optional":true},{"url":"/cboard/recipes/egg-fried-rice.json","integrity":"sha256-wbo2eTcLZuHzBTpSSoPjwZRmWz11Hq6UvocEosf3lFU=","optional":true},{"url":"/cboard/recipes/greek-yogurt-oats.json","integrity":"sha256-Q60FZbhNkG+9ZU59MMJbthwHqMQHmqGpg6Y4dwgoavo=","optional":true},{"url":"/cboard/recipes/recipe.schema.json","integrity":"sha256-5J/sUdjLsaYZwxQlqNG4cqFo2ZZWjfH7649MuxXgKR8=","optional":true}]};
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
