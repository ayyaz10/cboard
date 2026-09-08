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

export function RecipeImporter({
  initial,
  editing = false,
  onSave,
  onSaveBatch,
  onCancel,
  getSlugs,
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
  const lock = useRef(false);
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
          <p className="text-sm text-black/70">
            Review your recipe and alternatives before saving. Nutrition values
            are as imported.
          </p>
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
            </div>
            {mode === 'form' ? (
              <RecipeFormEditor
                recipe={formData}
                onChange={setFormData}
                editing={editing}
              />
            ) : (
              <>
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
          <RecipeImageUploader
            image={image}
            onChange={setImage}
            onBusy={setImageBusy}
            disabled={busy}
          />
          <p className="text-sm text-black/70">
            The image above is for a single-recipe import. Batch imports have a
            separate image uploader for each recipe in the preview.
          </p>
          <div className="flex flex-wrap gap-3">
            <PrimaryButton type="submit" disabled={busy || imageBusy}>
              {busy ? 'Checking…' : 'Preview Recipe'}
            </PrimaryButton>
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
