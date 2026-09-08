import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseRecipe,
  validateRecipe,
  slugify,
  uniqueSlug,
  formatIngredient,
} from './recipeData.js';
import { isRecipeImage, readRecipeImage } from './recipeImage.js';
import { validateRecipeSource } from './recipeData.js';
import { recipeEditorData } from './recipeData.js';

test('editing a recipe with a large saved photo excludes image bytes from JSON limits', () => {
  const stored = { ...example, image: `data:image/webp;base64,${'A'.repeat(900000)}`, updatedAt: '2026-09-08', tags: [' breakfast ', ''] };
  const editable = recipeEditorData(stored);
  assert.equal(editable.image, undefined);
  assert.equal(editable.updatedAt, undefined);
  assert.deepEqual(editable.tags, ['breakfast']);
  assert.equal(parseRecipeBatch(JSON.stringify(editable))[0].title, example.title);
  assert.equal(stored.image.length > 262144, true);
  assert.equal(stored.tags[0], ' breakfast ');
});

test('recipe sources normalize Markdown URLs and persist through validation', () => {
  const url = 'https://youtu.be/PXub4lr-9J8?si=BezeVek1HJWp7EUR';
  const source = {
    type: 'youtube',
    label: 'Original Recipe Video',
    url: `[${url}](${url})`,
    showOnRecipeCard: true,
  };
  const recipe = validateRecipe({ ...example, source });
  assert.equal(recipe.source.url, url);
  assert.equal(recipe.source.showOnRecipeCard, true);
  assert.deepEqual(parseRecipe(JSON.stringify(recipe)), recipe);
  assert.equal(validateRecipeSource(null), null);
  assert.equal(validateRecipeSource({ url }).showOnRecipeCard, false);
});

test('recipe sources reject unsafe links and invalid configuration', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,evil',
    '/relative',
    'https://user:password@example.com',
    '[video](javascript:alert(1))',
  ]) {
    assert.throws(() => validateRecipeSource({ url }), /source URL/);
  }
  assert.throws(
    () =>
      validateRecipeSource({
        url: 'https://example.com',
        showOnRecipeCard: 'true',
      }),
    /true or false/,
  );
});
import { parseRecipeBatch, assignBatchSlugs } from './recipeData.js';

test('batch import accepts single objects and arrays and identifies invalid recipe indexes', () => {
  const source = readFileSync(
    new URL('../../../public/recipes/batch-example.json', import.meta.url),
    'utf8',
  );
  const parsed = parseRecipeBatch(source);
  assert.equal(parsed.length, 2);
  assert.equal(parseRecipeBatch(JSON.stringify(parsed[0])).length, 1);
  assert.throws(
    () => parseRecipeBatch(JSON.stringify([parsed[0], { title: 'Broken' }])),
    /Recipe #2/,
  );
  assert.throws(() => parseRecipeBatch('[]'), /between 1 and 20/);
  assert.throws(
    () => parseRecipeBatch(JSON.stringify(Array(21).fill(parsed[0]))),
    /between 1 and 20/,
  );
  assert.throws(() => parseRecipeBatch('[{'), /Could not read/);
  assert.throws(
    () => parseRecipeBatch(' '.repeat(2 * 1024 * 1024 + 1)),
    /2 MB/,
  );
  assert.throws(
    () =>
      parseRecipeBatch(
        JSON.stringify([{ ...parsed[0], ignored: 'a'.repeat(262144) }]),
      ),
    /Recipe #1.*256 KB/,
  );
});

test('batch slugs are unique within the batch and against existing records', () => {
  const input = [
    { slug: 'oats', title: 'A' },
    { slug: 'oats', title: 'B' },
    { slug: 'oats-2', title: 'C' },
  ];
  const resolved = assignBatchSlugs(input, ['oats', 'oats-3']);
  assert.deepEqual(
    resolved.map((recipe) => recipe.slug),
    ['oats-2', 'oats-4', 'oats-2-2'],
  );
  assert.equal(input[0].slug, 'oats');
});

const example = JSON.parse(
  readFileSync(
    new URL('../../../public/recipes/greek-yogurt-oats.json', import.meta.url),
  ),
);

