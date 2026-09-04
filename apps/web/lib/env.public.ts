/**
 * @fileoverview Validated public environment configuration — safe in the browser.
 *
 * The counterpart to `lib/env.ts`, which is server-only: that module's schema
 * requires `INTERNAL_API_URL` and `AUTH_JWT_SECRET_FOR_PROXY`, neither of which
 * is a `NEXT_PUBLIC_` variable, so parsing it in a client component fails — and
 * because the parse runs at module load, the import throws while the component
 * tree is being built and the page renders blank. This module declares only the
 * `NEXT_PUBLIC_*` keys, so it validates identically on both sides.
 *
 * **Client components read public config from here**, not from `process.env`
 * directly and not from `lib/env`. `lib/env` composes this schema for the server
 * side, so each public variable is declared exactly once.
 *
 * Every key is read through an explicit `process.env.NEXT_PUBLIC_…` member
 * expression below. That is what Next.js statically replaces at build time; a
 * dynamic lookup or a spread of `process.env` is not inlined and would arrive
 * empty in the browser.
 *
 * @module lib/env.public
 */

import { z } from 'zod';

/**
 * Zod schema for the `NEXT_PUBLIC_*` variables, which reach the browser bundle.
 *
 * Exported so `lib/env.ts` can merge it into the full server-side schema rather
 * than restating these keys.
 */
export const publicEnvSchema = z.object({
  /**
   * Base URL for API calls made from the browser (same-origin /api proxy).
   * Typically http://localhost:3000/api in development, /api in production.
   */
  NEXT_PUBLIC_API_URL: z.string().url(),

  /**
   * WebSocket base URL for the browser WS client.
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

  /**
   * How the API delivers a password reset — must match the API's
   * `PASSWORD_RESET_METHOD`.
   *
   * `token` mails a link that lands on the reset page with everything it needs.
   * `otp` mails a numeric code and nothing else, so the request screen has to
   * offer a way into the code-entry screen; without knowing the mode it dead-ends
   * on "check your inbox" and the user has nowhere to go.
   *
   * Inlined at build time, so a deployment that changes it must rebuild the
   * image rather than restart the container.
   */
  NEXT_PUBLIC_PASSWORD_RESET_MODE: z.enum(['token', 'otp']).default('token'),
});

/** Public type of the validated, frozen public env object. */
export type PublicEnv = Readonly<z.infer<typeof publicEnvSchema>>;

/**
 * The `NEXT_PUBLIC_*` values as Next.js inlines them.
 *
 * Written as explicit member expressions, one per key — see the file header for
 * why a dynamic read cannot be substituted here.
 */
const rawPublicEnv = {
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
  NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED: process.env.NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED,
  NEXT_PUBLIC_PASSWORD_RESET_MODE: process.env.NEXT_PUBLIC_PASSWORD_RESET_MODE,
};

/**
 * Validated and frozen public environment configuration.
 *
 * Throws at module load if a public variable is missing or invalid — the same
 * contract `lib/env` gives the server, so a typo fails the build rather than
 * arriving as `undefined` in a component.
 */
export const publicEnv: PublicEnv = (() => {
  const result = publicEnvSchema.safeParse(rawPublicEnv);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid public web env:\n${issues}`);
  }
  return Object.freeze(result.data);
})();
