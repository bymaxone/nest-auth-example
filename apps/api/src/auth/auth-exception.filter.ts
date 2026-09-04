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
 * Framework exceptions whose status maps onto an auth code — a rate-limit
 * rejection, a failed DTO validation, a guard's refusal — are folded into the
 * same envelope so they reach the user as themselves. Those that do not map keep
 * their own body: a 404 for a missing project is not an authentication failure,
 * and describing it with an auth code would report an ordinary missing resource
 * as a server fault.
 *
 * Server faults and thrown values that are not exceptions answer a generic
 * internal error. That is the one path where a stack detail or a connection
 * string could otherwise reach a response body, so nothing from them is echoed.
 *
 * @layer auth
 * @see docs/guidelines/security-privacy-guidelines.md
 */

import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  AuthException,
  AUTH_ERROR_CODES,
  AUTH_ERROR_MESSAGES,
  describeError,
} from '@bymax-one/nest-auth';
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
 * Used for framework exceptions that carry no code of their own — chiefly a
 * guard that threw `UnauthorizedException` or `ForbiddenException`, which the
 * frontend routes on (an invalid token sends the user back to sign in).
 *
 * 400 is deliberately absent. `createAuthValidationPipe` is mounted globally and
 * its `exceptionFactory` already answers DTO failures with `auth.validation` and
 * the per-field list under `error.details`, so a real validation failure arrives
 * carrying the envelope and never reaches this map. What a 400 reaching here
 * actually is, then, is a business rule — `AccountService.findSwitchTarget`
 * reporting "You are already signed in to this workspace" — and relabelling that
 * as `auth.validation` replaced its sentence with "some fields are invalid".
 */
const STATUS_TO_CODE: Partial<Record<number, AuthErrorCode>> = {
  [HttpStatus.UNAUTHORIZED]: AUTH_ERROR_CODES.TOKEN_INVALID,
  [HttpStatus.FORBIDDEN]: AUTH_ERROR_CODES.FORBIDDEN,
  [HttpStatus.TOO_MANY_REQUESTS]: AUTH_ERROR_CODES.TOO_MANY_REQUESTS,
};

/**
 * Maps an HTTP status to the auth error code that describes it, if any.
 *
 * Deliberately partial. `AUTH_ERROR_CODES` is an authentication vocabulary, and
 * most framework exceptions are not authentication failures: a missing project
 * is a 404 and a duplicate tenant slug is a 409, neither of which any auth code
 * describes. Forcing them onto one would tell the frontend that an ordinary
 * missing resource was a server fault, and replace the message the service
 * wrote with the internal-error sentence.
 *
 * @param status - HTTP status carried by the exception.
 * @returns The matching auth error code, or `undefined` when none applies.
 */
function codeForStatus(status: number): AuthErrorCode | undefined {
  return STATUS_TO_CODE[status];
}

/**
 * Lowest status that denotes a server fault rather than a client error.
 *
 * Widened to `number` deliberately: `exception.getStatus()` returns a plain
 * number, and comparing that against an `HttpStatus` member directly is an
 * unsafe enum comparison.
 */
const SERVER_ERROR_THRESHOLD: number = HttpStatus.INTERNAL_SERVER_ERROR;

/** Longest tenant identifier accepted into a log line from a request header. */
const MAX_LOGGED_TENANT_LENGTH = 64;

/**
 * Correlation identifiers carried by the request, for the log line.
 *
 * `requestId` is attached by pino-http. The tenant is read from the JWT the
 * guard verified, and only falls back to the `X-Tenant-Id` header when the
 * request never reached a guard — an unauthenticated route, or a failure before
 * authentication. Nothing in the application assigns `request.tenantId`, so
 * reading that property yields `undefined` on every request.
 *
 * The header value is caller-supplied, so it is length-capped: a log field is
 * not a place to echo an unbounded string a client chose. It is also marked as
 * unverified, because on that path it is a claim rather than a fact.
 *
 * The logger module puts correlation on every line it writes itself through
 * `customProps`, but that applies to the request logger, not to the `Logger`
 * instance a filter holds — so an exception logged here would otherwise be the
 * one line in the file that cannot be tied to its request.
 *
 * @param request - The Express request the failure happened on.
 * @returns The identifiers that are present, for spreading into the log object.
 */
function correlationOf(request: Request): {
  requestId?: unknown;
  tenantId?: string;
  tenantIdUnverified?: string;
} {
  const carrier = request as Request & { id?: unknown; user?: { tenantId?: unknown } };
  const requestId = carrier.id;

  const authenticatedTenant = carrier.user?.tenantId;
  if (typeof authenticatedTenant === 'string' && authenticatedTenant.length > 0) {
    return { requestId, tenantId: authenticatedTenant };
  }

  // `headers` is always present on a real Express request, but this filter is
  // the last line of defence — reading through an absent bag here would crash
  // inside the handler that exists to keep crashes from escaping.
  const header = request.headers?.['x-tenant-id'];
  const claimed = Array.isArray(header) ? header[0] : header;
  if (typeof claimed === 'string' && claimed.length > 0) {
    return { requestId, tenantIdUnverified: claimed.slice(0, MAX_LOGGED_TENANT_LENGTH) };
  }

  return { requestId };
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
   * @param secrets - Configured values that must never appear in a log line.
   *   Pino's `redact` paths match structured fields, so they cannot reach a
   *   value a driver interpolated into its own `Error.message` — the connection
   *   URL a failed Prisma or ioredis call quotes back, most of all. Naming the
   *   values here is what lets them be stripped from that message. Defaults to
   *   none so a test can construct the filter directly.
   */
  constructor(private readonly secrets: readonly string[] = []) {}

  /**
   * Writes `exception` to the response in the library envelope.
   *
   * @param exception - Whatever was thrown.
   * @param host - NestJS arguments host (HTTP context).
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();

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
      if (code !== undefined) {
        this.send(response, status, code, null);
        return;
      }

      // No auth code describes this status. A client error carries information
      // the caller needs and this application wrote — "Project 'x' not found",
      // "Tenant slug 'y' is already taken" — so its own body is answered
      // unchanged. The client's third body shape reads the message from it.
      if (status < SERVER_ERROR_THRESHOLD) {
        response.status(status).json(body);
        return;
      }

      // A server fault, on the other hand, is never echoed: the message belongs
      // to whatever failed and may quote its own configuration.
      this.send(response, status, AUTH_ERROR_CODES.INTERNAL, null);
      return;
    }

    // Not an HttpException: a bug, a driver failure, a rejected promise. The
    // cause is logged and never serialized.
    //
    // The message is written by whatever threw, so it is the one log line on
    // this path that can carry a credential the logger's redact paths cannot
    // see. `describeError` strips the configured secrets out of it, caps the
    // length, and collapses newlines so a CR/LF in a remote's words cannot
    // forge a second log record. It goes in its own field rather than in `msg`,
    // so the event name stays groupable and the request ids sit beside it.
    this.logger.error({
      msg: 'auth.unhandled_exception',
      ...correlationOf(http.getRequest<Request>()),
      error: describeError(exception, this.secrets),
    });
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
    // AUTH_ERROR_MESSAGES is `Readonly<Record<AuthErrorCode, string>>` — a mapped
    // type over the full code union, so the lookup is total and needs no fallback.
    response.status(status).json({ error: { code, message: AUTH_ERROR_MESSAGES[code], details } });
  }
}
