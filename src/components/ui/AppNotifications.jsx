import { Toaster } from 'sonner';
import { useTheme } from '../../contexts/ThemeContext';

export function AppNotifications() {
  const { isMatrixTheme } = useTheme();
  return <Toaster position="bottom-right" theme="light" closeButton duration={4200} visibleToasts={4}
    toastOptions={{ className: 'cboard-toast', classNames: { title: 'cboard-toast-title', description: 'cboard-toast-description', actionButton: 'cboard-toast-action', cancelButton: 'cboard-toast-cancel', closeButton: 'cboard-toast-close' } }}
    style={{ '--normal-bg': isMatrixTheme ? '#122019' : '#fffdf8', '--normal-text': isMatrixTheme ? '#e0ffe8' : '#111111', '--normal-border': isMatrixTheme ? '#70e891' : '#111111', '--success-bg': isMatrixTheme ? '#122019' : '#edffd5', '--success-border': isMatrixTheme ? '#70e891' : '#315d20', '--error-bg': isMatrixTheme ? '#241414' : '#ffe8e5', '--error-border': isMatrixTheme ? '#ff7b7b' : '#8b1f1f', '--warning-bg': isMatrixTheme ? '#211b10' : '#fff2d5', '--warning-border': isMatrixTheme ? '#f0bc51' : '#8a5700' }} />;
}
