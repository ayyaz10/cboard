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
      className={`rounded-full border-2 border-black px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-black transition ${
        isActive ? 'bg-[#c5ff6f] shadow-[3px_3px_0_#000]' : 'bg-white hover:bg-[#fffdf8]'
      }`}
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
      className="rounded-[1.75rem] border-2 border-black bg-[#c5ff6f] p-5 shadow-[5px_5px_0_#000] sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
            Focus Timer
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-black">
            Start a focus session
          </h2>
        </div>
        <span className="rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-black">
          Timestamped
        </span>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="block md:col-span-2">
          <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-black/70">
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
          <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-black/70">
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
          <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-black/70">
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
          <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-black/70">
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
          <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-black/70">
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

      <div className="mt-5 rounded-[1.35rem] border-2 border-black bg-[#f8f3ea] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
            Break checklist
          </p>
          <span className="rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-black">
            {breakTasks.length} tasks
          </span>
        </div>

        <div className="mt-3 grid gap-2">
          {breakTasks.map((task, index) => (
            <div
              key={`${task}-${index}`}
              className="flex items-center justify-between gap-3 rounded-[1rem] border-2 border-black bg-white px-3 py-2"
            >
              <span className="text-sm font-bold text-black">{task}</span>
              <button
                type="button"
                onClick={() => removeBreakTask(index)}
                className="rounded-full border-2 border-black bg-[#ffe0de] px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-black"
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
            className="rounded-full border-2 border-black bg-[#9fe3ff] px-4 py-3 text-xs font-bold uppercase tracking-[0.12em] text-black shadow-[3px_3px_0_#000]"
          >
            Add task
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-[1rem] border-2 border-black bg-[#ffe0de] px-4 py-3 text-sm font-bold text-black">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isSaving}
        className="mt-6 inline-flex w-full items-center justify-center rounded-full border-2 border-black bg-black px-5 py-3.5 text-sm font-bold uppercase tracking-[0.12em] text-white shadow-[4px_4px_0_#fff] transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_#fff] disabled:cursor-not-allowed disabled:opacity-45"
      >
        {isSaving ? 'Starting...' : 'Start focus'}
      </button>
    </form>
  );
}
