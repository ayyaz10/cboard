import { useState } from 'react';
import { InputField } from '../../../components/ui/InputField';
import { PrimaryButton } from '../../../components/ui/PrimaryButton';
import { SelectField } from '../../../components/ui/SelectField';
import { calculateSavingsPlan, createSavingsPlannerForm, scheduleModes, validateSavingsPlanner, weekdays } from './savingsPlannerMath';

const currencies = ['GBP', 'USD', 'EUR', 'CAD', 'AUD', 'INR', 'PKR'].map(value => ({ value, label: value }));
const savingModes = [{ value: 'amount', label: 'Fixed amount' }, { value: 'percentage', label: 'Percentage of daily earnings' }];
const planModes = [{ value: 'contribution', label: 'I know how much I can save' }, { value: 'deadline', label: 'I know my target date' }];
const money = (amount, currency) => new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount);
const prettyDate = value => new Date(`${value}T12:00:00`).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const percentage = value => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value);

function Result({ result, currency }) {
  if (!result) return <aside className="rounded-[2rem] border-2 border-black bg-[#ff90e8] p-5 sm:p-6" aria-live="polite"><p className="text-xs font-bold uppercase tracking-[0.18em] text-black/60">Your plan</p><p className="mt-6 text-5xl font-bold">--</p><p className="mt-3 font-semibold text-black/65">Enter your target and schedule.</p></aside>;
  const complete = result.contributions === 0;
  const cards = [
    ['Still to save', money(result.remaining, currency)],
    ['Save each workday', money(result.amountPerDay, currency)],
    [result.calculationMode === 'deadline' ? 'Target date' : 'Finish date', prettyDate(result.finishDate)],
    ['Last payment', money(result.finalContribution, currency)],
  ];
  if (result.calculationMode === 'deadline') cards.push(['Required percentage', `${percentage(result.requiredPercentage)}% of ${money(result.dailyIncome, currency)}`]);
  return <aside className="rounded-[2rem] border-2 border-black bg-[#ff90e8] p-5 sm:p-6" aria-live="polite">
    <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/60">Your plan</p>
    <h2 className="mt-3 text-3xl font-bold tracking-[-0.04em]">{complete ? 'Target already reached' : result.calculationMode === 'deadline' ? `${money(result.amountPerDay, currency)} each saving day` : `${result.contributions} saving days`}</h2>
    <p className="mt-2 text-lg font-bold">{complete ? `You already have ${money(result.target, currency)}.` : result.calculationMode === 'deadline' ? `Across ${result.contributions} saving days` : `About ${result.periods} ${result.periodLabel}`}</p>
    <div className="mt-5 grid gap-3 sm:grid-cols-2">{cards.map(([label, value]) => <div key={label} className="rounded-[1.25rem] border-2 border-black bg-[#fffdf8] p-4"><p className="text-xs font-bold uppercase tracking-[0.12em] text-black/55">{label}</p><p className="mt-2 text-lg font-bold leading-tight">{value}</p></div>)}</div>
    {!complete && <p className="mt-4 text-sm font-semibold leading-6 text-black/65">{result.exactDate ? 'The date uses the exact weekdays you selected.' : 'The date is an estimate because exact saving days were not selected.'}</p>}
    {!complete && result.equalPayments && result.overTarget > 0 && <p className="mt-2 rounded-xl border-2 border-black bg-[#fff0b8] p-3 text-sm font-bold leading-6">Equal payments total {money(result.projectedTotal, currency)}, which is {money(result.overTarget, currency)} above your target.</p>}
  </aside>;
}

