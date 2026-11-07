const AUTH_ROUTES = new Set(['/login', '/forgot-password', '/reset-password']);

export function safeReturnPath(path, { basePath = '/', origin } = {}) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || !origin) return '/board';
  try {
    const url = new URL(path, origin);
    const base = basePath.endsWith('/') ? basePath : `${basePath}/`;
    if (url.origin !== origin || !url.pathname.startsWith(base)) return '/board';
    const localPath = url.pathname.slice(base.length - 1) || '/';
    if (AUTH_ROUTES.has(localPath)) return '/board';
    return `${localPath}${url.search}${url.hash}`;
  } catch { return '/board'; }
}
