/**
 * Hash router hook
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import type { RouteParams, RoutePath } from '@/types/hiv';

const parseHash = (): { path: string; params: RouteParams } => {
  const hash = window.location.hash.replace('#', '') || '/';
  const [pathPart, queryString] = hash.split('?');
  const params: RouteParams = {};

  if (queryString) {
    const searchParams = new URLSearchParams(queryString);
    searchParams.forEach((value, key) => {
      if (key === 'id') params.id = value;
    });
  }

  // Extract :id from path like /knowledge/malaria-2024
  const segments = pathPart.split('/').filter(Boolean);
  if (segments.length >= 2) {
    params.id = segments[segments.length - 1];
  }

  return { path: pathPart, params };
};

export const useRouter = () => {
  const [{ path, params }, setRoute] = useState(parseHash);

  useEffect(() => {
    const handleHashChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigate = useCallback((to: string) => {
    window.location.hash = to;
  }, []);

  const goBack = useCallback(() => {
    window.history.back();
  }, []);

  const currentRoute = useMemo(() => {
    // Match exact or parameterized routes
    if (path.startsWith('/knowledge/') && path !== '/knowledge') return '/knowledge/:id' as RoutePath;
    if (path.startsWith('/decision-tree/')) return '/decision-tree/:id' as RoutePath;
    if (path.startsWith('/drug-table/')) return '/drug-table/:id' as RoutePath;
    return path as RoutePath;
  }, [path]);

  return {
    path,
    currentRoute,
    params,
    navigate,
    goBack,
  };
};
