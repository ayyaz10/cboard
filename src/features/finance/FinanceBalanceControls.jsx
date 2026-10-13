import { balanceComponents } from './financeBalances.js';

const views = [
  { id: 'available', label: 'Available' },
  { id: 'actual', label: 'Actual cash' },
  { id: 'overall', label: 'Overall owned' },
];

export function FinanceBalanceControls({ view, setView, included, toggleComponent, idPrefix = 'finance-balance' }) {
  return <div className="f-balance-controls">
    <fieldset className="f-balance-views"><legend>Balance view</legend><div className="f-balance-view-buttons" role="group" aria-label="Balance view">
      {views.map(item => <button type="button" key={item.id} className={view === item.id ? 'is-selected' : ''} aria-pressed={view === item.id} onClick={() => setView(item.id)}>{item.label}</button>)}
    </div></fieldset>
    <details className="f-balance-components"><summary>Include reserved money <span>Available view only</span></summary><p className="f-help">Checked reserves are added back to Available. Actual cash already includes all virtual reserves; Overall owned includes tracked assets.</p><div className="f-balance-component-list">
      {balanceComponents.map(item => <label key={item.id}>
        <input type="checkbox" checked={included.has(item.id)} onChange={() => toggleComponent(item.id)} aria-label={`Include ${item.label.toLowerCase()} reserve`} id={`${idPrefix}-${item.id}`}/>{item.label}
      </label>)}
    </div></details>
  </div>;
}
