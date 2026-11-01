import { getAppHref } from '../../app/useRoute';
import calLogo from '../../assets/cal-logo.png';

export function BrandBadge() {
  return (
    <a href={getAppHref('/board')} className="brand-badge" aria-label="CBoard home" title="CBoard home">
      <img
        src={calLogo}
        alt=""
        className="brand-badge-mark h-9 w-auto shrink-0 object-contain"
      />

      <div className="brand-badge-copy">
        <p className="brand-badge-title">CBoard</p>
      </div>
    </a>
  );
}
