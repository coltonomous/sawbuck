/**
 * Typed Hono RPC client — auto-infers request/response types from the server.
 *
 * Usage:
 *   import { rpc } from './rpc';
 *   const res = await rpc.listings.$get({ query: { platform: 'craigslist' } });
 *   const data = await res.json(); // fully typed
 *
 * For most existing code, the `api` object in api.ts still works and
 * delegates to plain fetch. This module provides the typed alternative
 * for new code.
 */

import { hc } from 'hono/client';
import type { ApiRoutes } from '../../server/app.js';

export const rpc = hc<ApiRoutes>('/api', {
  init: {
    credentials: 'include',
  },
  headers: () => ({
    'Content-Type': 'application/json',
  }),
});
