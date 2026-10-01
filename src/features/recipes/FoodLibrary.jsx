import { useState } from 'react';
import { NUTRIENTS } from '../nutrition/nutrients.js';
import { RecipeLink, secondaryButton } from './RecipeComponents';

export function FoodLibrary({ library, recipes, onAdd }) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const needle = query.trim().toLocaleLowerCase();
  const filtered = library.filter(entry => {
    const shared = entry.recipeTitles.includes('Main food library');
    const inRecipe = entry.recipeTitles.some(title => title !== 'Main food library');
    return (source === 'all' || (source === 'shared' ? shared : inRecipe))
      && [entry.item.name, ...entry.recipeTitles].some(value => value.toLocaleLowerCase().includes(needle));
  });
  return <section className="food-library" aria-labelledby="food-library-heading">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 id="food-library-heading" className="text-3xl font-bold">All food items</h1><p>Browse saved foods and ingredients from your recipes, sauces and alternatives.</p></div>
      <button type="button" className={secondaryButton} onClick={onAdd}>Add item</button>
    </header>
    <div className="food-library-filters">
      <label>Search foods or recipes<input className="field-input" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search all food items" /></label>
      <label>Source<select className="field-input" value={source} onChange={event => setSource(event.target.value)}><option value="all">All sources</option><option value="shared">Shared food library</option><option value="recipes">Used in recipes</option></select></label>
    </div>
    <p role="status">{filtered.length} of {library.length} food records. Different portions or nutrition records may appear separately. Shared foods include separately added items and foods saved from recipes.</p>
    {!filtered.length && <p className="panel p-5">{library.length ? 'No matching foods. Try another search or source.' : 'No food items yet. Add an item or save a recipe to get started.'}</p>}
    <div className="food-library-grid">{filtered.map(entry => {
      const item = entry.item;
      const nutrition = item.nutritionLabel || item.nutrition || {};
      const quantity = item.nutritionLabel?.quantity ?? item.amount;
      const unit = item.nutritionLabel?.unit ?? item.unit;
      const usedBy = recipes.filter(recipe => entry.recipeTitles.includes(recipe.title));
      return <article className="panel p-5" key={entry.key}>
        <h2 className="text-xl font-bold">{item.name}</h2>
        <p className="text-sm mt-2">{quantity != null ? `Nutrition for ${quantity} ${unit || ''}` : 'Nutrition basis not set'}</p>
        <dl className="food-library-nutrients">{NUTRIENTS.slice(0, 5).map(([key,label,nutrientUnit]) => <div key={key}><dt>{label}</dt><dd>{nutrition[key] == null ? 'Not set' : `${nutrition[key]} ${nutrientUnit}`}</dd></div>)}</dl>
        <details><summary>More nutrients</summary><dl className="food-library-nutrients">{NUTRIENTS.slice(5).map(([key,label,nutrientUnit]) => <div key={key}><dt>{label}</dt><dd>{nutrition[key] == null ? 'Not set' : `${nutrition[key]} ${nutrientUnit}`}</dd></div>)}</dl></details>
        {entry.recipeTitles.includes('Main food library') && <p className="text-sm mt-3">Saved in shared food library</p>}
        {usedBy.length > 0 && <div className="mt-3"><h3 className="font-bold">Used in recipes</h3><div className="flex flex-wrap gap-2 mt-2">{usedBy.map(recipe => <RecipeLink key={recipe.slug} to={`/recipes/${recipe.slug}`}>{recipe.title}</RecipeLink>)}</div></div>}
      </article>;
    })}</div>
  </section>;
}
