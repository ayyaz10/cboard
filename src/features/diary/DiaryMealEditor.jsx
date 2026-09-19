import { NutritionTotals } from "./DiaryNutrition";
import { useEffect, useState } from "react";
import { NutritionLookup } from "../groceries/NutritionLookup";
import { NUTRIENTS } from "../nutrition/nutrients";
import { MEALS, foodItem, itemNutrition, recipeItems } from "./diaryData";

const number = (value) => (value === "" ? "" : Number(value));
const format = (value) =>
  value == null
    ? "Unknown"
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
        value,
      );
export function DiaryMealEditor({
  initial,
  recipes,
  busy,
  onSave,
  onCancel,
  onDraftChange,
}) {
  const [draft, setDraft] = useState(() => structuredClone(initial));
  const [slug, setSlug] = useState("");
  const [portions, setPortions] = useState(1);
  const [individual, setIndividual] = useState(false);
  const [lookup, setLookup] = useState(null);
  const [error, setError] = useState("");
  const recipe = recipes.find((item) => item.slug === slug);
  useEffect(() => {
    onDraftChange(draft);
  }, [draft, onDraftChange]);
  function changeItem(id, values) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === id ? { ...item, ...values } : item,
      ),
    }));
    setError("");
  }
  function addRecipe() {
    try {
      if (!recipe) throw new Error("Choose a recipe first.");
      const items = recipeItems(recipe, Number(portions), individual);
      if (draft.items.length + items.length > 100)
        throw new Error("A meal can contain up to 100 foods.");
      setDraft((current) => ({
        ...current,
        title: current.items.length ? current.title : recipe.title,
        items: [...current.items, ...items],
      }));
      setError("");
      setSlug("");
    } catch (err) {
      setError(err.message);
    }
  }
  function selectFood(nutrition) {
    const item = foodItem(nutrition);
    setDraft((current) => ({
      ...current,
      items:
        lookup === "new"
          ? [...current.items, item]
          : current.items.map((old) =>
              old.id === lookup
                ? {
                    ...item,
                    id: old.id,
                    quantity:
                      old.unit === item.unit ? old.quantity : item.quantity,
                  }
                : old,
            ),
    }));
    setLookup(null);
  }
  return (
    <section className="diary-editor" aria-label="Meal entry editor">
      <h2>{initial.items.length ? "Edit meal entry" : "Log a meal"}</h2>
      <p>
        Adjust this meal freely. Your recipe library and other diary days stay
        unchanged.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
        }}
      >
        <fieldset disabled={busy}>
          <div className="diary-fields">
            <label>
              Meal type
              <select
                value={draft.meal}
                onChange={(event) =>
                  setDraft({ ...draft, meal: event.target.value })
                }
              >
                {MEALS.map((meal) => (
                  <option key={meal}>{meal}</option>
                ))}
              </select>
            </label>
            <label>
              Entry name
              <input
                required
                maxLength={160}
                value={draft.title}
                onChange={(event) =>
                  setDraft({ ...draft, title: event.target.value })
                }
              />
            </label>
          </div>
          <section className="diary-add-recipe">
            <h3>Add a saved recipe</h3>
            <div className="diary-fields">
              <label>
                Recipe
                <select
                  aria-label="Recipe"
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                >
                  <option value="">Choose a recipe</option>
                  {recipes.map((item) => (
                    <option key={item.slug} value={item.slug}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Recipe portions
                <input
                  type="number"
                  min="0.01"
                  max="100"
                  step="any"
                  value={portions}
                  onChange={(event) => setPortions(number(event.target.value))}
                />
              </label>
            </div>
            {recipe && !recipe.productNutrition && (
              <>
                <p className="diary-hint">
                  One portion uses the recipe’s listed macros. Check whether
                  your imported recipe lists one serving or a whole batch.
                </p>
                <label className="diary-check">
                  <input
                    type="checkbox"
                    checked={individual}
                    onChange={(event) => setIndividual(event.target.checked)}
                  />
                  Use individual ingredients instead
                </label>
                {individual && (
                  <p className="diary-hint">
                    Ingredient values must describe their full recipe
                    quantities. They are divided by the recipe’s serving count.
                    Missing values stay unknown; you can replace ingredients
                    using food lookup.
                  </p>
                )}
              </>
            )}
            {recipe?.productNutrition && (
              <p className="diary-hint">
                Imports the saved product ingredients for this many servings.
                Each amount is editable below.
              </p>
            )}
            <button
              type="button"
              disabled={!recipe || draft.items.length >= 100}
              onClick={addRecipe}
            >
              Add recipe to entry
            </button>
          </section>
          <div className="diary-actions">
            <button
              type="button"
              disabled={draft.items.length >= 100}
              onClick={() => setLookup(lookup === "new" ? null : "new")}
            >
              Find food or scan barcode
            </button>
            <button
              type="button"
              disabled={draft.items.length >= 100}
              onClick={() =>
                setDraft({
                  ...draft,
                  items: [
                    ...draft.items,
                    foodItem({ quantity: 100, unit: "g" }, "New food"),
                  ],
                })
              }
            >
              Enter food manually
            </button>
          </div>
          {lookup && (
            <section className="diary-lookup" aria-label="Find food">
              <div className="diary-actions">
                <h3>
                  {lookup === "new" ? "Add food" : "Replace this ingredient"}
                </h3>
                <button type="button" onClick={() => setLookup(null)}>
                  Close food lookup
                </button>
              </div>
              <p>
                For eggs, choose a matching cooked product. To log 2 eggs,
                choose pieces and enter the edible weight per egg if the record
                is per 100 g.
              </p>
              <NutritionLookup
                key={lookup}
                name={
                  lookup === "new"
                    ? ""
                    : draft.items.find((item) => item.id === lookup)?.name || ""
                }
                active
                visible
                onSelect={selectFood}
              />
            </section>
          )}
          <div className="diary-foods">
            {draft.items.map((item, index) => {
              const totals = itemNutrition(item);
              return (
                <section
                  key={item.id}
                  className="diary-food"
                  aria-label={`Food ${index + 1}`}
                >
                  <label>
                    Food name
                    <input
                      required
                      maxLength={300}
                      value={item.name}
                      onChange={(event) =>
                        changeItem(item.id, { name: event.target.value })
                      }
                    />
                  </label>
                  <p className="diary-hint">
                    {item.source.provider}
                    {item.source.name ? ` · ${item.source.name}` : ""}
                    {item.source.modified ? " · edited values" : ""}
                  </p>
                  <div className="diary-fields">
                    <label>
                      Amount eaten
                      <input
                        required
                        type="number"
                        min="0.001"
                        max="1000000"
                        step="any"
                        value={item.quantity}
                        onChange={(event) =>
                          changeItem(item.id, {
                            quantity: number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      Amount unit
                      <select
                        value={item.unit}
                        onChange={(event) =>
                          changeItem(item.id, {
                            unit: event.target.value,
                            perPiece: null,
                          })
                        }
                      >
                        <option value={item.nutritionUnit}>
                          {item.nutritionUnit}
                        </option>
                        {["g", "ml"].includes(item.nutritionUnit) && (
                          <option value="pieces">pieces</option>
                        )}
                      </select>
                    </label>
                    {item.unit !== item.nutritionUnit && (
                      <label>
                        {item.nutritionUnit} per piece (edible portion)
                        <input
                          required
                          type="number"
                          min="0.001"
                          max="1000000"
                          step="any"
                          value={item.perPiece ?? ""}
                          onChange={(event) =>
                            changeItem(item.id, {
                              perPiece: number(event.target.value),
                            })
                          }
                        />
                      </label>
                    )}
                  </div>
                  <p className="diary-food-summary">
                    {format(totals.calories)} kcal · {format(totals.protein)} g
                    protein
                  </p>
                  <details>
                    <summary>Edit label values and micronutrients</summary>
                    <div className="diary-fields">
                      <label>
                        Label values per
                        <input
                          required
                          type="number"
                          min="0.001"
                          max="1000000"
                          step="any"
                          value={item.basis}
                          onChange={(event) =>
                            changeItem(item.id, {
                              basis: number(event.target.value),
                              source: { ...item.source, modified: true },
                            })
                          }
                        />
                      </label>
                      <label>
                        Label unit
                        <select
                          value={item.nutritionUnit}
                          onChange={(event) =>
                            changeItem(item.id, {
                              nutritionUnit: event.target.value,
                              unit: event.target.value,
                              perPiece: null,
                              source: { ...item.source, modified: true },
                            })
                          }
                        >
                          {["g", "ml", "pieces", "servings"].map((unit) => (
                            <option key={unit}>{unit}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p className="diary-hint">
                      Enter values per {item.basis || "?"} {item.nutritionUnit},
                      not for the amount eaten. Blank means unknown.
                    </p>
                    <div className="diary-nutrient-inputs">
                      {NUTRIENTS.map(([key, label, unit]) => (
                        <label key={key}>
                          {label} ({unit})
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={item.nutrition[key] ?? ""}
                            placeholder="Unknown"
                            onChange={(event) =>
                              changeItem(item.id, {
                                nutrition: {
                                  ...item.nutrition,
                                  [key]:
                                    event.target.value === ""
                                      ? null
                                      : Number(event.target.value),
                                },
                                source: { ...item.source, modified: true },
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </details>
                  <div className="diary-actions">
                    <button type="button" onClick={() => setLookup(item.id)}>
                      Replace from food lookup
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft({
                          ...draft,
                          items: draft.items.filter(
                            (food) => food.id !== item.id,
                          ),
                        });
                        if (lookup === item.id) setLookup(null);
                      }}
                    >
                      Remove food
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
          <section aria-label="Draft meal nutrition">
            <h3>This meal</h3>
            <NutritionTotals meals={[draft]} />
            <p className="diary-hint">
              Updates as you change foods and amounts. Save the entry to update
              your daily totals.
            </p>
          </section>
          <label>
            Meal notes
            <textarea
              maxLength={2000}
              rows={2}
              value={draft.notes}
              onChange={(event) =>
                setDraft({ ...draft, notes: event.target.value })
              }
              placeholder="Optional: preparation, appetite, or anything to remember"
            />
          </label>
          <div className="diary-actions diary-editor-footer">
            <button
              className="diary-primary"
              type="submit"
              disabled={!draft.items.length}
            >
              {busy ? "Saving…" : "Save meal entry"}
            </button>
            <button type="button" onClick={onCancel}>
              Cancel editing
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
        </fieldset>
      </form>
    </section>
  );
}
