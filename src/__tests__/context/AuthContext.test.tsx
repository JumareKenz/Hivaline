/**
 * AuthContext.test.tsx — Full auth flow: login, logout, persistence,
 * session revocation, cross-tab events, and stored auth loading.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AuthProvider, AuthContext } from '@/context/AuthContext';
import { HIVA_TOKEN_KEY, HIVA_SERVER_CODE_KEY, HIVA_USER_NAME_KEY } from '@/utils/constants';

/* ─── Test consumer component ─── */
const AuthConsumer: React.FC = () => {
  const ctx = React.useContext(AuthContext);
  if (!ctx) return <div>no context</div>;
  return (
    <div>
      <span data-testid="auth-state">{ctx.state.isAuthenticated ? 'authenticated' : 'unauthenticated'}</span>
      <span data-testid="user-name">{ctx.state.user?.name ?? 'none'}</span>
      <button onClick={() => ctx.logout()} data-testid="logout-btn">Logout</button>
    </div>
  );
};

function renderWithAuth(ui: React.ReactNode = <AuthConsumer />) {
  return render(<AuthProvider>{ui}</AuthProvider>);
}

describe('AuthContext — initial state from localStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('starts unauthenticated when localStorage is empty', () => {
    renderWithAuth();
    expect(screen.getByTestId('auth-state').textContent).toBe('unauthenticated');
    expect(screen.getByTestId('user-name').textContent).toBe('none');
  });

  it('restores authenticated state when token + server code are in localStorage', () => {
    localStorage.setItem(HIVA_TOKEN_KEY, 'valid-token');
    localStorage.setItem(HIVA_SERVER_CODE_KEY, 'HIVA-K7H4');
    localStorage.setItem(HIVA_USER_NAME_KEY, 'Test Clinic');

    renderWithAuth();

    expect(screen.getByTestId('auth-state').textContent).toBe('authenticated');
    expect(screen.getByTestId('user-name').textContent).toBe('Test Clinic');
  });

  it('starts unauthenticated when token is missing but server code is present', () => {
    localStorage.setItem(HIVA_SERVER_CODE_KEY, 'HIVA-K7H4');
    renderWithAuth();
    expect(screen.getByTestId('auth-state').textContent).toBe('unauthenticated');
  });

  it('starts unauthenticated when server code is missing but token is present', () => {
    localStorage.setItem(HIVA_TOKEN_KEY, 'valid-token');
    renderWithAuth();
    expect(screen.getByTestId('auth-state').textContent).toBe('unauthenticated');
  });
});

