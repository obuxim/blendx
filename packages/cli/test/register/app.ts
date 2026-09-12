import { defineApp } from 'blendx';

export interface User {
  id: number;
  role: 'admin' | 'member';
}

export default defineApp({
  auth: async ({ request }): Promise<User | null> =>
    request.headers.has('authorization') ? { id: 1, role: 'admin' } : null,
});
