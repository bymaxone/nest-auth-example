/**
 * @file auth-exception.filter.ts
 * @description Global exception filter that answers every failure in the library
 * envelope, so a single response contract covers the whole API.
 *
 * Response contract — the shape `@bymax-one/nest-auth` itself emits:
 * ```json
 * { "error": { "code": "auth.invalid_credentials", "message": "…", "details": null } }
 * ```
 *
 * This shape matters: the library's own `createAuthClient` parses exactly two
 * envelopes, and this is one of them. An envelope the client cannot parse leaves
 * `AuthClientError.code` undefined, and every form in `apps/web` then falls back
 * to its generic "unexpected error" sentence instead of the specific message it
 * has for that code. Emitting a flat `{ code, message, statusCode }` body is the
 * mistake that produces that symptom.
 *
 * Framework exceptions are folded into the same envelope with a meaningful code
 * rather than a blanket internal error, so a rate-limit rejection or a failed DTO
 * validation still reaches the user as itself. Thrown values that are not
 * exceptions answer a generic internal error: that is the one path where a stack
 * detail or a connection string could otherwise reach a response body.
 *
 * @layer auth
 * @see docs/guidelines/security-privacy-guidelines.md
 */

import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthException, AUTH_ERROR_CODES, AUTH_ERROR_MESSAGES } from '@bymax-one/nest-auth';
import type { AuthErrorCode } from '@bymax-one/nest-auth';

/** The response body every failure is answered with. */
interface AuthEnvelope {
  error: {
    code: AuthErrorCode;
    message: string;
    details: Record<string, unknown> | null;
  };
}

/**
 * Narrows an unknown response body to the library envelope.
 *
 * Guards against structural drift in the library's response format without
 * casting the whole value to an unsafe type.
 *
 * @param body - Raw value from `exception.getResponse()`.
 * @returns `true` when body already carries the envelope shape.
 */
function isAuthEnvelope(body: unknown): body is AuthEnvelope {
  if (typeof body !== 'object' || body === null) return false;
  const envelope = (body as Record<string, unknown>)['error'];
  if (typeof envelope !== 'object' || envelope === null) return false;
  return typeof (envelope as Record<string, unknown>)['code'] === 'string';
}

/**
 * The auth error code that best describes each HTTP status.
 *
 * Used for framework exceptions that carry no code of their own — a validation
 * failure, a missing route, a guard that threw `ForbiddenException`.
 */
const STATUS_TO_CODE: Partial<Record<number, AuthErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: AUTH_ERROR_CODES.VALIDATION,
  [HttpStatus.UNAUTHORIZED]: AUTH_ERROR_CODES.TOKEN_INVALID,
  [HttpStatus.FORBIDDEN]: AUTH_ERROR_CODES.FORBIDDEN,
  [HttpStatus.TOO_MANY_REQUESTS]: AUTH_ERROR_CODES.TOO_MANY_REQUESTS,
};

/**
 * Maps an HTTP status to the closest auth error code.
 *
 * Anything unrecognised becomes an internal error, which is also the only
 * branch whose message is suppressed.
 *
 * @param status - HTTP status carried by the exception.
 * @returns The auth error code that best describes the status.
 */
function codeForStatus(status: number): AuthErrorCode {
  return STATUS_TO_CODE[status] ?? AUTH_ERROR_CODES.INTERNAL;
}

/**
 * Reads the per-field messages a `ValidationPipe` failure carries.
 *
 * The pipe puts them under `message` as an array of strings. They are written by
 * this application's DTOs, never by a caller, so they are safe to return.
 *
 * @param body - Raw value from `exception.getResponse()`.
 * @returns The field messages, or `null` when the body carries none.
 */
function readValidationDetails(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null) return null;
  const message = (body as Record<string, unknown>)['message'];
  if (!Array.isArray(message)) return null;
  const fields = message.filter((entry): entry is string => typeof entry === 'string');
  return fields.length > 0 ? { fields } : null;
}

/**
 * Global exception filter answering every failure in the library envelope.
 *
 * Registered via `app.useGlobalFilters(new AuthExceptionFilter())` in `main.ts`.
 *
 * @public
 */
@Catch()
export class AuthExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AuthExceptionFilter.name);

  /**
   * Writes `exception` to the response in the library envelope.
   *
   * @param exception - Whatever was thrown.
   * @param host - NestJS arguments host (HTTP context).
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AuthException) {
      const body: unknown = exception.getResponse();
      if (isAuthEnvelope(body)) {
        response.status(exception.getStatus()).json(body);
        return;
      }
      // Shape drift in the library — answer the code we can still recover.
      this.logger.warn(
        `AuthException body shape mismatch — using fallback envelope. status=${exception.getStatus()}`,
      );
      this.send(response, exception.getStatus(), AUTH_ERROR_CODES.TOKEN_INVALID, null);
      return;
    }

    if (exception instanceof ThrottlerException) {
      this.send(response, HttpStatus.TOO_MANY_REQUESTS, AUTH_ERROR_CODES.TOO_MANY_REQUESTS, null);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body: unknown = exception.getResponse();

      // A nested exception already carrying the envelope passes through intact.
      if (isAuthEnvelope(body)) {
        response.status(status).json(body);
        return;
      }

      const code = codeForStatus(status);
      const details = code === AUTH_ERROR_CODES.VALIDATION ? readValidationDetails(body) : null;
      this.send(response, status, code, details);
      return;
    }

    // Not an HttpException: a bug, a driver failure, a rejected promise. The
    // cause is logged and never serialized.
    this.logger.error(
      `unhandled exception: ${exception instanceof Error ? exception.message : typeof exception}`,
    );
    this.send(response, HttpStatus.INTERNAL_SERVER_ERROR, AUTH_ERROR_CODES.INTERNAL, null);
  }

  /**
   * Writes one envelope, taking the message from the static catalogue.
   *
   * The catalogue message is used rather than the thrown one so a framework
   * exception cannot leak its internals into a response body.
   *
   * @param response - Express response to write to.
   * @param status - HTTP status to answer with.
   * @param code - Auth error code for the envelope.
   * @param details - Structured detail for the caller, or `null`.
   */
  private send(
    response: Response,
    status: number,
    code: AuthErrorCode,
    details: Record<string, unknown> | null,
  ): void {
    // AUTH_ERROR_MESSAGES is keyed by code; the lookup is total for every value
    // of AuthErrorCode, and the fallback covers a code added by a newer library.
    const message = (AUTH_ERROR_MESSAGES as Record<string, string | undefined>)[code] ?? code;
    response.status(status).json({ error: { code, message, details } });
  }
}
