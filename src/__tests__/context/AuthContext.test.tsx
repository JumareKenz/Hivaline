/**
 * AuthContext.test.tsx — durable auth: cold-launch bootstrap, offline grace,
 * login/logout via Capacitor Preferences, and session revocation.
 *
 * Auth now persists in @capacitor/preferences (mocked in setup.ts with an
 * in-memory store) so a session survives an app process kill — online OR
 * offline. These tests cover the offline-grace path that fixes the lockout.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AuthProvider, AuthContext } from '@/context/AuthContext';
import { saveAuth } from '@/services/authStorage';
import { Preferences } from '@capacitor/preferences';
import * as updateService from '@/services/updateService';

vi.mock('@/services/updateService', () => ({
  checkForUpdate: vi.fn().mockResolvedValue(null),
  downloadHIV: vi.fn().mockResolvedValue(null),
  hasStoredHIV: vi.fn().mockResolvedValue(false),
  loadStoredHIV: vi.fn().mockResolvedValue(null),
}));

const mockHasStoredHIV = vi.mocked(updateService.hasStoredHIV);
const mockCheckForUpdate = vi.mocked(updateService.checkForUpdate);
const mockDownloadHIV = vi.mocked(updateService.downloadHIV);

/* ─── Test consumer ─── */
const AuthConsumer: React.FC = () => {
  const ctx = React.useContext(AuthContext);
  if (!ctx) return <div>no context</div>;
  return (
    <div>
      <span data-testid="init">{ctx.state.isInitializing ? 'initializing' : 'ready'}</span>
      <span data-testid="auth-state">{ctx.state.isAuthenticated ? 'authenticated' : 'unauthenticated'}</span>
      <span data-testid="grace">{ctx.state.offlineGrace ? 'grace' : 'live'}</span>
      <span data-testid="user-name">{ctx.state.user?.name ?? 'none'}</span>
      <button onClick={() => ctx.logout()} data-testid="logout-btn">Logout</button>
    </div>
  );
};

function renderWithAuth(ui: React.ReactNode = <AuthConsumer />) {
  return render(<AuthProvider>{ui}</AuthProvider>);
}

/** Wait until the async bootstrap has resolved. */
async function waitForReady() {
  await waitFor(() => expect(screen.getByTestId('init').textContent).toBe('ready'));
}

beforeEach(async () => {
  await Preferences.clear();
  vi.clearAllMocks();
  mockHasStoredHIV.mockResolvedValue(false);
  mockCheckForUpdate.mockResolvedValue(null);
});

describe('AuthContext — cold-launch bootstrap', () => {
  it('starts unauthenticated when no token and no .hiv exist', async () => {
    renderWithAuth();
    await waitForReady();
    expect(screen.getByTestId('auth-state').textContent).toBe('unauthenticated');
  });

  it('restores an authenticated session from a valid persisted token (no network)', async () => {
    await saveAuth({
      token: 'valid-token',
      expiry: Date.now() + 60_000,
      serverCode: 'HIVA-K7H4',
      userName: 'Test Clinic',
    });

    renderWithAuth();
    await waitForReady();

    expect(screen.getByTestId('auth-state').textContent).toBe('authenticated');
    expect(screen.getByTestId('grace').textContent).toBe('live');
    expect(screen.getByTestId('user-name').textContent).toBe('Test Clinic');
  });

  it('enters OFFLINE GRACE when token is expired but .hiv is present', async () => {
    await saveAuth({
      token: 'old-token',
      expiry: Date.now() - 1000, // expired
      serverCode: 'HIVA-K7H4',
      userName: 'Kano CHEW',
    });
    mockHasStoredHIV.mockResolvedValue(true);

    renderWithAuth();
    await waitForReady();

    expect(screen.getByTestId('auth-state').textContent).toBe('authenticated');
    expect(screen.getByTestId('grace').textContent).toBe('grace');
  });

  it('enters OFFLINE GRACE when there is no token but a .hiv is present', async () => {
    mockHasStoredHIV.mockResolvedValue(true);

    renderWithAuth();
    await waitForReady();

    expect(screen.getByTestId('auth-state').textContent).toBe('authenticated');
    expect(screen.getByTestId('grace').textContent).toBe('grace');
  });

  it('forces login when token is expired AND no .hiv exists', async () => {
    await saveAuth({
      token: 'old-token',
      expiry: Date.now() - 1000,
      serverCode: 'HIVA-K7H4',
      userName: 'X',
    });
    mockHasStoredHIV.mockResolvedValue(false);

    renderWithAuth();
    await waitForReady();

    expect(screen.getByTestId('auth-state').textContent).toBe('unauthenticated');
  });
});

