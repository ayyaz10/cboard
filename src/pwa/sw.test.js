import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
const origin = 'https://example.test';
const prefix = 'cboard-shell:/cboard/:';
const config = { base: '/cboard/', version: 'v3', assets: [
  { url: '/cboard/index.html', integrity: 'sha256-test' },
  { url: '/cboard/assets/app-new.js', integrity: 'sha256-test' },
  { url: '/cboard/nutrition/usda-foods.json', integrity: 'sha256-test', optional: true },
] };
function setup({ offline = false, failedInstall = false, blockedStorage = false } = {}) {
  const handlers = {}, stores = new Map(), fetched = [];
  let activated = 0, claimed = 0;
  const keyOf = request => new URL(typeof request === 'string' ? request : request.url, origin).href;
  const caches = {
    async keys() { return [...stores.keys()]; },
    async delete(key) { return stores.delete(key); },
    async open(key) {
      if (blockedStorage) throw new Error('Storage denied');
      if (!stores.has(key)) stores.set(key, new Map());
      const store = stores.get(key);
      return {
        async match(request) { return store.get(keyOf(request))?.clone(); },
        async put(request, response) { store.set(keyOf(request), response.clone()); },
        async addAll(requests) {
          for (const request of requests) {
            assert.equal(request.credentials, 'omit');
            assert.equal(request.cache, 'reload');
            assert.ok(request.integrity);
            if (failedInstall) throw new Error('Incomplete deployment');
            store.set(keyOf(request), new Response(request.url.includes('.html') ? 'CBoard shell' : 'public asset'));
          }
        },
      };
    },
  };
  const fetch = async request => {
    fetched.push(request);
    if (offline) throw new Error('Offline');
    return new Response('network content');
  };
  const self = { location: { origin }, clients: { async claim() { claimed++; } }, async skipWaiting() { activated++; }, addEventListener(name, fn) { handlers[name] = fn; } };
  vm.runInNewContext(source.replace('/* PWA_BUILD_CONFIG */', `const CONFIG=${JSON.stringify(config)};`), { self, caches, fetch, Request, Response, URL, Map, Promise });
  async function lifecycle(name, extra = {}) {
    let pending;
    handlers[name]({ ...extra, waitUntil(value) { pending = value; } });
    await pending;
  }
  function request(path, { method = 'GET', mode = 'cors', headers = {} } = {}) {
    let response;
    handlers.fetch({ request: { url: new URL(path, origin).href, method, mode, headers: new Headers(headers) }, respondWith(value) { response = value; } });
    return response;
  }
  return { lifecycle, request, stores, fetched, caches, get activated() { return activated; }, get claimed() { return claimed; } };
}

test('offline navigation to all app routes returns the public shell; static chunks remain available', async () => {
  const sw = setup({ offline: true });
  await sw.lifecycle('install');
  assert.equal(sw.activated, 0, 'install must wait for user consent');
  for (const route of ['', 'food-diary', 'recipes/diary/day', 'groceries', 'finance?section=timeline', 'notes', 'training', 'calculators/calorie', 'login']) {
    assert.equal(await (await sw.request(`/cboard/${route}`, { mode: 'navigate' })).text(), 'CBoard shell');
  }
  assert.equal(await (await sw.request('/cboard/assets/app-new.js')).text(), 'public asset');
  assert.equal(sw.fetched.length, 0);
});
test('private, authenticated, external, query and mutating requests bypass the worker', () => {
  const sw = setup();
  for (const [path, options] of [
    ['https://project.supabase.co/auth/v1/token', {}], ['https://project.supabase.co/rest/v1/notes', {}],
    ['/cboard/api/private', {}], ['/cboard/storage/private.png', {}],
    ['/cboard/assets/app-new.js?token=secret', {}],
    ['/cboard/assets/app-new.js', { headers: { Authorization: 'Bearer secret' } }],
    ['/cboard/finance', { method: 'POST', mode: 'navigate' }], ['/another-app/', { mode: 'navigate' }],
  ]) assert.equal(sw.request(path, options), undefined);
  assert.equal(sw.stores.size, 0);
});
test('activation retains only current and previous shell caches, not other apps or user storage', async () => {
  const sw = setup();
  for (const name of [prefix+'v1',prefix+'v2','other-app-cache']) await sw.caches.open(name);
  await sw.lifecycle('install');
  await sw.lifecycle('activate');
  assert.deepEqual([...sw.stores.keys()], [prefix+'v2','other-app-cache',prefix+'v3']);
  assert.equal(sw.claimed,1);
  await sw.lifecycle('message',{data:{type:'ACTIVATE_UPDATE'}});
  assert.equal(sw.activated,1);
});
test('failed install removes only the incomplete cache and preserves previous app', async () => {
  const sw = setup({ failedInstall: true });
  await sw.caches.open(prefix+'v2');
  await assert.rejects(sw.lifecycle('install'), /Incomplete deployment/);
  assert.deepEqual([...sw.stores.keys()],[prefix+'v2']);
});
test('public datasets are fetched on demand; cache failures still allow online use', async () => {
  const sw = setup();
  await sw.lifecycle('install');
  assert.equal(sw.stores.get(prefix+'v3').size,2);
  await sw.request('/cboard/nutrition/usda-foods.json');
  await sw.request('/cboard/nutrition/usda-foods.json');
  assert.equal(sw.fetched.length,1);
  const blocked = setup({ blockedStorage:true });
  assert.equal(await (await blocked.request('/cboard/',{mode:'navigate'})).text(),'network content');
  const offline = setup({ blockedStorage:true,offline:true });
  assert.equal((await offline.request('/cboard/',{mode:'navigate'})).status,503);
});
test('old open tabs can load previous hashed chunks without using an older document', async () => {
  const sw=setup({offline:true});
  const previous=await sw.caches.open(prefix+'v2');
  await previous.put('/cboard/assets/app-old.js',new Response('old chunk'));
  await previous.put('/cboard/index.html',new Response('old shell'));
  await sw.lifecycle('install');
  assert.equal(await (await sw.request('/cboard/assets/app-old.js')).text(),'old chunk');
  assert.equal(await (await sw.request('/cboard/',{mode:'navigate'})).text(),'CBoard shell');
});
