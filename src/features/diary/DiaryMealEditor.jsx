import { NutritionTotals } from "./DiaryNutrition";
import { useEffect, useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { NutritionLookup } from "../groceries/NutritionLookup";
import { NUTRIENTS } from "../nutrition/nutrients";
import { MEALS, foodItem, itemNutrition, recipeItems } from "./diaryData";
import { applyStoredDiaryFood, findDiaryFoodMatches } from './diaryFoodLibrary';

const number = (value) => (value === "" ? "" : Number(value));
const format = (value) =>
  value == null
    ? "Unknown"
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
        value,
      );

function DiaryStoredFoodName({ item, foodLibrary, onNameChange, onSelect }) {
  const inputId = useId();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = findDiaryFoodMatches(foodLibrary, item.name);
  const show = open && matches.length > 0;
  const choose = (entry) => { onSelect(entry.item); setOpen(false); setActive(0); };
  return <div className="diary-food-name">
    <label htmlFor={inputId}>Food name</label>
    <input
      id={inputId}
      required
      maxLength={300}
      autoComplete="off"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={show}
      aria-controls={listId}
      aria-activedescendant={show ? `${listId}-${active}` : undefined}
      value={item.name}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onChange={(event) => { onNameChange(event.target.value); setOpen(true); setActive(0); }}
      onKeyDown={(event) => {
        if (!show && event.key === 'ArrowDown' && matches.length) { event.preventDefault(); setOpen(true); return; }
        if (!show) return;
        if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => (index + 1) % matches.length); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => (index - 1 + matches.length) % matches.length); }
        else if (event.key === 'Enter') { event.preventDefault(); choose(matches[active]); }
        else if (event.key === 'Escape') setOpen(false);
      }}
    />
    {show && <div id={listId} className="diary-food-suggestions" role="listbox">
      {matches.map((entry, index) => <button
        id={`${listId}-${index}`}
        key={entry.key}
        type="button"
        role="option"
        aria-selected={active === index}
        className={active === index ? 'is-active' : ''}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActive(index)}
        onClick={() => choose(entry)}
      >
        <strong>{entry.item.name}</strong>
        <small>{[entry.item.quantity, entry.item.unit, entry.item.source?.name || entry.item.source?.provider, entry.origins.slice(0, 2).join(', ')].filter((value) => value !== '' && value != null).join(' · ')}</small>
      </button>)}
    </div>}
  </div>;
}

export function DiaryMealEditor({
  initial,
  recipes,
  busy,
  onSave,
  onCancel,
  onDraftChange,
  foodLibrary = [],
}) {
  const [draft, setDraft] = useState(() => structuredClone(initial));
  const [slug, setSlug] = useState("");
  const [portions, setPortions] = useState(1);
  const [individual, setIndividual] = useState(false);
  const [lookup, setLookup] = useState(null);
  const [openFood, setOpenFood] = useState(null);
  const [error, setError] = useState("");
  const reduceMotion = useReducedMotion();
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
    const selectedId = lookup === "new" ? item.id : lookup;
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
    setOpenFood(selectedId);
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
            {recipe && !recipe.productNutrition && !recipe.nutritionFromIngredients && (
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
            {recipe?.nutritionFromIngredients && (
              <p className="diary-hint">
                Imports the saved ingredient nutrition for this many servings so known values and incomplete ingredients remain visible.
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
              onClick={() => {
                const item = foodItem({ quantity: 100, unit: "g" }, "New food");
                setDraft({ ...draft, items: [...draft.items, item] });
                setOpenFood(item.id);
              }}
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
                  className="diary-food diary-food-compact"
                  aria-label={`Food ${index + 1}`}
                >
                  <button
                    type="button"
                    className="diary-food-toggle"
                    aria-expanded={openFood === item.id}
                    onClick={() => setOpenFood(openFood === item.id ? null : item.id)}
                  >
                    <span className="diary-food-toggle-copy">
                      <span className="diary-food-title">{item.name}</span>
                      <span className="diary-food-amount">{format(item.quantity)} {item.unit}</span>
                      <span className="diary-food-macro-summary">
                        <span>{totals.calories == null ? "—" : format(totals.calories)} kcal</span>
                        <span>P {totals.protein == null ? "—" : `${format(totals.protein)} g`}</span>
                        <span>C {totals.carbs == null ? "—" : `${format(totals.carbs)} g`}</span>
                        <span>F {totals.fat == null ? "—" : `${format(totals.fat)} g`}</span>
                        <span>Fibre {totals.fiber == null ? "—" : `${format(totals.fiber)} g`}</span>
                      </span>
                    </span>
                    <motion.svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="diary-food-chevron" animate={{ rotate: openFood === item.id ? 180 : 0 }} transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}>
                      <path d="m6 9 6 6 6-6" />
                    </motion.svg>
                  </button>
                  <AnimatePresence initial={false}>
                  {openFood === item.id && <motion.div
                    key="food-editor"
                    className="diary-food-editor-body"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ height: { duration: reduceMotion ? 0 : 0.38, ease: [0.22, 1, 0.36, 1] }, opacity: { duration: reduceMotion ? 0 : 0.22 } }}
                  >
                  <div className="diary-food-editor-inner">
                  <DiaryStoredFoodName
                    item={item}
                    foodLibrary={foodLibrary}
                    onNameChange={(name) => changeItem(item.id, { name })}
                    onSelect={(stored) => {
                      const selected = applyStoredDiaryFood(item, stored);
                      setDraft((current) => ({ ...current, items: current.items.map((food) => food.id === item.id ? selected : food) }));
                      setError('');
                    }}
                  />
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
                  </div>
                  </motion.div>}
                  </AnimatePresence>
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
