import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, RefreshCw, X } from 'lucide-react';
import { CONNECTION_EVENT } from './network.js';
import { registerPwa } from './register.js';
import { PWA_UPDATE_PANEL_EVENT } from './updateCheckEvents.js';
import './pwa.css';

export function PwaStatus() {
  const [connection, setConnection] = useState(navigator.onLine ? 'online' : 'offline');
  const [recovered, setRecovered] = useState(false);
  const [update, setUpdate] = useState(null);
  const [message, setMessage] = useState('');
  const [checkForUpdates, setCheckForUpdates] = useState(null);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const [portalTarget, setPortalTarget] = useState(() => document.getElementById('app-shell-status') || document.body);
  const lastConnection = useRef(connection);
  const statusRef = useRef(null);
  useEffect(() => {
    const changeConnection = next => {
      if (next === 'online' && lastConnection.current !== 'online') setRecovered(true);
      if (next !== 'online') setRecovered(false);
      lastConnection.current = next;
      setConnection(next);
    };
    const online = () => changeConnection('online');
    const offline = () => changeConnection('offline');
    const cloud = event => {
      changeConnection(event.detail);
    };
    const openUpdatePanel = () => {
      setOpen(true);
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener(CONNECTION_EVENT, cloud);
    window.addEventListener(PWA_UPDATE_PANEL_EVENT, openUpdatePanel);
    const cleanup = registerPwa(state => {
      if (state.update) setUpdate(() => state.update);
      if (state.check) {
        setCheckForUpdates(() => state.check);
      }
      if (typeof state.checking === 'boolean') setChecking(state.checking);
      if (state.message) setMessage(state.message);
      else if (state.checking) setMessage('');
    });
    return () => {
      cleanup();
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      window.removeEventListener(CONNECTION_EVENT, cloud);
      window.removeEventListener(PWA_UPDATE_PANEL_EVENT, openUpdatePanel);
    };
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const close = event => {
      if (event.key === 'Escape' || (statusRef.current && !statusRef.current.contains(event.target))) setOpen(false);
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    };
  }, [open]);
  useEffect(() => {
    const syncPortalTarget = () => {
      const nextTarget = document.getElementById('app-shell-status') || document.body;
      setPortalTarget(current => current === nextTarget ? current : nextTarget);
    };
    const observer = new MutationObserver(syncPortalTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    syncPortalTarget();
    return () => observer.disconnect();
  }, []);
  const floating = portalTarget === document.body;
  return createPortal(<aside ref={statusRef} className={`pwa-status${floating ? ' is-floating' : ''}`} aria-label="App connection and updates">
    {open && <div className="pwa-status-panel" role="dialog" aria-modal="false" aria-label="App updates">
      <div className="pwa-update-check"><div><strong>App updates</strong><span>Check that you’re using the latest version.</span></div><button type="button" onClick={() => setOpen(false)} aria-label="Close app updates"><X size={18} aria-hidden="true" /></button></div>
      <button type="button" disabled={!checkForUpdates || checking || connection !== 'online'} onClick={() => checkForUpdates?.()}><RefreshCw size={14} aria-hidden="true" />{checking ? 'Checking for updates…' : 'Check for updates'}</button>
      {connection !== 'online' && <p role="status"><AlertCircle size={15} aria-hidden="true" />{connection === 'offline' ? 'You are offline. Reconnect to check for updates.' : 'Cloud services are unreachable. Check your connection and try again.'}</p>}
      {connection === 'online' && recovered && <div><p role="status">Connection restored. You can retry loading data. Check interrupted saves before submitting again.</p><button type="button" onClick={() => setRecovered(false)}>Dismiss</button></div>}
      {update && <div><p role="status">New version available. Save your work before updating; this reloads the app.</p><button type="button" disabled={connection !== 'online'} onClick={update}>Update</button><button type="button" onClick={() => setUpdate(null)}>Later</button></div>}
      {message && <div><p role="status">{message}</p><button type="button" onClick={() => setMessage('')}>Dismiss</button></div>}
    </div>}
  </aside>, portalTarget);
}
