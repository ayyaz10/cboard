import { useEffect, useRef, useState } from 'react';
import { CONNECTION_EVENT } from './network.js';
import { registerPwa } from './register.js';
import './pwa.css';

export function PwaStatus() {
  const [connection, setConnection] = useState(navigator.onLine ? 'online' : 'offline');
  const [recovered, setRecovered] = useState(false);
  const [update, setUpdate] = useState(null);
  const [message, setMessage] = useState('');
  const lastConnection = useRef(connection);
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
      if (state.update) setUpdate(() => state.update);
      if (state.message) setMessage(state.message);
    });
    return () => {
      cleanup();
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      window.removeEventListener(CONNECTION_EVENT, cloud);
    };
  }, []);
  return <aside className="pwa-status" aria-label="App connection and updates">
    {connection !== 'online' && <p role="status">{connection === 'offline' ? 'You are offline.' : 'Cloud services are unreachable.'} Displayed data may be out of date. Reconnect to load or save cloud data. Changes are not queued.</p>}
    {connection === 'online' && recovered && <div><p role="status">Connection restored. You can retry loading data. Check interrupted saves before submitting again.</p><button type="button" onClick={() => setRecovered(false)}>Dismiss</button></div>}
    {update && <div><p role="status">New version available. Save your work before updating; this reloads the app.</p><button type="button" disabled={connection !== 'online'} onClick={update}>Update</button><button type="button" onClick={() => setUpdate(null)}>Later</button></div>}
    {message && <div><p role="status">{message}</p><button type="button" onClick={() => setMessage('')}>Dismiss</button></div>}
  </aside>;
}
