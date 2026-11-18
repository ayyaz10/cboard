import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DiaryRecipeConfirm } from '../../../src/features/diary/DiaryRecipeConfirm.jsx';
import '../../../src/features/groceries/groceries.css';
import '../../../src/features/diary/foodDiary.css';

const initialItem = { id: 'oats', name: 'Oats', quantity: 100, unit: 'g', nutrition: {}, source: { provider: 'Recipe ingredient', name: 'Test recipe' } };
const meal = { title: 'Breakfast', items: [{ ...initialItem, quantity: 150 }] };
const initial = { items: [initialItem] };
const recipes = [{ slug: 'test-recipe', title: 'Test recipe', servings: 2, ingredients: [{ id: 'oats-original', name: 'Oats', amount: 100, unit: 'g' }] }];

function Harness() {
  const [open, setOpen] = useState(true);
  window.__recipeHarness ||= { saves: [], closes: 0 };
  return <main style={{ minHeight: '100vh' }}>{open && <DiaryRecipeConfirm meal={meal} initial={initial} recipes={recipes} busy={false} error="" diarySaved={false} recipeSaved={false}
    onSave={(...args) => { window.__recipeHarness.saves.push(args); }} onClose={() => { window.__recipeHarness.closes++; setOpen(false); }} />}</main>;
}

createRoot(document.getElementById('root')).render(<Harness />);
