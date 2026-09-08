import { secondaryButton } from './RecipeComponents';
import { useId } from 'react';

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
    <div className="grid gap-4 sm:grid-cols-2">
      {[
        ['calories', 'Calories (kcal)'],
        ['protein', 'Protein (g)'],
        ['carbs', 'Carbs (g)'],
        ['fat', 'Fat (g)'],
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

function ItemEditor({ item, onChange, groups }) {
  const set = (key, value) => onChange({ ...item, [key]: value });
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
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
      <details>
        <summary className="font-semibold">Item nutrition (optional)</summary>
        <div className="mt-4">
          <Macros
            value={item.nutrition}
            onChange={(value) => set('nutrition', value)}
          />
        </div>
      </details>
    </div>
  );
}

function Items({ title, items, onChange, groups }) {
  return (
    <section className="space-y-4">
      <h2 className="text-2xl font-bold">{title}</h2>
      {items.map((item, index) => (
        <fieldset
          key={index}
          className="space-y-4 rounded-2xl border-2 border-black p-4"
        >
          <legend className="px-2 font-bold">
            {title} #{index + 1}
          </legend>
          <ItemEditor
            item={typeof item === 'string' ? { name: item } : item}
            groups={groups}
            onChange={(next) =>
              onChange(
                items.map((current, i) => (i === index ? next : current)),
              )
            }
          />
          <button
            type="button"
            className={secondaryButton}
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            Remove {title.toLowerCase()} #{index + 1}
          </button>
        </fieldset>
      ))}
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
  const set = (key, value) => onChange({ ...recipe, [key]: value });
  const groups = recipe.alternatives ?? {};
  return (
    <div className="space-y-7">
      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Recipe details</h2>
        <Field
          label="Recipe title"
          required
          value={recipe.title}
          onChange={(value) => set('title', value)}
        />
        <Field
          label="Meal type"
          required
          value={recipe.mealType}
          placeholder="Breakfast, Lunch, Dinner, Snack or custom"
          onChange={(value) => set('mealType', value)}
        />
        <Field
          label="Description"
          multiline
          rows={3}
          value={recipe.description}
          onChange={(value) => set('description', value)}
        />
        <div className="grid gap-4 sm:grid-cols-3">
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
      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Recipe nutrition</h2>
        <p className="text-sm text-black/70">
          Enter macros manually; changing ingredients does not recalculate them.
          Leave unknown values blank.
        </p>
        <Macros
          value={recipe.nutrition}
          onChange={(value) => set('nutrition', value)}
        />
      </section>
      <Items
        title="Ingredients"
        items={recipe.ingredients ?? []}
        groups={groups}
        onChange={(value) => set('ingredients', value)}
      />
      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Instructions</h2>
        {(recipe.steps ?? []).map((step, index) => (
          <div key={index} className="space-y-2">
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
        <button
          type="button"
          className={secondaryButton}
          onClick={() => set('steps', [...(recipe.steps ?? []), ''])}
        >
          Add step
        </button>
      </section>
      <Items
        title="Sauces"
        items={recipe.sauces ?? []}
        onChange={(value) => set('sauces', value)}
      />
      {Object.keys(groups).length > 0 && (
        <section className="space-y-4">
          <h2 className="text-2xl font-bold">Ingredient alternatives</h2>
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
        </section>
      )}
      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Recipe source</h2>
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
      </section>
    </div>
  );
}
