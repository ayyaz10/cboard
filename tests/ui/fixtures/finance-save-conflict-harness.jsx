import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultCategories, initialFinanceState } from '../../../src/features/finance/financeData.js';
import { CategoriesManager, TransactionForm } from '../../../src/features/finance/FinancePage.jsx';

function Harness() {
  const [state, setState] = useState(() => ({ ...initialFinanceState(), settings: { ...initialFinanceState().settings, configured: true }, categories: defaultCategories.filter(item => ['expense', 'income'].includes(item.type)) }));
  const [mode, setMode] = useState('home');
  const [conflict, setConflict] = useState(false);
  const [successfulSaves, setSuccessfulSaves] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const failNext = useRef(false);
  async function change(mutator) {
    setAttempts(value => value + 1);
    if (failNext.current) {
      failNext.current = false;
      setConflict(true);
      return false;
    }
    const next = structuredClone(state);
    mutator(next);
    setState(next);
    setSuccessfulSaves(value => value + 1);
    return true;
  }
  const armConflict = () => { failNext.current = true; };
  return <main style={{ maxWidth: 900, margin: '0 auto', padding: 16, fontFamily: 'sans-serif' }}>
    <h1>Finance save conflict regression</h1>
    <button type="button" onClick={() => setMode('categories')}>Open Categories</button>
    <button type="button" onClick={() => setMode('transaction')}>Open Transactions</button>
    {conflict && <p role="alert">Finance changed in another tab. <button type="button" onClick={() => setConflict(false)}>Retry</button></p>}
    {mode === 'categories' && <CategoriesManager data={state} change={change} confirmAction={async () => true}/>}
    {mode === 'transaction' && <TransactionForm data={state} initial={null} close={() => setMode('home')} change={change} busy={false}/>}
    <output data-testid="successful-saves">{successfulSaves}</output>
    <output data-testid="save-attempts">{attempts}</output>
    <output data-testid="finance-state" style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{JSON.stringify(state)}</output>
    <button type="button" onClick={armConflict}>Arm next conflict</button>
  </main>;
}

createRoot(document.getElementById('root')).render(<Harness/>);
