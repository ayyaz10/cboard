import { useMemo, useState } from 'react';
import {
  buildPresetMetrics,
  createId,
  goalTypePresets,
  metricColorKeys,
} from './progressTrackerStorage';

function makeInitialForm() {
  const type = 'typing';

  return {
    title: '',
    type,
    targetValue: '',
    unit: goalTypePresets[type].targetUnit,
    deadline: '',
    metrics: buildPresetMetrics(type),
  };
}

export function GoalForm({ onCreateGoal, isSaving = false }) {
  const [form, setForm] = useState(makeInitialForm);
  const [error, setError] = useState('');

  const typeOptions = useMemo(
    () => Object.entries(goalTypePresets),
    [],
  );

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function handleTypeChange(event) {
    const type = event.target.value;
    const preset = goalTypePresets[type];

    setForm((current) => ({
      ...current,
      type,
      unit: preset.targetUnit,
      metrics: buildPresetMetrics(type),
    }));
  }

  function updateMetric(metricId, field, value) {
    setForm((current) => ({
      ...current,
      metrics: current.metrics.map((metric) =>
        metric.id === metricId ? { ...metric, [field]: value } : metric,
      ),
    }));
  }

  function addMetric() {
    setForm((current) => ({
      ...current,
      metrics: [
        ...current.metrics,
        {
          id: createId('metric'),
          name: '',
          unit: '',
          colorKey: metricColorKeys[current.metrics.length % metricColorKeys.length],
        },
      ],
    }));
  }

  function removeMetric(metricId) {
    setForm((current) => ({
      ...current,
      metrics:
        current.metrics.length === 1
          ? current.metrics
          : current.metrics.filter((metric) => metric.id !== metricId),
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const metrics = form.metrics
      .map((metric, index) => ({
        ...metric,
        name: metric.name.trim(),
        unit: metric.unit.trim(),
        colorKey: metric.colorKey || metricColorKeys[index % metricColorKeys.length],
      }))
      .filter((metric) => metric.name);

    if (!form.title.trim()) {
      setError('Add a goal title first.');
      return;
    }

    if (metrics.length === 0) {
      setError('Add at least one metric to track.');
      return;
    }

    const parsedTarget = Number.parseFloat(form.targetValue);

    try {
      await onCreateGoal({
        id: createId('goal'),
        title: form.title.trim(),
        type: form.type,
        targetValue:
          form.targetValue === '' || !Number.isFinite(parsedTarget)
            ? null
            : parsedTarget,
        unit: form.unit.trim(),
        deadline: form.deadline,
        metrics,
        createdAt: new Date().toISOString(),
      });

      setError('');
      setForm(makeInitialForm());
    } catch (createError) {
      setError(createError.message);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-[1.75rem] border-2 border-black bg-[#fffdf8] p-5 shadow-[5px_5px_0_#000] sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
            Create goal
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-black">
            New tracker
          </h2>
        </div>
        <span className="rounded-full border-2 border-black bg-[#ffd166] px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-black">
          Cloud
        </span>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-black/70">
            Goal title
          </span>
          <input
            className="field-input"
            value={form.title}
            onChange={(event) => updateField('title', event.target.value)}
            placeholder="150 WPM, 10,000 steps..."
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-black/70">
            Type
          </span>
          <select
            className="field-input"
            value={form.type}
            onChange={handleTypeChange}
          >
            {typeOptions.map(([type, preset]) => (
              <option key={type} value={type}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-black/70">
            Target value
          </span>
          <input
            className="field-input"
            type="number"
            inputMode="decimal"
            value={form.targetValue}
            onChange={(event) => updateField('targetValue', event.target.value)}
            placeholder="150"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-black/70">
            Target unit
          </span>
          <input
            className="field-input"
            value={form.unit}
            onChange={(event) => updateField('unit', event.target.value)}
            placeholder="WPM, steps, sessions..."
          />
        </label>

        <label className="block md:col-span-2">
          <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-black/70">
            Deadline
          </span>
          <input
            className="field-input"
            type="date"
            value={form.deadline}
            onChange={(event) => updateField('deadline', event.target.value)}
          />
        </label>
      </div>

      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
            Metrics
          </p>
          <button
            type="button"
            onClick={addMetric}
            className="rounded-full border-2 border-black bg-[#9fe3ff] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-black shadow-[3px_3px_0_#000]"
          >
            Add metric
          </button>
        </div>

        <div className="mt-3 grid gap-3">
          {form.metrics.map((metric) => (
            <div
              key={metric.id}
              className="grid gap-3 rounded-[1.35rem] border-2 border-black bg-[#f8f3ea] p-3 md:grid-cols-[1fr_0.65fr_auto]"
            >
              <input
                className="field-input"
                value={metric.name}
                onChange={(event) =>
                  updateMetric(metric.id, 'name', event.target.value)
                }
                placeholder="Metric name"
              />
              <input
                className="field-input"
                value={metric.unit}
                onChange={(event) =>
                  updateMetric(metric.id, 'unit', event.target.value)
                }
                placeholder="Unit"
              />
              <button
                type="button"
                onClick={() => removeMetric(metric.id)}
                className="rounded-full border-2 border-black bg-white px-4 py-3 text-xs font-bold uppercase tracking-[0.12em] text-black"
              >
                Remove
              </button>
            </div>
          ))}
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
        className="mt-6 inline-flex w-full items-center justify-center rounded-full border-2 border-black bg-[#c5ff6f] px-5 py-3.5 text-sm font-bold uppercase tracking-[0.12em] text-black shadow-[4px_4px_0_#000] transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_#000] disabled:cursor-not-allowed disabled:opacity-55"
      >
        {isSaving ? 'Saving...' : 'Create goal'}
      </button>
    </form>
  );
}
