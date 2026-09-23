import { secondaryButton } from './RecipeComponents';
import { useEffect, useId, useRef, useState } from 'react';
import { NutritionLookup } from '../groceries/NutritionLookup';
import { initialProductAmount } from './recipeProducts.js';
import { cleanIngredientLabel, ingredientLabelAmount, ingredientLabelNutrition, ingredientRecipeCalculation, ingredientRecipeTotals, prepareIngredientEditor } from './ingredientNutrition.js';
import '../groceries/groceries.css';

export const emptyRecipe = () => ({
  title: '',
  mealType: '',
  description: '',
  nutrition: {},
  ingredients: [{ name: '', amount: null, unit: '' }],
  steps: [''],
  sauces: [],
  alternatives: {},
  tags: [],
});

function Field({ label, value, onChange, multiline = false, ...props }) {
  const Control = multiline ? 'textarea' : 'input';
  const id = useId();
  return (
    <div className="min-w-0 space-y-2 font-semibold">
      <label htmlFor={id} className="block">
        {label}
      </label>
      <Control
        id={id}
        className="field-input"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        {...props}
      />
    </div>
  );
}

function Macros({ value = {}, onChange }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {[
        ['calories', 'Calories (kcal)'],
        ['protein', 'Protein (g)'],
        ['carbs', 'Carbs (g)'],
        ['fat', 'Fat (g)'],
        ['fiber', 'Fibre (g)'],
      ].map(([key, label]) => (
        <Field
          key={key}
          label={label}
          type="number"
          min="0"
          step="any"
          value={value[key]}
          onChange={(next) =>
            onChange({ ...value, [key]: next === '' ? null : Number(next) })
          }
        />
      ))}
    </div>
  );
}

