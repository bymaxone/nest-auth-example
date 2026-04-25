/**
 * @fileoverview Validated, frozen environment configuration for apps/web.
 *
 * All process.env reads in apps/web MUST go through this module. Direct
 * `process.env.FOO` access anywhere else is a lint error (no-process-env rule).
 *
 * NEXT_PUBLIC_* variables are exposed to the browser bundle by Next.js at
 * build time. All other variables are server-only — never reference them in
 * client components or they will be undefined (and Next.js will warn).
 *
 * Throws at module load with a human-readable error if any required variable
 * is missing or malformed — the app refuses to serve until the config is fixed.
 */

import { z } from 'zod';

/** Zod schema for every env var consumed by apps/web. */
const envSchema = z.object({
  // ── Server-only ────────────────────────────────────────────────────────────
  /**
   * Internal URL the Next.js server uses to proxy /api/* requests to NestJS.
   * Never exposed to the browser — used only in next.config.mjs rewrites and
   * server-side fetch calls.
   */
  INTERNAL_API_URL: z.string().url(),

  /**
   * HS256 mirror of the API's JWT_SECRET — used by the Next.js auth proxy
   * (createAuthProxy) to verify access-token cookies without a round-trip to
   * the API. Must match the API's JWT_SECRET exactly.
   * Minimum 32 characters to meet entropy requirements.
   */
  AUTH_JWT_SECRET_FOR_PROXY: z.string().min(32),

  // ── Public (NEXT_PUBLIC_*) ─────────────────────────────────────────────────
  /**
   * Base URL for API calls made from the browser (same-origin /api proxy).
   * Typically http://localhost:3000/api in development, /api in production.
   */
  NEXT_PUBLIC_API_URL: z.string().url(),

  /**
   * WebSocket base URL for the browser WS client (Phase 16).
   * Must be same-origin (e.g. `ws://localhost:3000` in dev) so that the
   * HttpOnly access_token cookie is automatically forwarded on the WS upgrade
   * request. Next.js proxies `/ws/:path*` to the NestJS gateway.
   * Use `wss://` in production when the app is served over HTTPS.
   */
  NEXT_PUBLIC_WS_URL: z.string().url(),

  /**
   * Feature flag: enable the Google OAuth login button.
   * Requires the API to be configured with GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
   */
  NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default(false),
});

/** Public type of the validated, frozen env object. */
export type Env = Readonly<z.infer<typeof envSchema>>;

/**
 * Validated and frozen environment configuration.
 *
 * Throws at module load if any required variable is missing or invalid.
 * Use this instead of `process.env` throughout apps/web.
 */
export const env: Env = (() => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid web env:\n${issues}`);
  }
  return Object.freeze(result.data);
})();