export function SavingsPlannerCalculator() {
  const [form, setForm] = useState(createSavingsPlannerForm);
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);
  const [attempted, setAttempted] = useState(false);
  function calculate(next) { const nextErrors = validateSavingsPlanner(next); setErrors(nextErrors); setResult(Object.keys(nextErrors).length ? null : calculateSavingsPlan(next)); }
  function update(name, value) { const next = { ...form, [name]: value }; setForm(next); if (attempted) calculate(next); }
  function toggleDay(day) { update('selectedDays', form.selectedDays.includes(day) ? form.selectedDays.filter(item => item !== day) : [...form.selectedDays, day]); }
  function submit(event) { event.preventDefault(); setAttempted(true); calculate(form); }
  return <div className="grid gap-6">
    <div className="grid gap-6 lg:grid-cols-[minmax(0,.9fr)_minmax(360px,1.1fr)] lg:items-start">
      <form noValidate onSubmit={submit} className="order-2 rounded-[2rem] border-2 border-black bg-[#fffdf8] p-5 sm:p-6 lg:order-1">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">Build your plan</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <InputField id="target" name="target" label="Target amount" value={form.target} onChange={e => update('target', e.target.value)} error={errors.target}/>
          <SelectField id="currency" name="currency" label="Currency" value={form.currency} onChange={e => update('currency', e.target.value)} options={currencies}/>
          <InputField id="alreadySaved" name="alreadySaved" label="Already saved" value={form.alreadySaved} onChange={e => update('alreadySaved', e.target.value)} error={errors.alreadySaved}/>
          <SelectField id="planMode" name="planMode" label="What do you know?" value={form.planMode} onChange={e => update('planMode', e.target.value)} options={planModes} error={errors.planMode}/>
        </div>
        <div className="mt-4 grid gap-4">
          {form.planMode === 'contribution' && <SelectField id="savingMode" name="savingMode" label="Saving amount type" value={form.savingMode} onChange={e => update('savingMode', e.target.value)} options={savingModes} error={errors.savingMode}/>}
          {form.planMode === 'contribution' && (form.savingMode === 'amount' ? <InputField id="amountPerDay" name="amountPerDay" label="Amount per saving day" value={form.amountPerDay} onChange={e => update('amountPerDay', e.target.value)} error={errors.amountPerDay}/> : <div className="grid gap-4 sm:grid-cols-2"><InputField id="dailyIncome" name="dailyIncome" label="Earnings per workday" value={form.dailyIncome} onChange={e => update('dailyIncome', e.target.value)} error={errors.dailyIncome}/><InputField id="savingPercentage" name="savingPercentage" label="Percentage to save" value={form.savingPercentage} onChange={e => update('savingPercentage', e.target.value)} error={errors.savingPercentage}/></div>)}
          <SelectField id="scheduleMode" name="scheduleMode" label="Saving schedule" value={form.scheduleMode} onChange={e => update('scheduleMode', e.target.value)} options={scheduleModes} error={errors.scheduleMode}/>
          {form.scheduleMode === 'specific' && <fieldset><legend className="text-xs font-bold uppercase tracking-[0.14em] text-black/70">Which days do you save?</legend><div className="mt-2 flex flex-wrap gap-2">{weekdays.map(day => <label key={day.value} className={`cursor-pointer rounded-full border-2 border-black px-3 py-2 text-sm font-bold ${form.selectedDays.includes(day.value) ? 'bg-[#c5ff6f] shadow-[2px_2px_0_#000]' : 'bg-white'}`}><input className="sr-only" type="checkbox" checked={form.selectedDays.includes(day.value)} onChange={() => toggleDay(day.value)}/>{day.short}</label>)}</div>{errors.selectedDays && <p className="mt-2 text-sm font-semibold text-[#b42318]">{errors.selectedDays}</p>}</fieldset>}
          {form.scheduleMode === 'weekly' && <InputField id="daysPerWeek" name="daysPerWeek" label="Saving days per week" value={form.daysPerWeek} onChange={e => update('daysPerWeek', e.target.value)} error={errors.daysPerWeek}/>}
          {form.scheduleMode === 'monthly' && <InputField id="daysPerMonth" name="daysPerMonth" label="Saving days per month" value={form.daysPerMonth} onChange={e => update('daysPerMonth', e.target.value)} error={errors.daysPerMonth}/>}
          <div><label htmlFor="startDate" className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-black/70">Start date</label><input id="startDate" type="date" className="field-input" value={form.startDate} onChange={e => update('startDate', e.target.value)} aria-invalid={Boolean(errors.startDate)}/>{errors.startDate && <p className="mt-2 text-sm font-semibold text-[#b42318]">{errors.startDate}</p>}</div>
          {form.planMode === 'deadline' && <div><label htmlFor="targetDate" className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-black/70">Target date</label><input id="targetDate" type="date" className="field-input" value={form.targetDate} onChange={e => update('targetDate', e.target.value)} aria-invalid={Boolean(errors.targetDate)}/>{errors.targetDate && <p className="mt-2 text-sm font-semibold text-[#b42318]">{errors.targetDate}</p>}</div>}
          {form.planMode === 'deadline' && <InputField id="dailyIncome" name="dailyIncome" label="Earnings per workday" value={form.dailyIncome} onChange={e => update('dailyIncome', e.target.value)} error={errors.dailyIncome}/>}
          {form.planMode === 'deadline' && <label className={`flex cursor-pointer items-start gap-3 rounded-[1.25rem] border-2 border-black p-4 font-bold ${form.equalPayments ? 'bg-[#c5ff6f]' : 'bg-white'}`}><input className="mt-1 h-5 w-5 accent-black" type="checkbox" checked={form.equalPayments} onChange={e => update('equalPayments', e.target.checked)}/><span>Keep every payment equal<span className="mt-1 block text-sm font-medium leading-6 text-black/60">May finish a few pennies above the target when it cannot divide evenly.</span></span></label>}
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center"><PrimaryButton type="submit">Calculate plan</PrimaryButton><p className="text-sm font-medium text-black/55">Updates live after the first calculation.</p></div>
      </form>
      <Result result={result} currency={form.currency}/>
    </div>
    <section className="rounded-[1.75rem] border-2 border-black bg-[#fff0b8] p-5 sm:p-6"><h2 className="text-xl font-bold">Example</h2><p className="mt-2 font-medium leading-7 text-black/70">For an £80 target, saving £10 on three selected workdays takes 8 saving days. A £100 target takes 10 saving days. Select your actual weekdays to get an exact finish date.</p></section>
  </div>;
}
