import { useEffect } from 'react';
import { Toaster } from 'sonner';
import { notify } from '../../lib/notifications.js';

function inlineAlertText(element) {
  const copy = element.cloneNode(true);
  copy.querySelectorAll('button').forEach(button => button.remove());
  return copy.textContent.replace(/\s+/g, ' ').trim();
}

function forwardInlineAlert(element, sent) {
  if (!(element instanceof HTMLElement) || element.closest('[data-sonner-toaster]')) return;
  const message = inlineAlertText(element);
  if (!message || sent.get(element) === message) return;

  sent.set(element, message);
  element.hidden = true;

  const actionButton = element.querySelector('button');
  const action = actionButton ? {
    label: actionButton.textContent.trim() || 'Retry',
    onClick: () => actionButton.click(),
  } : undefined;
  const options = { id: `inline-alert-${message}`, duration: action ? 20_000 : 12_000, ...(action ? { action } : {}) };

  // Time-sensitive reminders use the same accessible alert surface, but are not errors.
  if (/^your reminders? (?:is|are) ready\b/i.test(message)) notify.info(message, options);
  else notify.error(message, options);
}

export function AppNotifications() {
  useEffect(() => {
    const sent = new WeakMap();
    const process = node => {
      const element = node instanceof Element ? node : node.parentElement;
      if (!element) return;
      const alert = element.matches('[role="alert"]') ? element : element.closest('[role="alert"]');
      if (alert) forwardInlineAlert(alert, sent);
      element.querySelectorAll('[role="alert"]').forEach(candidate => forwardInlineAlert(candidate, sent));
    };
    document.querySelectorAll('[role="alert"]').forEach(element => forwardInlineAlert(element, sent));
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') process(record.target.parentElement);
        else record.addedNodes.forEach(process);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return <Toaster position="top-right" theme="system" closeButton duration={4200} visibleToasts={8} expand
    toastOptions={{ className: 'cboard-toast', classNames: { title: 'cboard-toast-title', description: 'cboard-toast-description', actionButton: 'cboard-toast-action', cancelButton: 'cboard-toast-cancel', closeButton: 'cboard-toast-close' } }}
    />;
}
