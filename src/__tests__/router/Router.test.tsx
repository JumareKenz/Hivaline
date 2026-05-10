/**
 * Router.test.tsx — Auth guard redirects and route rendering
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthContext } from '@/context/AuthContext';

/* ─── Module-level mocks (hoisted by Vitest) ─── */

const mockNavigate = vi.fn();
let mockPath = '/';
let mockCurrentRoute = '/';

vi.mock('@/router/useRouter', () => ({
  useRouter: () => ({
    navigate: mockNavigate,
    path: mockPath,
    currentRoute: mockCurrentRoute,
    params: {},
    goBack: vi.fn(),
  }),
}));

vi.mock('@/components/auth/LoginScreen', () => ({
  default: () => <div data-testid="login-screen">Login</div>,
}));
vi.mock('@/components/chat/ChatScreen', () => ({
  default: () => <div data-testid="chat-screen">Chat</div>,
}));
vi.mock('@/components/knowledge/KnowledgeBaseScreen', () => ({
  default: () => <div data-testid="knowledge-screen">Knowledge</div>,
}));
vi.mock('@/components/knowledge/KnowledgeDetailScreen', () => ({
  default: () => <div data-testid="knowledge-detail-screen">Detail</div>,
}));
vi.mock('@/components/settings/SettingsScreen', () => ({
  default: () => <div data-testid="settings-screen">Settings</div>,
}));
vi.mock('@/components/decision/DecisionTreeScreen', () => ({
  default: () => <div data-testid="decision-screen">Decision</div>,
}));
vi.mock('@/components/drug/DrugTableScreen', () => ({
  default: () => <div data-testid="drug-screen">Drug</div>,
}));
vi.mock('@/components/shell/BottomTabBar', () => ({
  BottomTabBar: () => <div data-testid="tab-bar">TabBar</div>,
}));

function makeAuthValue(isAuthenticated: boolean) {
  return {
    state: {
      isAuthenticated,
      user: isAuthenticated ? {
        id: 'HIVA-K7H4',
        name: 'Test User',
        facility: 'Test',
        state: '',
        serverCode: 'HIVA-K7H4',
        supervisor: '',
        role: 'chew' as const,
      } : null,
    },
    login: vi.fn(),
    logout: vi.fn(),
  };
}

describe('Router — auth guard redirects', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('redirects unauthenticated user from protected route to /', async () => {
    mockPath = '/chat';
    mockCurrentRoute = '/chat';

    const { Router } = await import('@/router/Router');
    render(
      <AuthContext.Provider value={makeAuthValue(false)}>
        <Router />
      </AuthContext.Provider>
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  it('redirects authenticated user from / to /chat', async () => {
    mockPath = '/';
    mockCurrentRoute = '/';

    const { Router } = await import('@/router/Router');
    render(
      <AuthContext.Provider value={makeAuthValue(true)}>
        <Router />
      </AuthContext.Provider>
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/chat');
    });
  });

  it('does not redirect authenticated user already on /chat', async () => {
    mockPath = '/chat';
    mockCurrentRoute = '/chat';

    const { Router } = await import('@/router/Router');
    render(
      <AuthContext.Provider value={makeAuthValue(true)}>
        <Router />
      </AuthContext.Provider>
    );

    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    // navigate should only have been called to go to /chat (not to /)
    const calls = mockNavigate.mock.calls;
    const logoutCalls = calls.filter((c) => c[0] === '/');
    expect(logoutCalls).toHaveLength(0);
  });
});

describe('Router — route rendering', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('renders LoginScreen at / when unauthenticated', async () => {
    mockPath = '/';
    mockCurrentRoute = '/';

    const { Router } = await import('@/router/Router');
    render(
      <AuthContext.Provider value={makeAuthValue(false)}>
        <Router />
      </AuthContext.Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('login-screen')).toBeInTheDocument();
    });
  });

  it('renders ChatScreen at /chat when authenticated', async () => {
    mockPath = '/chat';
    mockCurrentRoute = '/chat';

    const { Router } = await import('@/router/Router');
    render(
      <AuthContext.Provider value={makeAuthValue(true)}>
        <Router />
      </AuthContext.Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('chat-screen')).toBeInTheDocument();
    });
  });

  it('shows tab bar on tabBar routes (/chat, /knowledge, /settings)', async () => {
    mockPath = '/chat';
    mockCurrentRoute = '/chat';

    const { Router } = await import('@/router/Router');
    render(
      <AuthContext.Provider value={makeAuthValue(true)}>
        <Router />
      </AuthContext.Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('tab-bar')).toBeInTheDocument();
    });
  });

  it('does not show tab bar on detail routes (/knowledge/:id)', async () => {
    mockPath = '/knowledge/malaria-2024';
    mockCurrentRoute = '/knowledge/:id';

    const { Router } = await import('@/router/Router');
    render(
      <AuthContext.Provider value={makeAuthValue(true)}>
        <Router />
      </AuthContext.Provider>
    );

    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.queryByTestId('tab-bar')).not.toBeInTheDocument();
  });
});
