/**
 * LoginScreen.test.tsx — Full functional test of the login form
 *
 * Tests: happy path, validation errors, loading state, success animation,
 * network error display, client-side access key match rule, XSS resistance.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AuthContext } from '@/context/AuthContext';
import LoginScreen from '@/components/auth/LoginScreen';
import type { LoginResult } from '@/context/AuthContext';

/* ─── Stubs ─── */

const mockNavigate = vi.fn();

vi.mock('@/router/useRouter', () => ({
  useRouter: () => ({
    navigate: mockNavigate,
    path: '/',
    currentRoute: '/',
    params: {},
    goBack: vi.fn(),
  }),
}));

function renderLogin(loginFn: (code: string, key: string) => Promise<LoginResult> = vi.fn().mockResolvedValue({ success: true })) {
  const mockAuth = {
    state: { isAuthenticated: false, user: null },
    login: loginFn,
    logout: vi.fn(),
  };
  return render(
    <AuthContext.Provider value={mockAuth}>
      <LoginScreen />
    </AuthContext.Provider>
  );
}

/* ─── Helpers ─── */

function getServerCodeInput() {
  // Input component renders a label element (not htmlFor-linked), query by placeholder
  return screen.getByPlaceholderText(/HIVA/i);
}

function getAccessKeyInput() {
  // Password input — query by placeholder text since label has no htmlFor association
  return screen.getByPlaceholderText('XXXX');
}

function getSubmitButton() {
  return screen.getByRole('button', { name: /connect to hiva/i });
}

describe('LoginScreen — renders correctly', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('renders HIVA logo heading', () => {
    renderLogin();
    expect(screen.getByText('HIVA')).toBeInTheDocument();
  });

  it('renders server code and access key inputs', () => {
    renderLogin();
    expect(getServerCodeInput()).toBeInTheDocument();
    // Access key input exists as password type
    const pwInput = document.querySelector('input[type="password"]');
    expect(pwInput).toBeInTheDocument();
  });

  it('renders Connect to HIVA submit button', () => {
    renderLogin();
    expect(getSubmitButton()).toBeInTheDocument();
  });

  it('renders version in footer', () => {
    renderLogin();
    expect(screen.getByText(/v\d+\.\d+/)).toBeInTheDocument();
  });
});

describe('LoginScreen — client-side validation', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('shows server code format error for invalid code', async () => {
    renderLogin();
    const input = getServerCodeInput();
    // autoCapitalize is true — 'invalid' → 'INVALID'
    fireEvent.change(input, { target: { value: 'INVALID' } });
    await waitFor(() => {
      // LoginScreen inline error: "Invalid format. Use HIVA-XXXX."
      expect(screen.getByText(/invalid format/i)).toBeInTheDocument();
    });
  });

  it('shows access key format error for short key', async () => {
    renderLogin();
    const input = getAccessKeyInput();
    fireEvent.change(input, { target: { value: 'AB' } });
    await waitFor(() => {
      // LoginScreen inline error: "Must be 4 characters."
      expect(screen.getByText(/must be 4 characters/i)).toBeInTheDocument();
    });
  });

  it('does not show format error while input is empty', () => {
    renderLogin();
    // No errors on initial render
    expect(screen.queryByText(/invalid format/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/must be 4 characters/i)).not.toBeInTheDocument();
  });

  it('shows error when access key does not match server code suffix', async () => {
    const loginFn = vi.fn().mockResolvedValue({ success: true });
    renderLogin(loginFn);

    fireEvent.change(getServerCodeInput(), { target: { value: 'HIVA-K7H4' } });
    fireEvent.change(getAccessKeyInput(), { target: { value: 'ZZZZ' } });

    await act(async () => {
      fireEvent.click(getSubmitButton());
    });

    await waitFor(() => {
      expect(screen.getByText(/access key must match/i)).toBeInTheDocument();
    });
    expect(loginFn).not.toHaveBeenCalled();
  });
});

