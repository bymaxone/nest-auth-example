/**
 * @file tenant-lookup.dto.ts
 * @description Query DTOs for the two public tenant lookups.
 *
 * Both routes are unauthenticated and take a single primitive query parameter,
 * which is exactly the shape that reaches Prisma as `undefined` when the caller
 * omits it — a driver-level failure surfacing as a 500 where the boundary
 * should have answered 400. Validated by the global `ValidationPipe`
 * (whitelist + forbidNonWhitelisted + transform).
 *
 * @layer tenants
 * @see docs/guidelines/validation-guidelines.md
 */

import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Query for `GET /api/tenants/resolve?slug=` — slug to CUID.
 *
 * The pattern matches `CreateTenantDto.slug`, so a value this rejects could
 * never have been stored in the first place.
 *
 * @public
 */
export class ResolveTenantBySlugQuery {
  /** URL-safe tenant slug (e.g. `'acme'`). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug may only contain lowercase letters, numbers, and hyphens',
  })
  slug!: string;
}

/**
 * Query for `GET /api/tenants/slug?id=` — tenant id to slug.
 *
 * Deliberately does NOT pin a CUID shape. `Tenant.id` defaults to `cuid()`, but
 * the id is the database's business and this repo's own e2e stack seeds
 * readable ids (`'acme'`); a pattern here would refuse them at the boundary and
 * make the endpoint work in one environment and not the other. The lookup is
 * the authority — an id it does not know is a 404, which is the honest answer
 * for a stale link and for a probe alike.
 *
 * @public
 */
export class ResolveTenantByIdQuery {
  /** Tenant id as it appears in a mailed link. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  id!: string;
}
