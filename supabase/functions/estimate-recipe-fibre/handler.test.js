import test from 'node:test';
import assert from 'node:assert/strict';
import { createFibreHandler } from './handler.js';
import { validateFibreRequest, validateFibreResult } from './fibreParser.js';
const body = { servings: 2, ingredients: [{ name: 'Oats', amount: 100, unit: 'g', note: '', knownFiber: 10 }, { name: '2 medium apples', amount: null, unit: '', note: '', knownFiber: null }] };
const model = { ingredients: [{ index: 0, fiberGrams: 999 }, { index: 1, fiberGrams: 8, quantityUsed: '2 medium apples, about 360g edible weight', note: 'Typical apple estimate; actual size varies.' }] };
const request = (data = body, token = 'test') => new Request('https://local', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify(data) });
test('AI fills missing ingredients but cannot overwrite known grocery values', () => {
  const result = validateFibreResult(model, validateFibreRequest(body));
  assert.equal(result.rows[0].fiberGrams, 10);
  assert.equal(result.rows[0].source, 'groceries');
  assert.equal(result.rows[1].fiberGrams, 8);
  assert.equal(result.rows[1].source, 'ai');
});
test('bad model values, duplicated ingredients and missing input amounts cannot be saved as totals', () => {
  const context = validateFibreRequest(body);
  for (const value of [null, { ingredients: [] }, { ingredients: [model.ingredients[0], model.ingredients[0]] }, { ingredients: [model.ingredients[0], { ...model.ingredients[1], fiberGrams: -1 }] }]) assert.throws(() => validateFibreResult(value, context));
  const missing = validateFibreRequest({ ...body, ingredients: [body.ingredients[0], { ...body.ingredients[1], name: 'Apples' }] });
  assert.equal(validateFibreResult(model, missing).rows[1].fiberGrams, null);
  assert.throws(() => validateFibreRequest({ ...body, servings: 0 }));
});
test('authentication and quota precede generation and estimates perform no database writes', async () => {
  let calls = 0, reservations = 0;
  const config = { env: () => 'test', createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) }, rpc: async () => { reservations++; return { data: true }; } }), generate: async () => { calls++; return model; } };
  const handler = createFibreHandler(config);
  assert.equal((await handler(request(body, ''))).status, 401);
  assert.equal((await handler(request({ ...body, servings: 0 }))).status, 400);
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).rows[1].fiberGrams, 8);
  assert.equal(calls, 1); assert.equal(reservations, 1);
  const limited = createFibreHandler({ ...config, createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) }, rpc: async () => ({ data: false }) }) });
  assert.equal((await limited(request())).status, 429); assert.equal(calls, 1);
});
