import calLogo from '../../assets/cal-logo.png';

export function BrandBadge() {
  return (
    <a href="#/" className="brand-badge" aria-label="Open calculator board home">
      <img
        src={calLogo}
        alt=""
        className="h-11 w-auto shrink-0 object-contain"
      />

      <div className="space-y-0.5">
        <p className="text-[0.65rem] font-bold uppercase leading-none tracking-[0.22em] text-black/55">
          Cal tools
        </p>
        <p className="text-lg font-bold leading-none tracking-[-0.05em] text-black sm:text-xl">
          Calculator Board
        </p>
      </div>
    </a>
  );
}
