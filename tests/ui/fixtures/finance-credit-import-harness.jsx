import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initialFinanceState, defaultCategories } from '../../../src/features/finance/financeData.js';
import { createCreditAgreement } from '../../../src/features/finance/creditPurchases.js';
import { TransactionImport } from '../../../src/features/finance/TransactionImport.jsx';
import '../../../src/features/finance/finance.css';

function Harness() {
  const [state, setState] = useState(() => {
    const data = initialFinanceState();
    data.categories = defaultCategories;
    data.settings.configured = true;
    data.accounts = [{ id: 'current', name: 'Current Account', type: 'bank', openingBalance: 100000, archivedAt: '' }];
    createCreditAgreement(data, { id: 'agreement-1', title: 'Philips Series 9000 Trimmer', merchant: 'Klarna', purchaseDate: '2026-10-25', cashPrice: 10000, deposit: 0, financedAmount: 10000, financeCharge: 0, interestMode: 'zero', term: 2, frequency: 'monthly', customDays: 30, firstPaymentDate: '2026-11-25' });
    return data;
  });
  async function change(mutator) { const next = structuredClone(state); mutator(next); setState(next); return true; }
  return <main style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
    <section role="dialog" aria-label="Import transactions"><TransactionImport data={state} busy={false} change={change} close={() => {}}/></section>
    <output data-testid="finance-state" style={{ display: 'block', overflowWrap: 'anywhere' }}>{JSON.stringify(state)}</output>
  </main>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
