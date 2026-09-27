import { useRef, useState } from 'react';
import { readRecipeImage } from './recipeImage';
import { RecipeImage, secondaryButton } from './RecipeComponents';

export function RecipeImageUploader({
  image,
  onChange,
  onBusy,
  onGenerate,
  disabled = false,
  compact = false,
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const reading = useRef(false);
  async function upload(file) {
    if (!file || reading.current || disabled) return;
    reading.current = true;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      onChange(await readRecipeImage(file));
    } catch (error) {
      setError(error.message);
    } finally {
      reading.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  async function generate() {
    if (!onGenerate || reading.current || disabled) return;
    reading.current = true;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      onChange(await onGenerate());
    } catch (error) {
      setError(error.message || 'Could not generate a recipe image. Please try again.');
    } finally {
      reading.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section
      className="space-y-4 rounded-2xl border-2 border-dashed border-black p-5"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        upload(event.dataTransfer.files[0]);
      }}
    >
      <label className="block font-bold" htmlFor="recipe-image">
        Upload Recipe Image
      </label>
      <p className="text-sm text-black/70">
        Choose a file or drop it here. JPG, PNG or WebP, up to 5 MB. Images are
        resized to fit your library.
      </p>
      <input
        id="recipe-image"
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        disabled={busy || disabled}
        onChange={(event) => {
          upload(event.target.files[0]);
          event.target.value = '';
        }}
        className="field-input"
      />
      {onGenerate && <button type="button" className={secondaryButton} disabled={busy || disabled} onClick={generate}>
        {busy ? 'Preparing image…' : 'Generate image with AI'}
      </button>}
      {busy && <p role="status">Preparing image…</p>}
      {error && <p role="alert">{error}</p>}
      {image && (
        <div className={compact ? 'max-w-xs space-y-3' : 'space-y-3'}>
          <RecipeImage image={image} title="Recipe image preview" large />
          <button
            type="button"
            className={secondaryButton}
            disabled={busy || disabled}
            onClick={() => onChange(null)}
          >
            Remove image
          </button>
        </div>
      )}
    </section>
  );
}
