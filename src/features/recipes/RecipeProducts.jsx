import { useState } from 'react';
import { NutritionLookup } from '../groceries/NutritionLookup';
import { saveRecipeProducts } from '../../services/recipeService';
import { calculateProducts, initialProductAmount, macroKeys, productBasis, productIngredients } from './recipeProducts.js';
import '../groceries/groceries.css';
import './recipeProducts.css';

const labels = { calories: 'Calories (kcal)', protein: 'Protein (g)', carbs: 'Carbs (g)', fat: 'Fat (g)', fiber: 'Fibre (g)' };
export function RecipeProducts({ recipe, onSaved }) {
  const ingredients = productIngredients(recipe);
  const [items, setItems] = useState(() => recipe.productNutrition?.items || ingredients.map(() => null));
  const [servings, setServings] = useState(recipe.servings || '');
  const [active, setActive] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const calculated = calculateProducts(items, Number(servings));
  function update(index, item) {
    setItems((previous) => previous.map((value, i) => i === index ? item : value));
    setMessage(''); setError('');
  }
  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      if (items.some((item) => item && macroKeys.some((key) => item.nutrition[key] != null && (!Number.isFinite(item.nutrition[key]) || item.nutrition[key] < 0)))) throw new Error('Label values must be zero or greater, or blank when unknown.');
      const saved = await saveRecipeProducts(recipe, { basis: productBasis(recipe), items }, Number(servings));
      onSaved?.(saved);
      setMessage('Products and nutrition saved. Recipe macros are per serving.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <details className="recipe-products groceries rounded-2xl border-2 border-black bg-white p-4" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-bold">Choose products & calculate nutrition</summary>
    <div className="mt-4 space-y-4">
      <p>Choose the product you use for each ingredient, including sauces. Match raw or cooked weights to the label. Alternatives are not added unless you replace the ingredient in your recipe.</p>
      <fieldset disabled={busy} className="space-y-4 min-w-0">
        <label>Number of servings<input type="number" min="0.01" step="any" value={servings} onChange={(event) => { setServings(event.target.value); setMessage(''); }} /></label>
        {ingredients.map((ingredient, index) => {
          const item = items[index];
          return <section key={index} className="recipe-product-row">
            <h3 className="font-bold">{ingredient.name}</h3>
            <p className="text-sm">Recipe amount: {[ingredient.amount, ingredient.unit].filter((part) => part != null && part !== '').join(' ') || 'Not specified'}</p>
            {item && <>
              <p className="font-semibold">{item.nutrition.source?.name || 'Nutrition label'} <small>({item.nutrition.source?.provider || 'Manual label'}{item.nutrition.source?.modified ? ', edited' : ''})</small></p>
              {/^\d{8,14}$/.test(item.nutrition.source?.code || '') && <a className="underline" href={`https://world.openfoodfacts.org/product/${item.nutrition.source.code}`} target="_blank" rel="noreferrer">View product label</a>}
              <label>Amount used in this recipe ({item.unit})<input type="number" min="0.01" step="any" value={item.quantity} onChange={(event) => update(index, { ...item, quantity: event.target.value === '' ? '' : Number(event.target.value) })} /></label>
              <details><summary>Check or correct label values per {item.nutrition.quantity} {item.unit}</summary>
                <label>Label values per quantity<input type="number" min="0.01" step="any" value={item.nutrition.quantity} onChange={(event) => update(index, { ...item, nutrition: { ...item.nutrition, quantity: Number(event.target.value), source: { ...item.nutrition.source, modified: true } } })} /></label><div className="recipe-product-values">{macroKeys.map((key) => <label key={key}>{labels[key]}<input type="number" min="0" step="any" value={item.nutrition[key] ?? ''} placeholder="Unknown" onChange={(event) => update(index, { ...item, nutrition: { ...item.nutrition, [key]: event.target.value === '' ? null : Number(event.target.value), source: { ...item.nutrition.source, modified: true } } })} /></label>)}</div>
              </details>
              <p className="text-sm">For this ingredient: {macroKeys.map((key) => `${labels[key]}: ${calculated.ingredients[index][key] == null ? 'unknown' : Number(calculated.ingredients[index][key].toFixed(2))}`).join(' · ')}</p>
            </>}
            <div className="g-actions mt-2">
              <button type="button" aria-expanded={active === index} onClick={() => setActive(active === index ? null : index)}>{active === index ? 'Close lookup' : item ? 'Change product' : 'Choose product'}</button>
              {!item && <button type="button" onClick={() => update(index, { quantity: initialProductAmount(ingredient, 'g'), unit: 'g', nutrition: { quantity: 100, unit: 'g', source: { name: ingredient.name, provider: 'Manual label' } } })}>Enter label manually</button>}
              {item && <button type="button" onClick={() => update(index, null)}>Remove product</button>}
            </div>
            {item && <label>Label unit<select value={item.unit} onChange={(event) => update(index, { ...item, unit: event.target.value, quantity: '', nutrition: { ...item.nutrition, unit: event.target.value, source: { ...item.nutrition.source, modified: true } } })}><option value="g">Grams (g)</option><option value="ml">Millilitres (ml)</option><option value="pieces">Pieces (label must give values per piece)</option></select></label>}
            {open && active === index && <NutritionLookup key={index} name={ingredient.name} active visible onSelect={(nutrition) => {
              update(index, { quantity: initialProductAmount(ingredient, nutrition.unit), unit: nutrition.unit, nutrition }); setActive(null);
            }} />}
          </section>;
        })}
        <div className="recipe-product-values" aria-label="Calculated nutrition">{macroKeys.map((key) => <div key={key}><strong>{labels[key]}</strong><p>Whole recipe: {calculated.total[key] == null ? 'Unknown' : Number(calculated.total[key].toFixed(2))}</p><p>Per serving: {calculated.perServing[key] ?? 'Unknown'}</p></div>)}</div>
        <p className="text-sm">Saving replaces the recipe’s displayed macros with these per-serving values. A nutrient stays unknown until every ingredient has a value. Saved product choices are reused when you reopen this recipe; look up a product again to refresh its label.</p>
        <button type="button" disabled={busy || !Number.isFinite(Number(servings)) || Number(servings) <= 0 || !items.some(Boolean) || items.some((item) => item && (!Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.nutrition.quantity) || item.nutrition.quantity <= 0))} onClick={save}>{busy ? 'Saving…' : 'Save products & nutrition'}</button>
      </fieldset>
      {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      <p className="text-sm">Product data: <a className="underline" href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Open Food Facts</a> / <a className="underline" href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">ODbL</a>. Check against your packet; records may be incomplete or outdated.</p>
    </div>
  </details>;
}
