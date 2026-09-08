export const MAX_JSON_BYTES = 256 * 1024;

// Photos remain in the uploader state, never in the editable JSON document.
export function recipeEditorData(recipe) {
  const { image, updatedAt, ...data } = recipe;
  return { ...data, tags: (data.tags ?? []).map((tag) => tag.trim()).filter(Boolean) };
}
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const reservedSlugs = new Set(['manage', 'import']);
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function string(value, label, required = false, max = 4000) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || (required && !value.trim()))
    throw new Error(`${label} is missing or must be text.`);
  if (value.length > max)
    throw new Error(`${label} must be ${max} characters or fewer.`);
  return value.trim();
}

function number(value, label, positive = false) {
  if (value == null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (positive ? value <= 0 : value < 0)
  ) {
    throw new Error(
      `${label} must be a ${positive ? 'positive' : 'non-negative'} number.`,
    );
  }
  return value;
}

function list(value, label, required = false) {
  if (value == null && !required) return [];
  if (!Array.isArray(value) || (required && !value.length))
    throw new Error(
      `${label} must be ${required ? 'a non-empty' : 'an'} array.`,
    );
  if (value.length > 100)
    throw new Error(`${label} can contain at most 100 entries.`);
  return value;
}

function nutrition(value, label = 'Nutrition') {
  if (value == null) value = {};
  if (!object(value)) throw new Error(`${label} must be an object.`);
  return Object.fromEntries(
    ['calories', 'protein', 'carbs', 'fat'].map((key) => [
      key,
      number(value[key], `${label}: ${key}`),
    ]),
  );
}

function ingredient(value, label) {
  if (!object(value))
    throw new Error(`${label} must be an object with a name, amount and unit.`);
  const amount =
    typeof value.amount === 'string'
      ? string(value.amount, `${label} amount`, true, 80)
      : number(value.amount, `${label} amount`);
  return {
    name: string(value.name, `${label} name`, true, 200),
    amount,
    unit: string(value.unit, `${label} unit`, false, 80),
    note: string(value.note, `${label} note`),
    nutrition: nutrition(value.nutrition, `${label} nutrition`),
    ...(value.alternativeGroup != null
      ? {
          alternativeGroup: string(
            value.alternativeGroup,
            `${label} alternative group`,
            true,
            100,
          ),
        }
      : {}),
  };
}

export function slugify(title) {
  const slug =
    title
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100)
      .replace(/-$/, '') || 'recipe';
  return reservedSlugs.has(slug) ? `${slug}-recipe` : slug;
}

export function uniqueSlug(slug, existing) {
  let next = slug;
  let count = 2;
  while (existing.includes(next) || reservedSlugs.has(next)) {
    const suffix = `-${count++}`;
    next = `${slug.slice(0, 100 - suffix.length).replace(/-$/, '')}${suffix}`;
  }
  return next;
}

export function validateRecipe(data) {
  if (!object(data)) throw new Error('Paste one recipe JSON object.');
  if (data.schemaVersion != null && data.schemaVersion !== 1)
    throw new Error('Use recipe schemaVersion 1.');
  const title = string(data.title, 'Title', true, 200);
  const slug =
    data.slug == null || data.slug === ''
      ? slugify(title)
      : string(data.slug, 'Slug', true, 100);
  if (!SLUG_PATTERN.test(slug) || reservedSlugs.has(slug))
    throw new Error(
      'Slug must use lowercase letters, numbers and single hyphens; “manage” and “import” are reserved.',
    );
  const ingredients = list(data.ingredients, 'Ingredients', true).map(
    (item, index) => ingredient(item, `Ingredient #${index + 1}`),
  );
  if (data.alternatives != null && !object(data.alternatives))
    throw new Error('Alternatives must be an object of named groups.');
  const groups = Object.entries(data.alternatives ?? {});
  if (groups.length > 100)
    throw new Error('Use at most 100 alternative groups.');
  const alternatives = Object.fromEntries(
    groups.map(([key, group]) => {
      if (
        !SLUG_PATTERN.test(key) ||
        ['constructor', 'prototype', '__proto__'].includes(key)
      )
        throw new Error(
          'Alternative group keys must use lowercase letters, numbers and hyphens.',
        );
      if (!object(group))
        throw new Error(`Alternative group “${key}” must be an object.`);
      return [
        key,
        {
          title: string(
            group.title,
            `Alternative group “${key}” title`,
            true,
            200,
          ),
          options: list(
            group.options,
            `Alternative group “${key}” options`,
            true,
          ).map((item, index) => {
            const option = ingredient(
              item,
              `Alternative “${key}” #${index + 1}`,
            );
            delete option.alternativeGroup;
            return option;
          }),
        },
      ];
    }),
  );
  for (const item of ingredients) {
    if (
      item.alternativeGroup &&
      !Object.hasOwn(alternatives, item.alternativeGroup)
    )
      throw new Error(
        `“${item.name}” refers to missing alternatives “${item.alternativeGroup}”.`,
      );
  }
  return {
    schemaVersion: 1,
    source: validateRecipeSource(data.source),
    title,
    slug,
    mealType: string(data.mealType, 'Meal type', true, 100),
    description: string(data.description, 'Description'),
    nutrition: nutrition(data.nutrition),
    prepTime: string(data.prepTime, 'Prep time', false, 100) || null,
    cookTime: string(data.cookTime, 'Cooking time', false, 100) || null,
    servings: number(data.servings, 'Servings', true),
    ingredients,
    steps: list(data.steps, 'Steps', true).map((step, index) =>
      string(step, `Step #${index + 1}`, true),
    ),
    sauces: list(data.sauces, 'Sauces').map((sauce, index) =>
      ingredient(
        typeof sauce === 'string' ? { name: sauce } : sauce,
        `Sauce #${index + 1}`,
      ),
    ),
    alternatives,
    tags: list(data.tags, 'Tags').map((tag, index) =>
      string(tag, `Tag #${index + 1}`, true, 100),
    ),
  };
}

