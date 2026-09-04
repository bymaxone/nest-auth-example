/**
 * @fileoverview Validated, frozen environment configuration for apps/web.
 *
 * **Server-only. Never import this from a client component.** The schema
 * requires `INTERNAL_API_URL` and `AUTH_JWT_SECRET_FOR_PROXY`, which are not
 * `NEXT_PUBLIC_` and therefore absent from the browser bundle. Parsing fails
 * there, and because the parse runs at module load the import throws while the
 * component tree is being built — the page renders as blank, with the real
 * cause only visible in the console. Server code (route handlers,
 * `lib/require-auth.ts`) is where this belongs.
 *
 * A client component that needs a `NEXT_PUBLIC_` value reads
 * `process.env.NEXT_PUBLIC_…` directly, as the login, register and
 * forgot-password screens do; Next inlines those expressions at build time.
 * Declaring the variable here as well is still worthwhile — it is what makes a
 * malformed value fail the server at boot rather than silently reaching a page.
 *
 * Throws at module load with a human-readable error if any required variable
 * is missing or malformed — the app refuses to serve until the config is fixed.
 */

import { z } from 'zod';

import { publicEnvSchema } from './env.public';

/**
 * Zod schema for the server-only variables.
 *
 * The `NEXT_PUBLIC_*` keys live in `lib/env.public.ts` and are merged in below,
 * so each public variable is declared exactly once and the browser can validate
 * the same shape without these server-only fields.
 */
const serverEnvSchema = z.object({
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
});

/** Zod schema for every env var consumed by apps/web, public keys included. */
const envSchema = serverEnvSchema.merge(publicEnvSchema);

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
    // Stryker disable StringLiteral: schema declares only top-level fields, so every Zod issue path is a single-segment array — `i.path.join('.')` and `i.path.join('')` render identically. The `'.'` separator is kept for forward compatibility with future nested refinements (and matches the API-side env schema convention).
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    // Stryker restore StringLiteral
    throw new Error(`Invalid web env:\n${issues}`);
  }
  return Object.freeze(result.data);
})();
