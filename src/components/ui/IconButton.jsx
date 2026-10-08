import { Button } from './Button.jsx';

export function IconButton({ label, children, className = '', ...props }) {
  return <Button variant="ghost" className={`ui-icon-button ${className}`.trim()} aria-label={label} title={label} {...props}>{children}</Button>;
}
