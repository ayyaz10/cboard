export const PWA_UPDATE_CHECK_EVENT = 'cboard:pwa-check-updates';

export function requestPwaUpdateCheck() {
  window.dispatchEvent(new Event(PWA_UPDATE_CHECK_EVENT));
}