export function validateRecipeSource(value) {
  if (value == null) return null;
  if (!object(value))
    throw new Error('Recipe source must be an object with a URL.');
  const raw = string(value.url, 'Recipe source URL', true, 2000);
  const markdown = raw.match(/^\[[^\]]*\]\((https?:\/\/[^\s]+)\)$/i);
  let url;
  try {
    url = new URL(markdown ? markdown[1] : raw);
  } catch {
    throw new Error(
      'Recipe source URL must be a complete http:// or https:// link.',
    );
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      'Recipe source URL must be an http:// or https:// link without login details.',
    );
  if (
    value.showOnRecipeCard != null &&
    typeof value.showOnRecipeCard !== 'boolean'
  )
    throw new Error('Source showOnRecipeCard must be true or false.');
  return {
    type: string(value.type, 'Recipe source type', false, 100) || 'website',
    label:
      string(value.label, 'Recipe source label', false, 200) ||
      'Original recipe',
    url: url.href,
    showOnRecipeCard: value.showOnRecipeCard ?? false,
  };
}

export function parseRecipe(text) {
  if (new TextEncoder().encode(text).length > MAX_JSON_BYTES)
    throw new Error(
      'Recipe JSON must be smaller than 256 KB. Upload the image separately.',
    );
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      'Could not read the JSON. Paste one complete object with double quotes, no trailing commas, and no Markdown code fences.',
    );
  }
  return validateRecipe(data);
}

export const MAX_BATCH_RECIPES = 20;
export const MAX_BATCH_JSON_BYTES = 2 * 1024 * 1024;

export function parseRecipeBatch(text) {
  if (new TextEncoder().encode(text).length > MAX_BATCH_JSON_BYTES)
    throw new Error(
      'Import JSON must be smaller than 2 MB. Upload images separately.',
    );
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      'Could not read the JSON. Paste a recipe object or an array of recipe objects with double quotes, no trailing commas, and no Markdown fences.',
    );
  }
  const entries = Array.isArray(data) ? data : [data];
  if (!entries.length || entries.length > MAX_BATCH_RECIPES)
    throw new Error(
      `Import between 1 and ${MAX_BATCH_RECIPES} recipes at a time.`,
    );
  return entries.map((entry, index) => {
    try {
      return parseRecipe(JSON.stringify(entry));
    } catch (error) {
      throw new Error(`Recipe #${index + 1}: ${error.message}`);
    }
  });
}

export function assignBatchSlugs(recipes, existingSlugs) {
  const used = [...existingSlugs];
  return recipes.map((recipe) => {
    const slug = uniqueSlug(recipe.slug, used);
    used.push(slug);
    return { ...recipe, slug };
  });
}

export function formatIngredient(item) {
  return [item.amount, item.unit, item.name]
    .filter((part) => part !== null && part !== undefined && part !== '')
    .join(' ');
}
