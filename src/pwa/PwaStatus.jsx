import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CONNECTION_EVENT } from './network.js';
import { registerPwa } from './register.js';
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
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener(CONNECTION_EVENT, cloud);
    const cleanup = registerPwa(state => {
      if (state.update) { setUpdate(() => state.update); setOpen(false); }
      if (state.check) setCheckForUpdates(() => state.check);
      if (typeof state.checking === 'boolean') setChecking(state.checking);
      if (state.message) setMessage(state.message);
      else if (state.checking) setMessage('');
    });
    return () => {
      cleanup();
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      window.removeEventListener(CONNECTION_EVENT, cloud);
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
  const statusLabel = update ? 'Update available' : connection !== 'online' ? 'App status: connection issue' : 'App status and updates';
  const floating = portalTarget === document.body;
  return createPortal(<aside ref={statusRef} className={`pwa-status${floating ? ' is-floating' : ''}`} aria-label="App connection and updates">
    <button type="button" className={`pwa-status-toggle${update ? ' has-update' : ''}${connection !== 'online' ? ' is-offline' : ''}`} aria-label={statusLabel} title={statusLabel} aria-expanded={open} onClick={() => setOpen(value => !value)}><span aria-hidden="true">⋯</span>{update && <i aria-hidden="true" />}</button>
    {open && <div className="pwa-status-panel">
      <div className="pwa-update-check"><strong>App status</strong><button type="button" onClick={() => setOpen(false)} aria-label="Close app status">×</button></div>
      <button type="button" disabled={!checkForUpdates || checking || connection !== 'online'} onClick={() => checkForUpdates?.()}>{checking ? 'Checking for updates…' : 'Check for updates'}</button>
      {connection !== 'online' && <p role="status">{connection === 'offline' ? 'You are offline.' : 'Cloud services are unreachable.'} Reconnect to load or save cloud data.</p>}
      {connection === 'online' && recovered && <div><p role="status">Connection restored. You can retry loading data. Check interrupted saves before submitting again.</p><button type="button" onClick={() => setRecovered(false)}>Dismiss</button></div>}
      {update && <div><p role="status">New version available. Save your work before updating; this reloads the app.</p><button type="button" disabled={connection !== 'online'} onClick={update}>Update</button><button type="button" onClick={() => setUpdate(null)}>Later</button></div>}
      {message && <div><p role="status">{message}</p><button type="button" onClick={() => setMessage('')}>Dismiss</button></div>}
    </div>}
  </aside>, portalTarget);
}
