import { useEffect, useRef, useState } from 'react';
import { Badge } from '../../components/ui/Badge.jsx';
import { formatMoney } from './financeMath.js';
import { debtAccrualSettlementStatus } from './debtAccounting.js';

function Money({ amount, currency }) {
  return <span className="f-debt-money">{formatMoney(amount, currency)}</span>;
}

function Progress({ value, paid, remaining, currency }) {
  const percent = Math.min(100, Math.max(0, value / 100));
  return <div className="f-debt-progress-block">
    <div className="f-progress" role="progressbar" aria-label="Debt repaid" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(percent)} aria-valuetext={`${Math.round(percent)}% repaid`}><span style={{ width: `${percent}%` }} /></div>
    <div className="f-debt-progress-labels"><span><strong>{Math.round(percent)}% repaid</strong><small><Money amount={paid} currency={currency}/> actually paid</small></span><span><small><Money amount={remaining} currency={currency}/> remaining</small></span></div>
  </div>;
}

function HistoryRows({ rows, empty, limit, setLimit, children }) {
  if (!rows.length) return <p className="f-debt-empty">{empty}</p>;
  return <>
    <ul className="f-debt-history-list">{rows.slice(0, limit).map(children)}</ul>
    {rows.length > limit && <button type="button" className="f-button f-debt-load-more" onClick={() => setLimit(value => value + 50)}>Load 50 more ({rows.length - limit} left)</button>}
  </>;
}

