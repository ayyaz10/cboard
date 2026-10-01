export function registerPwa(onState) {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return () => {};
  let registration, disposed = false, requestedUpdate = false, reloading = false, lastCheck = 0;
  let installing;
  const offerUpdate = () => {
    if (disposed || !registration?.waiting || !navigator.serviceWorker.controller) return;
    onState({ update: () => {
      if (!navigator.onLine) { onState({ message: 'Reconnect before updating CBoard.' }); return; }
      requestedUpdate = true;
      registration.waiting?.postMessage({ type: 'ACTIVATE_UPDATE' });
    } });
  };
  const stateChanged = () => { if (installing?.state === 'installed') offerUpdate(); };
  const updateFound = () => {
    installing?.removeEventListener('statechange', stateChanged);
    installing = registration.installing;
    installing?.addEventListener('statechange', stateChanged);
  };
  const controllerChanged = () => {
    if (requestedUpdate && !reloading) { reloading = true; window.location.reload(); }
    else if (!disposed && registration?.active) {
      // Another tab accepted an update. Keep this tab's drafts until it chooses reload.
      onState({ update: () => window.location.reload() });
    }
  };
  const check = () => {
    if (disposed || !registration || !navigator.onLine || document.visibilityState !== 'visible' || Date.now()-lastCheck < 60_000) return;
    lastCheck = Date.now();
    registration.update().catch(() => {});
  };
  let hadController = Boolean(navigator.serviceWorker.controller);
  const controlled = () => { if (hadController) controllerChanged(); hadController = true; };
  navigator.serviceWorker.addEventListener('controllerchange', controlled);
  window.addEventListener('online', check);
  document.addEventListener('visibilitychange', check);
  const interval = setInterval(check, 60 * 60 * 1000);
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' })
    .then(value => {
      if (disposed) return;
      registration = value;
      offerUpdate();
      registration.addEventListener('updatefound', updateFound);
      if (registration.installing) updateFound();
      check();
    }).catch(() => { if (!disposed) onState({ message: 'Offline setup is unavailable. CBoard still works online.' }); });
  return () => {
    disposed = true;
    clearInterval(interval);
    installing?.removeEventListener('statechange', stateChanged);
    registration?.removeEventListener('updatefound', updateFound);
    navigator.serviceWorker.removeEventListener('controllerchange', controlled);
    window.removeEventListener('online', check);
    document.removeEventListener('visibilitychange', check);
  };
}
