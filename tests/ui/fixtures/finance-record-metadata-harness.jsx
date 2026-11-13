import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultCategories, initialFinanceState } from '../../../src/features/finance/financeData.js';
import { FinanceCreditPurchases } from '../../../src/features/finance/FinanceCreditPurchases.jsx';
import { AuthProvider } from '../../../src/contexts/AuthContext.jsx';
import { ReminderProvider } from '../../../src/features/focusTimer/ReminderProvider.jsx';
import '../../../src/features/finance/finance.css';
function Harness() {
  const [state, setState] = useState(() => { const data = initialFinanceState(); data.categories = defaultCategories; data.settings.configured = true; return data; });
  async function change(mutator) { const next = structuredClone(state); mutator(next); setState(next); return true; }
  return <AuthProvider><ReminderProvider><main style={{ maxWidth: 1200, margin: '0 auto', padding: 16 }}><FinanceCreditPurchases data={state} change={change} busy={false} confirmAction={async () => true} setTab={() => {}}/><output data-testid="finance-state" style={{ display: 'block', overflowWrap: 'anywhere' }}>{JSON.stringify(state)}</output></main></ReminderProvider></AuthProvider>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
