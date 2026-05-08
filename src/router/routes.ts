/**
 * Route definitions
 */

import type { AppRoute } from '@/types/hiv';

export const ROUTES: readonly AppRoute[] = [
  { path: '/', screen: 'LoginScreen', requiresAuth: false, tabBar: false },
  { path: '/chat', screen: 'ChatScreen', requiresAuth: true, tabBar: true },
  { path: '/knowledge', screen: 'KnowledgeBaseScreen', requiresAuth: true, tabBar: true },
  { path: '/knowledge/:id', screen: 'KnowledgeDetailScreen', requiresAuth: true, tabBar: false },
  { path: '/settings', screen: 'SettingsScreen', requiresAuth: true, tabBar: true },
  { path: '/decision-tree/:id', screen: 'DecisionTreeScreen', requiresAuth: true, tabBar: false },
  { path: '/drug-table/:id', screen: 'DrugTableScreen', requiresAuth: true, tabBar: false },
] as const;
