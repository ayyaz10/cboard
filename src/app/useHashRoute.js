import { useEffect, useState } from 'react';

function getCurrentRoute() {
  const hashValue = window.location.hash.replace(/^#/, '');

  if (!hashValue) {
    return '/';
  }

  return hashValue.startsWith('/') ? hashValue : `/${hashValue}`;
}

export function useHashRoute() {
  const [route, setRoute] = useState(getCurrentRoute);

  useEffect(() => {
    const handleHashChange = () => {
      setRoute(getCurrentRoute());
    };

    window.addEventListener('hashchange', handleHashChange);

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  return route;
}
