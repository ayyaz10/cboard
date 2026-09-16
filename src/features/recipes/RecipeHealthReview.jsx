import { healthReviewStatus } from '../../../supabase/functions/_shared/recipeHealthReview.js';
import './recipeHealthReview.css';

const labels = {
  positive: 'Positive ingredients', watch: 'Points to watch',
  limited: 'More information needed', outdated: 'Review outdated', unavailable: 'Not reviewed',
};
export function RecipeHealthReview({ recipe, compact = false }) {
  const status = healthReviewStatus(recipe);
  if (!recipe.healthReview && !recipe.tags?.includes('AI imported')) return null;
  if (compact) return <p className="recipe-review-badge" data-status={status}>Ingredient review: {labels[status]}</p>;
  const review = recipe.healthReview;
  return <section className="recipe-health-review" aria-label="AI ingredient review">
    <div className="recipe-review-heading">
      <h2>AI ingredient review</h2>
      <span className="recipe-review-badge" data-status={status}>{labels[status]}</span>
    </div>
    {status === 'unavailable' ? <p>No ingredient review is available for this recipe. New AI imports include one when the model can provide it.</p>
      : status === 'outdated' ? <p>This recipe has changed since its review. The previous report is hidden because it may no longer apply. Import the updated recipe with AI to get a fresh review.</p>
        : <>
          <p>{review.summary}</p>
          <div className="recipe-review-grid">
            {[['positives', 'Positives', 'positive'], ['watchOuts', 'Points to watch', 'watch']].map(([key, label, tone]) =>
              review[key].length > 0 && <div className="recipe-review-note" data-status={tone} key={key}>
                <h3>{label}</h3><ul>{review[key].map((text, index) => <li key={index}>{text}</li>)}</ul>
              </div>)}
          </div>
          {review.suggestions.length > 0 && <div><h3>Simple improvements</h3><ul>{review.suggestions.map((text, index) => <li key={index}>{text}</li>)}</ul></div>}
          {review.limitations.length > 0 && <div className="recipe-review-note" data-status="limited"><h3>What’s uncertain</h3><ul>{review.limitations.map((text, index) => <li key={index}>{text}</li>)}</ul></div>}
        </>}
    <p className="recipe-review-context">AI guidance based on the supplied ingredients and method, not a food-label traffic-light score or a medical assessment. Portions and your overall diet matter; this does not confirm allergy or food safety.</p>
    <a href="https://www.nhs.uk/live-well/eat-well/food-guidelines-and-food-labels/the-eatwell-guide/" target="_blank" rel="noopener noreferrer">Healthy eating guidance: NHS Eatwell Guide ↗</a>
  </section>;
}
