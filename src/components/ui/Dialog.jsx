import { useEffect, useRef } from 'react';

/** Native modal dialog with theme-token surfaces, backdrop, focus and Escape behavior. */
export function Dialog({ open, onClose, labelledBy, className = '', children, ...props }) {
  const ref = useRef(null);
  const backdropPointerDown = useRef(false);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className={`ui-dialog ${className}`.trim()} aria-labelledby={labelledBy} onCancel={event => { event.preventDefault(); onClose?.(); }} onPointerDown={event => { const rect = ref.current?.getBoundingClientRect(); backdropPointerDown.current = Boolean(rect && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)); }} onClick={event => { const startedOnBackdrop = backdropPointerDown.current; backdropPointerDown.current = false; if (event.target === ref.current && startedOnBackdrop) onClose?.(); }} {...props}>{children}</dialog>;
}
