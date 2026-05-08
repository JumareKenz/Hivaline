import { describe, it, expect } from 'vitest';
import { validateServerCode, validateAccessKey, validateWeight, getValidationError } from '@/utils/validation';

describe('validateServerCode', () => {
  it('accepts valid HIVA code in uppercase', () => {
    expect(validateServerCode('HIVA-K7H4')).toBe(true);
    expect(validateServerCode('HIVA-AB12')).toBe(true);
    expect(validateServerCode('HIVA-9999')).toBe(true);
  });

  it('rejects lowercase letters', () => {
    expect(validateServerCode('hiva-k7h4')).toBe(false);
    expect(validateServerCode('HIVA-k7h4')).toBe(false);
  });

  it('rejects missing dash', () => {
    expect(validateServerCode('HIVAK7H4')).toBe(false);
    expect(validateServerCode('HIVA K7H4')).toBe(false);
  });

  it('rejects wrong prefix', () => {
    expect(validateServerCode('FMOH-K7H4')).toBe(false);
    expect(validateServerCode('WHO-K7H4')).toBe(false);
    expect(validateServerCode('HIVK7H4')).toBe(false);
  });

  it('rejects too short or too long', () => {
    expect(validateServerCode('HIVA-K7H')).toBe(false);
    expect(validateServerCode('HIVA-K7H45')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateServerCode('')).toBe(false);
  });
});

describe('validateAccessKey', () => {
  it('accepts 4 alphanumeric uppercase chars', () => {
    expect(validateAccessKey('K7H4')).toBe(true);
    expect(validateAccessKey('AB12')).toBe(true);
    expect(validateAccessKey('9999')).toBe(true);
  });

  it('rejects lowercase', () => {
    expect(validateAccessKey('k7h4')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(validateAccessKey('K7H')).toBe(false);
    expect(validateAccessKey('K7H45')).toBe(false);
  });

  it('rejects special characters', () => {
    expect(validateAccessKey('K7-H')).toBe(false);
    expect(validateAccessKey('K7!4')).toBe(false);
  });
});

describe('validateWeight', () => {
  it('accepts weight within 3-60 kg range', () => {
    expect(validateWeight(3)).toBe(true);
    expect(validateWeight(12)).toBe(true);
    expect(validateWeight(60)).toBe(true);
  });

  it('rejects weight below 3 kg', () => {
    expect(validateWeight(2)).toBe(false);
    expect(validateWeight(0)).toBe(false);
    expect(validateWeight(-1)).toBe(false);
  });

  it('rejects weight above 60 kg', () => {
    expect(validateWeight(61)).toBe(false);
    expect(validateWeight(100)).toBe(false);
  });
});

describe('getValidationError', () => {
  it('returns null for valid inputs', () => {
    expect(getValidationError('HIVA-K7H4', 'K7H4')).toBeNull();
  });

  it('returns error for invalid server code', () => {
    const error = getValidationError('invalid', 'K7H4');
    expect(error).toContain('Invalid server code');
  });

  it('returns error for invalid access key', () => {
    const error = getValidationError('HIVA-K7H4', 'bad');
    expect(error).toContain('Access key');
  });
});
