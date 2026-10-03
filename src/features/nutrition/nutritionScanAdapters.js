import { initialProductAmount } from '../recipes/recipeProducts.js';

export function ingredientScanCurrent(item) {
  if(item.nutritionLabel)return item.nutritionLabel;
  for(const unit of ['g','ml','pieces']) {
    const quantity=initialProductAmount(item,unit);
    if(quantity!=='')return {...item.nutrition,quantity,unit};
  }
  return {...item.nutrition,quantity:Number(item.amount)||null,unit:item.unit};
}
