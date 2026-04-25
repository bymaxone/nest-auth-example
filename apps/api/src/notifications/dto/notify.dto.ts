/**
 * @file notify.dto.ts
 * @description Validated request bodies for the dev-only notification endpoints.
 *
 * `NotifyDto` — required title + body for `POST /api/debug/notify/:userId`.
 * `NotifySelfDto` — optional title + body for `POST /api/debug/notify/self`;
 *   both fields default server-side when omitted.
 *
 * @layer notifications
 * @see docs/DEVELOPMENT_PLAN.md §Phase 10 P10-2
 * @see docs/DEVELOPMENT_PLAN.md §Phase 16 P16-3
 */

import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Payload that the debug notify endpoint forwards to the WebSocket gateway.
 *
 * @public
 */
export class NotifyDto {
  /** Short notification headline displayed by the client. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  title!: string;

  /** Supporting notification text displayed under the title. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  body!: string;
}

/**
 * Optional payload for the self-notification demo endpoint.
 *
 * Both fields default to a sensible demo message when omitted so the
 * account-page demo button can call the endpoint body-free.
 *
 * @public
 */
export class NotifySelfDto {
  /** Short notification headline (defaults to `'Hello'`). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  title?: string;

  /** Supporting notification text (defaults to `'This is a test notification.'`). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  body?: string;
}
