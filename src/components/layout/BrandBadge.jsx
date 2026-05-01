import { getAppHref } from '../../app/useRoute';
import calLogo from '../../assets/cal-logo.png';

export function BrandBadge() {
  return (
    <a href={getAppHref('/')} className="brand-badge" aria-label="Open C Board home">
      <img
        src={calLogo}
        alt=""
        className="h-11 w-auto shrink-0 object-contain"
      />

      <div className="space-y-0.5">
        <p className="text-[0.65rem] font-bold uppercase leading-none tracking-[0.22em] text-black/55">
          Control board
        </p>
        <p className="text-lg font-bold leading-none tracking-[-0.05em] text-black sm:text-xl">
          C Board
        </p>
      </div>
    </a>
  );
}
