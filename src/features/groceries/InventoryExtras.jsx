import { useState } from 'react';
import { addItems, newItem, units, convert } from './groceryData';
import { getAppHref } from '../../app/useRoute';
export function RecipeReferences({ item }) {
  return item.recipeRefs?.length ? <details><summary>Used in {item.recipeRefs.length} recipe{item.recipeRefs.length === 1 ? '' : 's'}</summary>{item.recipeRefs.map(recipe => <p key={recipe.slug}><a href={getAppHref(`/recipes/${recipe.slug}`)}>{recipe.title}</a></p>)}</details> : null;
}
export function InventoryExtras({ data, change, busy, section }) {
  const [draft, setDraft] = useState({ name: '', quantity: 1, unit: 'pieces' });
  const [error, setError] = useState('');
  const unused = data.items.filter(item => item.recipeOnly && !item.removed);
  async function save(event) {
    event.preventDefault();
    if (!draft.name.trim()) return;
    const ok = await change(state => {
      state.wishlist ||= [];
      const entry = { ...newItem(draft.name, Number(draft.quantity), draft.unit), ...(draft.id ? { id: draft.id } : {}) };
      if (draft.id) state.wishlist = state.wishlist.map(item => item.id === draft.id ? entry : item);
      else state.wishlist.push(entry);
      return state;
    }, 'Wishlist saved');
    if (ok) setDraft({ name: '', quantity: 1, unit: 'pieces' });
  }
  return <section className="g-inventory-extras">
    <label className="g-check"><input type="checkbox" disabled={busy} checked={!data.settings.stockTrackingPaused} onChange={event => change(state => { state.settings.stockTrackingPaused = !event.target.checked; return state; }, 'Stock tracking updated', false)} />Automatic stock tracking: {data.settings.stockTrackingPaused ? 'PAUSED' : 'ON'}</label>
    <p className="g-hint">Only new diary activity adjusts stock. Use Auto stock on each grocery to turn tracking off for that item. The global pause overrides every item. Paused activity is never deducted later. Manual stock changes still work.</p>
    <section hidden={section !== 'unused'}><h2>Ingredients from unused recipes ({unused.length})</h2>
      {!unused.length && <p>No additional ingredients from unused recipes.</p>}
      {unused.map(item => <div key={item.id} className="g-between"><div><strong>{item.name}</strong><p>{item.quantity ?? 0} {item.unit}</p><RecipeReferences item={item}/></div><button disabled={busy} onClick={() => change(state => { state.items.find(row => row.id === item.id).recipeOnly = false; return state; })}>Move to inventory</button></div>)}
    </section>
    <section hidden={section !== 'links'}><h2>Recipe ingredient links</h2><p>Choose the stock record used by future recipe logs. Existing logged entries keep their original stock record.</p>
      {Object.entries(data.ingredientLinks || {}).filter(([key]) => key.includes('/')).map(([key, itemId]) => {
        const item = data.items.find(item => item.id === itemId);
        const slug = key.split('/')[0];
        const recipe = data.items.flatMap(item => item.recipeRefs || []).find(recipe => recipe.slug === slug);
        if (!item || item.removed || !recipe) return null;
        return <label key={key} className="g-tools">{recipe.title}: {item.name}<select disabled={busy} value={itemId} onChange={event => change(state => { state.ingredientLinks[key] = event.target.value; return state; }, 'Ingredient link saved', false)}>{data.items.filter(candidate => !candidate.removed && convert(1, item.unit, candidate.unit) != null).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name} ({candidate.unit})</option>)}</select></label>;
      })}
    </section>
    <section hidden={section !== 'wishlist'}><h2>Wishlist / Future items ({data.wishlist?.length || 0})</h2>
      <p>Ideas for later purchases. These are separate from current stock.</p>
      {(data.wishlist || []).map(item => <div className="g-between" key={item.id}><span>{item.name} · {item.quantity} {item.unit}</span><div className="g-tools">
        <button disabled={busy} onClick={() => setDraft(item)}>Edit</button>
        <button className="danger-action" disabled={busy} onClick={() => change(state => { state.wishlist = state.wishlist.filter(row => row.id !== item.id); return state; })}>Remove</button>
        <button disabled={busy} onClick={async () => { try { await change(state => { const next = addItems(state, [item]); next.wishlist = next.wishlist.filter(row => row.id !== item.id); return next; }, 'Purchased item added to stock'); } catch (err) { setError(err.message); } }}>Bought: add to stock</button>
      </div></div>)}
      <form onSubmit={save}><fieldset disabled={busy} className="g-tools"><label>Item<input required maxLength={200} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })}/></label><label>Quantity<input required type="number" min="0.0001" step="any" value={draft.quantity} onChange={event => setDraft({ ...draft, quantity: event.target.value })}/></label><label>Unit<select value={draft.unit} onChange={event => setDraft({ ...draft, unit: event.target.value })}>{units.map(unit => <option key={unit}>{unit}</option>)}</select></label><button>{draft.id ? 'Save item' : 'Add future item'}</button>{draft.id && <button type="button" onClick={() => setDraft({ name: '', quantity: 1, unit: 'pieces' })}>Cancel edit</button>}</fieldset></form>
      {error && <p role="alert">{error}</p>}
    </section>
  </section>;
}
