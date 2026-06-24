/**
 * authStorage.ts — durable auth persistence via Capacitor Preferences
 *
 * Replaces sessionStorage (which is wiped when the WebView process is killed).
 * Preferences is backed by native SharedPreferences on Android and localStorage
 * on the web — so a logged-in worker survives a cold app restart, online OR
 * offline. This is the storage half of the "auth survives app kill" fix.
 *
 * All functions are async because the Preferences API is async on every platform.
 */

import { Preferences } from '@capacitor/preferences';
import {
  HIVA_AUTH_TOKEN_KEY,
  HIVA_AUTH_EXPIRY_KEY,
  HIVA_AUTH_SERVER_CODE_KEY,
  HIVA_AUTH_USER_NAME_KEY,
} from '@/utils/constants';

export interface StoredAuth {
  token: string;
  /** Absolute expiry as a ms epoch timestamp, or null if the token never expires. */
  expiry: number | null;
  serverCode: string;
  userName: string;
}

/**
 * Persist the auth session durably. Called on successful login.
 */
export async function saveAuth(auth: StoredAuth): Promise<void> {
  await Preferences.set({ key: HIVA_AUTH_TOKEN_KEY, value: auth.token });
  await Preferences.set({
    key: HIVA_AUTH_EXPIRY_KEY,
    value: auth.expiry == null ? '' : String(auth.expiry),
  });
  await Preferences.set({ key: HIVA_AUTH_SERVER_CODE_KEY, value: auth.serverCode });
  await Preferences.set({ key: HIVA_AUTH_USER_NAME_KEY, value: auth.userName });
}

/**
 * Load the persisted auth session. Returns null when no token is stored.
 */
export async function loadAuth(): Promise<StoredAuth | null> {
  try {
    const { value: token } = await Preferences.get({ key: HIVA_AUTH_TOKEN_KEY });
    if (!token) return null;

    const { value: expiryRaw } = await Preferences.get({ key: HIVA_AUTH_EXPIRY_KEY });
    const { value: serverCode } = await Preferences.get({ key: HIVA_AUTH_SERVER_CODE_KEY });
    const { value: userName } = await Preferences.get({ key: HIVA_AUTH_USER_NAME_KEY });

    const expiry = expiryRaw ? Number(expiryRaw) : null;

    return {
      token,
      expiry: Number.isFinite(expiry as number) ? (expiry as number) : null,
      serverCode: serverCode ?? '',
      userName: userName ?? '',
    };
  } catch {
    return null;
  }
}

/**
 * Read just the bearer token (used by the update/download service).
 */
export async function getToken(): Promise<string | null> {
  try {
    const { value } = await Preferences.get({ key: HIVA_AUTH_TOKEN_KEY });
    return value ?? null;
  } catch {
    return null;
  }
}

/**
 * Clear all persisted auth keys. Called on logout and on server revocation.
 */
export async function clearAuth(): Promise<void> {
  await Preferences.remove({ key: HIVA_AUTH_TOKEN_KEY });
  await Preferences.remove({ key: HIVA_AUTH_EXPIRY_KEY });
  await Preferences.remove({ key: HIVA_AUTH_SERVER_CODE_KEY });
  await Preferences.remove({ key: HIVA_AUTH_USER_NAME_KEY });
}

/**
 * True when a stored token exists and is not past its expiry.
 * A null expiry is treated as "never expires".
 */
export function isExpired(auth: StoredAuth, now: number = Date.now()): boolean {
  return auth.expiry != null && now > auth.expiry;
}
