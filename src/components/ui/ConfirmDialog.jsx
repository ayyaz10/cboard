import { useId } from 'react';
import { Button } from './Button.jsx';
import { Dialog } from './Dialog.jsx';
import { IconButton } from './IconButton.jsx';

export function ConfirmDialog({ isOpen, title, message, confirmLabel = 'Delete', cancelLabel = 'Cancel', onConfirm, onCancel }) {
  const id = useId();
  return <Dialog open={isOpen} onClose={onCancel} labelledBy={`${id}-title`} className="ui-confirm-dialog">
    <div className="ui-confirm-heading"><span className="ui-eyebrow">Confirm</span><IconButton label="Close confirmation" onClick={onCancel}>×</IconButton></div>
    <h2 id={`${id}-title`}>{title}</h2>
    <p>{message}</p>
    <div className="ui-confirm-actions"><Button onClick={onCancel}>{cancelLabel}</Button><Button variant="danger" onClick={onConfirm}>{confirmLabel}</Button></div>
  </Dialog>;
}
