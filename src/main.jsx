import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ReminderProvider } from './features/focusTimer/ReminderProvider';
import './styles/index.css';
import './styles/design-tokens.css';
import './styles/shared-ui.css';
import './styles/midnight.css';
import { PwaStatus } from './pwa/PwaStatus';
import { AppNotifications } from './components/ui/AppNotifications';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <AppNotifications />
      <PwaStatus />
      <AuthProvider>
        <ReminderProvider>
          <App />
        </ReminderProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
