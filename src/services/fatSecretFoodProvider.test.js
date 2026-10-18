import test from 'node:test';
import assert from 'node:assert/strict';
import { FatSecretFoodProvider } from './fatSecretFoodProvider.js';

test('normalizes search candidates and fetches selected details by provider id', async () => {
  const calls = [];
  const provider = new FatSecretFoodProvider(async (fn, body) => {
    calls.push([fn, body]);
    return body.operation === 'search'
      ? { foods: [{ foodId: '123', name: 'Chicken Biryani', foodType: 'Generic' }] }
      : { foodId: '123', servings: [{ servingId: '456', description: '1 cup', quantity: 240, unit: 'g', nutrition: { calories: 350 } }] };
  });
  const [food] = await provider.searchFoods('chicken biryani');
  assert.equal(food.providerFoodId, '123');
  assert.equal(food.source.provider, 'FatSecret');
  const details = await provider.getFoodDetails(food.providerFoodId);
  assert.equal(details.servings[0].providerServingId, '456');
  assert.deepEqual(calls, [
    ['fatsecret-foods', { operation: 'search', query: 'chicken biryani' }],
    ['fatsecret-foods', { operation: 'details', foodId: '123' }],
  ]);
});
