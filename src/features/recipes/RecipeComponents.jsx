import { RecipeHealthReview } from './RecipeHealthReview';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { getAppHref, navigateTo } from '../../app/useRoute';
import { formatIngredient } from './recipeData';
import { RecipeSource } from './RecipeSource';
import { RecipeGroceries } from '../groceries/RecipeGroceries';
import { RecipeMasonryGrid, useRecipeCardGrid } from './RecipeCardView';
import { RecipeFavouriteButton } from './RecipeFavouriteButton';
import { calculateProducts } from './recipeProducts.js';
import { ingredientRecipeCalculation } from './ingredientNutrition.js';

export const secondaryButton =
  'inline-flex items-center justify-center rounded-full border-2 border-black bg-white px-4 py-2 text-sm font-bold text-black transition hover:-translate-y-px focus-visible:outline-offset-4 disabled:opacity-50';

export function RecipeLink({ to, children, className = secondaryButton }) {
  return (
    <a
      href={getAppHref(to)}
      className={className}
      onClick={(event) => {
        if (
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault();
          navigateTo(to);
          window.scrollTo(0, 0);
        }
      }}
    >
      {children}
    </a>
  );
}

export function RecipeImage({ image, title, large = false }) {
  return image ? (
    <img
      src={image}
      alt={title}
      loading={large ? 'eager' : 'lazy'}
      className={`w-full rounded-[1.35rem] object-cover ${large ? 'max-h-[22rem] aspect-[4/3]' : 'aspect-[4/3]'}`}
    />
  ) : (
    <div
      className={`recipe-image-placeholder flex items-center justify-center rounded-[1.35rem] border-2 border-black bg-white px-2 text-center text-sm font-semibold leading-5 text-black/55 ${large ? 'min-h-28 h-full' : 'aspect-[4/3]'}`}
    >
      No recipe image yet
    </div>
  );
}

export function RecipeNutrition({ nutrition = {}, fibreSource }) {
  const values = [
    ['calories', 'kcal'],
    ['protein', 'g protein'],
    ['carbs', 'g carbs'],
    ['fat', 'g fat'],
    ['fiber', 'g fibre'],
  ].filter(([key]) => nutrition[key] != null);
  return values.length ? (
    <dl className="flex flex-wrap gap-3">
      {values.map(([key, unit]) => (
        <div
          key={key}
          className="rounded-2xl border-2 border-black bg-white px-4 py-3 text-black"
        >
          <dt className="text-xs capitalize text-black/70">{key === 'fiber' ? 'fibre' : key}</dt>
          <dd className="font-bold">
            {nutrition[key]} {unit}
            {key === 'fiber' && fibreSource && <small className="block font-normal">Estimated ? {fibreSource.type === 'ai' ? 'AI assisted' : 'grocery labels'} ? {fibreSource.basis === 'serving' ? 'per serving' : 'whole recipe'}</small>}
          </dd>
        </div>
      ))}
    </dl>
  ) : (
    <p className="text-sm text-black/55">Nutrition not provided.</p>
  );
}

function RecipeNutritionStatus({ recipe, preview = false }) {
  if (preview)
    return <p className="text-sm" role="status">Unsaved nutrition preview · per serving. Complete the ingredient amounts, then save products & nutrition.</p>;
  if (!recipe.productNutrition && !recipe.nutritionFromIngredients) return null;
  const calculation = recipe.productNutrition
    ? calculateProducts(recipe.productNutrition.items, recipe.servings)
    : recipe.nutritionFromIngredients
      ? ingredientRecipeCalculation(recipe)
      : null;
  const missing = calculation ? Math.max(...Object.values(calculation.missing)) : 0;
  return <p className="text-sm">
    Ingredient nutrition · per serving
    {missing > 0 && <> · <strong>known subtotal</strong> ({missing} ingredient{missing === 1 ? '' : 's'} incomplete)</>}
  </p>;
}

function RecipeCardNutrition({ recipe }) {
  const values = [
    recipe.nutrition?.calories != null && `${recipe.nutrition.calories} kcal`,
    recipe.nutrition?.protein != null && `${recipe.nutrition.protein} g protein`,
    recipe.nutrition?.fiber != null && `${recipe.nutrition.fiber} g fibre`,
  ].filter(Boolean);
  if (!values.length) return null;
  const calculation = recipe.productNutrition
    ? calculateProducts(recipe.productNutrition.items, recipe.servings)
    : recipe.nutritionFromIngredients
      ? ingredientRecipeCalculation(recipe)
      : null;
  const partial = calculation && Math.max(...Object.values(calculation.missing)) > 0;
  return <p className="recipe-card-nutrition text-sm font-semibold text-black/70">
    {values.join(' · ')}{partial && <span className="font-normal"> · partial</span>}
  </p>;
}

