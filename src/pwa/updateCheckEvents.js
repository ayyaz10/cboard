export const PWA_UPDATE_PANEL_EVENT = 'cboard:pwa-open-update-panel';

export function openPwaUpdatePanel() {
  window.dispatchEvent(new Event(PWA_UPDATE_PANEL_EVENT));
}
