import test from 'node:test';
import assert from 'node:assert/strict';
import { createFatSecretHandler } from './handler.js';

const request = body => new Request('https://local', { method: 'POST', headers: { Authorization: 'Bearer user-token' }, body: JSON.stringify(body) });
const base = { SUPABASE_URL: 'url', SUPABASE_SERVICE_ROLE_KEY: 'service', FATSECRET_CLIENT_ID: 'id', FATSECRET_CLIENT_SECRET: 'secret', FATSECRET_SCOPE: 'basic' };
const setup = (fetchImpl, overrides = {}) => {
  const vars = { ...base, ...overrides };
  return createFatSecretHandler({
    env: key => vars[key], fetchImpl,
    createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } }),
  });
};

test('requires CBoard auth and valid FatSecret configuration', async () => {
  const fetchImpl = async () => { throw new Error('should not call upstream'); };
  const noAuth = createFatSecretHandler({ env: key => base[key], fetchImpl, createClient: () => ({ auth: { getUser: async () => ({ error: true }) } }) });
  assert.equal((await noAuth(request({ operation: 'search', query: 'samosa' }))).status, 401);
  const badScope = setup(fetchImpl, { FATSECRET_SCOPE: 'localization' });
  assert.match((await (await badScope(request({ operation: 'search', query: 'samosa' }))).json()).error, /scope/i);
});

test('Basic search uses documented server.api method and reuses OAuth token without caching result data', async () => {
  let tokens = 0, searches = 0;
  const handler = setup(async (url, options) => {
    if (String(url).includes('oauth.fatsecret.com')) { tokens++; assert.equal(options.method, 'POST'); return Response.json({ access_token: 'bearer', expires_in: 86400 }); }
    searches++; assert.equal(options.headers.Authorization, 'Bearer bearer');
    assert.match(String(url), /rest\/server\.api/);
    assert.equal(options.method, 'POST');
    assert.equal(new URLSearchParams(options.body).get('method'), 'foods.search');
    assert.equal(new URLSearchParams(options.body).get('search_expression'), 'samosa');
    return Response.json({ foods: { food: [
      { food_id: '17', food_name: 'Vegetable Samosa', food_type: 'Generic', food_description: 'Per 1 piece', private_field: 'discard' },
      { food_id: 'bad', food_name: 'invalid' },
    ] } });
  });
  const first = await (await handler(request({ operation: 'search', query: 'samosa' }))).json();
  const second = await (await handler(request({ operation: 'search', query: 'samosa' }))).json();
  assert.deepEqual(first.foods, [{ foodId: '17', name: 'Vegetable Samosa', brand: '', foodType: 'Generic', description: 'Per 1 piece' }]);
  assert.deepEqual(second, first);
  assert.equal(tokens, 1);
  assert.equal(searches, 2);
});

test('Basic details maps known nutrients and servings without filling unknowns', async () => {
  let n = 0;
  const handler = setup(async (url, options) => {
    if (String(url).includes('oauth.fatsecret.com')) return Response.json({ access_token: 't', expires_in: 3600 });
    n++;
    assert.match(String(url), /rest\/server\.api/);
    assert.equal(new URLSearchParams(options.body).get('method'), 'food.get');
    return Response.json({ food: { food_id: '77', food_name: 'Naan', servings: { serving: [
      { serving_id: '88', serving_description: '1 piece', metric_serving_amount: '90', metric_serving_unit: 'g', calories: '262', protein: '8.7', sodium: '420', fiber: '1.8' },
    ] } } });
  });
  const result = await (await handler(request({ operation: 'details', foodId: '77' }))).json();
  assert.equal(result.servings[0].servingId, '88');
  assert.equal(result.servings[0].amount, 90);
  assert.equal(result.servings[0].nutrition.calories, 262);
  assert.equal(result.servings[0].nutrition.carbs, null);
  assert.equal(result.servings[0].nutrition.sodium, 420);
  assert.equal(n, 1);
});
