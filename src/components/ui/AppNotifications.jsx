import { Toaster } from 'sonner';

export function AppNotifications() {
  return <Toaster position="bottom-right" theme="system" closeButton duration={4200} visibleToasts={4}
    toastOptions={{ className: 'cboard-toast', classNames: { title: 'cboard-toast-title', description: 'cboard-toast-description', actionButton: 'cboard-toast-action', cancelButton: 'cboard-toast-cancel', closeButton: 'cboard-toast-close' } }}
    />;
}