describe('AuthContext — offline grace recovery on reconnect', () => {
  it('drops the banner and re-validates the token when connectivity returns', async () => {
    await saveAuth({
      token: 'grace-token',
      expiry: Date.now() - 1000,
      serverCode: 'HIVA-K7H4',
      userName: 'Borno CHEW',
    });
    mockHasStoredHIV.mockResolvedValue(true);

    renderWithAuth();
    await waitForReady();
    expect(screen.getByTestId('grace').textContent).toBe('grace');

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => expect(screen.getByTestId('grace').textContent).toBe('live'));
    // Background re-validation used the stored token (no credentials re-entered).
    expect(mockCheckForUpdate).toHaveBeenCalled();
  });

  it('re-download on reconnect is non-destructive (does not revoke on 401)', async () => {
    await saveAuth({
      token: 'valid-token',
      expiry: Date.now() + 60_000,
      serverCode: 'HIVA-K7H4',
      userName: 'Kano CHEW',
    });
    const meta = {
      version: '2026.06.04.42', sha256: 'x', size_kb: 1,
      languages: ['en'], chunk_count: 1, created_at: '2026-06-04',
    };
    mockCheckForUpdate.mockResolvedValue(meta);
    mockDownloadHIV.mockResolvedValue(null);

    renderWithAuth();
    await waitForReady();
    expect(screen.getByTestId('auth-state').textContent).toBe('authenticated');

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });

    // The reconnect retry must opt out of session revocation...
    await waitFor(() => {
      expect(mockDownloadHIV).toHaveBeenCalledWith(meta, { revokeOnAuthError: false });
    });
    // ...and the worker stays signed in even though the download didn't succeed.
    expect(screen.getByTestId('auth-state').textContent).toBe('authenticated');
  });
});

describe('AuthContext — login', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  it('persists the token durably and authenticates on success', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token: 'new-token',
        expires_in: 3600,
        user_profile: { server_code: 'HIVA-K7H4', name: 'Kano CHEW' },
      }),
    } as unknown as Response);

    const LoginConsumer: React.FC = () => {
      const ctx = React.useContext(AuthContext)!;
      return (
        <div>
          <span data-testid="auth-state">{ctx.state.isAuthenticated ? 'authenticated' : 'unauthenticated'}</span>
          <button data-testid="login-btn" onClick={() => ctx.login('HIVA-K7H4', 'K7H4')}>Login</button>
        </div>
      );
    };

    renderWithAuth(<LoginConsumer />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('login-btn'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-state').textContent).toBe('authenticated');
    });

    const { value } = await Preferences.get({ key: 'hivaline_auth_token' });
    expect(value).toBe('new-token');

    globalThis.fetch = originalFetch;
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
        <button data-testid="login-btn" onClick={async () => { loginResult = await ctx.login('HIVA-K7H4', 'WRONG'); }}>
          Login
        </button>
      );
    };

    renderWithAuth(<TestConsumer />);
    await act(async () => { fireEvent.click(screen.getByTestId('login-btn')); });

    expect(loginResult?.success).toBe(false);
    expect(loginResult?.error).toContain('Incorrect');

    globalThis.fetch = originalFetch;
  });
});

describe('AuthContext — logout & revocation', () => {
  it('clears persisted auth on logout', async () => {
    await saveAuth({
      token: 'valid-token',
      expiry: Date.now() + 60_000,
      serverCode: 'HIVA-K7H4',
      userName: 'Test Clinic',
    });

    renderWithAuth();
    await waitForReady();
    expect(screen.getByTestId('auth-state').textContent).toBe('authenticated');

    await act(async () => {
      fireEvent.click(screen.getByTestId('logout-btn'));
    });

    expect(screen.getByTestId('auth-state').textContent).toBe('unauthenticated');
    await waitFor(async () => {
      const { value } = await Preferences.get({ key: 'hivaline_auth_token' });
      expect(value).toBeNull();
    });
  });

  it('logs out when hiva:session-revoked fires', async () => {
    await saveAuth({
      token: 'valid-token',
      expiry: Date.now() + 60_000,
      serverCode: 'HIVA-K7H4',
      userName: 'Test Clinic',
    });

    renderWithAuth();
    await waitForReady();
    expect(screen.getByTestId('auth-state').textContent).toBe('authenticated');

    await act(async () => {
      window.dispatchEvent(new CustomEvent('hiva:session-revoked'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-state').textContent).toBe('unauthenticated');
    });
  });
});
