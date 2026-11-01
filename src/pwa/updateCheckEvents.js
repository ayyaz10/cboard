export const PWA_UPDATE_PANEL_EVENT = 'cboard:pwa-open-update-panel';
export const PWA_UPDATE_AVAILABLE_EVENT = 'cboard:pwa-update-available';

let updateAvailable = false;

export function hasPwaUpdateAvailable() {
  return updateAvailable;
}

export function setPwaUpdateAvailable(available) {
  const next = Boolean(available);
  if (next === updateAvailable) return;
  updateAvailable = next;
  window.dispatchEvent(new Event(PWA_UPDATE_AVAILABLE_EVENT));
}

export function openPwaUpdatePanel() {
  window.dispatchEvent(new Event(PWA_UPDATE_PANEL_EVENT));
}