describe('LoginScreen — submission states', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('shows loading spinner during login', async () => {
    let resolveLogin!: (val: LoginResult) => void;
    const loginFn = vi.fn(
      () => new Promise<LoginResult>((res) => { resolveLogin = res; })
    );
    renderLogin(loginFn);

    fireEvent.change(getServerCodeInput(), { target: { value: 'HIVA-K7H4' } });
    fireEvent.change(getAccessKeyInput(), { target: { value: 'K7H4' } });

    act(() => { fireEvent.click(getSubmitButton()); });

    await waitFor(() => {
      expect(screen.getByText(/connecting/i)).toBeInTheDocument();
    });

    // Button is disabled while loading
    expect(screen.getByText(/connecting/i).closest('button')).toBeDisabled();

    await act(async () => { resolveLogin({ success: false, error: 'fail' }); });
  });

  it('shows success state after successful login', async () => {
    const loginFn = vi.fn().mockResolvedValue({ success: true });
    renderLogin(loginFn);

    fireEvent.change(getServerCodeInput(), { target: { value: 'HIVA-K7H4' } });
    fireEvent.change(getAccessKeyInput(), { target: { value: 'K7H4' } });

    await act(async () => {
      fireEvent.click(getSubmitButton());
    });

    await waitFor(() => {
      expect(screen.getByText(/connected/i)).toBeInTheDocument();
    });
  });

  it('navigates to /chat after successful login (after 800ms delay)', async () => {
    const loginFn = vi.fn().mockResolvedValue({ success: true });
    renderLogin(loginFn);

    fireEvent.change(getServerCodeInput(), { target: { value: 'HIVA-K7H4' } });
    fireEvent.change(getAccessKeyInput(), { target: { value: 'K7H4' } });

    await act(async () => {
      fireEvent.click(getSubmitButton());
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/chat');
    }, { timeout: 2000 });
  });

  it('shows server-returned error message on failure', async () => {
    const loginFn = vi.fn().mockResolvedValue({
      success: false,
      error: 'Incorrect server code or access key',
    });
    renderLogin(loginFn);

    fireEvent.change(getServerCodeInput(), { target: { value: 'HIVA-K7H4' } });
    fireEvent.change(getAccessKeyInput(), { target: { value: 'K7H4' } });

    await act(async () => {
      fireEvent.click(getSubmitButton());
    });

    await waitFor(() => {
      expect(screen.getByText(/incorrect server code/i)).toBeInTheDocument();
    });
  });

  it('shows generic error when login returns no error string', async () => {
    const loginFn = vi.fn().mockResolvedValue({ success: false });
    renderLogin(loginFn);

    fireEvent.change(getServerCodeInput(), { target: { value: 'HIVA-K7H4' } });
    fireEvent.change(getAccessKeyInput(), { target: { value: 'K7H4' } });

    await act(async () => {
      fireEvent.click(getSubmitButton());
    });

    await waitFor(() => {
      expect(screen.getByText(/connection failed/i)).toBeInTheDocument();
    });
  });
});

describe('LoginScreen — security', () => {
  it('does not call login() when server code format is invalid', async () => {
    const loginFn = vi.fn();
    renderLogin(loginFn);

    fireEvent.change(getServerCodeInput(), { target: { value: 'NOT-VALID' } });
    fireEvent.change(getAccessKeyInput(), { target: { value: 'K7H4' } });

    await act(async () => {
      fireEvent.click(getSubmitButton());
    });

    expect(loginFn).not.toHaveBeenCalled();
  });

  it('XSS in server code field is rejected by validation and never reaches login()', async () => {
    const loginFn = vi.fn();
    renderLogin(loginFn);

    fireEvent.change(getServerCodeInput(), { target: { value: '<script>alert(1)</script>' } });
    fireEvent.change(getAccessKeyInput(), { target: { value: 'K7H4' } });

    await act(async () => {
      fireEvent.click(getSubmitButton());
    });

    expect(loginFn).not.toHaveBeenCalled();
  });

  it('does not expose access key in text (input type=password)', () => {
    renderLogin();
    const pwInput = document.querySelector('input[type="password"]');
    expect(pwInput).toBeInTheDocument();
    expect(pwInput).toHaveAttribute('type', 'password');
  });
});
