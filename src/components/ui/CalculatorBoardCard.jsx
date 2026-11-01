import { getAppHref } from '../../app/useRoute';

const boardColorKeys = {
  '#c5ff6f': 'lime',
  '#ff90e8': 'pink',
  '#9fe3ff': 'cyan',
  '#ffd166': 'amber',
};

export function CalculatorBoardCard({ calculator }) {
  const colorKey = boardColorKeys[calculator.boardColor] || 'paper';

  return (
    <a
      href={getAppHref(calculator.path)}
      className="board-card theme-color-card"
      data-theme-color={colorKey}
      style={{ '--theme-card-bg': calculator.boardColor }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            {calculator.boardLabel}
          </p>
          <h2 className="mt-3 text-2xl font-bold tracking-[-0.04em] text-[var(--color-text)]">
            {calculator.name}
          </h2>
        </div>

      </div>

      <p className="mt-4 max-w-sm text-sm font-medium leading-7 text-black/72">
        {calculator.boardDescription}
      </p>

      <div className="mt-8 flex items-center justify-between gap-3">
        <span className="rounded-full border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text)]">
          Open
        </span>
        <span className="text-2xl font-bold text-[var(--color-text)]">{'->'}</span>
      </div>
    </a>
  );
}
