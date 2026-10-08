import { isValidElement } from 'react';

function buttonLabel(children) {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(buttonLabel).join(' ');
  if (isValidElement(children)) return buttonLabel(children.props.children);
  return '';
}

export function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', children, ...props }) {
  const label = props['aria-label'] || buttonLabel(children);
  const resolvedVariant = /^(delete|remove|discard)\b/i.test(label.trim()) ? 'danger' : variant;
  return <button type={type} className={`ui-button ui-button--${resolvedVariant} ui-button--${size} ${className}`.trim()} {...props}>{children}</button>;
}
