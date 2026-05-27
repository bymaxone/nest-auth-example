/**
 * @fileoverview Single source of truth for the seeded tenant slugs that the
 * example app exposes through its sign-in / register / forgot-password
 * pickers. Mirrors `apps/api/prisma/seed.ts → TENANT_DEFINITIONS`.
 *
 * Design note (reference app vs production):
 *   In a production multi-tenant SaaS this list would NOT be hard-coded.
 *   Real apps usually pick a tenant by:
 *     - subdomain (`acme.example.com/login`) — recommended for B2B SaaS, or
 *     - email-driven discovery (`/account/workspaces?email=…`) — for
 *       multi-workspace accounts, or
 *     - a deep-link from a welcome / invitation email that already carries
 *       the slug as a query param.
 *   The hard-coded picker here is a deliberate "training wheels"
 *   simplification for a reference application: it lets a developer
 *   exploring the codebase test multi-tenant flows without setting up
 *   DNS or memorizing URLs. The library's `tenantIdResolver` consumes
 *   the `X-Tenant-Id` header verbatim — none of the picker shape leaks
 *   into the lib contract, so swapping this for a production strategy
 *   is a frontend-only change.
 *
 *   Keep this list in sync with the API seed; if a third tenant is ever
 *   added to `TENANT_DEFINITIONS` in seed.ts, this file is the only
 *   place to update on the web.
 *
 * @layer lib
 */

/**
 * Shape of a single entry in the workspace picker. The `value` is the slug
 * as it appears in the URL (`?tenantId=acme`) and as the seed creates it
 * in Postgres; the `label` is the human-readable text rendered inside the
 * `<select>` option.
 */
export interface TenantOption {
  /** Slug — used as URL query param value and as the API seed identifier. */
  readonly value: string;
  /** Human-readable label rendered inside `<option>` elements. */
  readonly label: string;
}

/**
 * Seeded workspaces from `apps/api/prisma/seed.ts`. Order matters for the
 * default: the first entry is the value used when no `?tenantId=` query
 * param is present and no other source has set a tenant.
 */
export const TENANT_OPTIONS: readonly TenantOption[] = [
  { value: 'acme', label: 'Acme Corp' },
  { value: 'globex', label: 'Globex Inc' },
] as const;

/**
 * Default slug to fall back to when no other source supplies one. Must
 * stay in sync with the first entry of `TENANT_OPTIONS` (asserted by
 * `tenants.test.ts`). Exported as a separate constant to sidestep the
 * `noUncheckedIndexedAccess: true` tsconfig flag, which otherwise widens
 * `TENANT_OPTIONS[0]` to `TenantOption | undefined`.
 */
export const DEFAULT_TENANT_SLUG = 'acme';

/**
 * Resolves the slug to use as the default value on a tenant picker,
 * honoring an explicit `?tenantId=` query param when it matches a known
 * tenant. Unknown or absent slugs fall back to {@link DEFAULT_TENANT_SLUG}.
 *
 * The login / forgot-password / register pages call this on every render
 * so deep-link URLs (e.g., a welcome email that carries `?tenantId=globex`)
 * pre-select the right workspace without overriding the user's manual
 * choice later in the form.
 *
 * @param urlSlug - Raw value from `useSearchParams().get('tenantId')`,
 *   which is `null` when the query param is absent.
 */
export function resolveDefaultTenantSlug(urlSlug: string | null): string {
  if (urlSlug !== null && TENANT_OPTIONS.some((opt) => opt.value === urlSlug)) {
    return urlSlug;
  }
  return DEFAULT_TENANT_SLUG;
}
