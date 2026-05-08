/**
 * Router.tsx — renders ONLY the active matched route
 * Fixes AnimatePresence "multiple children" warning
 */

import React, { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useRouter } from './useRouter';
import { ROUTES } from './routes';
import { useAuth } from '@/hooks/useAuth';

import LoginScreen from '@/components/auth/LoginScreen';
import ChatScreen from '@/components/chat/ChatScreen';
import KnowledgeBaseScreen from '@/components/knowledge/KnowledgeBaseScreen';
import KnowledgeDetailScreen from '@/components/knowledge/KnowledgeDetailScreen';
import SettingsScreen from '@/components/settings/SettingsScreen';
import DecisionTreeScreen from '@/components/decision/DecisionTreeScreen';
import DrugTableScreen from '@/components/drug/DrugTableScreen';
import { BottomTabBar } from '@/components/shell/BottomTabBar';

const SCREEN_MAP: Record<string, React.FC> = {
  LoginScreen,
  ChatScreen,
  KnowledgeBaseScreen,
  KnowledgeDetailScreen,
  SettingsScreen,
  DecisionTreeScreen,
  DrugTableScreen,
};

const pageTransition = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
  transition: { duration: 0.2, ease: [0.4, 0, 0.2, 1] },
};

const matchRoute = (path: string, routePath: string): boolean => {
  if (routePath.includes(':id')) {
    const base = routePath.split('/:id')[0];
    return path.startsWith(base + '/');
  }
  return routePath === path;
};

export const Router: React.FC = () => {
  const { path, currentRoute, navigate } = useRouter();
  const { state: authState } = useAuth();

  const activeRoute = useMemo(() => {
    return ROUTES.find((r) => matchRoute(path, r.path));
  }, [path]);

  // Auth guard
  React.useEffect(() => {
    if (activeRoute?.requiresAuth && !authState.isAuthenticated) {
      navigate('/');
    }
    if (path === '/' && authState.isAuthenticated) {
      navigate('/chat');
    }
  }, [activeRoute, authState.isAuthenticated, path, navigate]);

  const showTabBar = activeRoute?.tabBar ?? false;

  const Screen = activeRoute ? SCREEN_MAP[activeRoute.screen] : null;
  const routeKey = activeRoute?.path ?? 'not-found';

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          {Screen && (
            <motion.div
              key={routeKey}
              {...pageTransition}
              className="absolute inset-0 overflow-y-auto"
            >
              <Screen />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {showTabBar && <BottomTabBar activeTab={getActiveTab(currentRoute)} />}
    </div>
  );
};

const getActiveTab = (route: string): 'chat' | 'knowledge' | 'settings' => {
  if (route.startsWith('/knowledge')) return 'knowledge';
  if (route === '/settings') return 'settings';
  return 'chat';
};
