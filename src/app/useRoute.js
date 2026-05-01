import { useEffect, useState } from 'react';

function getBasePath() {
  const baseUrl = import.meta.env.BASE_URL || '/';

  if (baseUrl === './' || baseUrl === '/') {
    return '';
  }

  return baseUrl.replace(/\/$/, '');
}

function withBasePath(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getBasePath()}${normalizedPath}` || '/';
}

function getCurrentRoute() {
  const redirectedPath = window.sessionStorage.getItem('spa:redirect');

  if (redirectedPath) {
    window.sessionStorage.removeItem('spa:redirect');
    window.history.replaceState({}, '', withBasePath(redirectedPath));
  }

  const basePath = getBasePath();
  let path = window.location.pathname || '/';

  if (basePath && path.startsWith(basePath)) {
    path = path.slice(basePath.length) || '/';
  }

  return path.startsWith('/') ? path : `/${path}`;
}

export function navigateTo(path, { replace = false } = {}) {
  const nextPath = withBasePath(path);
  const method = replace ? 'replaceState' : 'pushState';

  window.history[method]({}, '', nextPath);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function getAppHref(path) {
  return withBasePath(path);
}

export function useRoute() {
  const [route, setRoute] = useState(getCurrentRoute);

  useEffect(() => {
    const handleRouteChange = () => {
      setRoute(getCurrentRoute());
    };

    window.addEventListener('popstate', handleRouteChange);

    return () => {
      window.removeEventListener('popstate', handleRouteChange);
    };
  }, []);

  return route;
}
