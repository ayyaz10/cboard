import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { useTheme } from '../../../contexts/ThemeContext';
import { useConfirmDialog } from '../../../hooks/useConfirmDialog';
import {
  clearCryptoFuturesTrades,
  createCryptoFuturesTrade,
  deleteCryptoFuturesTrade,
  getCryptoFuturesTrades,
} from '../../../services/cryptoFuturesTradeService';
import {
  calculateCryptoFuturesTrade,
  formatPercent,
  formatQuantity,
  formatRatio,
  formatUsd,
  initialCryptoFuturesForm,
  quickLeverages,
  validateCryptoFuturesForm,
} from './cryptoFuturesMath';

const fieldConfig = [
  {
    name: 'assetSymbol',
    label: 'Coin / Currency',
    placeholder: 'BTCUSDT',
    type: 'text',
    inputMode: 'text',
  },
  { name: 'entryPrice', label: 'Entry Price', placeholder: '65000' },
  { name: 'takeProfitPrice', label: 'Take Profit Price', placeholder: '68000' },
  { name: 'stopLossPrice', label: 'Stop Loss Price', placeholder: '63500' },
  { name: 'marginUsed', label: 'Margin Used in USD', placeholder: '100' },
  { name: 'leverage', label: 'Leverage', placeholder: '10' },
];

function createPartialTakeProfit() {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    price: '',
    closePercent: '',
  };
}

function formatPartials(entry) {
  if (!entry.partialTakeProfits?.length) {
    return 'None';
  }

  return entry.partialTakeProfits
    .map((partial) =>
      `${formatUsd(partial.price)} / ${formatPercent(partial.closePercent)}`,
    )
    .join(', ');
}

