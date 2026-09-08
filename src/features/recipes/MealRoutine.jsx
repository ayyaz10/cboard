import {
  RecipeImage,
  RecipeLink,
  RecipeNutrition,
  secondaryButton,
} from './RecipeComponents';
import { MEAL_SLOTS } from './mealPlanData';
import { useRecipeCardGrid } from './RecipeCardView';

export function MealRoutine({ routine, meals, onEdit }) {
  const cardGrid = useRecipeCardGrid();
  return (
    <section className="space-y-5" aria-label="Current meal routine">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <span className="pill">Currently following</span>
          <h2 className="break-words text-3xl font-bold">{routine.name}</h2>
          {routine.notes && (
            <p className="whitespace-pre-wrap break-words text-black/70">
              {routine.notes}
            </p>
          )}
        </div>
        <button className={secondaryButton} onClick={onEdit}>
          Edit routine
        </button>
      </header>
      <p className="text-sm text-black/70">
        Your saved everyday meal routine. Daily totals above use the latest
        recipe macros.
      </p>
      <div className={cardGrid}>
        {MEAL_SLOTS.map((slot) => {
          const selected = meals.filter((meal) => meal.meal === slot);
          return (
            <section key={slot} className="min-w-0 space-y-3">
              <h3 className="text-xl font-bold">{slot}</h3>
              {selected.length ? (
                <div className="space-y-4">
                  {selected.map((meal) => (
                    <article
                      key={meal.id}
                      className="recipe-card min-w-0 space-y-4 rounded-2xl border-2 border-black bg-white p-5"
                    >
                      {meal.recipe ? (
                        <>
                          <RecipeImage
                            image={meal.recipe.image}
                            title={meal.recipe.title}
                          />
                          <h4 className="break-words text-xl font-bold">
                            {meal.recipe.title}
                          </h4>
                          <p className="font-semibold">
                            {meal.portions}× portion
                          </p>
                          <RecipeNutrition nutrition={meal.nutrition} />
                          <RecipeLink to={`/recipes/${meal.slug}`}>
                            View Recipe →
                          </RecipeLink>
                        </>
                      ) : (
                        <p role="alert">
                          This recipe was deleted. Edit your routine to choose a
                          replacement; its nutrition is excluded from the known
                          totals.
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-black/70">
                  No {slot.toLowerCase()} selected.
                </p>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
