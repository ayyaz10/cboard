import { getAppHref, navigateTo } from '../../app/useRoute';
import { formatIngredient } from './recipeData';
import { RecipeSource } from './RecipeSource';
import { useRecipeCardGrid } from './RecipeCardView';

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
      className={`w-full rounded-[1.35rem] object-cover ${large ? 'max-h-[30rem] aspect-[16/9]' : 'aspect-[4/3]'}`}
    />
  ) : (
    <div
      className={`recipe-image-placeholder flex items-center justify-center rounded-[1.35rem] border-2 border-black bg-white text-sm font-semibold text-black/55 ${large ? 'h-48' : 'aspect-[4/3]'}`}
    >
      No recipe image yet
    </div>
  );
}

export function RecipeNutrition({ nutrition = {} }) {
  const values = [
    ['calories', 'kcal'],
    ['protein', 'g protein'],
    ['carbs', 'g carbs'],
    ['fat', 'g fat'],
  ].filter(([key]) => nutrition[key] != null);
  return values.length ? (
    <dl className="flex flex-wrap gap-3">
      {values.map(([key, unit]) => (
        <div
          key={key}
          className="rounded-2xl border-2 border-black bg-white px-4 py-3 text-black"
        >
          <dt className="text-xs capitalize text-black/70">{key}</dt>
          <dd className="font-bold">
            {nutrition[key]} {unit}
          </dd>
        </div>
      ))}
    </dl>
  ) : (
    <p className="text-sm text-black/55">Nutrition not provided.</p>
  );
}

export function RecipeAlternatives({ group }) {
  const cardGrid = useRecipeCardGrid();
  return (
    <section className="space-y-4">
      <h2 className="text-2xl font-bold">{group.title}</h2>
      <ul className={cardGrid}>
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
      </ul>
    </section>
  );
}

export function IngredientList({ recipe, preview = false }) {
  return (
    <section>
      <h2 className="text-2xl font-bold">Ingredients</h2>
      <ul className="mt-4 space-y-3">
        {recipe.ingredients.map((item, index) => (
          <li
            key={index}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-black bg-white p-4"
          >
            <div>
              <p className="font-semibold">{formatIngredient(item)}</p>
              {item.note && (
                <p className="mt-1 text-sm text-black/70">{item.note}</p>
              )}
            </div>
            {item.alternativeGroup &&
              (preview ? (
                <a
                  className="font-bold underline underline-offset-4"
                  href={`#preview-${item.alternativeGroup}`}
                >
                  View Alternatives →
                </a>
              ) : (
                <RecipeLink
                  to={`/recipes/${recipe.slug}/alternatives/${item.alternativeGroup}`}
                >
                  View Alternatives →
                </RecipeLink>
              ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RecipeSteps({ steps }) {
  return (
    <section>
      <h2 className="text-2xl font-bold">How to make it</h2>
      <ol className="mt-4 space-y-4">
        {steps.map((step, index) => (
          <li key={index} className="flex gap-4 leading-7">
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

export function RecipePage({ recipe, preview = false }) {
  return (
    <article className="space-y-7 break-words text-black">
      <RecipeImage image={recipe.image} title={recipe.title} large />
      <header className="space-y-3">
        <span className="pill">{recipe.mealType}</span>
        <h1 className="text-3xl font-bold tracking-[-0.04em] sm:text-5xl">
          {recipe.title}
        </h1>
        {recipe.description && (
          <p className="max-w-3xl leading-7 text-black/70">
            {recipe.description}
          </p>
        )}
      </header>
      <RecipeSource source={recipe.source} linkClassName={secondaryButton} />
      <RecipeNutrition nutrition={recipe.nutrition} />
      <dl className="flex flex-wrap gap-6">
        {[
          ['Prep time', recipe.prepTime],
          ['Cooking time', recipe.cookTime],
          ['Servings', recipe.servings],
        ]
          .filter(([, value]) => value != null && value !== '')
          .map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm text-black/70">{label}</dt>
              <dd className="font-bold">{value}</dd>
            </div>
          ))}
      </dl>
      <IngredientList recipe={recipe} preview={preview} />
      <RecipeSteps steps={recipe.steps} />
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

export function RecipeCard({ recipe }) {
  return (
    <article className="recipe-card panel flex min-w-0 flex-col gap-4 border-black p-5 text-black">
      <RecipeImage image={recipe.image} title={recipe.title} />
      <div>
        <span className="pill">{recipe.mealType}</span>
        <h2 className="mt-3 break-words text-2xl font-bold">{recipe.title}</h2>
      </div>
      {recipe.description && (
        <p className="line-clamp-3 text-sm leading-6 text-black/70">
          {recipe.description}
        </p>
      )}
      <RecipeNutrition nutrition={recipe.nutrition} />
      <p className="text-sm text-black/70">
        {[
          recipe.prepTime && `Prep: ${recipe.prepTime}`,
          recipe.cookTime && `Cook: ${recipe.cookTime}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <div className="mt-auto flex flex-wrap gap-3">
        <RecipeLink to={`/recipes/${recipe.slug}`}>View Recipe →</RecipeLink>
        <RecipeSource
          source={recipe.source}
          linkClassName={secondaryButton}
          compact
        />
      </div>
    </article>
  );
}