export function DebtDetail({
  debt, currency, sourceCurrency, sourceRemaining, remaining, status, metrics, progress, planLabel,
  accumulations, incomeAllocations = [], payments, getSettlementStatus, getPaymentSource, canEditPayment, canReversePayment,
  onBack, onRecordPayment, onSendMoney, onAddAccumulation, onEditAccumulation, onRemoveAccumulation,
  onEditPayment, onReversePayment, onEditDebt, onEditPlan, onPause, onResume, onArchive, onReleaseExcess, excessAmount = 0, openTransactionDetail,
  onDelete, canDelete, children,
}) {
  const [accumulationLimit, setAccumulationLimit] = useState(50);
  const [paymentLimit, setPaymentLimit] = useState(50);
  const headingRef = useRef(null);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [debt.id]);
  const paidOff = status === 'completed';
  const planRunning = status === 'active' || status === 'scheduled';
  const payoffDate = payments.filter(item => !item.reversedAt).map(item => item.date).sort().at(-1);

  return <section className="f-debt-detail" aria-labelledby="debt-detail-title">
    <button type="button" className="f-button f-debt-back" onClick={onBack}>← Back to debts</button>
    <header className="f-debt-detail-heading">
      <div><p className="f-debt-eyebrow">Debt details</p><h2 ref={headingRef} tabIndex="-1" id="debt-detail-title">{debt.name}</h2><p className="f-meta">{debt.notes || 'Track what remains, what you have set aside, and what you have actually paid.'}</p></div>
      <Badge variant={status === 'active' || paidOff ? 'success' : status === 'paused' ? 'warning' : 'neutral'}>{debt.archivedAt ? 'Archived' : paidOff ? 'Paid off' : status === 'paused' ? 'Paused' : status === 'scheduled' ? 'Scheduled' : 'Active'}</Badge>
    </header>

    <div className="f-debt-detail-layout">
      <div className="f-debt-main">
        <section className="f-debt-current" aria-label="Current debt position">
          <div className="f-debt-primary-metric"><span>Debt remaining</span><strong><Money amount={remaining} currency={currency}/></strong>{paidOff&&<small>Paid off{payoffDate?` · ${payoffDate}`:''}</small>}</div>
          <dl className="f-debt-secondary-metrics">
            <div><dt>Original debt</dt><dd><Money amount={debt.original} currency={currency}/></dd></div>
            <div><dt>Accumulated to pay</dt><dd><Money amount={metrics.due} currency={currency}/></dd></div>
            <div><dt>Actually paid</dt><dd><Money amount={metrics.paidAllTime} currency={currency}/></dd></div>
          </dl>
          <Progress value={progress} paid={metrics.paidAllTime} remaining={remaining} currency={currency}/>
          {sourceCurrency !== currency && <p className="f-help mt-2">Debt currency balance: <Money amount={sourceRemaining} currency={sourceCurrency}/></p>}
        </section>

        <div className="f-debt-primary-actions">
          {!paidOff && <button type="button" className="f-primary" onClick={onRecordPayment}>Record payment</button>}{!paidOff && onSendMoney && <button type="button" className="f-button" onClick={onSendMoney}>Send money</button>}
          {!paidOff && <button type="button" className="f-button" onClick={onAddAccumulation}>+ Add to accumulated</button>}
        </div>

        <section className="f-debt-history-section" aria-labelledby="debt-accumulated-heading">
          <header><div><h3 id="debt-accumulated-heading">Accumulated to pay</h3><p className="f-help">Reserved amounts reduce Spendable, but do not change total owned or debt remaining.</p></div><strong><Money amount={metrics.due} currency={currency}/></strong></header>
          <HistoryRows rows={accumulations} empty="Nothing accumulated yet." limit={accumulationLimit} setLimit={setAccumulationLimit}>
            {entry => {
              const settlement = getSettlementStatus(entry);
              const amount = Math.max(0, Number(entry.accruedAmount ?? entry.amount ?? 0) - Number(entry.paidAmount || 0) - Number(entry.releasedAmount || 0));
              const source = entry.sourceType === 'income_rule' ? 'Automatic accumulation' : entry.sourceType === 'scheduled_rule' ? 'Automatic plan' : entry.sourceType === 'manual' ? 'Manual' : 'Returned to accumulated';
              return <li className="f-debt-history-row" key={entry.id}><div className="f-debt-history-copy"><strong><Money amount={amount || (entry.accruedAmount ?? entry.amount)} currency={currency}/></strong><span>{entry.effectiveDate} · {source} · {settlement === 'partially_settled' ? 'Partially paid' : settlement === 'settled' ? 'Settled' : settlement === 'released' ? 'Released' : 'Unpaid'}</span>{Number(entry.releasedAmount||0)>0&&<small>{formatMoney(entry.releasedAmount,currency)} released to Spendable on {entry.releaseDate}</small>}{entry.note&&<small>{entry.note}</small>}</div><div className="f-debt-row-actions">{amount>0&&<button type="button" className="f-button" onClick={onRecordPayment}>Record payment</button>}{Number(entry.paidAmount||0)===0&&Number(entry.releasedAmount||0)===0&&<><button type="button" className="f-button" onClick={()=>onEditAccumulation(entry)}>Edit</button><button type="button" className="f-button" onClick={()=>onRemoveAccumulation(entry)}>Remove</button></>}</div></li>;
            }}
          </HistoryRows>
        </section>
        {excessAmount > 0 && <section className="f-debt-excess-notice" aria-label="Excess debt reserve"><p><strong>{formatMoney(excessAmount, currency)} is now more than needed for this debt.</strong></p><button type="button" className="f-button" onClick={onReleaseExcess}>Release excess to Spendable</button></section>}

          <section className="f-debt-history-section" aria-labelledby="debt-auto-history-heading"><header><div><h3 id="debt-auto-history-heading">Automatic allocations from income</h3><p className="f-help">Amounts set aside for this debt, linked to the income that triggered them.</p></div></header>{incomeAllocations.length?<ul className="f-debt-history-list">{incomeAllocations.map(event=><li className="f-debt-history-row" key={event.id}><div className="f-debt-history-copy"><strong><Money amount={event.plannedAmount} currency={currency}/></strong><span>{event.sourceIncomeDate} · From {event.sourceIncomeDescription} ({event.status})</span></div>{event.sourceIncomeAvailable&&<button type="button" className="f-button" onClick={()=>openTransactionDetail?.(event.sourceIncomeId)}>Income details</button>}</li>)}</ul>:<p className="f-debt-empty">No automatic income allocations for this debt.</p>}</section>

          <section className="f-debt-history-section" aria-labelledby="debt-paid-heading">
          <header><div><h3 id="debt-paid-heading">Paid</h3><p className="f-help">Actual Finance payments. Reversed payments stay in history and are excluded from this total.</p></div><strong><Money amount={metrics.paidAllTime} currency={currency}/></strong></header>
          <HistoryRows rows={payments} empty="No payments recorded yet." limit={paymentLimit} setLimit={setPaymentLimit}>
            {payment => <li className={`f-debt-history-row${payment.reversedAt?' is-reversed':''}`} key={payment.id}><div className="f-debt-history-copy"><strong><Money amount={payment.amount} currency={currency}/>{payment.reversedAt&&<Badge variant="neutral">Reversed</Badge>}</strong><span>{payment.date} · Paid from {getPaymentSource(payment.paidFromFundId)}{payment.reversedAt?` · marked unpaid ${payment.reversalDate||''}`:''}</span>{payment.sourceAccruals?.length>0&&<small>Applied to accumulated amounts</small>}{payment.note&&<small>{payment.note}</small>}</div><div className="f-debt-row-actions">{payment.transactionId&&<button type="button" className="f-button" onClick={()=>openTransactionDetail?.(payment.transactionId)}>Transaction details</button>}{canEditPayment(payment)&&<button type="button" className="f-button" onClick={()=>onEditPayment(payment)}>Correct</button>}{canReversePayment(payment)&&<button type="button" className="f-button danger-action" onClick={()=>onReversePayment(payment)}>Reverse payment</button>}</div></li>}
          </HistoryRows>
        </section>
      </div>

      <aside className="f-debt-side" aria-label="Debt plan and actions">
        <section className="f-debt-side-section"><h3>Automatic accumulation plan</h3><p>{planLabel}</p><p className="f-help">Eligible income adds to Accumulated to pay. The reserve reduces Spendable. Money leaves Finance only when you record an actual payment.</p><span className="f-debt-plan-status">{planRunning?'Active':status==='paused'?'Paused':'Not set up'}</span><div className="f-debt-side-actions">{planRunning&&<button type="button" className="f-button" onClick={onPause}>Pause plan</button>}{status==='paused'&&<button type="button" className="f-button" onClick={onResume}>Resume plan</button>}<button type="button" className={status === 'not_started' ? 'f-primary' : 'f-button'} onClick={onEditPlan}>{status === 'not_started' ? 'Set up automatic allocation' : 'Edit plan'}</button></div></section>
        <section className="f-debt-side-section"><h3>Debt details</h3><dl className="f-debt-meta-list"><div><dt>Started</dt><dd>{debt.startedOn || 'Not recorded'}</dd></div><div><dt>Due date</dt><dd>{debt.dueDate || 'Not set'}</dd></div><div><dt>Priority</dt><dd>{debt.priority || 'Normal'}</dd></div></dl><div className="f-debt-side-actions"><button type="button" className="f-button" onClick={onEditDebt}>Edit debt</button><button type="button" className="f-button" onClick={onArchive}>{debt.archivedAt?'Restore':'Archive'}</button>{canDelete&&<button type="button" className="f-button danger-action" onClick={onDelete}>Delete</button>}</div></section>
      </aside>
    </div>
    {children}
  </section>;
}
