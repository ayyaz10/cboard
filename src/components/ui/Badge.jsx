export function Badge({ variant = 'neutral', className = '', children, ...props }) {
  return <span className={`ui-badge ui-badge--${variant} ${className}`.trim()} {...props}>{children}</span>;
}
