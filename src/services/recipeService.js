import { getUserScopedClient, assertSupabaseResult } from './supabaseCrud';
import {
  validateRecipe,
  MAX_BATCH_RECIPES,
} from '../features/recipes/recipeData';
import { isRecipeImage } from '../features/recipes/recipeImage';

const PREFIX = 'recipe:v1:';

// One row per recipe reuses CBoard's existing user-scoped JSONB persistence.
// The existing (user_id, key) unique constraint also protects concurrent imports.
export async function getRecipes() {
  const { client, userId } = await getUserScopedClient();
  const rows = [];
  for (let from = 0; ; from += 100) {
    const result = await client
      .from('user_tool_preferences')
      .select('key,value,updated_at')
      .eq('user_id', userId)
      .like('key', `${PREFIX}%`)
      .order('key')
      .range(from, from + 99);
    assertSupabaseResult(result);
    rows.push(...result.data);
    if (result.data.length < 100) break;
  }
  return rows.map((row) => ({
    ...validateRecipe(row.value.recipe),
    image: isRecipeImage(row.value.image) ? row.value.image : null,
    updatedAt: row.updated_at,
  }));
}

export async function saveRecipe(recipe, image, { edit = false } = {}) {
  const clean = validateRecipe(recipe);
  if (image && !isRecipeImage(image))
    throw new Error('Please upload a valid recipe image.');
  const { client, userId } = await getUserScopedClient();
  const payload = {
    user_id: userId,
    key: `${PREFIX}${clean.slug}`,
    value: { recipe: clean, image: image || null },
    updated_at: new Date().toISOString(),
  };
  const query = edit
    ? client
        .from('user_tool_preferences')
        .update({ value: payload.value, updated_at: payload.updated_at })
        .eq('user_id', userId)
        .eq('key', payload.key)
    : client.from('user_tool_preferences').insert(payload);
  const result = await query.select('key').single();
  if (result.error?.code === '23505')
    throw new Error(
      'This recipe slug was just used by another save. Edit Data and preview again to choose a unique slug.',
    );
  assertSupabaseResult(result);
  return { ...clean, image: image || null, updatedAt: payload.updated_at };
}

export async function deleteRecipe(slug) {
  const { client, userId } = await getUserScopedClient();
  const result = await client
    .from('user_tool_preferences')
    .delete()
    .eq('user_id', userId)
    .eq('key', `${PREFIX}${slug}`);
  assertSupabaseResult(result);
}

export async function saveRecipeBatch(entries) {
  if (
    !Array.isArray(entries) ||
    !entries.length ||
    entries.length > MAX_BATCH_RECIPES
  )
    throw new Error(
      `Import between 1 and ${MAX_BATCH_RECIPES} recipes at a time.`,
    );
  const clean = entries.map(({ recipe, image }, index) => {
    if (image && !isRecipeImage(image))
      throw new Error(`Recipe #${index + 1}: please upload a valid image.`);
    return { recipe: validateRecipe(recipe), image: image || null };
  });
  if (new Set(clean.map(({ recipe }) => recipe.slug)).size !== clean.length)
    throw new Error(
      'Duplicate slugs in this batch. Edit Data and preview again.',
    );
  if (new TextEncoder().encode(JSON.stringify(clean)).length > 12 * 1024 * 1024)
    throw new Error(
      'This batch is over 12 MB including images. Use smaller images or import fewer recipes at a time.',
    );
  const { client, userId } = await getUserScopedClient();
  const updatedAt = new Date().toISOString();
  const payload = clean.map((value) => ({
    user_id: userId,
    key: `${PREFIX}${value.recipe.slug}`,
    value,
    updated_at: updatedAt,
  }));
  // A single INSERT is atomic: a conflicting slug cannot leave a partial batch.
  const result = await client
    .from('user_tool_preferences')
    .insert(payload)
    .select('key');
  if (result.error?.code === '23505')
    throw new Error(
      'A recipe slug was just used by another save. No recipes in this batch were saved. Edit Data and preview again.',
    );
  assertSupabaseResult(result);
  return clean.map(({ recipe, image }) => ({ ...recipe, image, updatedAt }));
}
