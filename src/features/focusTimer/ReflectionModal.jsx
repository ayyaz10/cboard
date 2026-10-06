import { useEffect, useState } from 'react';

export function ReflectionModal({
  isOpen,
  session,
  onSaveReflection,
  onClose,
  isSaving = false,
}) {
  const [reflectionResult, setReflectionResult] = useState('');
  const [distractionLevel, setDistractionLevel] = useState('');
  const [energyLevel, setEnergyLevel] = useState('');
  const [reflectionNote, setReflectionNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setReflectionResult(session?.reflectionResult || '');
    setDistractionLevel(session?.distractionLevel ? String(session.distractionLevel) : '');
    setEnergyLevel(session?.energyLevel ? String(session.energyLevel) : '');
    setReflectionNote(session?.reflectionNote || '');
    setError('');
  }, [session]);

  if (!isOpen || !session) {
    return null;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const parsedDistraction = distractionLevel === '' ? null : Number(distractionLevel);
    const parsedEnergy = energyLevel === '' ? null : Number(energyLevel);

    if (parsedDistraction !== null && (!Number.isFinite(parsedDistraction) || parsedDistraction < 1 || parsedDistraction > 5)) {
      setError('Distraction level must be between 1 and 5.');
      return;
    }

    if (parsedEnergy !== null && (!Number.isFinite(parsedEnergy) || parsedEnergy < 1 || parsedEnergy > 5)) {
      setError('Energy level must be between 1 and 5.');
      return;
    }

    try {
      await onSaveReflection({
        reflectionResult,
        distractionLevel: parsedDistraction,
        energyLevel: parsedEnergy,
        reflectionNote,
      });
      setError('');
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  return (
    <div
      className="ui-overlay fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
      role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reflection-title"
        className="ui-dialog max-h-[92vh] w-full max-w-2xl overflow-y-auto p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="pill">Reflection</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close reflection"
            className="ui-button ui-button--sm h-8 w-8 p-0 text-lg leading-none"
          >
            ×
          </button>
        </div>

        <h2
          id="reflection-title"
          className="mt-5 text-3xl font-bold tracking-[-0.05em] text-[var(--color-text)]"
        >
          Session reflection
        </h2>

        <div className="mt-5 grid gap-4">
          <div>
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
              Did you complete your intention?
            </span>
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                ['yes', 'Yes'],
                ['partially', 'Partially'],
                ['no', 'No'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setReflectionResult(value)}
                  aria-pressed={reflectionResult === value}
                  className="ui-button ui-button--sm uppercase tracking-[0.12em]"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label>
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
                Distraction level
              </span>
              <input
                className="field-input"
                type="number"
                min="1"
                max="5"
                value={distractionLevel}
                onChange={(event) => setDistractionLevel(event.target.value)}
                placeholder="1-5"
              />
            </label>

            <label>
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
                Mood / energy level
              </span>
              <input
                className="field-input"
                type="number"
                min="1"
                max="5"
                value={energyLevel}
                onChange={(event) => setEnergyLevel(event.target.value)}
                placeholder="1-5"
              />
            </label>
          </div>

          <label>
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
              Session note
            </span>
            <textarea
              className="field-input min-h-32 resize-y"
              value={reflectionNote}
              onChange={(event) => setReflectionNote(event.target.value)}
              placeholder="What happened during this session?"
            />
          </label>
        </div>

        {error ? (
          <p className="ui-badge ui-badge--danger mt-4 block rounded-[var(--radius-md)] px-4 py-3 text-sm">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="ui-button uppercase tracking-[0.12em]"
          >
            Later
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="ui-button ui-button--primary uppercase tracking-[0.12em]"
          >
            {isSaving ? 'Saving...' : 'Save reflection'}
          </button>
        </div>
      </form>
    </div>
  );
}
