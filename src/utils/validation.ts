/**
 * Input validation utilities
 */

import { SERVER_CODE_REGEX, ACCESS_KEY_REGEX, MIN_WEIGHT_KG, MAX_WEIGHT_KG } from './constants';

export const validateServerCode = (code: string): boolean => {
  return SERVER_CODE_REGEX.test(code);
};

export const validateAccessKey = (key: string): boolean => {
  return ACCESS_KEY_REGEX.test(key);
};

export const validateWeight = (weight: number): boolean => {
  return weight >= MIN_WEIGHT_KG && weight <= MAX_WEIGHT_KG;
};

export const getValidationError = (code: string, key: string): string | null => {
  if (!validateServerCode(code)) {
    return 'Invalid server code format. Use HIVA-XXXX.';
  }
  if (!validateAccessKey(key)) {
    return 'Access key must be 4 alphanumeric characters.';
  }
  return null;
};
