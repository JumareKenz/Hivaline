/**
 * Mock user data and authentication lookup
 */

import type { User } from '@/types/hiv';

export const MOCK_USERS: readonly User[] = [
  {
    id: 'user-001',
    name: 'Kano State CHEW',
    facility: 'Kano State PHC',
    state: 'Kano State',
    serverCode: 'HIVA-K7H4',
    supervisor: 'Kano State HIVA Supervisor',
    role: 'chew',
  },
] as const;

export const findUserByCode = (serverCode: string, accessKey: string): User | undefined => {
  const expectedKey = serverCode.split('-')[1] ?? '';
  if (accessKey !== expectedKey) return undefined;
  return MOCK_USERS.find((u) => u.serverCode === serverCode);
};
