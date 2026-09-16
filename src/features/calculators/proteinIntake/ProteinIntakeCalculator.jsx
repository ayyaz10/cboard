import { useState } from 'react';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { InputField } from '../../../components/ui/InputField';
import { PrimaryButton } from '../../../components/ui/PrimaryButton';
import { RecentResultsPanel } from '../../../components/ui/RecentResultsPanel';
import { SelectField } from '../../../components/ui/SelectField';
import { useConfirmDialog } from '../../../hooks/useConfirmDialog';
import { getAppHref } from '../../../app/useRoute';
import { useRecentResults } from '../useRecentResults';
import {
  buildProteinIntakeResult,
  createEmptyProteinIntakeForm,
  validateProteinIntakeForm,
  weightUnitOptions,
} from './proteinIntakeMath';

const scenarioColours = ['bg-[#fff0b8]', 'bg-[#9fe3ff]', 'bg-[#c5ff6f]'];
const proteinReferenceVideoUrl = 'https://youtu.be/j1bx0GMofYw?si=M9_h8M_zO2tqoSew';

function ProteinResultPanel({ result }) {
  return (
    <aside aria-live="polite" className="rounded-[2rem] border-2 border-black bg-[#ff90e8] p-5 text-black sm:p-6">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/60">Daily protein ranges</p>
      {!result ? (
        <>
          <p className="mt-6 text-6xl font-bold tracking-[-0.06em] text-black">--</p>
          <p className="mt-3 text-sm font-bold uppercase tracking-[0.12em] text-black/65">Enter your body weight</p>
        </>
      ) : (
        <div className="mt-5 grid gap-3">
          {result.scenarios.map((scenario, index) => (
            <article
              key={scenario.id}
              className={`rounded-[1.4rem] border-2 border-black p-4 ${scenarioColours[index]}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-black/60">{scenario.shortLabel}</p>
                <span className="rounded-full border-2 border-black bg-white px-2.5 py-1 text-[0.68rem] font-bold text-black">
                  {scenario.formattedPoundRatio}
                </span>
              </div>
              <h2 className="mt-2 text-lg font-bold leading-tight text-black">{scenario.label}</h2>
              <p className="mt-2 text-3xl font-bold tracking-[-0.04em] text-black">{scenario.formattedRange}</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-black/70">{scenario.formattedKilogramRatio}</p>
            </article>
          ))}
        </div>
      )}
    </aside>
  );
}

export function ProteinIntakeCalculator() {
  const { confirm, dialog } = useConfirmDialog();
  const [formValues, setFormValues] = useState(createEmptyProteinIntakeForm);
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const { recentResults, isLoading, error, saveResult, removeResult } = useRecentResults('protein-intake');

  function runCalculation(nextValues) {
    const validationErrors = validateProteinIntakeForm(nextValues);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length) {
      setResult(null);
      return null;
    }
    const nextResult = buildProteinIntakeResult(nextValues);
    setResult(nextResult);
    return nextResult;
  }

  function handleChange(event) {
    const { name, value } = event.target;
    const nextValues = { ...formValues, [name]: value };
    setFormValues(nextValues);
    if (hasAttemptedSubmit) runCalculation(nextValues);
  }

  function handleSubmit(event) {
    event.preventDefault();
    setHasAttemptedSubmit(true);
    const nextResult = runCalculation(formValues);
    if (nextResult) saveResult({ summary: nextResult.historySummary, detail: nextResult.historyDetail });
  }

  async function handleRemoveResult(entry) {
    const confirmed = await confirm({
      title: 'Delete saved protein calculation?',
      message: entry.summary,
      confirmLabel: 'Delete',
    });
    if (confirmed) removeResult(entry.id);
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(360px,1.2fr)] lg:items-start">
        <form noValidate onSubmit={handleSubmit} className="order-2 rounded-[2rem] border-2 border-black bg-[#fffdf8] p-5 sm:p-6 lg:order-1">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">Inputs</p>
          <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-black">Enter your body weight</h2>
          <p className="mt-2 text-sm font-medium leading-6 text-black/60">
            The calculator applies all three reference ranges to your weight.
          </p>
          <div className="mt-5 grid gap-4">
            <InputField
              id="weight"
              name="weight"
              label="Body weight"
              placeholder="e.g. 78"
              value={formValues.weight}
              onChange={handleChange}
              error={errors.weight}
            />
            <SelectField
              id="unit"
              name="unit"
              label="Weight unit"
              value={formValues.unit}
              onChange={handleChange}
              options={weightUnitOptions}
              error={errors.unit}
            />
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <PrimaryButton type="submit">Calculate</PrimaryButton>
            <p className="text-sm font-medium leading-6 text-black/55">Updates live after the first calculation.</p>
          </div>
          <a
            href={getAppHref('/recipes')}
            className="mt-5 inline-flex text-sm font-bold text-black underline decoration-2 underline-offset-4"
          >
            Open daily nutrition targets
          </a>
        </form>
        <ProteinResultPanel result={result} />
      </div>

      <section className="rounded-[1.75rem] border-2 border-black bg-[#fffdf8] p-5 text-black sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">How to choose</p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {[{
            title: 'Almost maximized', text: 'Choose this when you want the lowest range while still targeting most of the muscle-gain benefit.'
          }, {
            title: 'Very likely maximized', text: 'Choose this for a higher-confidence target with more protein available for training and recovery.'
          }, {
            title: 'Definitely maximized', text: 'Choose this for the highest range from the chart, especially when you prefer extra margin.'
          }].map((item, index) => (
            <article key={item.title} className={`rounded-[1.35rem] border-2 border-black p-4 ${scenarioColours[index]}`}>
              <h2 className="text-lg font-bold text-black">{item.title}</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-black/70">{item.text}</p>
            </article>
          ))}
        </div>
        <p className="mt-4 text-sm font-medium leading-6 text-black/60">
          These are bodyweight-based estimates. Training, total calories, health, and personal response can change the amount that suits you.
        </p>
        <div className="mt-5 flex flex-col gap-3 rounded-[1.35rem] border-2 border-black bg-[#fff0b8] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-black/55">Video reference</p>
            <p className="mt-1 text-base font-bold leading-6 text-black">
              You&apos;re Wasting Your Money On Protein (NEW RESEARCH)
            </p>
          </div>
          <a
            href={proteinReferenceVideoUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center justify-center rounded-full border-2 border-black bg-[#c5ff6f] px-4 py-2.5 text-xs font-bold uppercase tracking-[0.1em] text-black shadow-[3px_3px_0_#000] transition hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_#000] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-black/15"
          >
            Watch on YouTube
          </a>
        </div>
      </section>

      <RecentResultsPanel
        entries={recentResults}
        emptyMessage="Your protein calculations will appear here after you calculate a result."
        onRemoveEntry={removeResult}
        onRequestRemoveEntry={handleRemoveResult}
        isLoading={isLoading}
        error={error}
      />
      <ConfirmDialog isOpen={Boolean(dialog)} {...dialog} />
    </div>
  );
}
