import { Toaster } from 'sonner';
import { useTheme } from '../../contexts/ThemeContext';

export function AppNotifications() {
  const { isMatrixTheme, isMidnightTheme } = useTheme();
  const dark = isMatrixTheme || isMidnightTheme;
  const colors = isMidnightTheme
    ? { normal: '#15191f', text: '#e7ebf0', border: '#343b45', success: '#1c3022', successBorder: '#477b50', error: '#351d21', errorBorder: '#9e555d', warning: '#322c1d', warningBorder: '#887447' }
    : { normal: '#122019', text: '#e0ffe8', border: '#70e891', success: '#122019', successBorder: '#70e891', error: '#241414', errorBorder: '#ff7b7b', warning: '#211b10', warningBorder: '#f0bc51' };
  return <Toaster position="bottom-right" theme={dark ? 'dark' : 'light'} closeButton duration={4200} visibleToasts={4}
    toastOptions={{ className: 'cboard-toast', classNames: { title: 'cboard-toast-title', description: 'cboard-toast-description', actionButton: 'cboard-toast-action', cancelButton: 'cboard-toast-cancel', closeButton: 'cboard-toast-close' } }}
    style={{ '--normal-bg': isMidnightTheme ? colors.normal : dark ? colors.normal : '#fffdf8', '--normal-text': isMidnightTheme ? colors.text : dark ? colors.text : '#111111', '--normal-border': colors.border, '--success-bg': isMidnightTheme ? colors.success : dark ? colors.normal : '#edffd5', '--success-border': colors.successBorder, '--error-bg': isMidnightTheme ? colors.error : dark ? colors.error : '#ffe8e5', '--error-border': colors.errorBorder, '--warning-bg': isMidnightTheme ? colors.warning : dark ? colors.warning : '#fff2d5', '--warning-border': colors.warningBorder }} />;
}
