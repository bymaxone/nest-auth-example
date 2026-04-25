/**
 * @file notify.dto.ts
 * @description Validated request body for the dev-only
 * `POST /api/debug/notify/:userId` endpoint.
 *
 * Both fields are required non-empty strings so callers cannot emit
 * meaningless notifications during demos or automated tests.
 *
 * @layer notifications
 * @see docs/DEVELOPMENT_PLAN.md §Phase 10 P10-2
 */

import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Payload that the debug notify endpoint forwards to the WebSocket gateway.
 *
 * @public
 */
export class NotifyDto {
  /** Short notification headline displayed by the client. */
  @IsString()
  @IsNotEmpty()
  title!: string;

  /** Supporting notification text displayed under the title. */
  @IsString()
  @IsNotEmpty()
  body!: string;
}
