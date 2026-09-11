import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ReminderProvider } from './features/focusTimer/ReminderProvider';
import './styles/index.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <ReminderProvider>
          <App />
        </ReminderProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
