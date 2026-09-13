import { defineApp } from 'blendx';

/**
 * The conformance identity is the x-user-id header: a positive integer is that user, anything
 * else is no identity. A real app verifies a token here instead.
 */
export default defineApp({
  auth: ({ request }): { id: number } | null => {
    const id = Number(request.headers.get('x-user-id'));
    return Number.isInteger(id) && id > 0 ? { id } : null;
  },
});
