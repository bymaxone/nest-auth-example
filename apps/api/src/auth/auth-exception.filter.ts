/**
 * @file auth-exception.filter.ts
 * @description Global exception filter that maps every `AuthException` thrown by
 * `@bymax-one/nest-auth` to a consistent JSON envelope used by the frontend
 * error-code map (`apps/web/lib/auth-errors.ts`).
 *
 * Response contract:
 * ```json
 * { "code": "auth.invalid_credentials", "message": "...", "statusCode": 401 }
 * ```
 *
 * Only `AuthException` is caught here — all other exceptions fall through to
 * NestJS's built-in exception handler. Stack traces and internal Prisma/Redis
 * diagnostics are never included in the response body.
 *
 * Covers FCM row #29 (shared error codes, anti-enumeration).
 *
 * @layer auth
 * @see docs/guidelines/security-privacy-guidelines.md
 * @see docs/DEVELOPMENT_PLAN.md §Phase 7 P7-7
 */

import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { AuthException, AUTH_ERROR_CODES, AUTH_ERROR_MESSAGES } from '@bymax-one/nest-auth';
import type { AuthErrorCode } from '@bymax-one/nest-auth';

/**
 * Internal shape that `AuthException` stores in its response body.
 * Mirrors the structure set in `AuthException`'s super() call.
 */
interface AuthExceptionBody {
  error: {
    code: AuthErrorCode;
    message: string;
    details: Record<string, unknown> | null;
  };
}

/**
 * Narrows an unknown response body to `AuthExceptionBody`.
 *
 * Guards against any future structural drift in the library's response format
 * without casting the whole value to an unsafe type.
 *
 * @param body - Raw value from `exception.getResponse()`.
 * @returns `true` when body has the expected nested shape.
 */
function isAuthExceptionBody(body: unknown): body is AuthExceptionBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof (body as Record<string, unknown>)['error'] === 'object' &&
    (body as Record<string, unknown>)['error'] !== null
  );
}

/**
 * Global exception filter for `@bymax-one/nest-auth` errors.
 *
 * Registered via `app.useGlobalFilters(new AuthExceptionFilter())` in `main.ts`.
 * Reshapes the library's `{ error: { code, message, details } }` body into the
 * simpler `{ code, message, statusCode }` envelope that the frontend error map
 * expects. Message falls back to `AUTH_ERROR_MESSAGES[code]` when the exception
 * body does not carry a human-readable message.
 *
 * @public
 */
@Catch(AuthException)
export class AuthExceptionFilter implements ExceptionFilter<AuthException> {
  private readonly logger = new Logger(AuthExceptionFilter.name);

  /**
   * Handles an `AuthException` and writes the standardised error envelope.
   *
   * @param exception - The thrown `AuthException`.
   * @param host - NestJS arguments host (HTTP context).
   */
  catch(exception: AuthException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const statusCode = exception.getStatus();

    const rawBody: unknown = exception.getResponse();
    const body = isAuthExceptionBody(rawBody) ? rawBody : null;

    if (body === null) {
      // Unexpected body shape — likely a library version mismatch. Log so it is
      // visible in production without exposing the raw exception body.
      this.logger.warn(
        `AuthException body shape mismatch — using fallback code. status=${statusCode}`,
      );
    }

    // Extract the code from the body; fall back to a generic unknown-error sentinel
    // when the exception body does not match the expected shape (forward-compat guard).
    const code: AuthErrorCode =
      body?.error?.code ?? (AUTH_ERROR_CODES.TOKEN_INVALID as AuthErrorCode);

    // Prefer the message carried by the exception body; fall back to the static map.
    // AUTH_ERROR_MESSAGES is a readonly Record<AuthErrorCode, string> — code is a string
    // literal union, not user input, so bracket access here is safe.
    const message: string =
      body?.error?.message ??
      (AUTH_ERROR_MESSAGES as Record<string, string | undefined>)[code] ??
      code;

    response.status(statusCode).json({ code, message, statusCode });
  }
}