export function RecipeAlternatives({ group }) {
  const cardGrid = useRecipeCardGrid();
  return (
    <section className="space-y-4">
      <h2 className="text-2xl font-bold">{group.title}</h2>
      <RecipeMasonryGrid as="ul" className={cardGrid}>
        {group.options.map((option, index) => (
          <li
            key={index}
            className="recipe-card rounded-2xl border-2 border-black bg-white p-4"
          >
            <p className="font-bold">{formatIngredient(option)}</p>
            {option.note && <p className="mt-2 text-black/70">{option.note}</p>}
            {Object.values(option.nutrition ?? {}).some(
              (value) => value != null,
            ) && (
              <div className="mt-3">
                <RecipeNutrition nutrition={option.nutrition} />
              </div>
            )}
          </li>
        ))}
      </RecipeMasonryGrid>
    </section>
  );
}

const ingredientNutrients = [
  ['calories', 'Calories', 'kcal'],
  ['protein', 'Protein', 'g'],
  ['carbs', 'Carbs', 'g'],
  ['fat', 'Fat', 'g'],
  ['fiber', 'Fibre', 'g'],
];

function ChevronDownIcon({ open, reduceMotion }) {
  return <motion.svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.25"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-5 w-5 shrink-0"
    animate={{ rotate: open ? 180 : 0 }}
    transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
  >
    <path d="m6 9 6 6 6-6" />
  </motion.svg>;
}

