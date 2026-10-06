export function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', children, ...props }) {
  return <button type={type} className={`ui-button ui-button--${variant} ui-button--${size} ${className}`.trim()} {...props}>{children}</button>;
}
