/**
 * @file create-tenant.dto.ts
 * @description DTO for creating a new tenant via `POST /api/tenants`.
 *
 * Validated by the global `ValidationPipe` (whitelist + forbidNonWhitelisted + transform).
 *
 * @layer tenants
 * @see docs/guidelines/validation-guidelines.md
 */

import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Payload for provisioning a new tenant (workspace).
 *
 * Only `OWNER`-role users may call this endpoint. The slug must be URL-safe
 * (lowercase alphanumeric and hyphens) so it can be used in subdomains or paths.
 *
 * @public
 */
export class CreateTenantDto {
  /**
   * Human-readable tenant display name (e.g. "Acme Corp").
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  /**
   * URL-safe unique identifier (e.g. "acme-corp").
   * Must match the pattern `[a-z0-9-]+`.
   */
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug may only contain lowercase letters, numbers, and hyphens',
  })
  slug!: string;
}