function IngredientNutritionRow({ item, recipe, preview }) {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  return <li className="min-w-0 self-start overflow-hidden rounded-xl border-2 border-black bg-white">
    <div className="flex min-w-0 items-center gap-2">
      <button type="button" className="flex min-w-0 flex-1 items-center justify-between gap-3 bg-transparent px-3 py-2.5 text-left" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="min-w-0">
          <span className="block font-semibold">{formatIngredient(item)}</span>
          {item.note && <span className="mt-0.5 block text-xs leading-5 text-black/65">{item.note}</span>}
        </span>
        <ChevronDownIcon open={open} reduceMotion={reduceMotion} />
      </button>
      {item.alternativeGroup && (preview ? (
        <a className="mr-3 text-sm font-bold underline underline-offset-4" href={`#preview-${item.alternativeGroup}`}>Alternatives →</a>
      ) : (
        <RecipeLink to={`/recipes/${recipe.slug}/alternatives/${item.alternativeGroup}`}>Alternatives →</RecipeLink>
      ))}
    </div>
    <AnimatePresence initial={false}>
      {open && <motion.div
        key="ingredient-nutrition"
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{
          height: { duration: reduceMotion ? 0 : 0.38, ease: [0.22, 1, 0.36, 1] },
          opacity: { duration: reduceMotion ? 0 : 0.24, ease: 'easeOut' },
        }}
        className="overflow-hidden"
      >
        <motion.div
          initial={{ y: reduceMotion ? 0 : -8 }}
          animate={{ y: 0 }}
          exit={{ y: reduceMotion ? 0 : -5 }}
          transition={{ duration: reduceMotion ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="border-t-2 border-black/15 px-3 py-3"
        >
          <p className="mb-2 text-xs font-semibold text-black/60">Nutrition for the listed ingredient amount</p>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {ingredientNutrients.map(([key, label, unit]) => <div key={key} className="rounded-lg bg-[#f4f1e8] px-2.5 py-2">
              <dt className="text-xs text-black/60">{label}</dt>
              <dd className="font-bold">{item.nutrition?.[key] == null ? '—' : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(item.nutrition[key])} ${unit}`}</dd>
            </div>)}
          </dl>
          {!ingredientNutrients.some(([key]) => item.nutrition?.[key] != null) && <p className="mt-2 text-xs text-black/60">Nutrition has not been calculated for this ingredient yet.</p>}
        </motion.div>
      </motion.div>}
    </AnimatePresence>
  </li>;
}

function useIngredientColumns() {
  const query = '(min-width: 768px)';
  const [columns, setColumns] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setColumns(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return columns;
}

export function IngredientList({ recipe, preview = false }) {
  const columns = useIngredientColumns();
  const row = (item, index) => <IngredientNutritionRow key={index} item={item} recipe={recipe} preview={preview} />;
  return (
    <section>
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-2xl font-bold">Ingredients</h2>
        <span className="text-sm text-black/60">{recipe.ingredients.length} items</span>
      </div>
      {columns ? <div className="mt-3 grid items-start gap-2 md:grid-cols-2">
        <ul className="min-w-0 space-y-2">{recipe.ingredients.map((item, index) => index % 2 === 0 ? row(item, index) : null)}</ul>
        <ul className="min-w-0 space-y-2">{recipe.ingredients.map((item, index) => index % 2 === 1 ? row(item, index) : null)}</ul>
      </div> : <ul className="mt-3 space-y-2">{recipe.ingredients.map(row)}</ul>}
    </section>
  );
}

export function RecipeSteps({ steps }) {
  return (
    <section>
      <h2 className="text-2xl font-bold">How to make it</h2>
      <ol className="mt-3 grid gap-x-6 gap-y-3 lg:grid-cols-2">
        {steps.map((step, index) => (
          <li key={index} className="flex gap-3 text-sm leading-6">
            <span className="pill h-fit shrink-0" aria-hidden="true">
              {index + 1}
            </span>
            <span>
              <span className="sr-only">Step {index + 1}. </span>
              {step}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function RecipePage({ recipe, preview = false, onRecipeUpdated, favourite = false, favouritePending = false, onToggleFavourite }) {
  return (
    <article className="space-y-5 break-words text-black">
      <section className="grid gap-5 lg:grid-cols-[minmax(15rem,0.75fr)_minmax(0,1.25fr)] lg:items-stretch">
        <RecipeImage image={recipe.image} title={recipe.title} large />
        <div className="space-y-4 rounded-[1.35rem] border-2 border-black bg-white p-5">
          <header className="space-y-2">
            <div className="flex items-center justify-between gap-3"><span className="pill">{recipe.mealType}</span>{!preview && <RecipeFavouriteButton recipe={recipe} favourite={favourite} pending={favouritePending} onToggle={onToggleFavourite}/>}</div>
            <h1 className="text-3xl font-bold tracking-[-0.04em] sm:text-4xl">
              {recipe.title}
            </h1>
            {recipe.description && <p className="text-sm leading-6 text-black/70">{recipe.description}</p>}
          </header>
          <RecipeNutrition nutrition={recipe.nutrition} fibreSource={recipe.fibreSource} />
          <RecipeNutritionStatus recipe={recipe} />
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            {[
              ['Prep time', recipe.prepTime],
              ['Cooking time', recipe.cookTime],
              ['Servings', recipe.servings],
            ].filter(([, value]) => value != null && value !== '').map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-black/60">{label}</dt>
                <dd className="text-sm font-bold">{value}</dd>
              </div>
            ))}
          </dl>
          <RecipeSource source={recipe.source} linkClassName={secondaryButton} />
        </div>
      </section>
      {(recipe.healthReview || recipe.tags?.includes('AI imported')) && (
        <details className="rounded-2xl border-2 border-black bg-white p-4">
          <summary className="cursor-pointer font-bold">Ingredient health report</summary>
          <div className="mt-4"><RecipeHealthReview recipe={recipe} /></div>
        </details>
      )}
      <IngredientList recipe={recipe} preview={preview} />
      <RecipeSteps steps={recipe.steps} />
      {!preview && (
        <details className="rounded-2xl border-2 border-black bg-white p-4">
          <summary className="cursor-pointer font-bold">Kitchen stock, shopping and fibre tools</summary>
          <div className="mt-4"><RecipeGroceries key={recipe.slug} recipe={recipe} onRecipeUpdated={onRecipeUpdated} /></div>
        </details>
      )}
      {recipe.sauces.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold">Sauces</h2>
          <ul className="mt-3 list-inside list-disc space-y-2">
            {recipe.sauces.map((sauce, index) => (
              <li key={index}>
                {formatIngredient(sauce)}
                {sauce.note && (
                  <span className="text-black/70"> — {sauce.note}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {preview &&
        Object.entries(recipe.alternatives).map(([key, group]) => (
          <div id={`preview-${key}`} key={key}>
            <RecipeAlternatives group={group} />
          </div>
        ))}
      {recipe.tags.length > 0 && (
        <ul aria-label="Tags" className="flex flex-wrap gap-2">
          {recipe.tags.map((tag, index) => (
            <li className="pill" key={index}>
              {tag}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function RecipeCard({ recipe, favourite = false, favouritePending = false, onToggleFavourite, onDelete }) {
  return (
    <article className="recipe-card recipe-clickable-card panel flex min-w-0 flex-col gap-4 border-black p-5 text-black">
      <RecipeImage image={recipe.image} title={recipe.title} />
      <div>
        <div className="flex items-center justify-between gap-3"><span className="pill">{recipe.mealType}</span><RecipeFavouriteButton recipe={recipe} favourite={favourite} pending={favouritePending} onToggle={onToggleFavourite}/></div>
        <h2 className="mt-3 break-words text-2xl font-bold"><RecipeLink to={`/recipes/${recipe.slug}`} className="recipe-card-main-link">{recipe.title}</RecipeLink></h2>
      </div>
      {recipe.description && (
        <p className="line-clamp-2 text-sm leading-6 text-black/70">
          {recipe.description}
        </p>
      )}
      <RecipeCardNutrition recipe={recipe} />
      {(recipe.prepTime || recipe.cookTime) && <p className="text-sm text-black/70">
        {[
          recipe.prepTime && `Prep: ${recipe.prepTime}`,
          recipe.cookTime && `Cook: ${recipe.cookTime}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>}
      {onDelete && <div className="mt-auto flex flex-wrap gap-3">
          <button
            type="button"
            className={secondaryButton}
            disabled={favouritePending}
            onClick={() => onDelete(recipe)}
          >
            Delete
          </button>
      </div>}
    </article>
  );
}
