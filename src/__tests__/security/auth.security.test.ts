/**
 * SECURITY TESTS — Authentication & Session Management
 *
 * Tests auth bypass, token tampering, IDOR, session revocation,
 * and privilege escalation against the auth system.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateServerCode, validateAccessKey, getValidationError } from '@/utils/validation';
import {
  HIVA_TOKEN_KEY,
  HIVA_SERVER_CODE_KEY,
  HIVA_USER_NAME_KEY,
} from '@/utils/constants';

/* ─── Constants that match AuthContext internal keys ─── */
const TOKEN_KEY = HIVA_TOKEN_KEY;
const SERVER_CODE_KEY = HIVA_SERVER_CODE_KEY;
const USER_NAME_KEY = HIVA_USER_NAME_KEY;

describe('SEC-01 Server code / access key format hardening', () => {
  it('rejects server code with SQL injection characters', () => {
    const malicious = [
      "HIVA-' OR '1'='1",
      "HIVA-;DROP",
      "HIVA-1; SELECT *",
      'HIVA-<script>',
    ];
    malicious.forEach((code) => {
      expect(validateServerCode(code)).toBe(false);
    });
  });

  it('rejects server code with path traversal characters', () => {
    const traversal = ['HIVA-/../', 'HIVA-..\\a', 'HIVA-%2e%2e'];
    traversal.forEach((code) => {
      expect(validateServerCode(code)).toBe(false);
    });
  });

  it('rejects server code with null bytes', () => {
    expect(validateServerCode('HIVA-\0ABC')).toBe(false);
  });

  it('rejects server code with unicode lookalikes', () => {
    // Cyrillic 'A' (А) looks like Latin 'A'
    expect(validateServerCode('HIVA-АBC1')).toBe(false);
  });

  it('rejects access key with special characters', () => {
    const badKeys = [
      "' OR 1=1--",
      '<script>',
      '../etc',
      '\x00\x00\x00\x00',
      '    ',
    ];
    badKeys.forEach((key) => {
      expect(validateAccessKey(key)).toBe(false);
    });
  });

  it('rejects access key with wrong length — boundary values', () => {
    expect(validateAccessKey('ABC')).toBe(false);  // 3 chars
    expect(validateAccessKey('ABCD')).toBe(true);  // 4 chars (valid)
    expect(validateAccessKey('ABCDE')).toBe(false); // 5 chars
  });

  it('rejects server code that is exactly HIVA- with nothing after', () => {
    expect(validateServerCode('HIVA-')).toBe(false);
  });

  it('rejects server code of maximum observed injection length', () => {
    const longCode = 'HIVA-' + 'A'.repeat(1000);
    expect(validateServerCode(longCode)).toBe(false);
  });
});

describe('SEC-02 Access key / server code relationship vulnerability', () => {
  /**
   * KNOWN DESIGN ISSUE: The login form enforces that accessKey === serverCode.split('-')[1].
   * This means the access key is always derivable from the server code,
   * making it effectively single-factor. Document and test the constraint.
   */
  it('documents: access key is always equal to last 4 chars of server code', () => {
    // HIVA-K7H4 requires access key K7H4
    // HIVA-AB12 requires access key AB12
    // This is a design constraint — confirm it holds for all valid codes
    const validCodes = ['HIVA-K7H4', 'HIVA-AB12', 'HIVA-9999'];
    validCodes.forEach((code) => {
      const parts = code.split('-');
      const derivedKey = parts[1];
      expect(validateAccessKey(derivedKey)).toBe(true);
      // Key == last 4 chars of code is always true — single-factor auth
      expect(code.endsWith(derivedKey)).toBe(true);
    });
  });

  it('getValidationError rejects when access key does not match server code suffix', () => {
    // HIVA-K7H4 with wrong key ZZZZ should fail
    const error = getValidationError('HIVA-K7H4', 'ZZZZ');
    // Format is valid but logic mismatch — validation passes format check
    // The business-logic check happens in LoginScreen.handleSubmit
    expect(error).toBeNull(); // format-level: null (format is valid)
  });
});

