import { useState } from 'react';
import { formatMoney } from './financeMath.js';

export function SendMoneyTransferDetails({ transfer, data, busy = false, onReverse, onOpenTransaction }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  if (!transfer) return <p className="f-help">Transfer details are unavailable.</p>;
  const currency = transfer.sourceCurrency || data.settings.currency;
  const rows = (transfer.transactionIds || []).map(id => data.transactions.find(item => item.id === id)).filter(Boolean);
  const account = (data.accounts || []).find(item => item.id === transfer.accountId);
  const reversed = transfer.status === 'reversed' || transfer.reversedAt;
  return <div className="f-form f-send-transfer-details">
    <header><span className="f-tag">Send Money ? {transfer.destination || transfer.destinationCurrency}</span><p className="f-meta">{transfer.date} ? {reversed ? 'Reversed' : 'Recorded as sent'}</p></header>
    <section className="f-card"><h3>Payments</h3><ul>{(transfer.items || []).map((item, index) => <li key={`${transfer.id}:${index}`} className="f-between"><span>{item.kind === 'debt' ? data.debts.find(debt => debt.id === item.debtId)?.name || 'Debt payment' : item.kind === 'familySupport' ? 'Family Support' : item.recipient || 'Other payment'}</span><strong>{formatMoney(item.amount, currency)}</strong></li>)}</ul>
      <p className="f-between"><span>Payment total</span><strong>{formatMoney(transfer.sourceAmount, currency)}</strong></p><p className="f-between"><span>Transfer fee</span><strong>{formatMoney(transfer.fee || 0, currency)}</strong></p><p className="f-between"><strong>Total cost</strong><strong>{formatMoney(transfer.totalCost, currency)}</strong></p>
      <p>Rate: 1 {transfer.sourceCurrency} = {Number(transfer.rate).toLocaleString()} {transfer.destinationCurrency}</p><p>Expected recipient amount: {formatMoney(transfer.expectedAmount, transfer.destinationCurrency)}</p>{transfer.actualAmount != null && <p>Actual recipient amount: {formatMoney(transfer.actualAmount, transfer.destinationCurrency)}</p>}<p>Funding account: {account?.name || (transfer.accountId ? 'Unavailable account' : 'Spendable money')}</p>
    </section>
    <section className="f-card"><h3>Linked Finance events</h3>{rows.length ? <ul>{rows.map(row => <li key={row.id} className="f-between"><span>{row.title} ? {row.reversedAt ? 'Reversed' : row.allocationStatus || row.type}</span><span className="f-actions"><strong>{formatMoney(row.amount, currency)}</strong><button type="button" className="f-button" onClick={() => onOpenTransaction?.(row.id)}>View transaction</button></span></li>)}</ul> : <p className="f-help">No linked events found.</p>}</section>
    {reversed && <section className="f-card" role="status"><strong>Reversed on {transfer.reversalDate || transfer.reversedAt.slice(0, 10)}</strong>{transfer.reversalReason && <p>Reason: {transfer.reversalReason}</p>}<p className="f-help">This corrects CBoard records only. It does not retrieve money from the recipient or reverse a bank transfer.</p></section>}
    {!reversed && onReverse && <section className="f-card"><button type="button" className="f-button danger-action" disabled={busy} onClick={() => setConfirming(true)}>Reverse transfer record</button>{confirming && <div className="f-form" role="alertdialog" aria-label="Confirm transfer reversal"><p>This reverses {formatMoney(transfer.totalCost, currency)} across all linked CBoard records, including debt, reserve, payment, and fee effects. It does not retrieve money from the recipient or reverse the external bank transfer.</p><label>Reason (optional)<input maxLength="240" value={reason} onChange={event => setReason(event.target.value)}/></label><div className="f-actions"><button type="button" className="f-primary danger-action" disabled={busy} onClick={() => { onReverse(transfer.id, reason); setConfirming(false); }}>Confirm reversal</button><button type="button" className="f-button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button></div></div>}</section>}
  </div>;
}