describe('AuthContext — logout', () => {
  beforeEach(() => {
    localStorage.setItem(HIVA_TOKEN_KEY, 'valid-token');
    localStorage.setItem(HIVA_SERVER_CODE_KEY, 'HIVA-K7H4');
    localStorage.setItem(HIVA_USER_NAME_KEY, 'Test Clinic');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('clears auth state on logout', async () => {
    renderWithAuth();
    expect(screen.getByTestId('auth-state').textContent).toBe('authenticated');

    await act(async () => {
      fireEvent.click(screen.getByTestId('logout-btn'));
    });

    expect(screen.getByTestId('auth-state').textContent).toBe('unauthenticated');
    expect(screen.getByTestId('user-name').textContent).toBe('none');
  });

  it('removes all auth keys from localStorage on logout', async () => {
    renderWithAuth();

    await act(async () => {
      fireEvent.click(screen.getByTestId('logout-btn'));
    });

    expect(localStorage.getItem(HIVA_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(HIVA_SERVER_CODE_KEY)).toBeNull();
    expect(localStorage.getItem(HIVA_USER_NAME_KEY)).toBeNull();
  });
});

describe('AuthContext — login', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
  });

  it('sets authenticated state on successful login', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token: 'new-token',
        user_profile: { server_code: 'HIVA-K7H4', name: 'Kano CHEW' },
      }),
    } as unknown as Response);

    const LoginConsumer: React.FC = () => {
      const ctx = React.useContext(AuthContext)!;
      return (
        <div>
          <span data-testid="auth-state">{ctx.state.isAuthenticated ? 'authenticated' : 'unauthenticated'}</span>
          <button
            data-testid="login-btn"
            onClick={() => ctx.login('HIVA-K7H4', 'K7H4')}
          >
            Login
          </button>
        </div>
      );
    };

    renderWithAuth(<LoginConsumer />);
    expect(screen.getByTestId('auth-state').textContent).toBe('unauthenticated');

    await act(async () => {
      fireEvent.click(screen.getByTestId('login-btn'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-state').textContent).toBe('authenticated');
    });

    expect(localStorage.getItem(HIVA_TOKEN_KEY)).toBe('new-token');
    expect(localStorage.getItem(HIVA_SERVER_CODE_KEY)).toBe('HIVA-K7H4');
    expect(localStorage.getItem(HIVA_USER_NAME_KEY)).toBe('Kano CHEW');
  });

  it('returns error on 401 (wrong credentials)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as unknown as Response);

    let loginResult: { success: boolean; error?: string } | null = null;
    const TestConsumer: React.FC = () => {
      const ctx = React.useContext(AuthContext)!;
      return (
        <button
          data-testid="login-btn"
          onClick={async () => {
            loginResult = await ctx.login('HIVA-K7H4', 'WRONG');
          }}
        >
          Login
        </button>
      );
    };

    renderWithAuth(<TestConsumer />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('login-btn'));
    });

    expect(loginResult?.success).toBe(false);
    expect(loginResult?.error).toContain('Incorrect');
  });

  it('returns error on 403 revoked', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ detail: 'revoked' }),
    } as unknown as Response);

    let loginResult: { success: boolean; error?: string } | null = null;
    const TestConsumer: React.FC = () => {
      const ctx = React.useContext(AuthContext)!;
      return (
        <button
          data-testid="login-btn"
          onClick={async () => { loginResult = await ctx.login('HIVA-K7H4', 'K7H4'); }}
        >
          Login
        </button>
      );
    };

    renderWithAuth(<TestConsumer />);
    await act(async () => { fireEvent.click(screen.getByTestId('login-btn')); });

    expect(loginResult?.success).toBe(false);
    expect(loginResult?.error).toContain('disabled');
  });

  it('returns error on 403 capacity exceeded', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ detail: 'capacity' }),
    } as unknown as Response);

    let loginResult: { success: boolean; error?: string } | null = null;
    const TestConsumer: React.FC = () => {
      const ctx = React.useContext(AuthContext)!;
      return (
        <button
          data-testid="login-btn"
          onClick={async () => { loginResult = await ctx.login('HIVA-K7H4', 'K7H4'); }}
        >
          Login
        </button>
      );
    };

    renderWithAuth(<TestConsumer />);
    await act(async () => { fireEvent.click(screen.getByTestId('login-btn')); });

    expect(loginResult?.success).toBe(false);
    expect(loginResult?.error).toContain('capacity');
  });

  it('returns error on 404 (no content)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as unknown as Response);

    let loginResult: { success: boolean; error?: string } | null = null;
    const TestConsumer: React.FC = () => {
      const ctx = React.useContext(AuthContext)!;
      return (
        <button
          data-testid="login-btn"
          onClick={async () => { loginResult = await ctx.login('HIVA-K7H4', 'K7H4'); }}
        >
          Login
        </button>
      );
    };

    renderWithAuth(<TestConsumer />);
    await act(async () => { fireEvent.click(screen.getByTestId('login-btn')); });

    expect(loginResult?.success).toBe(false);
    expect(loginResult?.error).toContain('No content');
  });

  it('returns connection error when fetch throws (offline)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

    let loginResult: { success: boolean; error?: string } | null = null;
    const TestConsumer: React.FC = () => {
      const ctx = React.useContext(AuthContext)!;
      return (
        <button
          data-testid="login-btn"
          onClick={async () => { loginResult = await ctx.login('HIVA-K7H4', 'K7H4'); }}
        >
          Login
        </button>
      );
    };

    renderWithAuth(<TestConsumer />);
    await act(async () => { fireEvent.click(screen.getByTestId('login-btn')); });

    expect(loginResult?.success).toBe(false);
    expect(loginResult?.error).toContain('connect');
  });

  it('returns error on 422 (invalid format)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({}),
    } as unknown as Response);

    let loginResult: { success: boolean; error?: string } | null = null;
    const TestConsumer: React.FC = () => {
      const ctx = React.useContext(AuthContext)!;
      return (
        <button
          data-testid="login-btn"
          onClick={async () => { loginResult = await ctx.login('HIVA-K7H4', 'K7H4'); }}
        >
          Login
        </button>
      );
    };

    renderWithAuth(<TestConsumer />);
    await act(async () => { fireEvent.click(screen.getByTestId('login-btn')); });

    expect(loginResult?.success).toBe(false);
    expect(loginResult?.error).toContain('Invalid code format');
  });
});

describe('AuthContext — session revocation events', () => {
  beforeEach(() => {
    localStorage.setItem(HIVA_TOKEN_KEY, 'valid-token');
    localStorage.setItem(HIVA_SERVER_CODE_KEY, 'HIVA-K7H4');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('logs out when hiva:session-revoked event fires', async () => {
    renderWithAuth();
    expect(screen.getByTestId('auth-state').textContent).toBe('authenticated');

    await act(async () => {
      window.dispatchEvent(new CustomEvent('hiva:session-revoked'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-state').textContent).toBe('unauthenticated');
    });
  });

  it('logs out when storage event removes the token key', async () => {
    renderWithAuth();
    expect(screen.getByTestId('auth-state').textContent).toBe('authenticated');

    await act(async () => {
      // jsdom's StorageEvent may not propagate key via constructor init dict in all versions.
      // Manually set key + newValue on the event object as a fallback.
      const evt = new StorageEvent('storage');
      Object.defineProperty(evt, 'key', { value: HIVA_TOKEN_KEY });
      Object.defineProperty(evt, 'newValue', { value: null });
      window.dispatchEvent(evt);
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-state').textContent).toBe('unauthenticated');
    });
  });

  it('does NOT log out when storage event affects a different key', async () => {
    renderWithAuth();
    expect(screen.getByTestId('auth-state').textContent).toBe('authenticated');

    await act(async () => {
      const evt = new StorageEvent('storage');
      Object.defineProperty(evt, 'key', { value: 'some_unrelated_key' });
      Object.defineProperty(evt, 'newValue', { value: null });
      window.dispatchEvent(evt);
    });

    expect(screen.getByTestId('auth-state').textContent).toBe('authenticated');
  });
});
