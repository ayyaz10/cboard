import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultCategories, initialFinanceState } from '../../../src/features/finance/financeData.js';
import { createRefundState } from '../../../src/features/finance/refunds.js';
import { financeSummary } from '../../../src/features/finance/financeMath.js';
import { calculateFinanceBalances } from '../../../src/features/finance/financeBalances.js';
import { TransactionForm, PeopleFinance } from '../../../src/features/finance/FinancePage.jsx';
import { TransactionDetailDialog } from '../../../src/features/finance/TransactionDetailDialog.jsx';
import { AutoAllocationHistory } from '../../../src/features/finance/AutoAllocationHistory.jsx';
import { applyIncomeAllocations } from '../../../src/features/finance/financeAllocations.js';

function makeState() {
  const state = initialFinanceState();
  state.settings.configured = true;
  state.categories = defaultCategories.filter(item => item.type === 'expense' || item.type === 'income');
  state.financePeople = [{ id: 'person-ahmed', name: 'Ahmed', archived: false }, { id: 'person-klarna', name: 'Klarna', archived: false }];
  state.accounts = [{ id: 'account-current', name: 'Current Account', type: 'bank', openingBalance: 100000, archivedAt: '' }];
  state.creditCards = [{ id: 'card-main', name: 'My Credit Card', openingLiability: 0, archivedAt: '' }];
  return state;
}
function Harness() {
  const [state, setState] = useState(makeState), [mode, setMode] = useState('home'), [detailId, setDetailId] = useState(''), [historyType, setHistoryType] = useState('all');
  async function change(mutator) { const next = structuredClone(state); mutator(next); setState(next); return true; }
  return <main style={{ maxWidth: 900, margin: '0 auto', padding: 16, fontFamily: 'sans-serif' }}>
    <h1>Finance flexible payments QA</h1>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button onClick={() => setMode('transaction')}>Open Add Transaction</button>
      <button onClick={() => setMode('people')}>Open People and Shared Costs</button>
      <button onClick={async () => change(next => { next.goals = [{ id: 'goal-emergency', title: 'Emergency Fund', target: 50000, saved: 0, status: 'active' }, { id: 'goal-complete', title: 'Completed Fund', target: 5000, saved: 5000, status: 'completed' }]; next.debts = [{ id: 'debt-card', name: 'Card debt', original: 100000, remaining: 100000, repaymentPlanStatus: 'active' }]; const income = { id: 'income-salary', type: 'income', title: 'Salary', amount: 150000, date: '2026-11-10' }; next.transactions.push(income); next.allocationRules = [{ id: 'rule-donation', name: 'Giving', targetType: 'donation', donationCategoryId: 'donation-default-general', mode: 'percent', value: 500, timing: 'income', active: true }, { id: 'rule-goal', name: 'Emergency Fund', targetType: 'goal', targetId: 'goal-emergency', mode: 'amount', value: 15000, timing: 'income', active: true }, { id: 'rule-debt', name: 'Card debt', targetType: 'debt', targetId: 'debt-card', mode: 'amount', value: 25000, timing: 'income', active: true }, { id: 'rule-skipped', name: 'Completed Fund', targetType: 'goal', targetId: 'goal-complete', mode: 'amount', value: 5000, timing: 'income', active: true }]; applyIncomeAllocations(next, income); setMode('allocations'); return next; })}>Create three allocations</button>
      <button onClick={() => { setHistoryType('donation'); setMode('allocations'); }}>Donation history only</button>
      <button onClick={() => { setDetailId(state.transactions.find(item => item.type === 'income')?.id || ''); }}>Open salary details</button>
      <button onClick={() => setMode('home')}>Close</button><button onClick={() => setDetailId(state.transactions.find(item => item.type === 'expense')?.id || '')}>View first purchase details</button>
    </div>
    {mode === 'transaction' && <section role="dialog" aria-label="Add transaction"><TransactionForm data={state} initial={null} close={() => setMode('home')} change={change} busy={false}/></section>}
    {mode === 'people' && <PeopleFinance data={state} change={change} busy={false}/>}
    {mode === 'allocations' && <AutoAllocationHistory key={historyType} data={state} filterType={historyType} onOpenIncome={id => setDetailId(id)}/>}
    {detailId && <TransactionDetailDialog transaction={state.transactions.find(item => item.id === detailId)} data={state} busy={false} close={() => setDetailId('')} edit={() => {}} remove={async () => false} duplicate={() => {}} reclassify={async () => true} openLinked={() => {}} markDonationUnpaid={() => {}} markDebtUnpaid={() => {}} canMarkDonationUnpaid={false} canMarkDebtUnpaid={false} createRefund={async (transaction, values) => change(current => { createRefundState(current, { originalTransactionId: transaction.id, ...values }); return current; })} editRefund={async () => {}} linkRefund={async () => {}} reverseRefund={async () => {}}/>}
    <output aria-label="Finance summary" data-testid="finance-summary">{JSON.stringify({income:financeSummary(state,null).income,expenses:financeSummary(state,null).expenses,owned:calculateFinanceBalances(state).actualCash,liabilities:calculateFinanceBalances(state).liabilities,receivables:calculateFinanceBalances(state).receivables})}</output>
    <output data-testid="finance-state" style={{ display: 'block', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(state)}</output>
  </main>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
