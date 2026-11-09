import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NutritionLabelScan } from '../../../src/features/nutrition/NutritionLabelScan.jsx';
import { AppNotifications } from '../../../src/components/ui/AppNotifications.jsx';
import { notify } from '../../../src/lib/notifications.js';

function Harness() {
  const [foodName, setFoodName] = useState('Raw uncooked chickpeas');
  const [applied, setApplied] = useState(null);
  window.showNutritionTestToast = () => notify.error('Nutrition test toast');
  return <main style={{ maxWidth: 760, margin: '2rem auto', padding: '1rem' }}>
    <h1>Nutrition import fixture</h1>
    <label>Food item name<input aria-label="Canonical food item name" value={foodName} onChange={event => setFoodName(event.target.value)} /></label>
    <NutritionLabelScan foodName={foodName} amount={100} unit="g" draftId="qa-food" onFoodNameChange={setFoodName} current={null} onApply={setApplied} />
    <output aria-label="Applied food name">{applied ? `${applied.foodName}|${applied.calories}` : ''}</output>
    <AppNotifications />
  </main>;
}

createRoot(document.getElementById('root')).render(<Harness />);
