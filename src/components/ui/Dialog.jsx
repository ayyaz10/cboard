import { useEffect, useRef } from 'react';

/** Native modal dialog with theme-token surfaces, backdrop, focus and Escape behavior. */
export function Dialog({ open, onClose, labelledBy, className = '', children, ...props }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className={`ui-dialog ${className}`.trim()} aria-labelledby={labelledBy} onCancel={event => { event.preventDefault(); onClose?.(); }} onClick={event => { if (event.target === ref.current) onClose?.(); }} {...props}>{children}</dialog>;
}
