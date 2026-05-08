import React, { createContext, useState, useCallback, useEffect } from 'react';
import type { User } from '@/types/hiv';
import {
  HIVA_TOKEN_KEY,
  HIVA_SERVER_CODE_KEY,
  HIVA_USER_NAME_KEY,
  HIVA_KNOWN_VERSION_KEY,
} from '@/utils/constants';

const API_BASE = 'https://compiler.hiva.chat';

interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
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

function loadStoredAuth(): AuthState {
  try {
    const token = localStorage.getItem(HIVA_TOKEN_KEY);
    const serverCode = localStorage.getItem(HIVA_SERVER_CODE_KEY);
    const userName = localStorage.getItem(HIVA_USER_NAME_KEY);
    if (!token || !serverCode) return { isAuthenticated: false, user: null };
    const user: User = {
      id: serverCode,
      name: userName ?? serverCode,
      facility: userName ?? serverCode,
      state: '',
      serverCode,
      supervisor: '',
      role: 'chew',
    };
    return { isAuthenticated: true, user };
  } catch {
    return { isAuthenticated: false, user: null };
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AuthState>(loadStoredAuth);

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
          user_profile: { server_code: string; name: string };
          version_info?: { version: string; sha256: string };
        };

        localStorage.setItem(HIVA_TOKEN_KEY, data.token);
        localStorage.setItem(HIVA_SERVER_CODE_KEY, data.user_profile.server_code);
        localStorage.setItem(HIVA_USER_NAME_KEY, data.user_profile.name);
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
        setState({ isAuthenticated: true, user });
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
    localStorage.removeItem(HIVA_TOKEN_KEY);
    localStorage.removeItem(HIVA_SERVER_CODE_KEY);
    localStorage.removeItem(HIVA_USER_NAME_KEY);
    setState({ isAuthenticated: false, user: null });
  }, []);

  useEffect(() => {
    const handleRevoked = () => {
      setState({ isAuthenticated: false, user: null });
    };
    // Same-tab revocation (from updateService when token is rejected by server)
    window.addEventListener('hiva:session-revoked', handleRevoked);
    // Cross-tab: browser fires 'storage' when another tab modifies localStorage
    const handleStorage = (e: StorageEvent) => {
      if (e.key === HIVA_TOKEN_KEY && e.newValue === null) {
        setState({ isAuthenticated: false, user: null });
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('hiva:session-revoked', handleRevoked);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  return (
    <AuthContext.Provider value={{ state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
