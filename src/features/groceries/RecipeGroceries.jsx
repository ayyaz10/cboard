import { useState } from "react";
import { getAppHref } from "../../app/useRoute";
import { useGroceries } from "./useGroceries";
import { addShopping, cookRecipe, recipeNeeds } from "./groceryData";
import "./groceries.css";
export function RecipeGroceries({ recipe }) {
  const { data, busy, error, reload, change, notice, undo } = useGroceries();
  const [multiplier, setMultiplier] = useState(1),
    [review, setReview] = useState(false);
  if (!data)
    return (
      <section className="groceries g-recipe">
        <h2>Your kitchen</h2>
        {error ? (
          <p role="alert">
            {error} <button onClick={reload}>Retry</button>
          </p>
        ) : (
          <p>Checking ingredients…</p>
        )}
      </section>
    );
  const needs = recipeNeeds(recipe, data, multiplier);
  const unresolved = needs.some((i) => i.missing == null);
  return (
    <section className="groceries g-recipe">
      <div className="g-between">
        <h2>From your kitchen</h2>
        <a href={getAppHref("/groceries")}>Manage groceries →</a>
      </div>
      <label className="g-tools">
        {recipe.servings ? "Servings" : "Recipe batches"}
        <input
          aria-label={
            recipe.servings ? "Grocery recipe servings" : "Recipe batches"
          }
          type="number"
          min="0.25"
          step="0.25"
          value={multiplier * (recipe.servings || 1)}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (n > 0) {
              setMultiplier(n / (recipe.servings || 1));
              setReview(false);
            }
          }}
        />
      </label>
      <ul>
        {needs.map((need, index) => (
          <li key={index}>
            <span className="g-recipe-ingredient">
              {need.image && <img src={need.image} alt="" loading="lazy" />}
              <span>
                {need.name}
                <small className="block">
                  {need.required == null
                    ? "Check recipe amount / unit"
                    : `${need.required} ${need.unit} needed`}
                </small>
              </span>
            </span>
            <strong>
              {need.missing == null
                ? "Needs review"
                : need.missing === 0
                  ? "✓ Available"
                  : need.available === 0
                    ? `Missing ${need.missing} ${need.unit}`
                    : `Short ${need.missing} ${need.unit}`}
            </strong>
          </li>
        ))}
      </ul>
      {unresolved && (
        <p>
          Set unknown stock quantities in Groceries. Correct missing amounts or
          unsupported units using the recipe’s Edit action, then check again.
        </p>
      )}
      {error && (
        <p role="alert">
          {error}{" "}
          <button disabled={busy} onClick={reload}>
            Reload
          </button>
        </p>
      )}
      <div className="g-actions">
        <button
          disabled={busy || !needs.some((i) => i.missing > 0)}
          onClick={() =>
            change((s) => {
              for (const need of recipeNeeds(recipe, s, multiplier))
                if (need.missing > 0)
                  s.shopping = addShopping(
                    s.shopping,
                    need,
                    need.missing,
                    true,
                  );
              return s;
            }, "Missing amounts added to shopping list")
          }
        >
          ＋ Add missing to shopping list
        </button>
        <button
          disabled={busy || !needs.length || needs.some((i) => i.missing !== 0)}
          onClick={() => setReview(true)}
        >
          Mark as cooked
        </button>
      </div>
      {review && (
        <div className="g-hint">
          <p>Deduct the amounts shown above from your groceries?</p>
          <div className="g-actions">
            <button
              className="g-primary"
              disabled={busy}
              onClick={async () => {
                if (
                  await change(
                    (s) => cookRecipe(s, recipeNeeds(recipe, s, multiplier)),
                    "Meal cooked · Stock updated",
                  )
                )
                  setReview(false);
              }}
            >
              Confirm & update stock
            </button>
            <button onClick={() => setReview(false)}>Cancel</button>
          </div>
        </div>
      )}
      <div role="status" className="g-between">
        <span>{busy ? "Saving…" : notice}</span>
        {undo && (
          <button disabled={busy} onClick={undo}>
            Undo
          </button>
        )}
      </div>
    </section>
  );
}