test('both starter recipes validate and survive a serialization round trip', () => {
  for (const file of ['greek-yogurt-oats', 'egg-fried-rice']) {
    const recipe = parseRecipe(
      readFileSync(
        new URL(`../../../public/recipes/${file}.json`, import.meta.url),
        'utf8',
      ),
    );
    assert.deepEqual(parseRecipe(JSON.stringify(recipe)), recipe);
    assert.equal(recipe.nutrition.calories, null);
  }
});
test('required fields and nested errors are actionable', () => {
  for (const key of ['title', 'mealType', 'ingredients', 'steps']) {
    const data = structuredClone(example);
    delete data[key];
    assert.throws(() => validateRecipe(data), /missing|non-empty/);
  }
  const data = structuredClone(example);
  delete data.ingredients[2].name;
  assert.throws(() => validateRecipe(data), /Ingredient #3 name/);
  assert.throws(() => validateRecipe({ ...example, steps: [{}] }), /Step #1/);
  assert.throws(
    () => validateRecipe({ ...example, ingredients: [] }),
    /non-empty/,
  );
});
test('malformed, oversized, and unsupported documents are rejected', () => {
  assert.throws(() => parseRecipe('{'), /Could not read the JSON/);
  assert.throws(() => parseRecipe(' '.repeat(262145)), /256 KB/);
  assert.throws(() => validateRecipe([]), /one recipe/);
  assert.throws(
    () => validateRecipe({ ...example, schemaVersion: 2 }),
    /schemaVersion 1/,
  );
});
test('slugs are route-safe and duplicates get safe suffixes', () => {
  assert.equal(slugify('Crème Oats!'), 'creme-oats');
  assert.equal(slugify('manage'), 'manage-recipe');
  assert.equal(uniqueSlug('oats', ['oats', 'oats-2']), 'oats-3');
  assert.equal(uniqueSlug('a'.repeat(100), ['a'.repeat(100)]).length, 100);
  assert.equal(
    validateRecipe({ ...example, slug: undefined }).slug,
    'greek-yogurt-oats',
  );
  for (const slug of ['manage', 'import', '../oats', 'a/b', 'CAPS'])
    assert.throws(() => validateRecipe({ ...example, slug }), /Slug/);
});
test('nutrition preserves unknowns and zero, rejecting strings and negatives', () => {
  assert.equal(
    validateRecipe({ ...example, nutrition: { fat: 0 } }).nutrition.fat,
    0,
  );
  for (const value of [-2, '550', Infinity])
    assert.throws(
      () => validateRecipe({ ...example, nutrition: { calories: value } }),
      /number/,
    );
  assert.throws(() => validateRecipe({ ...example, servings: 0 }), /positive/);
});
test('alternatives require valid references and block prototype keys', () => {
  assert.throws(
    () => validateRecipe({ ...example, alternatives: {} }),
    /missing alternatives/,
  );
  assert.throws(
    () =>
      validateRecipe({
        ...example,
        alternatives: { banana: { title: 'Fruit', options: [] } },
      }),
    /non-empty/,
  );
  assert.throws(
    () =>
      validateRecipe({
        ...example,
        alternatives: JSON.parse('{"__proto__": {}}'),
      }),
    /group keys/,
  );
  assert.equal({}.polluted, undefined);
});
test('plain text is retained while executable and storage fields are discarded', () => {
  const recipe = validateRecipe({
    ...example,
    title: '<script>alert(1)</script>',
    image: 'javascript:alert(1)',
    user_id: 'someone',
    onClick: 'evil',
  });
  assert.equal(recipe.title, '<script>alert(1)</script>');
  assert.equal(recipe.image, undefined);
  assert.equal(recipe.user_id, undefined);
  assert.equal(recipe.onClick, undefined);
  assert.equal(
    formatIngredient({ name: 'Beef', amount: '142 g / 5', unit: 'oz' }),
    '142 g / 5 oz Beef',
  );
});
test('image checks reject active content, oversized data and forged files', async () => {
  for (const value of [
    'javascript:alert(1)',
    'data:image/svg+xml;base64,abcd',
    'https://example.com/img.jpg',
    `data:image/png;base64,${'a'.repeat(1400000)}`,
  ])
    assert.equal(isRecipeImage(value), false);
  await assert.rejects(
    readRecipeImage(
      new File(['not an image'], 'fake.jpg', { type: 'image/jpeg' }),
    ),
    /contents/,
  );
  await assert.rejects(
    readRecipeImage(
      new File(['<svg/>'], 'photo.svg', { type: 'image/svg+xml' }),
    ),
    /JPG/,
  );
});
