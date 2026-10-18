import { invokeNutritionFunction } from './nutritionLookup.js';

// Provider boundary: FatSecret wire responses stay in the Edge Function. This client receives
// only temporary search/detail fields and normalizes them for CBoard's existing nutrition UI.
export class FatSecretFoodProvider {
  constructor(invoke = invokeNutritionFunction) { this.invoke = invoke; }
  async searchFoods(query) {
    const data = await this.invoke('fatsecret-foods', { operation: 'search', query });
    return (Array.isArray(data.foods) ? data.foods : []).map(food => ({
      provider: 'fatsecret', providerFoodId: String(food.foodId), code: `fatsecret-${food.foodId}`,
      name: String(food.name || ''), brand: String(food.brand || ''), foodType: String(food.foodType || 'Generic'),
      description: String(food.description || ''), source: {
        provider: 'FatSecret', providerFoodId: String(food.foodId), name: 'FatSecret', url: 'https://www.fatsecret.com',
      },
    })).filter(food => food.name && food.providerFoodId);
  }
  async getFoodDetails(providerFoodId) {
    const data = await this.invoke('fatsecret-foods', { operation: 'details', foodId: String(providerFoodId) });
    return {
      provider: 'fatsecret', providerFoodId: String(data.foodId), name: String(data.name || ''),
      brand: String(data.brand || ''), foodType: String(data.foodType || 'Generic'),
      servings: (Array.isArray(data.servings) ? data.servings : []).map(serving => ({
        providerServingId: String(serving.servingId), label: String(serving.description || 'Serving'),
        quantity: Number.isFinite(serving.amount) && serving.amount > 0 ? serving.amount : 1,
        unit: ['g', 'ml'].includes(serving.unit) ? serving.unit : 'servings',
        nutrition: serving.nutrition && typeof serving.nutrition === 'object' ? serving.nutrition : {},
      })).filter(serving => serving.providerServingId),
    };
  }
}

export const fatSecretFoodProvider = new FatSecretFoodProvider();
