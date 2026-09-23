import {
  RecipeImage,
  RecipeLink,
  RecipeNutrition,
  secondaryButton,
} from './RecipeComponents';
import { MEAL_SLOTS } from './mealPlanData';

export function MealRoutine({ routine, meals, onEdit }) {
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
      <div className="grid items-start gap-5 md:grid-cols-2">
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
                      className="recipe-clickable-card grid min-w-0 gap-3 break-words rounded-2xl border-2 border-black bg-white p-3 sm:grid-cols-[8rem_minmax(0,1fr)]"
                    >
                      {meal.recipe ? (
                        <>
                          <div className="self-start">
                            <RecipeImage
                              image={meal.recipe.image}
                              title={meal.recipe.title}
                            />
                          </div>
                          <div className="min-w-0 space-y-2.5">
                          <h4 className="break-words text-lg font-bold leading-tight">
                            <RecipeLink
                              to={`/recipes/${meal.slug}`}
                              className="recipe-card-main-link"
                            >
                              {meal.recipe.title}
                            </RecipeLink>
                          </h4>
                          <p className="text-sm font-semibold">
                            {meal.portions}× portion
                          </p>
                          <RecipeNutrition nutrition={meal.nutrition} />
                          <RecipeLink to={`/recipes/${meal.slug}`}>
                            View Recipe →
                          </RecipeLink>
                          </div>
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
