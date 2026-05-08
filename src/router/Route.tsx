/**
 * Route matcher component
 */

import React from 'react';
import type { AppRoute } from '@/types/hiv';

interface RouteProps {
  route: AppRoute;
  currentPath: string;
  children: React.ReactNode;
}

export const Route: React.FC<RouteProps> = ({ route, currentPath, children }) => {
  const isMatch = React.useMemo(() => {
    if (route.path.includes(':id')) {
      const base = route.path.split('/:id')[0];
      return currentPath.startsWith(base + '/');
    }
    return route.path === currentPath;
  }, [route.path, currentPath]);

  if (!isMatch) return null;
  return <>{children}</>;
};
