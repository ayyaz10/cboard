import { cleanNutrients, nutrientKeys } from './nutrients.js';

export function cleanLabelBasis(value) {
  if(!value || typeof value!=='object')return undefined;
  const positive=value=>Number.isFinite(value)&&value>0?value:null;
  return {label:String(value.label||'').slice(0,160),kind:String(value.kind||'').slice(0,30),quantity:positive(value.quantity),unit:['g','ml','pieces','servings'].includes(value.unit)?value.unit:'pieces',
    servingQuantity:positive(value.servingQuantity),servingUnit:['g','ml','pieces'].includes(value.servingUnit)?value.servingUnit:null,servingDescription:String(value.servingDescription||'').slice(0,200)};
}

export function currentAtBasis(current, basis) {
  if(!current || !(current.quantity>0) || current.unit!==basis.unit || !(basis.quantity>0)) return null;
  if(['pieces','servings'].includes(basis.unit)) {
    const countKind=kind=>['portion','serving'].includes(kind)?'serving':['item','pieces',undefined].includes(kind)?'item':kind;
    if(countKind(current.source?.labelBasis?.kind)!==countKind(basis.kind))return null;
  }
  return Object.fromEntries(nutrientKeys.map(key=>[key,current[key]==null?null:current[key]*basis.quantity/current.quantity]));
}

// Unchecked values are retained on the new basis only when the units are compatible.
export function applyNutritionReview(current, column, selected, {clearIncompatible=false}={}) {
  if(!column.confirmed || !Number.isFinite(column.quantity) || column.quantity<=0 || !['g','ml','pieces','servings'].includes(column.unit))throw new Error('Confirm the nutrition basis and a quantity greater than zero.');
  const values=column.values || Object.fromEntries(Object.entries(column.nutrients||{}).map(([key,item])=>[key,item.value]));
  const keys=nutrientKeys.filter(key=>selected.includes(key));
  if(!keys.length)throw new Error('Select at least one nutrition field to apply.');
  const converted=currentAtBasis(current,column);
  const retained=nutrientKeys.filter(key=>current?.[key]!=null&&!keys.includes(key));
  if(retained.length && !converted && !clearIncompatible)throw new Error('The existing values use a different unit. Confirm clearing incompatible values, or keep the existing nutrition.');
  const nutrition=cleanNutrients(converted || {});
  for(const key of keys){const value=values[key];if(value!=null&&(!Number.isFinite(value)||value<0))throw new Error('Nutrition must be a non-negative number, or blank.');nutrition[key]=value??null;}
  return {...nutrition,quantity:column.quantity,unit:column.unit,source:{...current?.source,provider:'Local nutrition label OCR',modified:true,
    name:`Reviewed label: ${column.label}`,labelBasis:cleanLabelBasis({...column,servingQuantity:column.serving?.quantity,servingUnit:column.serving?.unit,servingDescription:column.serving?.description})}};
}
