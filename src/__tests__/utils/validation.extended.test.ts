/**
 * validation.extended.test.ts — Boundary, edge, and stress tests
 */

import { describe, it, expect } from 'vitest';
import { validateServerCode, validateAccessKey, validateWeight, getValidationError } from '@/utils/validation';

describe('validateServerCode — exhaustive boundaries', () => {
  it('accepts all uppercase alphanumeric 4-char suffixes', () => {
    const valids = ['HIVA-AAAA', 'HIVA-ZZZZ', 'HIVA-0000', 'HIVA-9999', 'HIVA-A1B2'];
    valids.forEach((code) => expect(validateServerCode(code)).toBe(true));
  });

  it('rejects suffix with exactly 3 chars', () => {
    expect(validateServerCode('HIVA-ABC')).toBe(false);
  });

  it('rejects suffix with exactly 5 chars', () => {
    expect(validateServerCode('HIVA-ABCDE')).toBe(false);
  });

  it('rejects mixed-case prefix (hIvA-AB12)', () => {
    expect(validateServerCode('hIvA-AB12')).toBe(false);
  });

  it('rejects code without prefix', () => {
    expect(validateServerCode('-AB12')).toBe(false);
    expect(validateServerCode('AB12')).toBe(false);
  });

  it('rejects code with double dash', () => {
    expect(validateServerCode('HIVA--AB12')).toBe(false);
  });

  it('rejects code with newline embedded', () => {
    expect(validateServerCode('HIVA-AB\n2')).toBe(false);
  });

  it('rejects code with tab embedded', () => {
    expect(validateServerCode('HIVA-AB\t2')).toBe(false);
  });

  it('handles null/undefined as false (type safety check)', () => {
    // TypeScript prevents null/undefined but guard runtime behavior
    expect(validateServerCode(null as unknown as string)).toBe(false);
    expect(validateServerCode(undefined as unknown as string)).toBe(false);
  });
});

describe('validateAccessKey — exhaustive boundaries', () => {
  it('accepts all uppercase letters', () => {
    expect(validateAccessKey('ABCD')).toBe(true);
    expect(validateAccessKey('WXYZ')).toBe(true);
  });

  it('accepts all digits', () => {
    expect(validateAccessKey('1234')).toBe(true);
    expect(validateAccessKey('0000')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(validateAccessKey('')).toBe(false);
  });

  it('rejects single character', () => {
    expect(validateAccessKey('A')).toBe(false);
  });

  it('rejects 3 characters', () => {
    expect(validateAccessKey('ABC')).toBe(false);
  });

  it('rejects 5 characters', () => {
    expect(validateAccessKey('ABCDE')).toBe(false);
  });

  it('rejects whitespace-padded valid key', () => {
    expect(validateAccessKey(' ABC')).toBe(false);
    expect(validateAccessKey('ABC ')).toBe(false);
    expect(validateAccessKey('A BC')).toBe(false);
  });

  it('handles null/undefined safely', () => {
    expect(validateAccessKey(null as unknown as string)).toBe(false);
    expect(validateAccessKey(undefined as unknown as string)).toBe(false);
  });
});

describe('validateWeight — boundary values', () => {
  it('accepts exact minimum (3 kg)', () => {
    expect(validateWeight(3)).toBe(true);
  });

  it('accepts exact maximum (60 kg)', () => {
    expect(validateWeight(60)).toBe(true);
  });

  it('rejects just below minimum (2.999)', () => {
    expect(validateWeight(2.999)).toBe(false);
  });

  it('rejects just above maximum (60.001)', () => {
    expect(validateWeight(60.001)).toBe(false);
  });

  it('accepts midrange weight', () => {
    expect(validateWeight(15)).toBe(true);
    expect(validateWeight(31.5)).toBe(true);
  });

  it('rejects negative weight', () => {
    expect(validateWeight(-1)).toBe(false);
    expect(validateWeight(-100)).toBe(false);
  });

  it('rejects zero', () => {
    expect(validateWeight(0)).toBe(false);
  });

  it('rejects NaN', () => {
    expect(validateWeight(NaN)).toBe(false);
  });

  it('rejects Infinity', () => {
    expect(validateWeight(Infinity)).toBe(false);
    expect(validateWeight(-Infinity)).toBe(false);
  });

  it('accepts 3.0 and 60.0 (floating point equivalents)', () => {
    expect(validateWeight(3.0)).toBe(true);
    expect(validateWeight(60.0)).toBe(true);
  });
});

describe('getValidationError — compound scenarios', () => {
  it('checks server code before access key', () => {
    // Both invalid — error should be about server code first
    const error = getValidationError('bad', 'bad');
    expect(error).toContain('Invalid server code');
  });

  it('returns access key error when server code is valid', () => {
    const error = getValidationError('HIVA-K7H4', 'bad');
    expect(error).toContain('Access key');
  });

  it('returns null when both are valid', () => {
    expect(getValidationError('HIVA-K7H4', 'K7H4')).toBeNull();
  });

  it('returns access key error for whitespace key', () => {
    const error = getValidationError('HIVA-K7H4', '    ');
    expect(error).toContain('Access key');
  });

  it('returns server code error for empty server code', () => {
    const error = getValidationError('', 'K7H4');
    expect(error).toContain('Invalid server code');
  });
});
