/**
 * @file create-project.dto.ts
 * @description DTO for creating a new project via `POST /api/projects`.
 *
 * Validated by the global `ValidationPipe` (whitelist + forbidNonWhitelisted + transform).
 *
 * @layer projects
 * @see docs/guidelines/validation-guidelines.md
 */

import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Payload for creating a tenant-scoped project.
 *
 * Only `ADMIN`-role users (and above in the role hierarchy) may call this endpoint.
 *
 * @public
 */
export class CreateProjectDto {
  /**
   * Human-readable project name (e.g. "Landing Page Redesign").
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;
}
