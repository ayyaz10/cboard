/** Accessible tab list primitive. Values are stable ids; rendering remains domain-owned. */
export function Tabs({ items, value, onChange, ariaLabel, className = '' }) {
  return <div className={`ui-tabs ${className}`} role="tablist" aria-label={ariaLabel}>
    {items.map((item) => <button key={item.value} type="button" role="tab" aria-selected={value === item.value} onClick={() => onChange(item.value)}>{item.label}</button>)}
  </div>;
}
