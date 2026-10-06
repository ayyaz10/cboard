export function Card({ as: Element = 'section', className = '', children, ...props }) {
  return <Element className={`ui-card ${className}`.trim()} {...props}>{children}</Element>;
}

export function Panel({ as: Element = 'section', className = '', children, ...props }) {
  return <Element className={`ui-panel ${className}`.trim()} {...props}>{children}</Element>;
}
