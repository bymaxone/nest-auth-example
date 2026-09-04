/**
 * @file auth-exception.filter.spec.ts
 * @description Unit tests for `AuthExceptionFilter`.
 *
 * The filter's contract is the library envelope, because that is what
 * `createAuthClient` parses. These tests pin the shape itself, not only the
 * values inside it: a regression to a flat `{ code, message, statusCode }` body
 * is what silently turns every error message in `apps/web` into the generic
 * fallback sentence, and it is invisible from the status code alone.
 *
 * Mocks `ArgumentsHost` using plain objects — no NestJS testing module needed.
 * Tests are synchronous; the filter method is not async.
 *
 * @layer test
 * @see apps/api/src/auth/auth-exception.filter.ts
 */

import { jest } from '@jest/globals';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { AuthException, AUTH_ERROR_CODES, AUTH_ERROR_MESSAGES } from '@bymax-one/nest-auth';
import { AuthExceptionFilter } from './auth-exception.filter.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Envelope body written by the filter via `res.status(n).json(body)`. */
interface EnvelopeBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown> | null;
  };
}

/**
 * Builds a mock `ArgumentsHost` whose HTTP context produces a response spy.
 *
 * @returns The fake host plus helpers reading the status and body last written.
 */
function makeHost(): {
  host: Parameters<AuthExceptionFilter['catch']>[1];
  getStatus: () => number | undefined;
  getBody: () => EnvelopeBody | undefined;
} {
  const jsonMock = jest.fn<(body: unknown) => void>();
  const statusMock = jest.fn<(code: number) => { json: typeof jsonMock }>().mockReturnValue({
    json: jsonMock,
  });

  const host = {
    switchToHttp: jest.fn(() => ({
      getResponse: jest.fn(() => ({ status: statusMock })),
    })),
  } as unknown as Parameters<AuthExceptionFilter['catch']>[1];

  /** Reads the status passed to the first status() call. */
  function getStatus(): number | undefined {
    const calls = statusMock.mock.calls as unknown as Array<[number]>;
    return calls[0]?.[0];
  }

  /** Reads the body passed to the first json() call. */
  function getBody(): EnvelopeBody | undefined {
    const calls = jsonMock.mock.calls as unknown as Array<[EnvelopeBody]>;
    return calls[0]?.[0];
  }

  return { host, getStatus, getBody };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('AuthExceptionFilter', () => {
  let filter: AuthExceptionFilter;

  beforeEach(() => {
    filter = new AuthExceptionFilter();
    jest.restoreAllMocks();
  });

  // ── AuthException ──────────────────────────────────────────────────────────

  /**
   * Scenario: the library throws its own exception.
   * Rule: the envelope it already carries is written through untouched, so the
   * code the client reads is the code the library raised.
   */
  it('passes a library exception through in its own envelope', () => {
    const { host, getStatus, getBody } = makeHost();

    filter.catch(new AuthException(AUTH_ERROR_CODES.INVALID_CREDENTIALS), host);

    expect(getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(getBody()?.error.code).toBe(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
    expect(typeof getBody()?.error.message).toBe('string');
  });

  /**
   * Scenario: any error response at all.
   * Rule: the body is nested under `error`. A flat top-level `code` is the shape
   * `createAuthClient` cannot parse, so its absence is the actual contract.
   */
  it('nests the code under `error` rather than at the top level', () => {
    const { host, getBody } = makeHost();

    filter.catch(new AuthException(AUTH_ERROR_CODES.MFA_REQUIRED), host);

    const body = getBody();
    expect(body).toHaveProperty('error.code', AUTH_ERROR_CODES.MFA_REQUIRED);
    expect(body).not.toHaveProperty('code');
    expect(body).not.toHaveProperty('statusCode');
  });

  /**
   * Scenario: a library version whose exception body no longer matches.
   * Rule: answer a usable envelope anyway and warn, rather than writing a body
   * the client cannot read.
   */
  it('falls back to an invalid-token envelope when the library body drifts', () => {
    const { host, getStatus, getBody } = makeHost();
    const warn = jest.spyOn(filter['logger'], 'warn').mockImplementation(() => undefined);

    const drifted = new AuthException(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
    jest.spyOn(drifted, 'getResponse').mockReturnValue({ unexpected: true });

    filter.catch(drifted, host);

    expect(getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(getBody()?.error.code).toBe(AUTH_ERROR_CODES.TOKEN_INVALID);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  // ── Framework exceptions ───────────────────────────────────────────────────

  /**
   * Scenario: the rate limiter rejects a request.
   * Rule: it answers as a rate-limit error, not as a generic internal one, so the
   * user is told to wait instead of being shown an unexplained failure.
   */
  it('maps a throttler rejection to the too-many-requests code', () => {
    const { host, getStatus, getBody } = makeHost();

    filter.catch(new ThrottlerException(), host);

    expect(getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(getBody()?.error.code).toBe(AUTH_ERROR_CODES.TOO_MANY_REQUESTS);
    expect(getBody()?.error.message).toBe(AUTH_ERROR_MESSAGES[AUTH_ERROR_CODES.TOO_MANY_REQUESTS]);
  });

  /**
   * Scenario: a DTO fails validation.
   * Rule: the per-field messages survive as structured detail, so a form can point
   * at the field instead of only showing a sentence.
   */
  it('carries validation field messages through as details', () => {
    const { host, getStatus, getBody } = makeHost();

    filter.catch(new BadRequestException({ message: ['email must be an email'] }), host);

    expect(getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(getBody()?.error.code).toBe(AUTH_ERROR_CODES.VALIDATION);
    expect(getBody()?.error.details).toEqual({ fields: ['email must be an email'] });
  });

  /**
   * Scenario: a bad request that carries no field array.
   * Rule: still a validation error, with no invented detail.
   */
  it('answers a bare bad request with a validation code and no details', () => {
    const { host, getBody } = makeHost();

    filter.catch(new BadRequestException('nope'), host);

    expect(getBody()?.error.code).toBe(AUTH_ERROR_CODES.VALIDATION);
    expect(getBody()?.error.details).toBeNull();
  });

  /**
   * Scenario: guards throw the framework's own refusals.
   * Rule: each status maps to the code that describes it.
   */
  it.each([
    [new UnauthorizedException(), HttpStatus.UNAUTHORIZED, AUTH_ERROR_CODES.TOKEN_INVALID],
    [new ForbiddenException(), HttpStatus.FORBIDDEN, AUTH_ERROR_CODES.FORBIDDEN],
    [new NotFoundException(), HttpStatus.NOT_FOUND, AUTH_ERROR_CODES.INTERNAL],
  ])('maps %# to its matching auth code', (exception, status, code) => {
    const { host, getStatus, getBody } = makeHost();

    filter.catch(exception, host);

    expect(getStatus()).toBe(status);
    expect(getBody()?.error.code).toBe(code);
  });

  /**
   * Scenario: an exception thrown by another layer that already speaks the envelope.
   * Rule: it is written through unchanged rather than re-wrapped.
   */
  it('passes a nested envelope through unchanged', () => {
    const { host, getBody } = makeHost();
    const envelope = {
      error: { code: AUTH_ERROR_CODES.SESSION_NOT_FOUND, message: 'gone', details: null },
    };

    filter.catch(new HttpException(envelope, HttpStatus.NOT_FOUND), host);

    expect(getBody()).toEqual(envelope);
  });

  /**
   * Scenario: a framework exception whose message names an internal detail.
   * Rule: the catalogue message is written, never the thrown one, so a driver
   * error cannot put a connection string in a response body.
   */
  it('never writes the thrown message for a framework exception', () => {
    const { host, getBody } = makeHost();

    filter.catch(new BadRequestException('postgres://user:secret@host/db'), host);

    expect(getBody()?.error.message).toBe(AUTH_ERROR_MESSAGES[AUTH_ERROR_CODES.VALIDATION]);
    expect(JSON.stringify(getBody())).not.toContain('secret');
  });

  /**
   * Scenario: an exception built from a bare string, so `getResponse()` hands the
   * filter a string rather than an object.
   * Rule: the envelope guard rejects a non-object outright instead of indexing
   * into it, and the validation reader finds no field array to report.
   */
  it('answers a string-bodied bad request without inventing details', () => {
    const { host, getStatus, getBody } = makeHost();

    filter.catch(new HttpException('plain text body', HttpStatus.BAD_REQUEST), host);

    expect(getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(getBody()?.error.code).toBe(AUTH_ERROR_CODES.VALIDATION);
    expect(getBody()?.error.details).toBeNull();
  });

  /**
   * Scenario: a string-bodied exception on a status with no code of its own.
   * Rule: the non-object body is rejected by the envelope guard and the status
   * falls through to the internal code — the response never carries the string.
   */
  it('rejects a non-object body rather than reading a code out of it', () => {
    const { host, getStatus, getBody } = makeHost();

    filter.catch(new HttpException('plain text body', HttpStatus.BAD_GATEWAY), host);

    expect(getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(getBody()?.error.code).toBe(AUTH_ERROR_CODES.INTERNAL);
    expect(JSON.stringify(getBody())).not.toContain('plain text body');
  });

  /**
   * Scenario: a validation body whose `message` array holds no strings.
   * Rule: `details` stays null. Serialising whatever the array happened to hold
   * is how a non-string value would reach the caller unchecked.
   */
  it('reports no details when the validation array holds no strings', () => {
    const { host, getBody } = makeHost();

    filter.catch(new BadRequestException({ message: [42, { field: 'email' }] }), host);

    expect(getBody()?.error.code).toBe(AUTH_ERROR_CODES.VALIDATION);
    expect(getBody()?.error.details).toBeNull();
  });

  // ── Unknown throwables ─────────────────────────────────────────────────────

  /**
   * Scenario: something that is not an exception at all reaches the filter.
   * Rule: answer a generic internal error and log the cause, so the failure is
   * visible in the logs without reaching the caller.
   */
  it('answers a generic internal error for a non-exception throwable', () => {
    const { host, getStatus, getBody } = makeHost();
    const error = jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);

    filter.catch(new Error('connect ECONNREFUSED 127.0.0.1:5432'), host);

    expect(getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(getBody()?.error.code).toBe(AUTH_ERROR_CODES.INTERNAL);
    expect(JSON.stringify(getBody())).not.toContain('ECONNREFUSED');
    expect(error).toHaveBeenCalledTimes(1);
  });

  /**
   * Scenario: a rejected promise carrying a non-Error value.
   * Rule: the filter still answers, describing the value by type only.
   */
  it('answers when the thrown value is not an Error', () => {
    const { host, getStatus, getBody } = makeHost();
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);

    filter.catch('boom', host);

    expect(getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(getBody()?.error.code).toBe(AUTH_ERROR_CODES.INTERNAL);
  });
});
