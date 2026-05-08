/**
 * Formatting utilities
 */

export const formatDate = (date: Date): string => {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};

export const formatWeight = (kg: number): string => {
  return `${kg} kg`;
};

export const toTitleCase = (str: string): string => {
  return str.replace(/\w\S*/g, (txt) =>
    txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()
  );
};

export const normalizeInput = (input: string): string => {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
};
