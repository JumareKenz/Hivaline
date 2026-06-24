import React, { createContext, useState, useCallback, useEffect, useRef } from 'react';
import type { User } from '@/types/hiv';
import { HIVA_KNOWN_VERSION_KEY } from '@/utils/constants';
import { checkForUpdate, downloadHIV, hasStoredHIV } from '@/services/updateService';
import { saveAuth, loadAuth, clearAuth, isExpired, type StoredAuth } from '@/services/authStorage';

const API_BASE = 'https://compiler.hiva.chat';

interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  /** True until the durable session has been read from Preferences on launch. */
  isInitializing: boolean;
  /** True when the app is usable but not on a freshly-confirmed online session. */
  offlineGrace: boolean;
}

export interface LoginResult {
  success: boolean;
  error?: string;
}

interface AuthContextValue {
  state: AuthState;
  login: (serverCode: string, accessKey: string) => Promise<LoginResult>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** Build a display User from a stored session. */
function userFromStored(auth: StoredAuth): User {
  const name = auth.userName || auth.serverCode || 'Health Worker';
  return {
    id: auth.serverCode || 'offline',
    name,
    facility: name,
    state: '',
    serverCode: auth.serverCode,
    supervisor: '',
    role: 'chew',
  };
}

/** Fallback User for grace mode where no stored profile exists (.hiv present, no token). */
function graceUser(): User {
  return {
    id: 'offline',
    name: 'Health Worker',
    facility: 'Offline session',
    state: '',
    serverCode: '',
    supervisor: '',
    role: 'chew',
  };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
    isInitializing: true,
    offlineGrace: false,
  });

  // Whether a token is currently held (drives background re-validation on reconnect).
  const hasTokenRef = useRef(false);

  /* ─── Launch bootstrap: read durable session before gating routes ─── */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = await loadAuth();
      const hivPresent = await hasStoredHIV();
      if (cancelled) return;

      // Case 1: valid (non-expired) token → normal authenticated session, no network needed.
      if (stored && !isExpired(stored)) {
        hasTokenRef.current = true;
        setState({
          isAuthenticated: true,
          user: userFromStored(stored),
          isInitializing: false,
          // If we happen to be offline right now, surface the banner.
          offlineGrace: typeof navigator !== 'undefined' && navigator.onLine === false,
        });
        return;
      }

      // Case 2: token expired BUT clinical data is on device → offline grace.
      if (stored && hivPresent) {
        hasTokenRef.current = true;
        setState({
          isAuthenticated: true,
          user: userFromStored(stored),
          isInitializing: false,
          offlineGrace: true,
        });
        return;
      }

      // Case 3: no token but .hiv is present → let the worker in (offline grace).
      if (!stored && hivPresent) {
        hasTokenRef.current = false;
        setState({
          isAuthenticated: true,
          user: graceUser(),
          isInitializing: false,
          offlineGrace: true,
        });
        return;
      }

      // Case 4: no token AND no .hiv → true first install, must log in.
      hasTokenRef.current = false;
      setState({
        isAuthenticated: false,
        user: null,
        isInitializing: false,
        offlineGrace: false,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (serverCode: string, accessKey: string): Promise<LoginResult> => {
    try {
      const response = await fetch(`${API_BASE}/api/hiv/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server_code: serverCode, access_key: accessKey }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          token: string;
          expires_in?: number;
          user_profile: { server_code: string; name: string };
          version_info?: { version: string; sha256: string };
        };

        const expiry =
          typeof data.expires_in === 'number' && data.expires_in > 0
            ? Date.now() + data.expires_in * 1000
            : null;

        // Persist durably BEFORE the auto-download (downloadHIV reads the token).
        await saveAuth({
          token: data.token,
          expiry,
          serverCode: data.user_profile.server_code,
          userName: data.user_profile.name,
        });
        if (data.version_info) {
          localStorage.setItem(HIVA_KNOWN_VERSION_KEY, data.version_info.version);
        }

        const user: User = {
          id: data.user_profile.server_code,
          name: data.user_profile.name,
          facility: data.user_profile.name,
          state: '',
          serverCode: data.user_profile.server_code,
          supervisor: '',
          role: 'chew',
        };
        hasTokenRef.current = true;
        setState({ isAuthenticated: true, user, isInitializing: false, offlineGrace: false });

        // Auto-download .hiv file after successful login
        try {
          const meta = await checkForUpdate();
          if (meta) {
            const bytes = await downloadHIV(meta);
            if (bytes) {
              window.dispatchEvent(new CustomEvent('hiva:file-downloaded'));
            }
          }
        } catch {
          /* Auto-update error — silent, user can manually check later */
        }

        return { success: true };
      }

      const status = response.status;
      let detail = '';
      try {
        const body = (await response.json()) as { detail?: string };
        detail = body.detail ?? '';
      } catch { /* ignore */ }

      if (status === 422) return { success: false, error: 'Invalid code format' };
      if (status === 401) return { success: false, error: 'Incorrect server code or access key' };
      if (status === 403 && detail.includes('revoked')) {
        return { success: false, error: 'This access code has been disabled. Contact your supervisor.' };
      }
      if (status === 403) {
        return { success: false, error: 'This code is at capacity. Contact your supervisor.' };
      }
      if (status === 404) return { success: false, error: 'No content available yet. Try again later.' };

      return { success: false, error: 'Connection failed. Please try again.' };
    } catch {
      return { success: false, error: 'Unable to connect to server. Check your internet connection.' };
    }
  }, []);

  const logout = useCallback(() => {
    hasTokenRef.current = false;
    void clearAuth();
    setState({ isAuthenticated: false, user: null, isInitializing: false, offlineGrace: false });
  }, []);

  useEffect(() => {
    const handleRevoked = () => {
      hasTokenRef.current = false;
      void clearAuth();
      setState({ isAuthenticated: false, user: null, isInitializing: false, offlineGrace: false });
    };
    window.addEventListener('hiva:session-revoked', handleRevoked);

    // Connectivity transitions: show the banner when offline, silently
    // re-validate the stored token when connectivity returns.
    const handleOffline = () => {
      setState((prev) => (prev.isAuthenticated ? { ...prev, offlineGrace: true } : prev));
    };
    const handleOnline = () => {
      // Re-validate using the stored token only — no credentials are re-entered.
      // Non-destructive: a 401/403 here throws HivAuthError (caught and ignored)
      // instead of revoking. An auto-retry with an unauthorized/expired token
      // must not silently log the worker out — they keep using the offline bundle.
      if (hasTokenRef.current) {
        checkForUpdate()
          .then((meta) => (meta ? downloadHIV(meta, { revokeOnAuthError: false }) : null))
          .then((bytes) => {
            if (bytes) window.dispatchEvent(new CustomEvent('hiva:file-downloaded'));
          })
          .catch(() => { /* offline, transient, or unauthorized — keep the session */ });
      }
      // Drop the banner optimistically; revocation path will flip us out if needed.
      setState((prev) => (prev.isAuthenticated ? { ...prev, offlineGrace: false } : prev));
    };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('hiva:session-revoked', handleRevoked);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  return (
    <AuthContext.Provider value={{ state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
