/**
 * @fileoverview Client-refresh route handler — explicit token rotation triggered by the client.
 *
 * Called by the `AuthProvider`'s revalidation loop (via `authClient`) when it detects a
 * 401 from the API. The handler forwards the refresh cookie to NestJS and sets fresh
 * cookies on the response so the next request carries valid credentials.
 *
 * @see FCM rows #27 (client-refresh).
 * @layer api/auth
 */

import { createClientRefreshHandler } from '@bymax-one/nest-auth/nextjs';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

/**
 * POST /api/auth/client-refresh
 *
 * Delegates entirely to the library handler. Do not add custom auth logic here.
 *
 * @param request - Incoming POST request from the AuthProvider's refresh loop.
 */
export const POST = createClientRefreshHandler({
  apiBase: env.INTERNAL_API_URL,
  refreshPath: '/api/auth/refresh',
});
