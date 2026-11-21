import { getAppHref, navigateTo } from '../../app/useRoute.js';
import { useEffect, useState } from 'react';
import { listLifeAreasOverview } from '../../services/lifeAreasService.js';
import { Button } from '../../components/ui/Button.jsx';
import { formatMoney } from '../finance/financeMath.js';
import { formatWeightDate } from '../weightProgress/weightData.js';
import './myLife.css';

function ModuleLink({ href, children }) { return <a className="life-module-link" href={getAppHref(href)}>{children}</a>; }
function SummaryCard({ title, eyebrow, status, onRetry, children, className = '' }) {
  return <section className={`life-summary-card ${className}`} aria-label={title}>
    <div className="life-summary-heading"><div><p className="life-eyebrow">{eyebrow}</p><h2>{title}</h2></div></div>
    {status.status === 'loading'? <p className="life-muted" role="status">Loading summary...</p>
      : status.status === 'error'? <div className="life-error" role="alert"><p>{status.error}</p><Button onClick={onRetry}>Retry</Button></div>
      : children(status.data)}
  </section>;
}

export function MyLifeOverview({ sections, onRefresh }) {
  const [lifeRows, setLifeRows] = useState([]), [lifeLoading, setLifeLoading] = useState(true), [lifeError, setLifeError] = useState('');
  const [lifeRevision, setLifeRevision] = useState(0);
  useEffect(() => { let active = true; setLifeLoading(true); listLifeAreasOverview().then(rows => { if (active) { setLifeRows(rows); setLifeError(''); } }).catch(problem => { if (active) setLifeError(problem?.message || 'Life Areas summary could not be loaded.'); }).finally(() => { if (active) setLifeLoading(false); }); return () => { active = false; }; }, [lifeRevision]);
  return <section className="my-life-overview" aria-labelledby="my-life-title">
    <header className="my-life-header"><div><p className="life-eyebrow">Your life at a glance</p><h1 id="my-life-title">My Life</h1><p className="life-muted">A compact view of information already saved in CBoard.</p></div><Button onClick={onRefresh}>Refresh summaries</Button></header>
    <section className="life-summary-card life-areas-summary" aria-label="Life Areas and next actions"><div className="life-summary-heading"><div><p className="life-eyebrow">Projects and Skills</p><h2>Life Areas</h2></div><ModuleLink href="/life-areas">Open Life Areas</ModuleLink></div>
      {lifeLoading ? <p role="status">Loading Life Areas...</p> : lifeError ? <div role="alert"><p>{lifeError}</p><Button onClick={() => setLifeRevision(value => value + 1)}>Retry</Button></div> : !lifeRows.length ? <p className="life-muted">No active areas yet. Create one to organize your projects and skills.</p> : <ul className="life-areas-summary-list">{lifeRows.map((row, index) => <li key={`${row.areaId}:${row.itemId || index}`}><button type="button" onClick={() => navigateTo(row.itemId ? `/life-areas/${row.areaId}/${row.itemId}` : `/life-areas/${row.areaId}`)}><span>{row.areaIcon}</span><span><strong>{row.itemName || row.areaName}</strong><small>{row.itemName ? `${row.itemType} in ${row.areaName}` : 'Life Area'}{row.linkedGoalTitle ? ` | Goal: ${row.linkedGoalTitle}` : ''}{row.nextTaskTitle ? ` | Next: ${row.nextTaskTitle}${row.nextTaskDueAt ? ` (${new Date(row.nextTaskDueAt).toLocaleDateString()})` : ''}` : ''}</small></span></button></li>)}</ul>}
    </section>
    <div className="my-life-grid">
      <SummaryCard title="Finance" eyebrow="Money" status={sections.finance} onRetry={onRefresh}>
        {data => <><dl className="life-metrics"><div><dt>Spendable now</dt><dd>{formatMoney(data.spendable, data.currency)}</dd></div><div><dt>Debt outstanding</dt><dd>{formatMoney(data.debtOutstanding, data.currency)}</dd></div><div><dt>Income this month</dt><dd>{formatMoney(data.monthlyIncome, data.currency)}</dd></div><div><dt>Spending this month</dt><dd>{formatMoney(data.monthlyExpenses, data.currency)}</dd></div></dl><p className="life-muted">{data.upcomingPayments.length? `${data.upcomingPayments.length} scheduled credit payment${data.upcomingPayments.length === 1? '' : 's'} in the next 7 days.` : 'No scheduled credit payments in the next 7 days.'}</p><ModuleLink href="/finance">Open Finance</ModuleLink></>}
      </SummaryCard>
      <SummaryCard title="Health & Food" eyebrow="Wellbeing" status={sections.food} onRetry={onRefresh}>
        {data => <><p>{data.foodCount? `${data.foodCount} food${data.foodCount === 1? '' : 's'} across ${data.mealCount} logged meal${data.mealCount === 1? '' : 's'} today.` : 'No food logged today.'}</p><p className="life-muted">{data.calories == null? "Calories are not available from the food diary." : `${Math.round(data.calories)} kcal logged${data.caloriesMissing? ' (partial nutrition data)' : ''}${data.calorieTarget? ` of ${Math.round(data.calorieTarget)} kcal target` : ''}.`}</p><ModuleLink href="/food-diary">Open Food Diary</ModuleLink></>}
      </SummaryCard>
      <SummaryCard title="Weight" eyebrow="Health" status={sections.weight} onRetry={onRefresh}>
        {data => <>{data.length? <><p className="life-primary-value">{data[0].weightKg} kg</p><p className="life-muted">Latest recorded on {formatWeightDate(data[0].date)}</p></> : <p className="life-muted">No weigh-ins recorded yet.</p>}<ModuleLink href="/weight-progress">Open Weight Progress</ModuleLink></>}
      </SummaryCard>
      <SummaryCard title="Training" eyebrow="Movement" status={sections.training} onRetry={onRefresh}>
        {data => !data.configured? <><p className="life-muted">No saved Training plan is available yet.</p><ModuleLink href="/training">Set up Training</ModuleLink></> : <><p>{data.active? 'A workout is in progress.' : data.todayPlan? `${data.todayPlan.name} is planned today, ${data.todayPlan.exercises} exercises.` : data.upcomingPlan? `Next planned session: ${data.upcomingPlan.name}, ${data.upcomingPlan.exercises} exercises.` : 'No exercises are scheduled in the next 7 days.'}</p>{data.recent&&<p className="life-muted">Recent workout: {data.recent.name}, {formatWeightDate(data.recent.date)}, {data.recent.sets} sets.</p>}<ModuleLink href="/training">{data.active?'Resume Training':'Open Training'}</ModuleLink></>}
      </SummaryCard>
      <SummaryCard title="Goals & Habits" eyebrow="Progress" status={sections.goals} onRetry={onRefresh}>
        {data => <><p>{data.count? `${data.count} goal${data.count === 1? '' : 's'} in Progress Tracker.` : 'No Progress Tracker goals yet.'}</p>{data.nextDeadline&&<p className="life-muted">Next target date: {data.nextDeadline.title}, {formatWeightDate(data.nextDeadline.date)}.</p>}<div className="life-link-row"><ModuleLink href="/progress-tracker">Open goals</ModuleLink><ModuleLink href="/habit-improvement">Open habits</ModuleLink></div></>}
      </SummaryCard>
      <SummaryCard title="Groceries" eyebrow="Home" status={{ status: 'ready' }}>
        {() => <><p className="life-muted">Your pantry and shopping list are available in the Groceries module.</p><ModuleLink href="/groceries">Open Groceries</ModuleLink></>}
      </SummaryCard>
    </div>
    <p className="life-data-note">Finance uses the existing Finance calculations. Training summaries use the saved cloud plan, not unsynced device changes. Goals show configured trackers and dates; progress values are not loaded here. Grocery stock and shopping counts are left in their module because its current loader also loads recipes, diary history and food catalog data.</p>
  </section>;
}
