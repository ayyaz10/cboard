import { useRef, useState } from 'react';
import { getAppHref } from '../../app/useRoute';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import {
  parseRecipeBatch,
  assignBatchSlugs,
  MAX_BATCH_JSON_BYTES,
  recipeEditorData,
} from './recipeData';
import { RecipePage, secondaryButton } from './RecipeComponents';
import { RecipeImageUploader } from './RecipeImageUploader';
import { RecipeFormEditor, emptyRecipe } from './RecipeFormEditor';
import { generateRecipeImage, parseRecipeText, saveRecipe } from '../../services/recipeService';
import { RecipeJsonGuide } from './RecipeJsonGuide';

export function RecipeImporter({
  initial,
  editing = false,
  onSave,
  onSaveBatch,
  onCancel,
  getSlugs,
  onAiCreated,
  ingredientLibrary = [],
}) {
  const [text, setText] = useState(() => {
    if (!initial) return '';
    return JSON.stringify(recipeEditorData(initial), null, 2);
  });
  const [image, setImage] = useState(initial?.image ?? null);
  const [mode, setMode] = useState(editing ? 'form' : 'json');
  const [formData, setFormData] = useState(() => recipeEditorData(initial ?? emptyRecipe()));
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState(0);
  const [batchImages, setBatchImages] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [aiText, setAiText] = useState('');
  const [generateAiImage, setGenerateAiImage] = useState(false);
  const lock = useRef(false);
  async function generateDraftImage() {
    if (mode === 'form') return generateRecipeImage(formData.title);
    const recipes = parseRecipeBatch(text);
    if (recipes.length !== 1) throw new Error('Generate an AI image for one recipe at a time.');
    return generateRecipeImage(recipes[0].title);
  }
  async function createWithAi() {
    if (lock.current || !aiText.trim()) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let recipe = await parseRecipeText(aiText);
      let imageWarning = '';
      if (generateAiImage) {
        setNotice('Recipe saved. Generating its food image…');
        try {
          const generatedImage = await generateRecipeImage(recipe.title);
          recipe = await saveRecipe(recipe, generatedImage, { edit: true });
        } catch (imageError) {
          imageWarning = imageError.message || 'The recipe was saved, but its image could not be generated.';
        }
      }
      onAiCreated(recipe, imageWarning);
    } catch (error) {
      setError(error.message || 'Unable to parse recipe. Please try again.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function showPreview(event) {
    event.preventDefault();
    if (lock.current || imageBusy) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const parsed = parseRecipeBatch(
        mode === 'form'
          ? JSON.stringify(recipeEditorData(formData))
          : text,
      );
      if (editing && parsed.length !== 1)
        throw new Error(
          'Edit one recipe at a time. Use Add Recipe to import a batch.',
        );
      const recipe = parsed[0];
      if (editing && recipe.slug !== initial.slug)
        throw new Error(
          'Keep the original slug when editing so existing recipe links continue to work. Duplicate the recipe to use a new slug.',
        );
      const resolved = editing
        ? parsed
        : assignBatchSlugs(parsed, await getSlugs());
      const renamed = resolved.filter(
        (item, index) => item.slug !== parsed[index].slug,
      );
      if (renamed.length)
        setNotice(
          `Existing or repeated slugs were renamed: ${renamed.map((item) => item.slug).join(', ')}.`,
        );
      if (editing) {
        await onSave(resolved[0], image, true);
        return;
      }
      setPreview(
        resolved.map((item, index) => ({
          recipe: item,
          imageKey: `${index}:${JSON.stringify(parsed[index])}`,
        })),
      );
      setSelected(0);
    } catch (error) {
      setError(error.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function save() {
    if (lock.current || imageBusy) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (preview.length === 1) await onSave(preview[0].recipe, image, editing);
      else
        await onSaveBatch(
          preview.map((entry) => ({
            recipe: entry.recipe,
            image: batchImages[entry.imageKey] ?? null,
          })),
        );
    } catch (error) {
      setError(
        error.message ||
          'Could not save the recipe. Your data is still here; please try again.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function uploadJson(file) {
    if (!file) return;
    setError('');
    if (!file.name.toLowerCase().endsWith('.json')) {
      setError('Choose a .json file.');
      return;
    }
    if (file.size > MAX_BATCH_JSON_BYTES) {
      setError('Import JSON must be smaller than 2 MB.');
      return;
    }
    setBusy(true);
    try {
      setText(await file.text());
    } catch {
      setError('Could not open this file. Try pasting the JSON instead.');
    } finally {
      setBusy(false);
    }
  }
  function switchMode(next) {
    if (next === mode) return;
    setError('');
    if (next === 'json') {
      setText(
        JSON.stringify(recipeEditorData(formData), null, 2),
      );
    } else {
      try {
        const parsed = text.trim() ? parseRecipeBatch(text) : [emptyRecipe()];
        if (parsed.length !== 1)
          throw new Error(
            'The form edits one recipe at a time. Import the batch first, then open Edit Recipe for each meal.',
          );
        setFormData(parsed[0]);
      } catch (error) {
        setError(error.message);
        return;
      }
    }
    setMode(next);
  }
  return (
    <div className="space-y-6 text-black">
      <h1 className="text-3xl font-bold">
        {preview
          ? preview.length > 1
            ? `Preview ${preview.length} Recipes`
            : 'Preview Recipe'
          : editing
            ? 'Edit Recipe'
            : 'Add Recipe'}
      </h1>
      {error && (
        <p
          role="alert"
          className="rounded-2xl border-2 border-black bg-white p-4"
        >
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {preview ? (
        <>
          {preview.length > 1 && (
            <>
              <p className="text-sm text-black/70">
                Choose each recipe to review it and upload its image. Save All
                Recipes saves the entire batch together.
              </p>
              <div
                className="flex flex-wrap gap-2"
                aria-label="Recipes in this import"
              >
                {preview.map((entry, index) => (
                  <button
                    key={entry.imageKey}
                    className={secondaryButton}
                    aria-pressed={selected === index}
                    disabled={busy || imageBusy}
                    onClick={() => setSelected(index)}
                  >
                    {index + 1}. {entry.recipe.title}
                  </button>
                ))}
              </div>
              <p role="status" className="font-bold">
                Recipe {selected + 1} of {preview.length}:{' '}
                {preview[selected].recipe.title}
              </p>
              <RecipeImageUploader
                key={preview[selected].imageKey}
                image={batchImages[preview[selected].imageKey] ?? null}
                onChange={(value) =>
                  setBatchImages((current) => ({
                    ...current,
                    [preview[selected].imageKey]: value,
                  }))
                }
                onBusy={setImageBusy}
                onGenerate={() => generateRecipeImage(preview[selected].recipe.title)}
                disabled={busy}
              />
            </>
          )}
          <RecipePage
            recipe={{
              ...preview[selected].recipe,
              image:
                preview.length > 1
                  ? batchImages[preview[selected].imageKey]
                  : image,
            }}
            preview
          />
          <div className="flex flex-wrap gap-3">
            <PrimaryButton disabled={busy || imageBusy} onClick={save}>
              {busy
                ? 'Saving…'
                : preview.length > 1
                  ? `Save All ${preview.length} Recipes`
                  : 'Save Recipe'}
            </PrimaryButton>
            <button
              className={secondaryButton}
              disabled={busy || imageBusy}
              onClick={() => setPreview(null)}
            >
              Edit Data
            </button>
            <button
              className={secondaryButton}
              disabled={busy || imageBusy}
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={showPreview} className="space-y-6">
          {editing && <div className="flex flex-wrap gap-3">
            <PrimaryButton type="submit" disabled={busy || imageBusy}>
              {busy ? 'Saving…' : 'Save Recipe'}
            </PrimaryButton>
            <button type="button" className={secondaryButton} disabled={busy || imageBusy} onClick={onCancel}>Cancel</button>
          </div>}
          <fieldset disabled={busy || imageBusy} className="min-w-0 space-y-5">
            <div className="flex flex-wrap gap-3" aria-label="Editor mode">
              <button
                type="button"
                className={secondaryButton}
                aria-pressed={mode === 'form'}
                onClick={() => switchMode('form')}
              >
                Form editor
              </button>
              <button
                type="button"
                className={secondaryButton}
                aria-pressed={mode === 'json'}
                onClick={() => switchMode('json')}
              >
                JSON editor
              </button>
              {!editing && (
                <button
                  type="button"
                  className={secondaryButton}
                  aria-pressed={mode === 'ai'}
                  onClick={() => {
                    setMode('ai');
                    setError('');
                    setPreview(null);
                  }}
                >
                  AI text import
                </button>
              )}
            </div>
            {mode === 'ai' ? (
              <section className="space-y-4 rounded-2xl border-2 border-black bg-[#e9f8ff] p-5">
                <div>
                  <h2 className="text-2xl font-bold">Paste a recipe in your own words</h2>
                  <p className="mt-2 text-sm leading-6 text-black/70">
                    Include a title, cooking time, ingredients, and steps. The server securely parses and saves it to your account.
                  </p>
                </div>
                <label className="block font-bold" htmlFor="ai-recipe-text">Recipe text</label>
                <textarea
                  id="ai-recipe-text"
                  className="field-input min-h-64"
                  maxLength={2000}
                  required
                  value={aiText}
                  onChange={(event) => setAiText(event.target.value)}
                  placeholder="Chicken fried rice. Use 120g chicken, 160g cooked rice…"
                />
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-black/65">
                  <span>{aiText.length}/2000 characters</span>
                  <span>Includes a short ingredient review with green positives, red points to watch and suggested improvements. AI can make mistakes; check the saved recipe and report.</span>
                </div>
                <label className="flex !grid-cols-[auto_1fr] items-start gap-3 rounded-xl border-2 border-black bg-white p-3">
                  <input className="mt-1 !w-auto" type="checkbox" checked={generateAiImage} onChange={(event) => setGenerateAiImage(event.target.checked)} />
                  <span><strong className="block text-black">Generate a recipe image with AI</strong><span className="mt-1 block font-normal text-black/65">Creates a food photo after the recipe is saved. This uses the Cloudflare image allowance configured in Groceries settings; if generation fails, the recipe remains safely saved without an image.</span></span>
                </label>
                <PrimaryButton type="button" disabled={busy || !aiText.trim()} onClick={createWithAi}>
                  {busy ? (generateAiImage ? 'Creating recipe and image…' : 'Creating recipe…') : (generateAiImage ? 'Create recipe + image with AI' : 'Create recipe with AI')}
                </PrimaryButton>
              </section>
            ) : mode === 'form' ? (
              <RecipeFormEditor
                recipe={formData}
                onChange={setFormData}
                editing={editing}
                ingredientLibrary={ingredientLibrary}
                imageEditor={editing ? <RecipeImageUploader
                  image={image}
                  onChange={setImage}
                  onBusy={setImageBusy}
                  onGenerate={generateDraftImage}
                  disabled={busy}
                  compact
                /> : null}
              />
            ) : (
              <>
                {!editing && <RecipeJsonGuide />}
                <p className="leading-7 text-black/70">
                  Paste or upload one recipe object or an array of up to 20
                  recipes. For batches, add each recipe’s image in the preview.
                  JSON can be up to 2 MB total, with 256 KB per recipe.{' '}
                  <a
                    className="font-bold underline"
                    href={getAppHref('/recipes/recipe.schema.json')}
                    download
                  >
                    Download JSON schema
                  </a>{' '}
                  ·{' '}
                  <a
                    className="font-bold underline"
                    href={getAppHref('/recipes/greek-yogurt-oats.json')}
                    download
                  >
                    Example JSON
                  </a>
                  {' · '}
                  <a
                    className="font-bold underline"
                    href={getAppHref('/recipes/batch-example.json')}
                    download
                  >
                    Batch example JSON
                  </a>
                </p>
                <label className="block font-bold" htmlFor="recipe-json-file">
                  Upload JSON
                </label>
                <input
                  id="recipe-json-file"
                  className="field-input"
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => {
                    uploadJson(event.target.files[0]);
                    event.target.value = '';
                  }}
                />
                <label className="block font-bold" htmlFor="recipe-json">
                  Paste Recipe JSON
                </label>
                <textarea
                  id="recipe-json"
                  required
                  spellCheck={false}
                  className="field-input min-h-80 font-mono text-sm"
                  value={text ?? ''}
                  onChange={(event) => setText(event.target.value)}
                />
              </>
            )}
          </fieldset>
          {mode !== 'ai' && !(editing && mode === 'form') && <RecipeImageUploader
            image={image}
            onChange={setImage}
            onBusy={setImageBusy}
            onGenerate={generateDraftImage}
            disabled={busy}
            compact={editing}
          />}
          {mode !== 'ai' && <p className="text-sm text-black/70">
            {editing ? 'Upload a replacement image or remove the current one.' : 'The image above is for a single-recipe import. Batch imports have a separate image uploader for each recipe in the preview.'}
          </p>}
          <div className="flex flex-wrap gap-3">
            {mode !== 'ai' && <PrimaryButton type="submit" disabled={busy || imageBusy}>
              {busy ? (editing ? 'Saving…' : 'Checking…') : (editing ? 'Save Recipe' : 'Preview Recipe')}
            </PrimaryButton>}
            <button
              type="button"
              className={secondaryButton}
              disabled={busy || imageBusy}
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
