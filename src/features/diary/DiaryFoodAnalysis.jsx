import { useMemo, useState } from 'react';
import { NutritionTotals } from './DiaryNutrition';
export function DiaryFoodAnalysis({ meals }) {
  const [selected, setSelected] = useState([]);
  const [open, setOpen] = useState(false);
  const foods = useMemo(() => meals.flatMap(meal => meal.items.map(item => ({ item, meal, key: `${meal.id}:${item.id}` }))), [meals]);
  const items = foods.filter(food => selected.includes(food.key)).map(food => food.item);
  return <details className="diary-editor diary-analysis" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>Detailed food analysis ({foods.length})</summary>
    {open && <>
    <p>Select foods across any meals to see their combined nutrition.</p>
    <div className="diary-actions"><button type="button" onClick={() => setSelected(foods.map(food => food.key))}>Select all</button><button type="button" onClick={() => setSelected([])}>Clear selection</button></div>
    {foods.map(({ item, meal, key }) => <label key={key} className="diary-check"><input type="checkbox" checked={selected.includes(key)} onChange={event => setSelected(current => event.target.checked ? [...current, key] : current.filter(value => value !== key))} />{item.name} · {item.quantity} {item.unit} · {meal.meal}: {meal.title}</label>)}
    {!foods.length ? <p>No foods logged for this day.</p> : !items.length ? <p>Select a food to see totals.</p> : <NutritionTotals meals={[{ id: 'selection', items }]} />}
    </>}
  </details>;
}