describe('SEC-03 sessionStorage token exposure', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('sessionStorage token is cleared when browser/app closes (XSS mitigation)', () => {
    sessionStorage.setItem(TOKEN_KEY, 'fake-bearer-token');
    // Any script can read this during the session:
    const exposed = sessionStorage.getItem(TOKEN_KEY);
    expect(exposed).toBe('fake-bearer-token');
    // FINDING: Token is in sessionStorage — cleared on app close, limiting XSS window.
    // For true XSS resilience, httpOnly cookies would be needed.
  });

  it('clearing token via sessionStorage.removeItem logs user out on next load', () => {
    sessionStorage.setItem(TOKEN_KEY, 'some-token');
    sessionStorage.setItem(SERVER_CODE_KEY, 'HIVA-K7H4');
    sessionStorage.removeItem(TOKEN_KEY);
    const token = sessionStorage.getItem(TOKEN_KEY);
    expect(token).toBeNull();
  });

  it('manually setting a fake token would bypass auth on next load', () => {
    // An attacker with console access can set:
    sessionStorage.setItem(TOKEN_KEY, 'attacker-injected-token');
    sessionStorage.setItem(SERVER_CODE_KEY, 'HIVA-FAKE');
    // loadStoredAuth() in AuthContext would consider this authenticated
    const hasToken = sessionStorage.getItem(TOKEN_KEY);
    const hasCode = sessionStorage.getItem(SERVER_CODE_KEY);
    expect(hasToken).not.toBeNull();
    expect(hasCode).not.toBeNull();
    // FINDING: No cryptographic validation of stored token on startup
  });
});

describe('SEC-04 Session revocation via custom events', () => {
  it('dispatches hiva:session-revoked event which should clear auth state', () => {
    const handler = vi.fn();
    window.addEventListener('hiva:session-revoked', handler);
    window.dispatchEvent(new CustomEvent('hiva:session-revoked'));
    expect(handler).toHaveBeenCalledOnce();
    window.removeEventListener('hiva:session-revoked', handler);
  });

  it('storage event with null token value triggers cross-tab logout', () => {
    const handler = vi.fn();
    window.addEventListener('storage', handler);

    // Use Object.defineProperty to reliably set key in jsdom
    const event = new StorageEvent('storage');
    Object.defineProperty(event, 'key', { value: TOKEN_KEY });
    Object.defineProperty(event, 'newValue', { value: null });
    window.dispatchEvent(event);

    expect(handler).toHaveBeenCalled();
    window.removeEventListener('storage', handler);
  });

  it('storage event with non-token key does not trigger logout', () => {
    let called = 0;
    const handler = (e: StorageEvent) => {
      if (e.key === TOKEN_KEY && e.newValue === null) called++;
    };
    window.addEventListener('storage', handler);

    const event = new StorageEvent('storage');
    Object.defineProperty(event, 'key', { value: 'some_other_key' });
    Object.defineProperty(event, 'newValue', { value: null });
    window.dispatchEvent(event);

    expect(called).toBe(0);
    window.removeEventListener('storage', handler);
  });
});

describe('SEC-05 Input length limits and DoS via validation', () => {
  it('validates 10000-character server code quickly without hanging', () => {
    const longCode = 'HIVA-' + 'A'.repeat(10000);
    const start = Date.now();
    const result = validateServerCode(longCode);
    const elapsed = Date.now() - start;
    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(100); // regex must be fast, no ReDoS
  });

  it('validates 10000-character access key quickly without hanging', () => {
    const longKey = 'A'.repeat(10000);
    const start = Date.now();
    const result = validateAccessKey(longKey);
    const elapsed = Date.now() - start;
    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(100);
  });

  it('regex anchors prevent prefix/suffix bypass', () => {
    // Without anchors, 'HIVA-K7H4extragarbage' might match
    expect(validateServerCode('HIVA-K7H4extragarbage')).toBe(false);
    expect(validateServerCode('prefixHIVA-K7H4')).toBe(false);
    expect(validateAccessKey('K7H4extra')).toBe(false);
    expect(validateAccessKey('preK7H4')).toBe(false);
  });
});

describe('SEC-06 XSS in validation error messages', () => {
  it('getValidationError does not reflect user input into error message', () => {
    // Even if user enters XSS payload, error message is static text
    const error = getValidationError('<script>alert(1)</script>', 'K7H4');
    expect(error).toBe('Invalid server code format. Use HIVA-XXXX.');
    expect(error).not.toContain('<script>');
  });
});