function TradeInput({
  label,
  name,
  value,
  placeholder,
  hint,
  error,
  onChange,
  isMatrixTheme,
  type = 'number',
  inputMode = 'decimal',
  min = '0',
  step = 'any',
}) {
  return (
    <label className="block">
      <span className={`mb-2 block text-xs font-bold uppercase tracking-[0.14em] ${
        isMatrixTheme ? 'text-white/60' : 'text-black/70'
      }`}
      >
        {label}
      </span>
      <input
        className={`w-full rounded-[1.1rem] border-2 px-4 py-3 text-base font-bold outline-none transition focus:-translate-y-px ${
          isMatrixTheme
            ? `bg-[#070b10] text-white placeholder:text-white/25 focus:shadow-[0_0_0_3px_rgba(197,255,111,0.18)] ${
              error ? 'border-[#ff6b6b]' : 'border-white/15 focus:border-[#c5ff6f]'
            }`
            : `bg-[#fffdf8] text-black placeholder:text-black/35 shadow-[4px_4px_0_#000] focus:shadow-[6px_6px_0_#000] ${
              error ? 'border-[#ff6b6b]' : 'border-black'
            }`
        }`}
        name={name}
        type={type}
        inputMode={inputMode}
        min={type === 'number' ? min : undefined}
        step={type === 'number' ? step : undefined}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
      />
      {error ? (
        <span className={`mt-2 block text-xs font-bold uppercase tracking-[0.12em] ${
          isMatrixTheme ? 'text-[#ff8a8a]' : 'text-[#b42318]'
        }`}
        >
          {error}
        </span>
      ) : hint ? (
        <span className={`mt-2 block text-xs font-semibold leading-5 ${
          isMatrixTheme ? 'text-white/40' : 'text-black/55'
        }`}
        >
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function ResultCard({ label, value, tone = 'neutral', isMatrixTheme }) {
  const toneClass = isMatrixTheme
    ? {
      profit: 'border-[#22c55e]/50 bg-[#071d12] text-[#6ee7a8]',
      loss: 'border-[#ef4444]/50 bg-[#220b0b] text-[#ff9b9b]',
      neutral: 'border-white/15 bg-[#0b1118] text-white',
    }[tone]
    : {
      profit: 'border-black bg-[#d9ff9f] text-black',
      loss: 'border-black bg-[#ffe0de] text-black',
      neutral: 'border-black bg-[#fffdf8] text-black',
    }[tone];

  return (
    <article className={`rounded-[1.25rem] border-2 p-4 ${toneClass} ${
      isMatrixTheme ? '' : 'shadow-[4px_4px_0_#000]'
    }`}
    >
      <p className={`text-xs font-bold uppercase tracking-[0.14em] ${
        isMatrixTheme ? 'text-white/50' : 'text-black/55'
      }`}
      >
        {label}
      </p>
      <p className="mt-3 break-words text-2xl font-bold tracking-[-0.04em]">
        {value}
      </p>
    </article>
  );
}

function formatTradeDate(value) {
  return new Date(value).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function TradeHistoryTable({
  entries,
  emptyMessage,
  isMatrixTheme,
  onDelete,
}) {
  if (entries.length === 0) {
    return (
      <div className={`mt-5 rounded-[1.25rem] border-2 border-dashed p-6 text-center text-sm font-bold leading-6 ${
        isMatrixTheme
          ? 'border-white/15 bg-[#070b10] text-white/45'
          : 'border-black bg-[#fffdf8] text-black/55'
      }`}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={`mt-5 overflow-x-auto rounded-[1.25rem] border-2 ${
      isMatrixTheme ? 'border-white/10' : 'border-black'
    }`}
    >
      <table className="min-w-[64rem] w-full border-collapse text-left">
        <thead className={isMatrixTheme ? 'bg-[#0b1118]' : 'bg-[#fff0b8]'}>
          <tr>
            {['Date', 'Market', 'Side', 'Entry', 'TP', 'Partials', 'SL', 'Margin', 'Lev.', 'Profit', 'Loss', 'R/R', ''].map((heading) => (
              <th
                key={heading || 'action'}
                className={`border-b-2 px-3 py-3 text-xs font-bold uppercase tracking-[0.12em] ${
                  isMatrixTheme
                    ? 'border-white/10 text-white/55'
                    : 'border-black text-black/55'
                }`}
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.id}
              className={isMatrixTheme ? 'bg-black' : 'bg-[#fffdf8]'}
            >
              <td className={`border-b px-3 py-3 text-sm font-bold ${
                isMatrixTheme ? 'border-white/10 text-white/70' : 'border-black/15 text-black/70'
              }`}
              >
                {formatTradeDate(entry.createdAt)}
              </td>
              <td className={`border-b px-3 py-3 ${
                isMatrixTheme ? 'border-white/10' : 'border-black/15'
              }`}
              >
                <span className={`rounded-full border-2 px-2.5 py-1 text-xs font-bold uppercase tracking-[0.12em] ${
                  isMatrixTheme
                    ? 'border-[#c5ff6f]/40 bg-[#071d12] text-[#c5ff6f]'
                    : 'border-black bg-[#c5ff6f] text-black'
                }`}
                >
                  {entry.assetSymbol}
                </span>
              </td>
              <td className={`border-b px-3 py-3 ${
                isMatrixTheme ? 'border-white/10' : 'border-black/15'
              }`}
              >
                <span className={`rounded-full border-2 px-2.5 py-1 text-xs font-bold uppercase tracking-[0.12em] ${
                  entry.side === 'long'
                    ? isMatrixTheme
                      ? 'border-[#22c55e]/45 bg-[#071d12] text-[#6ee7a8]'
                      : 'border-black bg-[#d9ff9f] text-black'
                    : isMatrixTheme
                      ? 'border-[#ef4444]/45 bg-[#220b0b] text-[#ff9b9b]'
                      : 'border-black bg-[#ffe0de] text-black'
                }`}
                >
                  {entry.side}
                </span>
              </td>
              {[
                formatUsd(entry.entryPrice),
                formatUsd(entry.takeProfitPrice),
                formatPartials(entry),
                formatUsd(entry.stopLossPrice),
                formatUsd(entry.marginUsed),
                `${entry.leverage}x`,
                formatUsd(entry.profitAtTakeProfit),
                formatUsd(entry.lossAtStopLoss),
                formatRatio(entry.riskRewardRatio),
              ].map((value, index) => (
                <td
                  key={`${entry.id}-${index}`}
                  className={`border-b px-3 py-3 text-sm font-bold ${
                    index === 6
                      ? isMatrixTheme ? 'border-white/10 text-[#6ee7a8]' : 'border-black/15 text-[#0f7a35]'
                      : index === 7
                        ? isMatrixTheme ? 'border-white/10 text-[#ff9b9b]' : 'border-black/15 text-[#b42318]'
                        : isMatrixTheme ? 'border-white/10 text-white' : 'border-black/15 text-black'
                  }`}
                >
                  {value}
                </td>
              ))}
              <td className={`border-b px-3 py-3 text-right ${
                isMatrixTheme ? 'border-white/10' : 'border-black/15'
              }`}
              >
                <button
                  type="button"
                  onClick={() => onDelete(entry.id)}
                  className={`rounded-full border-2 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] transition ${
                    isMatrixTheme
                      ? 'border-[#ef4444]/45 bg-[#220b0b] text-[#ff9b9b] hover:border-[#ef4444]'
                      : 'border-black bg-[#ffe0de] text-black hover:bg-[#ffb4ad]'
                  }`}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function sumProfit(entries) {
  return entries.reduce((sum, entry) => sum + entry.profitAtTakeProfit, 0);
}

function JournalChart({ entries, allEntries, selectedMarket, isMatrixTheme }) {
  let cumulativeProfit = 0;
  const chartData = [...entries].reverse().map((entry, index) => {
    const tradeProfit = Number(entry.profitAtTakeProfit.toFixed(2));
    cumulativeProfit += tradeProfit;

    return {
      label: `#${index + 1}`,
      profit: tradeProfit,
      cumulativeProfit: Number(cumulativeProfit.toFixed(2)),
      partialProfit: Number((entry.partialProfitTotal || 0).toFixed(2)),
      finalProfit: Number((entry.finalTakeProfitProfit ?? entry.profitAtTakeProfit).toFixed(2)),
    };
  });
  const selectedProfit = sumProfit(entries);
  const allProfit = sumProfit(allEntries);
  const axisColor = isMatrixTheme ? '#d9ffd9' : '#000';
  const gridColor = isMatrixTheme ? '#00a812' : '#000';

  return (
    <div className="mt-5 grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={`rounded-[1.25rem] border-2 p-4 ${
          isMatrixTheme
            ? 'border-[#22c55e]/45 bg-[#071d12] text-[#6ee7a8]'
            : 'border-black bg-[#d9ff9f] text-black shadow-[4px_4px_0_#000]'
        }`}
        >
          <p className={`text-xs font-bold uppercase tracking-[0.14em] ${
            isMatrixTheme ? 'text-white/60' : 'text-black/55'
          }`}
          >
            {selectedMarket === 'all' ? 'All markets journal profit' : `${selectedMarket} journal profit`}
          </p>
          <p className="mt-2 text-4xl font-bold tracking-[-0.05em]">
            {formatUsd(selectedProfit)}
          </p>
        </div>

        <div className={`rounded-[1.25rem] border-2 p-4 ${
          isMatrixTheme
            ? 'border-white/15 bg-[#0b1118] text-white'
            : 'border-black bg-[#fffdf8] text-black shadow-[4px_4px_0_#000]'
        }`}
        >
          <p className={`text-xs font-bold uppercase tracking-[0.14em] ${
            isMatrixTheme ? 'text-white/60' : 'text-black/55'
          }`}
          >
            Total profit across all markets
          </p>
          <p className="mt-2 text-4xl font-bold tracking-[-0.05em]">
            {formatUsd(allProfit)}
          </p>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className={`rounded-[1.25rem] border-2 border-dashed p-6 text-center text-sm font-bold leading-6 ${
          isMatrixTheme
            ? 'border-white/15 bg-[#070b10] text-white/45'
            : 'border-black bg-[#fffdf8] text-black/55'
        }`}
        >
          Save journal trades for this market to draw the profit chart.
        </div>
      ) : (
      <div className={`h-80 rounded-[1.25rem] border-2 p-3 sm:h-96 ${
        isMatrixTheme
          ? 'border-white/10 bg-[#070b10]'
          : 'border-black bg-[#fffdf8]'
      }`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 14, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid
              stroke={gridColor}
              strokeDasharray="4 6"
              strokeOpacity={isMatrixTheme ? 0.32 : 0.14}
            />
            <XAxis
              dataKey="label"
              tick={{ fill: axisColor, fontSize: 12, fontWeight: 700 }}
              tickLine={false}
              axisLine={{ stroke: axisColor, strokeWidth: 2 }}
            />
            <YAxis
              tick={{ fill: axisColor, fontSize: 12, fontWeight: 700 }}
              tickLine={false}
              axisLine={{ stroke: axisColor, strokeWidth: 2 }}
              width={64}
            />
            <Tooltip
              cursor={{ stroke: isMatrixTheme ? '#00ff41' : '#000', strokeWidth: 2 }}
              formatter={(value) => formatUsd(value)}
            />
            <Legend
              wrapperStyle={{
                color: axisColor,
                fontSize: 12,
                fontWeight: 800,
                textTransform: 'uppercase',
              }}
            />
            <Line
              type="monotone"
              dataKey="cumulativeProfit"
              name={selectedMarket === 'all' ? 'All markets cumulative profit' : `${selectedMarket} cumulative profit`}
              stroke="#22c55e"
              strokeWidth={4}
              dot={{ r: 5, strokeWidth: 2, fill: '#22c55e' }}
              activeDot={{ r: 7 }}
            />
            <Line
              type="monotone"
              dataKey="profit"
              name="Trade profit"
              stroke="#84cc16"
              strokeWidth={3}
              dot={{ r: 4, strokeWidth: 2, fill: '#84cc16' }}
            />
            <Line
              type="monotone"
              dataKey="partialProfit"
              name="Partial TP profit"
              stroke="#9fe3ff"
              strokeWidth={3}
              dot={{ r: 4, strokeWidth: 2, fill: '#9fe3ff' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      )}
    </div>
  );
}

function JournalEntryCard({ entry, isMatrixTheme, onDelete }) {
  const createdAt = new Date(entry.createdAt).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const sideTone = entry.side === 'long'
    ? isMatrixTheme
      ? 'border-[#22c55e]/45 bg-[#071d12] text-[#6ee7a8]'
      : 'border-black bg-[#d9ff9f] text-black'
    : isMatrixTheme
      ? 'border-[#ef4444]/45 bg-[#220b0b] text-[#ff9b9b]'
      : 'border-black bg-[#ffe0de] text-black';

  return (
    <article className={`rounded-[1.35rem] border-2 p-4 ${
      isMatrixTheme
        ? 'border-white/10 bg-[#0b1118]'
        : 'border-black bg-[#fffdf8]'
    }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border-2 px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] ${sideTone}`}>
              {entry.side}
            </span>
            <span className={`text-xs font-bold uppercase tracking-[0.12em] ${
              isMatrixTheme ? 'text-white/45' : 'text-black/55'
            }`}
            >
              {createdAt}
            </span>
          </div>
          <p className={`mt-3 text-lg font-bold tracking-[-0.03em] ${
            isMatrixTheme ? 'text-white' : 'text-black'
          }`}
          >
            Entry {formatUsd(entry.entryPrice)} {'->'} TP {formatUsd(entry.takeProfitPrice)}
          </p>
          <p className={`mt-1 text-sm font-semibold ${
            isMatrixTheme ? 'text-white/55' : 'text-black/60'
          }`}
          >
            SL {formatUsd(entry.stopLossPrice)} | Margin {formatUsd(entry.marginUsed)} | {entry.leverage}x
          </p>
        </div>
        <button
          type="button"
          onClick={() => onDelete(entry.id)}
          className={`rounded-full border-2 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] transition ${
            isMatrixTheme
              ? 'border-[#ef4444]/45 bg-[#220b0b] text-[#ff9b9b] hover:border-[#ef4444]'
              : 'border-black bg-[#ffe0de] text-black hover:bg-[#ffb4ad]'
          }`}
        >
          Delete
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <ResultCard
          label="Profit"
          value={formatUsd(entry.profitAtTakeProfit)}
          tone="profit"
          isMatrixTheme={isMatrixTheme}
        />
        <ResultCard
          label="Loss"
          value={formatUsd(entry.lossAtStopLoss)}
          tone="loss"
          isMatrixTheme={isMatrixTheme}
        />
        <ResultCard
          label="ROI"
          value={formatPercent(entry.profitRoi)}
          tone="profit"
          isMatrixTheme={isMatrixTheme}
        />
        <ResultCard
          label="Risk / Reward"
          value={formatRatio(entry.riskRewardRatio)}
          isMatrixTheme={isMatrixTheme}
        />
      </div>
    </article>
  );
}

export function CryptoFuturesCalculator() {
  const { isMatrixTheme } = useTheme();
  const { confirm, dialog } = useConfirmDialog();
  const [form, setForm] = useState(initialCryptoFuturesForm);
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);
  const [saveToJournal, setSaveToJournal] = useState(true);
  const [activeLogTab, setActiveLogTab] = useState('normal');
  const [tradeHistory, setTradeHistory] = useState([]);
  const [tradeJournal, setTradeJournal] = useState([]);
  const [selectedMarket, setSelectedMarket] = useState('all');
  const [isLoadingTrades, setIsLoadingTrades] = useState(true);
  const [isSavingTrade, setIsSavingTrade] = useState(false);
  const [tradeError, setTradeError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadTrades() {
      setIsLoadingTrades(true);
      setTradeError('');

      try {
        const [normalTrades, journalTrades] = await Promise.all([
          getCryptoFuturesTrades('normal'),
          getCryptoFuturesTrades('journal'),
        ]);

        if (!isMounted) {
          return;
        }

        setTradeHistory(normalTrades);
        setTradeJournal(journalTrades);
      } catch {
        if (isMounted) {
          setTradeError('Could not load saved trades. Run the latest Supabase schema, then refresh.');
        }
      } finally {
        if (isMounted) {
          setIsLoadingTrades(false);
        }
      }
    }

    loadTrades();

    return () => {
      isMounted = false;
    };
  }, []);

  const marketOptions = useMemo(() => {
    const symbols = new Set();

    [...tradeHistory, ...tradeJournal].forEach((entry) => {
      if (entry.assetSymbol) {
        symbols.add(entry.assetSymbol);
      }
    });

    return ['all', ...Array.from(symbols).sort()];
  }, [tradeHistory, tradeJournal]);

  useEffect(() => {
    if (!marketOptions.includes(selectedMarket)) {
      setSelectedMarket('all');
    }
  }, [marketOptions, selectedMarket]);

  const filteredTradeHistory = useMemo(() => (
    selectedMarket === 'all'
      ? tradeHistory
      : tradeHistory.filter((entry) => entry.assetSymbol === selectedMarket)
  ), [selectedMarket, tradeHistory]);

  const filteredTradeJournal = useMemo(() => (
    selectedMarket === 'all'
      ? tradeJournal
      : tradeJournal.filter((entry) => entry.assetSymbol === selectedMarket)
  ), [selectedMarket, tradeJournal]);

  const resultCards = useMemo(() => {
    if (!result) {
      return [];
    }

    return [
      { label: 'Market', value: result.assetSymbol },
      { label: 'Position Size', value: formatUsd(result.positionSize) },
      { label: 'Quantity', value: formatQuantity(result.quantity) },
      { label: 'Partial TP Profit', value: formatUsd(result.partialProfitTotal), tone: 'profit' },
      { label: 'Final TP Profit', value: formatUsd(result.finalTakeProfitProfit), tone: 'profit' },
      { label: 'Profit at TP', value: formatUsd(result.profitAtTakeProfit), tone: 'profit' },
      { label: 'Loss at SL', value: formatUsd(result.lossAtStopLoss), tone: 'loss' },
      { label: 'Profit ROI', value: formatPercent(result.profitRoi), tone: 'profit' },
      { label: 'Loss ROI', value: formatPercent(result.lossRoi), tone: 'loss' },
      { label: 'TP Move', value: formatPercent(result.takeProfitMove), tone: 'profit' },
      { label: 'SL Move', value: formatPercent(result.stopLossMove), tone: 'loss' },
      { label: 'Risk / Reward', value: formatRatio(result.riskRewardRatio) },
    ];
  }, [result]);

  function updateForm(event) {
    const { name, value } = event.target;
    setForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
  }

  function addPartialTakeProfit() {
    setForm((currentForm) => ({
      ...currentForm,
      partialTakeProfits: [
        ...(currentForm.partialTakeProfits ?? []),
        createPartialTakeProfit(),
      ],
    }));
  }

  function updatePartialTakeProfit(partialId, field, value) {
    setForm((currentForm) => ({
      ...currentForm,
      partialTakeProfits: (currentForm.partialTakeProfits ?? []).map((partial) =>
        partial.id === partialId ? { ...partial, [field]: value } : partial,
      ),
    }));
  }

  function removePartialTakeProfit(partialId) {
    setForm((currentForm) => ({
      ...currentForm,
      partialTakeProfits: (currentForm.partialTakeProfits ?? []).filter(
        (partial) => partial.id !== partialId,
      ),
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const validationErrors = validateCryptoFuturesForm(form);
    setErrors(validationErrors);
    setTradeError('');

    if (Object.keys(validationErrors).length > 0) {
      setResult(null);
      return;
    }

    const nextResult = calculateCryptoFuturesTrade(form);
    const calculatedEntry = {
      createdAt: new Date().toISOString(),
      ...nextResult,
    };

    setResult(nextResult);
    setIsSavingTrade(true);

    try {
      const savedHistoryEntry = await createCryptoFuturesTrade('normal', calculatedEntry);
      setTradeHistory((currentHistory) => [savedHistoryEntry, ...currentHistory].slice(0, 60));
      setSelectedMarket(savedHistoryEntry.assetSymbol);

      if (saveToJournal) {
        const savedJournalEntry = await createCryptoFuturesTrade('journal', calculatedEntry);
        setTradeJournal((currentJournal) => [savedJournalEntry, ...currentJournal].slice(0, 60));
        setActiveLogTab('journal');
        return;
      }

      setActiveLogTab('normal');
    } catch {
      setTradeError('Could not save this trade. Run the latest Supabase schema, then try again.');
    } finally {
      setIsSavingTrade(false);
    }
  }

  function handleReset() {
    setForm(initialCryptoFuturesForm);
    setErrors({});
    setResult(null);
  }

  async function deleteJournalEntry(entryId) {
    const shouldDelete = await confirm({
      title: 'Delete journal entry?',
      message: 'This removes the trade from the journal and the profit chart.',
      confirmLabel: 'Delete entry',
    });

    if (!shouldDelete) {
      return;
    }

    try {
      await deleteCryptoFuturesTrade(entryId);
      setTradeJournal((currentJournal) =>
        currentJournal.filter((entry) => entry.id !== entryId),
      );
    } catch {
      setTradeError('Could not delete this journal entry. Please try again.');
    }
  }

  async function clearJournal() {
    const marketLabel = selectedMarket === 'all' ? 'all markets' : selectedMarket;
    const shouldClear = await confirm({
      title: 'Clear journal entries?',
      message: `This removes journal trades for ${marketLabel} and updates the profit chart.`,
      confirmLabel: 'Clear journal',
    });

    if (!shouldClear) {
      return;
    }

    try {
      await clearCryptoFuturesTrades('journal', selectedMarket);
      setTradeJournal((currentJournal) => (
        selectedMarket === 'all'
          ? []
          : currentJournal.filter((entry) => entry.assetSymbol !== selectedMarket)
      ));
    } catch {
      setTradeError('Could not clear journal entries. Please try again.');
    }
  }

  async function deleteHistoryEntry(entryId) {
    const shouldDelete = await confirm({
      title: 'Delete normal entry?',
      message: 'This removes the trade from normal history only.',
      confirmLabel: 'Delete entry',
    });

    if (!shouldDelete) {
      return;
    }

    try {
      await deleteCryptoFuturesTrade(entryId);
      setTradeHistory((currentHistory) =>
        currentHistory.filter((entry) => entry.id !== entryId),
      );
    } catch {
      setTradeError('Could not delete this normal entry. Please try again.');
    }
  }

  async function clearHistory() {
    const marketLabel = selectedMarket === 'all' ? 'all markets' : selectedMarket;
    const shouldClear = await confirm({
      title: 'Clear normal history?',
      message: `This removes normal history trades for ${marketLabel}. Journal entries stay separate.`,
      confirmLabel: 'Clear normal',
    });

    if (!shouldClear) {
      return;
    }

    try {
      await clearCryptoFuturesTrades('normal', selectedMarket);
      setTradeHistory((currentHistory) => (
        selectedMarket === 'all'
          ? []
          : currentHistory.filter((entry) => entry.assetSymbol !== selectedMarket)
      ));
    } catch {
      setTradeError('Could not clear normal history. Please try again.');
    }
  }

  return (
    <>
    <div className={`rounded-[1.75rem] border-2 p-4 shadow-[8px_8px_0_#000] sm:p-5 lg:p-6 ${
      isMatrixTheme
        ? 'border-black bg-[#05070a] text-white'
        : 'border-black bg-[#fffdf8] text-black'
    }`}
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(320px,0.82fr)_minmax(0,1.18fr)]">
        <form
          noValidate
          onSubmit={handleSubmit}
          className={`rounded-[1.5rem] border-2 p-5 ${
            isMatrixTheme
              ? 'border-white/10 bg-[#0b1118]'
              : 'border-black bg-[#fff0b8]'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className={`text-xs font-bold uppercase tracking-[0.18em] ${
                isMatrixTheme ? 'text-[#c5ff6f]' : 'text-black/55'
              }`}
              >
                Trade setup
              </p>
              <h2 className={`mt-2 text-2xl font-bold tracking-[-0.04em] ${
                isMatrixTheme ? 'text-white' : 'text-black'
              }`}
              >
                Plan before entry
              </h2>
            </div>
            <span className={`rounded-full border-2 px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] ${
              isMatrixTheme
                ? 'border-white/15 bg-black text-white/70'
                : 'border-black bg-white text-black'
            }`}
            >
              Futures
            </span>
          </div>

          <div className={`mt-5 grid grid-cols-2 gap-2 rounded-[1.1rem] border-2 p-1.5 ${
            isMatrixTheme
              ? 'border-white/10 bg-black'
              : 'border-black bg-[#fffdf8]'
          }`}
          >
            {['long', 'short'].map((side) => {
              const isActive = form.side === side;

              return (
                <button
                  key={side}
                  type="button"
                  onClick={() => setForm((currentForm) => ({ ...currentForm, side }))}
                  className={`rounded-[0.85rem] px-4 py-3 text-sm font-bold uppercase tracking-[0.14em] transition ${
                    isActive
                      ? side === 'long'
                        ? 'bg-[#22c55e] text-black'
                        : 'bg-[#ef4444] text-white'
                      : isMatrixTheme
                        ? 'text-white/55 hover:bg-white/5 hover:text-white'
                        : 'text-black/55 hover:bg-[#f8f3ea] hover:text-black'
                  }`}
                >
                  {side}
                </button>
              );
            })}
          </div>

          <div className="mt-5 grid gap-4">
            {fieldConfig.map((field) => (
              <div key={field.name}>
                <TradeInput
                  {...field}
                  value={form[field.name]}
                  error={errors[field.name]}
                  onChange={updateForm}
                  isMatrixTheme={isMatrixTheme}
                />
                {field.name === 'leverage' ? (
                  <div className="mt-3">
                    <p className={`mb-2 text-xs font-bold uppercase tracking-[0.14em] ${
                      isMatrixTheme ? 'text-white/60' : 'text-black/70'
                    }`}
                    >
                      Quick leverage
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {quickLeverages.map((leverage) => (
                        <button
                          key={leverage}
                          type="button"
                          onClick={() =>
                            setForm((currentForm) => ({
                              ...currentForm,
                              leverage: String(leverage),
                            }))
                          }
                          className={`rounded-full border-2 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] transition ${
                            Number(form.leverage) === leverage
                              ? 'border-[#c5ff6f] bg-[#c5ff6f] text-black'
                              : isMatrixTheme
                                ? 'border-white/15 bg-black text-white/70 hover:border-white/35 hover:text-white'
                                : 'border-black bg-white text-black hover:bg-[#f8f3ea]'
                          }`}
                        >
                          {leverage}x
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className={`mt-5 rounded-[1.1rem] border-2 p-4 ${
            isMatrixTheme
              ? 'border-white/10 bg-black'
              : 'border-black bg-[#fffdf8]'
          }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className={`text-xs font-bold uppercase tracking-[0.14em] ${
                  isMatrixTheme ? 'text-white/60' : 'text-black/70'
                }`}
                >
                  Partial take profits
                </p>
                <p className={`mt-1 text-sm font-semibold leading-5 ${
                  isMatrixTheme ? 'text-white/40' : 'text-black/55'
                }`}
                >
                  Add TP price and close percentage. Remaining size exits at the main TP.
                </p>
              </div>
              <button
                type="button"
                onClick={addPartialTakeProfit}
                className="rounded-full border-2 border-[#c5ff6f] bg-[#c5ff6f] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-black"
              >
                Add partial
              </button>
            </div>

            {errors.partialTakeProfits ? (
              <p className={`mt-3 rounded-[0.9rem] border-2 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] ${
                isMatrixTheme
                  ? 'border-[#ef4444]/45 bg-[#220b0b] text-[#ff9b9b]'
                  : 'border-black bg-[#ffe0de] text-black'
              }`}
              >
                {errors.partialTakeProfits}
              </p>
            ) : null}

            {(form.partialTakeProfits ?? []).length === 0 ? (
              <p className={`mt-4 rounded-[0.9rem] border-2 border-dashed px-3 py-3 text-sm font-bold ${
                isMatrixTheme
                  ? 'border-white/15 text-white/35'
                  : 'border-black text-black/45'
              }`}
              >
                No partial exits added.
              </p>
            ) : (
              <div className="mt-4 grid gap-3">
                {form.partialTakeProfits.map((partial, index) => (
                  <div
                    key={partial.id}
                    className={`grid gap-3 rounded-[1rem] border-2 p-3 md:grid-cols-[1fr_0.8fr_auto] ${
                      isMatrixTheme
                        ? 'border-white/10 bg-[#070b10]'
                        : 'border-black bg-[#fff0b8]'
                    }`}
                  >
                    <TradeInput
                      label={`Partial TP ${index + 1}`}
                      name={`partial-price-${partial.id}`}
                      value={partial.price}
                      placeholder="67000"
                      error={errors[`partialPrice_${index}`]}
                      onChange={(event) =>
                        updatePartialTakeProfit(partial.id, 'price', event.target.value)
                      }
                      isMatrixTheme={isMatrixTheme}
                    />
                    <TradeInput
                      label="Close %"
                      name={`partial-close-${partial.id}`}
                      value={partial.closePercent}
                      placeholder="25"
                      error={errors[`partialClose_${index}`]}
                      onChange={(event) =>
                        updatePartialTakeProfit(partial.id, 'closePercent', event.target.value)
                      }
                      isMatrixTheme={isMatrixTheme}
                    />
                    <button
                      type="button"
                      onClick={() => removePartialTakeProfit(partial.id)}
                      className={`self-end rounded-full border-2 px-4 py-3 text-xs font-bold uppercase tracking-[0.12em] transition ${
                        isMatrixTheme
                          ? 'border-[#ef4444]/45 bg-[#220b0b] text-[#ff9b9b] hover:border-[#ef4444]'
                          : 'border-black bg-[#ffe0de] text-black hover:bg-[#ffb4ad]'
                      }`}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <label className={`mt-5 flex items-center justify-between gap-4 rounded-[1.1rem] border-2 p-4 ${
            isMatrixTheme
              ? 'border-white/10 bg-black'
              : 'border-black bg-[#fffdf8]'
          }`}
          >
            <span>
              <span className={`block text-xs font-bold uppercase tracking-[0.14em] ${
                isMatrixTheme ? 'text-white/60' : 'text-black/70'
              }`}
              >
                Save to journal
              </span>
              <span className={`mt-1 block text-sm font-semibold leading-5 ${
                isMatrixTheme ? 'text-white/40' : 'text-black/55'
              }`}
              >
                On saves to normal history and journal. Off saves only to normal history.
              </span>
            </span>
            <button
              type="button"
              onClick={() => setSaveToJournal((currentValue) => !currentValue)}
              className={`relative h-8 w-14 shrink-0 rounded-full border-2 transition ${
                saveToJournal
                  ? 'border-[#22c55e] bg-[#22c55e]'
                  : isMatrixTheme
                    ? 'border-white/25 bg-[#070b10]'
                    : 'border-black bg-white'
              }`}
              aria-pressed={saveToJournal}
            >
              <span
                className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${
                  saveToJournal ? 'left-8' : 'left-1'
                }`}
              />
            </button>
          </label>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="submit"
              disabled={isSavingTrade}
              className="inline-flex flex-1 items-center justify-center rounded-full border-2 border-[#c5ff6f] bg-[#c5ff6f] px-5 py-3.5 text-sm font-bold uppercase tracking-[0.12em] text-black shadow-[4px_4px_0_#000] transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_#000] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSavingTrade ? 'Saving' : 'Calculate'}
            </button>
            <button
              type="button"
              onClick={handleReset}
              className={`inline-flex flex-1 items-center justify-center rounded-full border-2 px-5 py-3.5 text-sm font-bold uppercase tracking-[0.12em] transition ${
                isMatrixTheme
                  ? 'border-white/20 bg-black text-white hover:border-white/45'
                  : 'border-black bg-white text-black hover:bg-[#f8f3ea]'
              }`}
            >
              Reset
            </button>
          </div>
        </form>

        <section
          aria-live="polite"
          className={`rounded-[1.5rem] border-2 p-5 ${
            isMatrixTheme
              ? 'border-white/10 bg-black'
              : 'border-black bg-[#f8f3ea]'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className={`text-xs font-bold uppercase tracking-[0.18em] ${
                isMatrixTheme ? 'text-white/45' : 'text-black/55'
              }`}
              >
                Result
              </p>
              <h2 className={`mt-2 text-2xl font-bold tracking-[-0.04em] ${
                isMatrixTheme ? 'text-white' : 'text-black'
              }`}
              >
                Trade outcome
              </h2>
            </div>
            <span
              className={`rounded-full border-2 px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] ${
                form.side === 'long'
                  ? 'border-[#22c55e]/45 bg-[#071d12] text-[#6ee7a8]'
                  : 'border-[#ef4444]/45 bg-[#220b0b] text-[#ff9b9b]'
              }`}
            >
              {form.side}
            </span>
          </div>

          {result ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {resultCards.map((card) => (
                <ResultCard
                  key={card.label}
                  {...card}
                  isMatrixTheme={isMatrixTheme}
                />
              ))}
            </div>
          ) : (
            <div className={`mt-5 flex min-h-[24rem] items-center justify-center rounded-[1.25rem] border-2 border-dashed p-6 text-center ${
              isMatrixTheme
                ? 'border-white/15 bg-[#070b10]'
                : 'border-black bg-[#fffdf8]'
            }`}
            >
              <p className={`max-w-sm text-lg font-bold leading-7 tracking-[-0.03em] ${
                isMatrixTheme ? 'text-white/45' : 'text-black/55'
              }`}
              >
                Enter a valid setup and press Calculate to preview profit,
                loss, ROI, and risk/reward.
              </p>
            </div>
          )}

          <p className={`mt-5 rounded-[1rem] border-2 px-4 py-3 text-sm font-bold leading-6 ${
            isMatrixTheme
              ? 'border-[#ffd166]/30 bg-[#211a08] text-[#ffd166]'
              : 'border-black bg-[#fff0b8] text-black/70'
          }`}
          >
            This calculator does not include exchange fees, funding fees, or
            liquidation price.
          </p>
        </section>
      </div>

      <section className={`mt-5 rounded-[1.5rem] border-2 p-5 ${
        isMatrixTheme
          ? 'border-white/10 bg-black'
          : 'border-black bg-[#f8f3ea]'
      }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className={`text-xs font-bold uppercase tracking-[0.18em] ${
              isMatrixTheme ? 'text-white/45' : 'text-black/55'
            }`}
            >
              Entries
            </p>
            <h2 className={`mt-2 text-2xl font-bold tracking-[-0.04em] ${
              isMatrixTheme ? 'text-white' : 'text-black'
            }`}
            >
              Trade records
            </h2>
          </div>
          <div className={`flex flex-wrap gap-2 rounded-full border-2 p-1 ${
            isMatrixTheme ? 'border-white/10 bg-[#070b10]' : 'border-black bg-white'
          }`}
          >
            {[
              { id: 'normal', label: 'Normal entry' },
              { id: 'journal', label: 'Journal entry' },
              { id: 'chart', label: 'Chart' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveLogTab(tab.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] transition ${
                  activeLogTab === tab.id
                    ? 'bg-[#c5ff6f] text-black'
                    : isMatrixTheme
                      ? 'text-white/55 hover:bg-white/5 hover:text-white'
                      : 'text-black/55 hover:bg-[#f8f3ea] hover:text-black'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className={`mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[1.1rem] border-2 p-3 ${
          isMatrixTheme
            ? 'border-white/10 bg-[#070b10]'
            : 'border-black bg-[#fffdf8]'
        }`}
        >
          <div>
            <p className={`text-xs font-bold uppercase tracking-[0.14em] ${
              isMatrixTheme ? 'text-white/60' : 'text-black/70'
            }`}
            >
              Market filter
            </p>
            <p className={`mt-1 text-sm font-semibold ${
              isMatrixTheme ? 'text-white/40' : 'text-black/55'
            }`}
            >
              Normal history, journal, and chart follow this market.
            </p>
          </div>
          <select
            value={selectedMarket}
            onChange={(event) => setSelectedMarket(event.target.value)}
            className={`rounded-full border-2 px-4 py-2 text-sm font-bold uppercase tracking-[0.12em] outline-none ${
              isMatrixTheme
                ? 'border-[#c5ff6f]/45 bg-black text-[#c5ff6f]'
                : 'border-black bg-[#c5ff6f] text-black'
            }`}
            aria-label="Filter trades by market"
          >
            {marketOptions.map((market) => (
              <option key={market} value={market}>
                {market === 'all' ? 'All markets' : market}
              </option>
            ))}
          </select>
        </div>

        {tradeError ? (
          <p className={`mt-5 rounded-[1rem] border-2 px-4 py-3 text-sm font-bold leading-6 ${
            isMatrixTheme
              ? 'border-[#ef4444]/45 bg-[#220b0b] text-[#ff9b9b]'
              : 'border-black bg-[#ffe0de] text-black'
          }`}
          >
            {tradeError}
          </p>
        ) : null}

        {isLoadingTrades ? (
          <div className={`mt-5 rounded-[1.25rem] border-2 border-dashed p-6 text-center text-sm font-bold leading-6 ${
            isMatrixTheme
              ? 'border-white/15 bg-[#070b10] text-white/45'
              : 'border-black bg-[#fffdf8] text-black/55'
          }`}
          >
            Loading saved trades...
          </div>
        ) : null}

        {activeLogTab === 'normal' ? (
          <>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className={`text-sm font-bold leading-6 ${
                isMatrixTheme ? 'text-white/45' : 'text-black/55'
              }`}
              >
                All calculated trades are stored here. These entries do not affect the chart.
              </p>
              {filteredTradeHistory.length > 0 ? (
                <button
                  type="button"
                  onClick={clearHistory}
                  className={`rounded-full border-2 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] transition ${
                    isMatrixTheme
                      ? 'border-[#ef4444]/45 bg-[#220b0b] text-[#ff9b9b] hover:border-[#ef4444]'
                      : 'border-black bg-[#ffe0de] text-black hover:bg-[#ffb4ad]'
                  }`}
                >
                  Clear normal
                </button>
              ) : null}
            </div>
            <TradeHistoryTable
              entries={filteredTradeHistory}
              emptyMessage="Normal calculated trades for this market will appear here."
              isMatrixTheme={isMatrixTheme}
              onDelete={deleteHistoryEntry}
            />
          </>
        ) : null}

        {activeLogTab === 'journal' ? (
          <>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className={`text-sm font-bold leading-6 ${
                isMatrixTheme ? 'text-white/45' : 'text-black/55'
              }`}
              >
                Journal entries are the only trades used by the profit chart.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setActiveLogTab('chart')}
                  className="rounded-full border-2 border-[#c5ff6f] bg-[#c5ff6f] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-black"
                >
                  View chart
                </button>
                {filteredTradeJournal.length > 0 ? (
                  <button
                    type="button"
                    onClick={clearJournal}
                    className={`rounded-full border-2 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] transition ${
                      isMatrixTheme
                        ? 'border-[#ef4444]/45 bg-[#220b0b] text-[#ff9b9b] hover:border-[#ef4444]'
                        : 'border-black bg-[#ffe0de] text-black hover:bg-[#ffb4ad]'
                    }`}
                  >
                    Clear journal
                  </button>
                ) : null}
              </div>
            </div>
            <TradeHistoryTable
              entries={filteredTradeJournal}
              emptyMessage="Switch Save to journal on, then calculate a trade for this market."
              isMatrixTheme={isMatrixTheme}
              onDelete={deleteJournalEntry}
            />
          </>
        ) : null}

        {activeLogTab === 'chart' ? (
          <>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className={`text-sm font-bold leading-6 ${
                isMatrixTheme ? 'text-white/45' : 'text-black/55'
              }`}
              >
                Profit chart uses journal entries only. Stop loss stays in the table, not the chart.
              </p>
              <button
                type="button"
                onClick={() => setActiveLogTab('journal')}
                className={`rounded-full border-2 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] transition ${
                  isMatrixTheme
                    ? 'border-white/15 bg-[#070b10] text-white/70 hover:border-white/35'
                    : 'border-black bg-white text-black hover:bg-[#f8f3ea]'
                }`}
              >
                Back to journal
              </button>
            </div>
            <JournalChart
              entries={filteredTradeJournal}
              allEntries={tradeJournal}
              selectedMarket={selectedMarket}
              isMatrixTheme={isMatrixTheme}
            />
          </>
        ) : null}
      </section>
    </div>
    <ConfirmDialog isOpen={Boolean(dialog)} {...dialog} />
    </>
  );
}
