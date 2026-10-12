export function Card({ as: Element = 'section', variant = 'default', className = '', children, ...props }) {
  const variantClass = variant === 'default' ? '' : `ui-card--${variant}`;
  return <Element className={`ui-card ${variantClass} ${className}`.trim()} {...props}>{children}</Element>;
}

export function Panel({ as: Element = 'section', className = '', children, ...props }) {
  return <Element className={`ui-panel ${className}`.trim()} {...props}>{children}</Element>;
}
