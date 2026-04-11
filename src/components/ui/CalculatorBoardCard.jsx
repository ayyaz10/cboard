export function CalculatorBoardCard({ calculator, index }) {
  return (
    <a
      href={`#${calculator.path}`}
      className="board-card"
      style={{ backgroundColor: calculator.boardColor }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
            {calculator.boardLabel}
          </p>
          <h2 className="mt-3 text-2xl font-bold tracking-[-0.04em] text-black">
            {calculator.name}
          </h2>
        </div>

        <span className="rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-black">
          {String(index + 1).padStart(2, '0')}
        </span>
      </div>

      <p className="mt-4 max-w-sm text-sm font-medium leading-7 text-black/72">
        {calculator.boardDescription}
      </p>

      <div className="mt-8 flex items-center justify-between gap-3">
        <span className="rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-black">
          Open
        </span>
        <span className="text-2xl font-bold text-black">{'->'}</span>
      </div>
    </a>
  );
}
