import { useState } from 'react';

const focusPresets = [25, 30, 50, 60];
const breakPresets = [5, 10, 15];
const defaultBreakTasks = [
  '20-20-20 eyes',
  'Drink water',
  'Stretch',
  '20 pushups',
];

function PresetButton({ children, isActive, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={`ui-button ui-button--sm text-xs uppercase tracking-[0.12em] ${isActive ? 'is-active' : ''}`}
    >
      {children}
    </button>
  );
}

export function FocusSessionForm({ onCreateSession, isSaving = false }) {
  const [form, setForm] = useState({
    title: '',
    focusMinutes: '25',
    breakMinutes: '5',
    taskDetails: '',
    intention: '',
  });
  const [breakTasks, setBreakTasks] = useState(defaultBreakTasks);
  const [nextTask, setNextTask] = useState('');
  const [error, setError] = useState('');

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function addBreakTask() {
    const task = nextTask.trim();

    if (!task) {
      return;
    }

    setBreakTasks((current) => [...current, task]);
    setNextTask('');
  }

  function removeBreakTask(indexToRemove) {
    setBreakTasks((current) => current.filter((_, index) => index !== indexToRemove));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const focusMinutes = Number.parseInt(form.focusMinutes, 10);
    const breakMinutes = Number.parseInt(form.breakMinutes || '0', 10);

    if (!form.title.trim()) {
      setError('Add a title before starting.');
      return;
    }

    if (!Number.isFinite(focusMinutes) || focusMinutes <= 0) {
      setError('Focus duration must be greater than 0.');
      return;
    }

    if (!Number.isFinite(breakMinutes) || breakMinutes < 0) {
      setError('Break duration cannot be negative.');
      return;
    }

    try {
      await onCreateSession({
        ...form,
        title: form.title.trim(),
        focusMinutes,
        breakMinutes,
        taskDetails: form.taskDetails.trim(),
        intention: form.intention.trim(),
        breakTasks: breakTasks.filter((task) => task.trim()),
      });

      setForm({
        title: '',
        focusMinutes: '25',
        breakMinutes: '5',
        taskDetails: '',
        intention: '',
      });
      setBreakTasks(defaultBreakTasks);
      setError('');
    } catch (createError) {
      setError(createError.message);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="ui-panel p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            Focus Timer
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-[var(--color-text)]">
            Start a focus session
          </h2>
        </div>
        <span className="ui-badge text-xs uppercase tracking-[0.14em]">
          Timestamped
        </span>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="block md:col-span-2">
          <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
            Title
          </span>
          <input
            className="field-input"
            value={form.title}
            onChange={(event) => updateField('title', event.target.value)}
            placeholder="Deep work, writing, study..."
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
            Focus duration
          </span>
          <input
            className="field-input"
            type="number"
            min="1"
            inputMode="numeric"
            value={form.focusMinutes}
            onChange={(event) => updateField('focusMinutes', event.target.value)}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {focusPresets.map((minutes) => (
              <PresetButton
                key={minutes}
                isActive={Number(form.focusMinutes) === minutes}
                onClick={() => updateField('focusMinutes', String(minutes))}
              >
                {minutes} min
              </PresetButton>
            ))}
          </div>
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
            Break duration
          </span>
          <input
            className="field-input"
            type="number"
            min="0"
            inputMode="numeric"
            value={form.breakMinutes}
            onChange={(event) => updateField('breakMinutes', event.target.value)}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {breakPresets.map((minutes) => (
              <PresetButton
                key={minutes}
                isActive={Number(form.breakMinutes) === minutes}
                onClick={() => updateField('breakMinutes', String(minutes))}
              >
                {minutes} min
              </PresetButton>
            ))}
          </div>
        </label>

        <label className="block md:col-span-2">
          <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
            Task details / notebook
          </span>
          <textarea
            className="field-input min-h-28 resize-y"
            value={form.taskDetails}
            onChange={(event) => updateField('taskDetails', event.target.value)}
            placeholder="What will you work on?"
          />
        </label>

        <label className="block md:col-span-2">
          <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
            Before-start intention
          </span>
          <textarea
            className="field-input min-h-24 resize-y"
            value={form.intention}
            onChange={(event) => updateField('intention', event.target.value)}
            placeholder="What will you complete in this session?"
          />
        </label>
      </div>

      <div className="ui-card mt-5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            Break checklist
          </p>
          <span className="ui-badge text-xs uppercase tracking-[0.12em]">
            {breakTasks.length} tasks
          </span>
        </div>

        <div className="mt-3 grid gap-2">
          {breakTasks.map((task, index) => (
            <div
              key={`${task}-${index}`}
              className="ui-card flex items-center justify-between gap-3 px-3 py-2"
            >
              <span className="text-sm font-bold text-[var(--color-text)]">{task}</span>
              <button
                type="button"
                onClick={() => removeBreakTask(index)}
                className="ui-button ui-button--danger ui-button--sm text-xs uppercase tracking-[0.12em]"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            className="field-input"
            value={nextTask}
            onChange={(event) => setNextTask(event.target.value)}
            placeholder="Add break task"
          />
          <button
            type="button"
            onClick={addBreakTask}
            className="ui-button ui-button--sm text-xs uppercase tracking-[0.12em]"
          >
            Add task
          </button>
        </div>
      </div>

      {error ? (
        <p className="ui-badge ui-badge--danger mt-4 block rounded-[var(--radius-md)] px-4 py-3 text-sm">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isSaving}
        className="ui-button ui-button--primary mt-6 w-full uppercase tracking-[0.12em]"
      >
        {isSaving ? 'Starting...' : 'Start focus'}
      </button>
    </form>
  );
}
