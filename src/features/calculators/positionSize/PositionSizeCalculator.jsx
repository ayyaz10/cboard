import { useEffect, useState } from 'react';
import { InputField } from '../../../components/ui/InputField';
import { formatUsd, formatPercent, formatRatio } from '../cryptoFutures/cryptoFuturesMath';
import { calculatePosition, defaults, leverages, recommendedPercent } from './positionSizeMath';
import './positionSize.css';

const storageKey = 'cboard-position-size-v1';
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, typeof saved?.[key] === 'string' ? saved[key] : value]));
  } catch { return { ...defaults }; }
}

export function PositionSizeCalculator() {
  const [form, setForm] = useState(restore);
  const [notice, setNotice] = useState('');
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(form)); setStorageError(false); }
    catch { setStorageError(true); }
  }, [form]);
  const result = calculatePosition(form);
  const valid = Object.keys(result.errors).length === 0;
  const spot = form.mode === 'spot';
  const update = (key, value) => { setForm((current) => ({ ...current, [key]: value })); setNotice(''); };
  const field = (key, label, hint, placeholder) => (
    <InputField id={`position-${key}`} name={key} label={label} value={form[key]} hint={hint} placeholder={placeholder}
      error={result.errors[key]} onChange={(event) => update(key, event.target.value)} />
  );
  const select = (key, label, options) => (
    <label className="block">
      <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-black/70">{label}</span>
      <select className="field-input" value={form[key]} onChange={(event) => update(key, event.target.value)} aria-invalid={Boolean(result.errors[key])}>
        {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
      {result.errors[key] && <span className="position-error">{result.errors[key]}</span>}
    </label>
  );
  async function copy(label, value) {
    try { await navigator.clipboard.writeText(value); setNotice(`${label} copied.`); }
    catch { setNotice('Copy unavailable. Select the result text and copy it manually.'); }
  }
  const cards = spot ? [
    ['Allocation per coin', formatUsd(result.allocationAmount)],
    ['Remaining wallet', formatUsd(result.remaining)],
  ] : [
    ['Recommended margin', formatUsd(result.recommendedMargin)],
    ['Recommended wallet %', valid ? `${result.marginPercent}%` : '--'],
    ['Margin used for estimates', formatUsd(result.margin)],
    ['Position notional', formatUsd(result.notional)],
    ['Stop-loss distance', formatPercent(result.stopPercent)],
    ['Estimated wallet risk', formatPercent(result.walletRisk), 'loss'],
    ['Estimated loss at stop', formatUsd(result.loss), 'loss'],
    ['Estimated profit at target', formatUsd(result.profit), 'profit'],
    ['Risk / reward', formatRatio(result.ratio)],
  ];
  return (
    <div className="position-calculator">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <span className="pill">Plan your exposure</span>
        <button className="position-button" type="button" onClick={() => { setForm({ ...defaults }); setNotice('Inputs reset to defaults.'); }}>Reset inputs</button>
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <section className="panel min-w-0 p-5 sm:p-6" aria-labelledby="position-setup">
          <p className="position-eyebrow">01 / Trade setup</p>
          <h2 id="position-setup" className="mb-6 mt-2 text-2xl font-bold tracking-tight">Start with your wallet</h2>
          <div className="grid gap-6 sm:grid-cols-2">
            {field('wallet', 'Total wallet balance (USD)')}
            {select('mode', 'Trading mode', [['futures', 'Leveraged Futures'], ['spot', 'Spot']])}
            {spot ? field('allocation', 'Spot allocation (%)', 'Strategy range: 5–10% maximum per coin.') : <>
              {select('side', 'Trade direction', [['long', 'Long — price rises'], ['short', 'Short — price falls']])}
              {select('leverage', 'Leverage', leverages.map((value) => [String(value), `${value}x`]))}
              {field('entry', 'Entry price (USD)')}
              {field('stop', 'Stop-loss price (USD)', `Use a stop-loss ${form.side === 'long' ? 'below' : 'above'} entry based on your trade’s invalidation level.`)}
              {field('target', 'Take-profit price (USD)')}
              {field('openTrades', 'Currently open leveraged trades')}
              <div className="sm:col-span-2">{field('margin', 'Custom margin (USD, optional)', `Leave blank to use ${recommendedPercent(Number(form.leverage))}% of your wallet. Estimates use this override when supplied.`, 'Use recommended margin')}</div>
            </>}
          </div>
          {!spot && Number(form.leverage) < 10 && <p className="mt-5 text-sm leading-6 text-black/70">1x–5x: a 1% margin fallback is used because the supplied strategy does not define these tiers.</p>}
        </section>
        <section className="panel min-w-0 p-5 sm:p-6" aria-labelledby="position-results">
          <p className="position-eyebrow">02 / Position overview</p>
          <h2 id="position-results" className="mt-2 text-2xl font-bold tracking-tight">{spot ? 'Leave room to diversify' : 'Know your risk before entry'}</h2>
          <p className="mb-5 mt-2 text-sm text-black/70">{spot ? 'Allocation for one coin, based on your selected percentage.' : 'Live estimates · USD · Before fees, funding and slippage'}</p>
          {!valid && <p className="position-error mb-4" role="status">Correct the highlighted inputs to see updated results.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {cards.map(([label, value, tone]) => <article key={label} className={`position-result ${tone || ''}`}>
              <p className="position-eyebrow">{label}</p>
              <p className="my-3 break-words text-2xl font-bold tracking-tight tabular-nums">{valid ? value : '--'}</p>
              <button className="position-copy" type="button" disabled={!valid} onClick={() => copy(label, value)} aria-label={`Copy ${label.toLowerCase()}`}>Copy value</button>
            </article>)}
          </div>
          <div className="mt-5 space-y-3" aria-live="polite">
            {result.warnings.map((warning) => <p className="position-warning" key={warning}><strong>Watch out:</strong> {warning}</p>)}
          </div>
          <p className="mt-4 text-sm font-semibold" role="status">{notice}</p>
          {storageError && <p className="position-warning">Browser storage is unavailable. Inputs will not be saved after leaving this page.</p>}
        </section>
      </div>
      <section className="panel mt-6 p-5 sm:p-6" aria-label="Strategy reference">
        <p className="position-eyebrow">Keep a wallet reserve</p>
        <div className="my-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[['10x–20x', '1% margin'], ['30x–40x', '0.5% margin'], ['50x', '0.25% margin'], ['Spot / per coin', '5–10% maximum']].map(([label, value]) => <div key={label} className="position-result"><p className="position-eyebrow">{label}</p><p className="mt-2 text-lg font-bold">{value}</p></div>)}
        </div>
        <p className="text-sm leading-6 text-black/70">Never use the whole wallet. Leverage changes exposure; actual risk depends on position size and stop-loss distance. Use a stop-loss on every leveraged trade. Stops do not guarantee the execution price. Exact liquidation requires an exchange-specific maintenance-margin model and is not calculated here.</p>
        <p className="mt-3 text-sm leading-6 text-black/70">Notional = margin × leverage. Estimated loss = notional × stop-loss distance %. Estimated profit = notional × target distance %. Risk/reward = estimated profit ÷ estimated loss.</p>
      </section>
      <p className="mt-5 text-center text-xs leading-6 text-black/70">This calculator is for education only and is not financial advice.</p>
    </div>
  );
}
