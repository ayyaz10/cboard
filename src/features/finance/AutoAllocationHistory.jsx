import { useMemo, useState } from 'react';
import { autoAllocationEvents, groupAutoAllocationsByIncome } from './autoAllocationHistory.js';
import { formatMoney } from './financeMath.js';

const kinds = [['all', 'All'], ['donation', 'Donation'], ['goal', 'Goals'], ['debt', 'Debt'], ['other', 'Other']];
const statusLabel = events => events.every(event => event.status === 'Applied') ? 'Applied' : [...new Set(events.map(event => event.status))].join(' · ');
const dateLabel = value => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date not recorded';

export function AutoAllocationHistory({ data, filterType = 'all', targetId = '', onOpenIncome }) {
  const [type, setType] = useState(filterType);
  const [status, setStatus] = useState('all');
  const [limit, setLimit] = useState(50);
  const groups = useMemo(() => {
    const allEvents = autoAllocationEvents(data);
    const visible = allEvents.filter(event => (type === 'all' || event.allocationType === type) && (!targetId || event.targetId === targetId) && (status === 'all' || event.status.toLowerCase().replaceAll(' ', '-') === status));
    const allowed = new Set(visible.map(event => event.sourceIncomeId));
    return groupAutoAllocationsByIncome(allEvents).filter(group => allowed.has(group.id)).map(group => ({
      ...group,
      visibleEvents: group.events.filter(event => (type === 'all' || event.allocationType === type) && (!targetId || event.targetId === targetId) && (status === 'all' || event.status.toLowerCase().replaceAll(' ', '-') === status)),
    }));
  }, [data, type, targetId, status]);
  const currency = data.settings.currency;
  return <section className="f-auto-history" aria-label="Automatic allocation history">
    <header className="f-auto-history-heading"><div><h3>{filterType === 'donation' ? 'Donation history' : targetId ? 'Automatic allocation history' : 'Auto allocation history'}</h3><p className="f-help">See which income triggered each rule and where it went. “Remaining” is income less planned allocations; it is not a cash balance.</p></div>
      <div className="f-auto-history-filters">
        {filterType === 'all' && <label>Type<select className="f-input" aria-label="Filter allocations by type" value={type} onChange={event => setType(event.target.value)}>{kinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
        <label>Status<select className="f-input" aria-label="Filter allocations by status" value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option><option value="applied">Applied</option><option value="allocated">Allocated</option><option value="partial">Partial</option><option value="skipped">Skipped</option><option value="not-applicable">Not applicable</option><option value="reversed">Reversed</option></select></label>
      </div>
    </header>
    {groups.length ? <div className="f-auto-history-list">{groups.slice(0, limit).map(group => <details className="f-auto-history-group" key={group.id}>
      <summary><span className="f-auto-history-income"><strong>{dateLabel(group.date)} · {group.description}</strong><small><Money amount={group.incomeAmount} currency={currency}/> income</small></span><span className="f-auto-history-summary"><small>{type === 'all' && !targetId ? 'Allocated' : 'This allocation'} <Money amount={group.visibleEvents.reduce((total, event) => total + event.plannedAmount, 0)} currency={currency}/></small>{type === 'all' && !targetId && <small>Remaining <Money amount={group.remainingAmount} currency={currency}/></small>}</span><span className="f-auto-history-status">{statusLabel(group.visibleEvents)}</span></summary>
      <div className="f-auto-history-details"><ul>{group.visibleEvents.map(event => <li key={event.id}><span><strong>{event.targetName}</strong><small>{event.allocationType[0].toUpperCase() + event.allocationType.slice(1)} · {event.status}{event.reason ? ` · ${event.reason}` : ''}</small>{event.plannedAmount !== event.appliedAmount && <small>Planned <Money amount={event.plannedAmount} currency={currency}/> · applied <Money amount={event.appliedAmount} currency={currency}/></small>}</span><strong><Money amount={event.plannedAmount} currency={currency}/></strong></li>)}</ul>{onOpenIncome && group.sourceIncomeAvailable && <button type="button" className="f-button" onClick={() => onOpenIncome(group.sourceTransactionId)}>Open income details</button>}</div>
    </details>)}</div> : <p className="f-auto-history-empty">No automatic allocations match these filters.</p>}
    {groups.length > limit && <button type="button" className="f-button f-auto-history-more" onClick={() => setLimit(value => value + 50)}>Load 50 more ({groups.length - limit} left)</button>}
  </section>;
}

function Money({ amount, currency }) { return <>{formatMoney(amount, currency)}</>; }