function ItemEditor({ item, onChange, groups, visible }) {
  const [lookup, setLookup] = useState(false);
  const [nutritionOpen, setNutritionOpen] = useState(Boolean(item.nutritionLabel));
  const nutritionDetails = useRef(null);
  const set = (key, value) => {
    const next = { ...item, [key]: value };
    if (key === 'name' && value !== item.name && item.nutritionLabel) {
      delete next.nutritionLabel;
      next.nutrition = {};
    } else if (key === 'nutrition') delete next.nutritionLabel;
    else if (next.nutritionLabel) next.nutrition = ingredientLabelNutrition(next);
    onChange(next, { calculateNutrition: key === 'nutrition' });
  };
  const label = item.nutritionLabel;
  function useLabel(nutrition) {
    const needsWeight = initialProductAmount(item, nutrition.unit) === '';
    const next = { ...item, nutritionLabel: cleanIngredientLabel({ ...nutrition,
      ...(needsWeight && nutrition.portion ? { amountPerUnit: nutrition.portion.grams, recipeUnit: String(item.unit || '').trim().toLowerCase() } : {}),
    }) };
    next.nutrition = ingredientLabelNutrition(next);
    onChange(next); setLookup(false); setNutritionOpen(true);
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(12rem,2fr)_minmax(7rem,1fr)_minmax(7rem,1fr)]">
        <Field
          label="Name"
          value={item.name}
          required
          onChange={(value) => set('name', value)}
        />
        <Field
          label="Amount"
          value={item.amount}
          placeholder="60, ½ or 5–10"
          onChange={(value) =>
            set(
              'amount',
              value === ''
                ? null
                : /^-?\d+(\.\d+)?$/.test(value)
                  ? Number(value)
                  : value,
            )
          }
        />
        <Field
          label="Unit"
          value={item.unit}
          placeholder="g, cup, medium"
          onChange={(value) => set('unit', value)}
        />
      </div>
      <Field
        label="Note"
        value={item.note}
        onChange={(value) => set('note', value)}
      />
      {groups && (
        <label className="block space-y-2 font-semibold">
          <span>Alternatives group</span>
          <select
            className="field-input"
            value={item.alternativeGroup ?? ''}
            onChange={(event) => {
              const next = { ...item };
              if (event.target.value)
                next.alternativeGroup = event.target.value;
              else delete next.alternativeGroup;
              onChange(next);
            }}
          >
            <option value="">None</option>
            {Object.entries(groups).map(([key, group]) => (
              <option key={key} value={key}>
                {group.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="groceries space-y-3 rounded-xl border border-black/20 p-3">
        <div className="flex flex-wrap gap-2">
        <button type="button" className={secondaryButton} aria-expanded={lookup} onClick={() => setLookup(!lookup)}>{lookup ? 'Close food lookup' : label ? 'Change nutrition food' : 'Find nutrition from food API'}</button>
        <button type="button" className={secondaryButton} onClick={() => {
          setLookup(false);
          setNutritionOpen(true);
          set('nutrition', item.nutrition || {});
          if (nutritionDetails.current) {
            nutritionDetails.current.open = true;
            nutritionDetails.current.querySelector('input')?.focus();
          }
        }}>Enter nutrition manually</button>
        </div>
        {visible && lookup && <div className="max-h-[34rem] min-w-0 overflow-y-auto overscroll-contain pr-1" aria-label="Food nutrition search results"><NutritionLookup name={item.name || ''} amountUnit={item.unit} portionMode="weight" active visible onSelect={useLabel} /></div>}
        {label && <>
          <p className="text-sm">{label.source.name || item.name} · {label.source.provider}. Label values per {label.quantity} {label.unit}.</p>
          {label.source.estimatedPortion && <p className="text-sm">Estimated USDA portion: {label.source.portionDescription}. Replace the weight below with your measured edible weight if available.</p>}
          {initialProductAmount(item, label.unit) === '' && <Field label={`${label.unit} in one ${item.unit || 'recipe unit'} (edible amount)`} type="number" min="0.001" step="any" value={label.recipeUnit === String(item.unit || '').trim().toLowerCase() ? label.amountPerUnit : ''} onChange={(value) => {
            const next = { ...item, nutritionLabel: { ...label, source: { ...label.source, estimatedPortion: false }, amountPerUnit: value === '' ? null : Number(value), recipeUnit: String(item.unit || '').trim().toLowerCase() } };
            next.nutrition = ingredientLabelNutrition(next); onChange(next);
          }} />}
          <p className="text-sm" role="status">{ingredientLabelAmount(item) == null ? 'Confirm the edible weight or volume of one recipe unit. The API cannot reliably infer the weight of your banana, handful or cup.' : `${ingredientLabelAmount(item)} ${label.unit} used / ${label.quantity} ${label.unit} on the label. The nutrition fields below are calculated for the amount above.`}</p>
          <p className="text-sm">Changing the amount recalculates automatically. Changing the food name clears the selected label. Editing a nutrition number switches this ingredient to manual values.</p>
        </>}
      </div>
      <details ref={nutritionDetails} open={nutritionOpen} onToggle={(event) => setNutritionOpen(event.currentTarget.open)}>
        <summary className="font-semibold">{label ? 'Item nutrition (calculated)' : 'Item nutrition (optional)'}</summary>
        <div className="mt-4">
          {!label && <p className="mb-3 text-sm text-black/60">Manual values for the full amount above. Use food lookup for automatic recalculation when the amount changes.</p>}
          <Macros
            value={item.nutrition}
            onChange={(value) => set('nutrition', value)}
          />
        </div>
      </details>
    </div>
  );
}

function ItemRow({ title, item, index, items, onChange, groups }) {
  const normalizedItem = typeof item === 'string' ? { name: item } : item;
  const [open, setOpen] = useState(!normalizedItem?.name);

  return (
    <details
      className="min-w-0 self-start rounded-xl border-2 border-black bg-white p-3"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer font-bold">
        <span className="text-black/55">{index + 1}.</span>{' '}
        {normalizedItem.name || `New ${title.toLowerCase()}`}
        {(normalizedItem.amount != null || normalizedItem.unit) && (
          <span className="ml-2 text-sm font-normal text-black/60">
            {[normalizedItem.amount, normalizedItem.unit]
              .filter((value) => value != null && value !== '')
              .join(' ')}
          </span>
        )}
      </summary>
      <div className="mt-3 space-y-3">
        <ItemEditor
          item={normalizedItem}
          groups={groups}
          visible={open}
          onChange={(next, options) =>
            onChange(items.map((current, i) => (i === index ? next : current)), options)
          }
        />
        <button
          type="button"
          className={secondaryButton}
          onClick={() => onChange(items.filter((_, i) => i !== index))}
        >
          Remove {title.toLowerCase()} #{index + 1}
        </button>
      </div>
    </details>
  );
}

function useDesktopColumns() {
  const query = '(min-width: 1024px)';
  const [desktop, setDesktop] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return desktop;
}

function Items({ title, items, onChange, groups }) {
  const desktop = useDesktopColumns();
  const itemRow = (item, index) => (
    <ItemRow
      key={index}
      title={title}
      item={item}
      index={index}
      items={items}
      onChange={onChange}
      groups={groups}
    />
  );
  return (
    <section className="space-y-4">
      <h2 className="text-2xl font-bold">{title}</h2>
      {desktop ? (
        <div className="grid items-start gap-2 lg:grid-cols-2">
          <div className="min-w-0 space-y-2">{items.map((item, index) => index % 2 === 0 ? itemRow(item, index) : null)}</div>
          <div className="min-w-0 space-y-2">{items.map((item, index) => index % 2 === 1 ? itemRow(item, index) : null)}</div>
        </div>
      ) : (
        <div className="space-y-2">{items.map(itemRow)}</div>
      )}
      <button
        type="button"
        className={secondaryButton}
        onClick={() =>
          onChange([...items, { name: '', amount: null, unit: '' }])
        }
      >
        Add {title.toLowerCase()}
      </button>
    </section>
  );
}

export function RecipeFormEditor({ recipe, onChange, editing }) {
  recipe = prepareIngredientEditor(recipe);
  const ingredientCalculation = ingredientRecipeCalculation(recipe);
  const set = (key, value, options = {}) => {
    const next = { ...recipe, [key]: value };
    if (key === 'nutrition') next.nutritionFromIngredients = false;
    else if (options.calculateNutrition || next.nutritionFromIngredients || [...(next.ingredients || []), ...(next.sauces || [])].some((item) => item.nutritionLabel)) {
      next.nutritionFromIngredients = true;
      delete next.productNutrition;
      delete next.fibreSource;
      next.nutrition = ingredientRecipeTotals(next);
    }
    onChange(next);
  };
  const groups = recipe.alternatives ?? {};
  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-2xl border-2 border-black bg-white p-4">
        <h2 className="text-2xl font-bold">Recipe details</h2>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <Field label="Recipe title" required value={recipe.title} onChange={(value) => set('title', value)} />
          <Field label="Meal type" required value={recipe.mealType} placeholder="Breakfast, Lunch…" onChange={(value) => set('mealType', value)} />
        </div>
        <Field
          label="Description"
          multiline
          rows={3}
          value={recipe.description}
          onChange={(value) => set('description', value)}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="Prep time"
            value={recipe.prepTime}
            onChange={(value) => set('prepTime', value || null)}
          />
          <Field
            label="Cooking time"
            value={recipe.cookTime}
            onChange={(value) => set('cookTime', value || null)}
          />
          <Field
            label="Servings"
            type="number"
            min="0.01"
            step="any"
            value={recipe.servings}
            onChange={(value) =>
              set('servings', value === '' ? null : Number(value))
            }
          />
        </div>
        {editing && (
          <p className="text-sm text-black/70">
            Recipe link: {recipe.slug} (kept unchanged)
          </p>
        )}
        <Field
          label="Tags (comma separated)"
          value={(recipe.tags ?? []).join(',')}
          onChange={(value) => set('tags', value.split(','))}
        />
      </section>
      <details className="rounded-2xl border-2 border-black bg-white p-4" open>
        <summary className="cursor-pointer text-xl font-bold">Recipe nutrition</summary>
        <p className="text-sm text-black/70">
          {recipe.nutritionFromIngredients ? 'Calculated automatically per serving from ingredient and sauce quantities. Set the serving count above; alternatives are not included.' : 'Enter macros manually or use food lookup inside an ingredient to calculate from ingredients. Item nutrition describes the full amount listed for that ingredient.'}
        </p>
        <div className="mt-3"><Macros value={recipe.nutrition} onChange={(value) => set('nutrition', value)} /></div>
        {recipe.nutritionFromIngredients && Object.values(ingredientCalculation.missing).some((value) => value > 0) && <p className="mt-3 text-sm font-semibold">Showing known per-serving subtotals. Complete the missing ingredient nutrition to calculate the full recipe.</p>}
      </details>
      <Items
        title="Ingredients"
        items={recipe.ingredients ?? []}
        groups={groups}
        onChange={(value, options) => set('ingredients', value, options)}
      />
      <section className="space-y-3">
        <h2 className="text-2xl font-bold">Instructions</h2>
        <div className="grid gap-3 lg:grid-cols-2">
        {(recipe.steps ?? []).map((step, index) => (
          <div key={index} className="space-y-2 rounded-xl border-2 border-black bg-white p-3">
            <Field
              label={`Step ${index + 1}`}
              multiline
              required
              value={step}
              onChange={(value) =>
                set(
                  'steps',
                  recipe.steps.map((current, i) =>
                    i === index ? value : current,
                  ),
                )
              }
            />
            <button
              type="button"
              className={secondaryButton}
              onClick={() =>
                set(
                  'steps',
                  recipe.steps.filter((_, i) => i !== index),
                )
              }
            >
              Remove step {index + 1}
            </button>
          </div>
        ))}
        </div>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => set('steps', [...(recipe.steps ?? []), ''])}
        >
          Add step
        </button>
      </section>
      <details className="rounded-2xl border-2 border-black bg-white p-4">
        <summary className="cursor-pointer text-xl font-bold">Sauces ({recipe.sauces?.length ?? 0})</summary>
        <div className="mt-4"><Items title="Sauces" items={recipe.sauces ?? []} onChange={(value, options) => set('sauces', value, options)} /></div>
      </details>
      {Object.keys(groups).length > 0 && (
        <details className="rounded-2xl border-2 border-black bg-white p-4">
          <summary className="cursor-pointer text-xl font-bold">Ingredient alternatives ({Object.keys(groups).length})</summary>
          <div className="mt-4 space-y-3">
          {Object.entries(groups).map(([key, group]) => (
            <details
              key={key}
              className="rounded-2xl border-2 border-black p-4"
            >
              <summary className="font-bold">{group.title}</summary>
              <div className="mt-4 space-y-4">
                <Field
                  label="Group title"
                  required
                  value={group.title}
                  onChange={(value) =>
                    set('alternatives', {
                      ...groups,
                      [key]: { ...group, title: value },
                    })
                  }
                />
                <Items
                  title="Options"
                  items={group.options}
                  onChange={(value) =>
                    set('alternatives', {
                      ...groups,
                      [key]: { ...group, options: value },
                    })
                  }
                />
              </div>
            </details>
          ))}
          </div>
        </details>
      )}
      <details className="rounded-2xl border-2 border-black bg-white p-4" open={Boolean(recipe.source)}>
        <summary className="cursor-pointer text-xl font-bold">Recipe source</summary>
        <div className="mt-4 space-y-3">
        <label className="flex items-center gap-3 font-semibold">
          <input
            type="checkbox"
            checked={Boolean(recipe.source)}
            onChange={(event) =>
              set(
                'source',
                event.target.checked
                  ? {
                      type: 'website',
                      label: 'Original recipe',
                      url: '',
                      showOnRecipeCard: false,
                    }
                  : null,
              )
            }
          />
          Include a source link
        </label>
        {recipe.source && (
          <>
            <Field
              label="Source URL"
              required
              placeholder="https://youtu.be/..."
              value={recipe.source.url}
              onChange={(value) =>
                set('source', { ...recipe.source, url: value })
              }
            />
            <Field
              label="Source label"
              value={recipe.source.label}
              onChange={(value) =>
                set('source', { ...recipe.source, label: value })
              }
            />
            <Field
              label="Source type"
              value={recipe.source.type}
              placeholder="youtube or website"
              onChange={(value) =>
                set('source', { ...recipe.source, type: value })
              }
            />
            <label className="flex items-center gap-3 font-semibold">
              <input
                type="checkbox"
                checked={recipe.source.showOnRecipeCard ?? false}
                onChange={(event) =>
                  set('source', {
                    ...recipe.source,
                    showOnRecipeCard: event.target.checked,
                  })
                }
              />
              Show source on recipe card
            </label>
          </>
        )}
        </div>
      </details>
    </div>
  );
}
