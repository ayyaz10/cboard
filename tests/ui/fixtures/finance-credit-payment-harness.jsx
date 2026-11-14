import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultCategories, initialFinanceState } from '../../../src/features/finance/financeData.js';
import { createCreditAgreement } from '../../../src/features/finance/creditPurchases.js';
import { FinanceCreditPurchases } from '../../../src/features/finance/FinanceCreditPurchases.jsx';
import { TransactionDetailDialog } from '../../../src/features/finance/TransactionDetailDialog.jsx';
import { AuthProvider } from '../../../src/contexts/AuthContext.jsx';
import { ReminderProvider } from '../../../src/features/focusTimer/ReminderProvider.jsx';
import '../../../src/features/finance/finance.css';

function Harness() {
  const [state, setState] = useState(() => {
    const data = initialFinanceState();
    data.categories = defaultCategories;
    data.settings.configured = true;
    data.accounts = [
      { id: 'account-current', name: 'Current Account', type: 'bank', openingBalance: 100000, archivedAt: '' },
      { id: 'account-savings', name: 'Savings', type: 'savings', openingBalance: 100000, archivedAt: '' },
    ];
    return data;
  });
  const [detailId, setDetailId] = useState('');
  async function change(mutator) { const next = structuredClone(state); mutator(next); setState(next); return true; }
  const noop = async () => true;
  return <AuthProvider><ReminderProvider><main style={{ maxWidth: 1200, margin: '0 auto', padding: 16 }}>
    <button type="button" onClick={() => setDetailId('')}>Open Credit Purchases</button><button type="button" onClick={() => setState(current => { const next = structuredClone(current); createCreditAgreement(next, { id: 'revision-fixture', title: 'Schedule revision test', purchaseDate: '2026-11-14', cashPrice: 12000, deposit: 0, financedAmount: 12000, term: 3, financeMode: 'zero', frequency: 'monthly', firstPaymentDate: '2027-01-15' }); return next; })}>Seed schedule revision plan</button>
    <FinanceCreditPurchases data={state} change={change} busy={false} confirmAction={async () => true} setTab={() => {}} openTransactionDetail={transaction => setDetailId(transaction.id)}/>
    {detailId && <TransactionDetailDialog transaction={state.transactions.find(item => item.id === detailId)} data={state} busy={false} close={() => setDetailId('')} edit={noop} remove={noop} duplicate={noop} reclassify={noop} openLinked={linked => { if (linked.kind === "credit") setDetailId(""); }} markDonationUnpaid={noop} markDebtUnpaid={noop} canMarkDonationUnpaid={false} canMarkDebtUnpaid={false} createRefund={noop} editRefund={noop} linkRefund={noop} reverseRefund={noop} reclassifySaved={noop}/>}
    <output data-testid="finance-state" style={{ display: 'block', overflowWrap: 'anywhere' }}>{JSON.stringify(state)}</output>
  </main></ReminderProvider></AuthProvider>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
