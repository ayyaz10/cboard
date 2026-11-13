import { useMemo, useRef, useState } from 'react';
import { financeCurrencies } from '../../services/currencyService.js';
import { id, today } from './financeData.js';
import { formatMoney, moneyInput, parseMoney } from './financeMath.js';
import { debtRemainingAmount } from './debtAccounting.js';
import { financeAccountBalance } from './financeAccounts.js';
import { sendMoneyPreview, recordSendMoney, familySupportAvailable, debtReserveAvailable } from './sendMoney.js';

const initialLine = (kind, details = {}) => ({ id: id(), kind, amount: '', ...details });
const amountText = (minor, currency) => formatMoney(minor, currency);
const parseDraft = value => { try { return parseMoney(value); } catch { return 0; } };
const destinationText = (minor, currency) => new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(minor / (['JPY'].includes(currency) ? 1 : 100));

export function SendMoneyPlanner({ data, change, busy, close, preselectedDebtId = '', openTransfer }) {
  const base = data.settings.currency || 'GBP';
  const familyAvailable = familySupportAvailable(data);
  const availableDebts = (data.debts || []).filter(debt => !debt.archivedAt && debtRemainingAmount(data, debt.id) > 0);
  const [items, setItems] = useState(() => preselectedDebtId && availableDebts.some(debt => debt.id === preselectedDebtId) ? [initialLine('debt', { debtId: preselectedDebtId, amount: moneyInput(debtRemainingAmount(data, preselectedDebtId)) })] : []);
  const [destinationCurrency, setDestinationCurrency] = useState(data.settings.defaultForeignCurrency || 'PKR');
  const [rate, setRate] = useState('');
  const [fee, setFee] = useState('');
  const [actualAmount, setActualAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(today());
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const total = items.reduce((sum, item) => sum + parseDraft(item.amount), 0);
  const feeMinor = fee.trim() ? parseDraft(fee) : 0;
  const rateNumber = Number(rate);
  const expected = Number.isFinite(rateNumber) && rateNumber > 0 ? Math.round((total / 100) * rateNumber * (destinationCurrency === 'JPY' ? 1 : 100)) : 0;
  const reservedDebtUsed = accountId ? 0 : items.filter(item => item.kind === 'debt').reduce((sum, item) => sum + Math.min(parseDraft(item.amount), debtReserveAvailable(data, item.debtId)), 0);
  const balance = useMemo(() => sendMoneyPreview(data, accountId, total + feeMinor, reservedDebtUsed), [data, accountId, total, feeMinor, reservedDebtUsed]);

  function changeItem(id, patch) { setItems(rows => rows.map(item => item.id === id ? { ...item, ...patch } : item)); }
  function addDebt(debtId) {
    if (items.some(item => item.kind === 'debt' && item.debtId === debtId)) return;
    const debt = availableDebts.find(item => item.id === debtId);
    if (debt) setItems(rows => [...rows, initialLine('debt', { debtId, amount: moneyInput(debtRemainingAmount(data, debtId)) })]);
  }
  function addFamilySupport() { if (!familyAvailable || items.some(item => item.kind === 'familySupport')) return; setItems(rows => [...rows, initialLine('familySupport', { amount: moneyInput(familyAvailable) })]); }
  function addOther() { setItems(rows => [...rows, initialLine('other', { recipient: '', purpose: '', amount: '', categoryId: data.categories.find(category => category.type === 'expense' && !category.archived)?.id || '' })]); }
  function maximum(item) { return item.kind === 'debt' ? debtRemainingAmount(data, item.debtId) : item.kind === 'familySupport' ? familyAvailable : Number.MAX_SAFE_INTEGER; }
  async function submit(event) {
    event.preventDefault();
    if (submitting.current || busy) return;
    submitting.current = true;
    setError('');
    try {
      if (!items.length || items.some(item => !item.amount || parseDraft(item.amount) <= 0 || parseDraft(item.amount) > maximum(item))) throw new Error('Each amount must be greater than zero and within its available balance.');
      if (items.some(item => item.kind === 'other' && !item.recipient.trim())) throw new Error('Enter a recipient or description for each other payment.');
      if (!Number.isFinite(rateNumber) || rateNumber <= 0) throw new Error('Enter a valid exchange rate greater than zero.');
      if (fee.trim() && parseMoney(fee) < 0) throw new Error('Transfer fee cannot be negative.');
      if (actualAmount.trim() && (!Number.isFinite(Number(actualAmount)) || Number(actualAmount) <= 0)) throw new Error('Enter a valid actual recipient amount.');
      if (!balance.sufficient) throw new Error(`Insufficient funds. Available: ${amountText(balance.available, base)}.`);
      const transferId = id();
      const saved = await change(state => {
        recordSendMoney(state, { id: transferId, date, destination, sourceAmount: total, fee: feeMinor, rate: rateNumber, destinationCurrency, expectedAmount: expected, actualAmount: actualAmount.trim() ? Math.round(Number(actualAmount) * (destinationCurrency === 'JPY' ? 1 : 100)) : null, accountId, note, items: items.map(item => ({ ...item, amount: parseDraft(item.amount) })) });
        return state;
      }, 'Transfer recorded');
      if (saved) close();
    } catch (cause) { setError(cause.message); }
    finally { submitting.current = false; }
  }

  return <form className="f-form f-send-money" onSubmit={submit}>
    <p className="f-help">Plan a transfer youâ€™ll make outside CBoard. Nothing changes in Finance until you record it as sent.</p>
    <section className="f-send-section"><h3>What are you paying?</h3>
      {items.map(item => {
        const debt = item.kind === 'debt' ? data.debts.find(entry => entry.id === item.debtId) : null;
        const support = item.kind === 'familySupport';
        const reserved = debt ? debtReserveAvailable(data, debt.id) : 0;
        return <div className="f-send-line" key={item.id}>
          {debt ? <div className="f-send-copy"><strong>{debt.name}</strong><small>Outstanding {amountText(debtRemainingAmount(data, debt.id), base)}{reserved ? ` ? Reserved ${amountText(reserved, base)}` : ''}</small></div> : support ? <div className="f-send-copy"><strong>Family Support</strong><small>{amountText(familyAvailable, base)} reserve available</small></div> : <div className="f-send-other"><label>Recipient / description<input required maxLength="100" value={item.recipient} onChange={event => changeItem(item.id, { recipient: event.target.value })}/></label><label>Category<select value={item.categoryId} onChange={event => changeItem(item.id, { categoryId: event.target.value })}>{data.categories.filter(category => category.type === 'expense' && !category.archived).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label></div>}
          <label className="f-send-amount">Send ({base})<input aria-label={`${debt?.name || item.recipient || 'Other payment'} amount in ${base}`} inputMode="decimal" value={item.amount} onChange={event => changeItem(item.id, { amount: event.target.value })}/></label>
          <button className="f-button" type="button" aria-label="Remove payment" onClick={() => setItems(rows => rows.filter(row => row.id !== item.id))}>Remove</button>
        </div>;
      })}
      <div className="f-actions"><button className="f-button" type="button" disabled={!familyAvailable||items.some(item=>item.kind==='familySupport')} onClick={addFamilySupport}>+ Family Support ({amountText(familyAvailable, base)})</button><select className="f-input" aria-label="Add a debt" value="" onChange={event => addDebt(event.target.value)}><option value="">+ Add debt</option>{availableDebts.filter(debt => !items.some(item => item.kind === 'debt' && item.debtId === debt.id)).map(debt => <option key={debt.id} value={debt.id}>{debt.name} Â· {amountText(debtRemainingAmount(data, debt.id), base)}</option>)}</select><button className="f-button" type="button" onClick={addOther}>+ Add other payment</button></div>
      {!items.length && <p className="f-help">Nothing selected yet. Add a debt or a one-off payment.</p>}
    </section>
    <div className="f-send-total"><span>Selected payments</span><strong>{amountText(total, base)}</strong></div>
    <section className="f-send-section"><h3>Convert currency</h3><div className="f-row"><label>Destination currency<select value={destinationCurrency} onChange={event => setDestinationCurrency(event.target.value)}>{financeCurrencies.filter(([code]) => code !== base).map(([code, label]) => <option key={code} value={code}>{code} Â· {label}</option>)}</select></label><label>Rate (1 {base} =)<input required inputMode="decimal" aria-label={`Exchange rate, ${destinationCurrency} for one ${base}`} value={rate} onChange={event => setRate(event.target.value)}/></label></div><label>Destination (optional)<input maxLength="80" value={destination} onChange={event => setDestination(event.target.value)} placeholder="e.g. Pakistan"/></label><div className="f-send-total"><span>Expected recipient amount</span><strong>{destinationText(expected, destinationCurrency)}</strong></div><label>Actual amount received (optional)<input inputMode="decimal" value={actualAmount} onChange={event => setActualAmount(event.target.value)} placeholder={destinationText(expected, destinationCurrency)}/></label></section>
    <section className="f-send-section"><h3>Fee and funding</h3><div className="f-row"><label>Transfer fee ({base}, added on top)<input inputMode="decimal" value={fee} onChange={event => setFee(event.target.value)} placeholder="0.00"/></label><label>Pay from<select value={accountId} onChange={event => setAccountId(event.target.value)}><option value="">Spendable money ({amountText(balance.available, base)} available)</option>{data.accounts.filter(account => !account.archivedAt).map(account => <option key={account.id} value={account.id}>{account.name} Â· {amountText(financeAccountBalance(data, account.id), base)} available</option>)}</select></label></div><p className="f-send-total"><span>Total GBP cost</span><strong>{amountText(total + feeMinor, base)}</strong></p>{!balance.sufficient&&<p className="f-alert" role="status">This exceeds available funds by {amountText(total + feeMinor - balance.available, base)}.</p>}</section>
    <label>Date sent<input type="date" value={date} onChange={event => setDate(event.target.value)}/></label><label>Note (optional)<textarea maxLength="300" value={note} onChange={event => setNote(event.target.value)}/></label>
    {error&&<p className="f-alert" role="alert">{error}</p>}<div className="f-actions f-send-actions"><button className="f-button" type="button" onClick={close}>Close</button><button className="f-primary" disabled={busy||!items.length||!balance.sufficient}>{busy?'Recordingâ€¦':'Record as sent'}</button></div>
    {(data.sendMoneyHistory||[]).length>0&&<details className="f-send-history"><summary>Send Money history ({data.sendMoneyHistory.length})</summary>{[...data.sendMoneyHistory].slice(-10).reverse().map(entry=><p key={entry.id}>{new Date(`${entry.date}T12:00:00`).toLocaleDateString(undefined,{day:'numeric',month:'short'})} Â· {entry.destination||entry.destinationCurrency} Â· {amountText(entry.totalCost,entry.sourceCurrency)} Â· {entry.status==='reversed'?'Reversed':destinationText(entry.actualAmount??entry.expectedAmount,entry.destinationCurrency)} <button type="button" className="f-button" onClick={()=>openTransfer?.(entry.id)}>View details</button></p>)}</details>}
  </form>;
}
