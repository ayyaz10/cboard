import { ChevronDown } from 'lucide-react';
import { NUTRIENTS } from '../nutrition/nutrients.js';
import { itemNutrition } from './diaryData.js';

const format = value => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);

function DiaryFoodRow({ item, meal, recipes, disabled, onEdit, onDelete }) {
  const nutrition = itemNutrition(item);
  const recipeTitle = item.recipeOrigin?.slug
    ? recipes.find(recipe => recipe.slug === item.recipeOrigin.slug)?.title || 'Saved recipe'
    : null;
  return <details className="diary-food-row">
    <summary>
      <span className="diary-food-row-name">{item.name}</span>
      <span className="diary-food-row-amount">{format(item.quantity)} {item.unit}</span>
      <strong className="diary-food-row-calories">{nutrition.calories == null ? '—' : `${format(nutrition.calories)} kcal`}</strong>
      <span className="diary-food-row-macros" aria-label="Protein, carbohydrate and fat">
        P {nutrition.protein == null ? '—' : `${format(nutrition.protein)}g`} · C {nutrition.carbs == null ? '—' : `${format(nutrition.carbs)}g`} · F {nutrition.fat == null ? '—' : `${format(nutrition.fat)}g`}
      </span>
      <ChevronDown size={17} aria-hidden="true" className="diary-food-row-chevron" />
    </summary>
    <div className="diary-food-row-details">
      <p className="diary-food-row-source">{item.source?.provider || 'Food'}{item.source?.name ? ` · ${item.source.name}` : ''}{recipeTitle ? ` · Recipe: ${recipeTitle}` : ''}</p>
      <dl className="diary-food-row-nutrients">
        {NUTRIENTS.map(([key, label, unit]) => <div key={key}><dt>{label}</dt><dd>{nutrition[key] == null ? '—' : `${format(nutrition[key])} ${unit}`}</dd></div>)}
      </dl>
      {meal.notes && <p className="diary-food-row-note">Meal note: {meal.notes}</p>}
      <div className="diary-actions">
        <button type="button" disabled={disabled} onClick={() => onEdit(meal, item)}>Edit food</button>
        <button type="button" className="danger-action" disabled={disabled} onClick={() => onDelete(meal, item)}>Delete food</button>
      </div>
    </div>
  </details>;
}

export function DiaryMealSection({ slot, entries, totals, skipped, disabled, recipes, onAdd, onEdit, onDelete, onMove, onSkip }) {
  const itemCount = entries.reduce((count, meal) => count + meal.items.length, 0);
  const calories = itemCount ? totals.calories.known ? `${format(totals.calories.value)} kcal` : 'Calories unknown' : 'No food logged';
  return <section className="diary-meal-section" aria-label={`${slot} entries`}>
    <header className="diary-meal-section-header">
      <div className="diary-meal-heading-copy">
        <h2>{slot}</h2>
        <span>{calories} · {itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
      </div>
      <button type="button" disabled={disabled} onClick={onAdd}>+ Add</button>
    </header>
    {entries.length ? <div className="diary-meal-entry-list">
      {entries.map(meal => <article className="diary-meal-entry" key={meal.id}>
        <header className="diary-meal-entry-header">
          <h3>{meal.title}</h3>
          <div className="diary-actions">
            <button type="button" disabled={disabled} aria-label={`Edit ${meal.title}`} onClick={() => onEdit(meal)}>Edit</button>
            <label className="diary-move-meal">Move to
              <select aria-label={`Move ${meal.title} to meal`} value={slot} disabled={disabled} onChange={event => onMove(meal, event.target.value)}>
                {['Breakfast', 'Lunch', 'Dinner', 'Snack'].filter(option => option !== slot).map(option => <option key={option} value={option}>{option}</option>)}
                <option value={slot}>{slot}</option>
              </select>
            </label>
            <button type="button" className="danger-action" disabled={disabled} aria-label={`Delete ${meal.title}`} onClick={() => onDelete(meal)}>Delete</button>
          </div>
        </header>
        <div className="diary-food-row-list">
          {meal.items.map(item => <DiaryFoodRow key={item.id} item={item} meal={meal} recipes={recipes} disabled={disabled} onEdit={onEdit} onDelete={(entry, food) => onDelete(entry, food)} />)}
        </div>
      </article>)}
    </div> : <div className="diary-meal-empty"><p>{skipped ? 'Marked skipped' : slot === 'Snack' ? 'No snacks logged' : daySkippedLabel(slot)}</p>
      {slot !== 'Snack' && <button type="button" disabled={disabled} onClick={onSkip}>{skipped ? 'Undo skipped' : 'Mark skipped'}</button>}
    </div>}
  </section>;
}

function daySkippedLabel(slot) {
  return `No ${slot.toLowerCase()} logged`;
}
