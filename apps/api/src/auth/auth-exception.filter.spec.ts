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
  ConflictException,
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
function makeHost(
  request: Record<string, unknown> = { id: 'req-1', headers: {}, user: { tenantId: 'acme' } },
): {
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
      // The filter reads the request for correlation ids on the unhandled path.
      getRequest: jest.fn(() => request),
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
   * Scenario: a service enforces a business rule with a plain
   * `BadRequestException` — `AccountService.findSwitchTarget` reports "You are
   * already signed in to this workspace" that way.
   * Rule: the sentence survives. A real DTO failure never reaches this branch:
   * `createAuthValidationPipe` is mounted globally and its `exceptionFactory`
   * already answers those in the library envelope with `auth.validation` and the
   * per-field list. Mapping 400 onto that code would therefore only ever relabel
   * a business rule, replacing its explanation with "some fields are invalid".
   */
  it('keeps the message of a business bad request', () => {
    const { host, getStatus, getBody } = makeHost();

    filter.catch(new BadRequestException('You are already signed in to this workspace.'), host);

    expect(getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(JSON.stringify(getBody())).toContain('already signed in');
    expect(JSON.stringify(getBody())).not.toContain(AUTH_ERROR_CODES.VALIDATION);
  });

  /**
   * Scenario: a DTO failure as the global pipe actually produces it.
   * Rule: it already carries the envelope, so it passes through untouched with
   * its per-field details intact — which is why the filter needs no validation
   * mapping of its own.
   */
  it('passes a pipe validation failure through with its field details', () => {
    const { host, getStatus, getBody } = makeHost();
    const envelope = {
      error: {
        code: AUTH_ERROR_CODES.VALIDATION,
        message: 'Validation failed',
        details: { fields: [{ field: 'email', message: 'must be an email' }] },
      },
    };

    filter.catch(new BadRequestException(envelope), host);

    expect(getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(getBody()).toEqual(envelope);
  });

  /**
   * Scenario: guards throw the framework's own refusals.
   * Rule: each status maps to the code that describes it.
   */
  it.each([
    [new UnauthorizedException(), HttpStatus.UNAUTHORIZED, AUTH_ERROR_CODES.TOKEN_INVALID],
    [new ForbiddenException(), HttpStatus.FORBIDDEN, AUTH_ERROR_CODES.FORBIDDEN],
  ])('maps %# to its matching auth code', (exception, status, code) => {
    const { host, getStatus, getBody } = makeHost();

    filter.catch(exception, host);

    expect(getStatus()).toBe(status);
    expect(getBody()?.error.code).toBe(code);
  });

  /**
   * Scenario: a service reports a missing row — `ProjectsService.delete` and
   * `PlatformService` both do.
   * Rule: the framework's own body is answered, untouched. `AUTH_ERROR_CODES` is
   * an authentication vocabulary and no member of it describes a missing
   * project, so folding this onto one would tell the frontend that an ordinary
   * 404 was a server fault and replace the service's message with the
   * internal-error sentence.
   */
  it('leaves a not-found alone rather than calling it an auth failure', () => {
    const { host, getStatus, getBody } = makeHost();

    filter.catch(new NotFoundException("Project 'p-1' not found"), host);

    expect(getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(JSON.stringify(getBody())).toContain("Project 'p-1' not found");
    expect(JSON.stringify(getBody())).not.toContain(AUTH_ERROR_CODES.INTERNAL);
  });

  /**
   * Scenario: a duplicate tenant slug — `TenantsService.create` throws this.
   * Rule: same as above for any unmapped client error. The conflict reaches the
   * caller as a conflict, with the reason the service wrote.
   */
  it('leaves a conflict alone and keeps the reason', () => {
    const { host, getStatus, getBody } = makeHost();

    filter.catch(new ConflictException("Tenant slug 'acme' is already taken"), host);

    expect(getStatus()).toBe(HttpStatus.CONFLICT);
    expect(JSON.stringify(getBody())).toContain('already taken');
  });

  /**
   * Scenario: a server-side `HttpException` on an unmapped 5xx status.
   * Rule: unlike a client error, this one IS suppressed. The message belongs to
   * whatever failed and may quote its own configuration, so the generic internal
   * envelope is answered and nothing is echoed.
   */
  it('suppresses the body of an unmapped server error', () => {
    const { host, getStatus, getBody } = makeHost();

    filter.catch(
      new HttpException('upstream at postgres://u:p@host/db failed', HttpStatus.BAD_GATEWAY),
      host,
    );

    expect(getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(getBody()?.error.code).toBe(AUTH_ERROR_CODES.INTERNAL);
    expect(JSON.stringify(getBody())).not.toContain('postgres://');
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
  it('never writes the thrown message for a mapped framework exception', () => {
    const { host, getBody } = makeHost();

    filter.catch(new ForbiddenException('postgres://user:secret@host/db'), host);

    expect(getBody()?.error.message).toBe(AUTH_ERROR_MESSAGES[AUTH_ERROR_CODES.FORBIDDEN]);
    expect(JSON.stringify(getBody())).not.toContain('secret');
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
   * Scenario: an exception whose response body is `null`. `typeof null` is
   * `'object'`, so the null check is the only thing standing between the guard
   * and a property read on null.
   * Rule: the filter answers instead of throwing. A crash inside the handler
   * that exists to stop crashes escaping would turn a handled error into an
   * unhandled one.
   */
  it('answers when the response body is null', () => {
    const { host, getStatus, getBody } = makeHost();

    filter.catch(new HttpException(null as unknown as string, HttpStatus.BAD_GATEWAY), host);

    expect(getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(getBody()?.error.code).toBe(AUTH_ERROR_CODES.INTERNAL);
  });

  /**
   * Scenario: a body carrying `error: null` — the shape a partially-populated
   * envelope would have.
   * Rule: same reasoning one level down. The envelope null check is what keeps
   * the `code` read off a null, and the response falls through to the status
   * mapping rather than crashing.
   */
  it('answers when the envelope itself is null', () => {
    const { host, getStatus, getBody } = makeHost();

    filter.catch(new HttpException({ error: null }, HttpStatus.FORBIDDEN), host);

    expect(getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(getBody()?.error.code).toBe(AUTH_ERROR_CODES.FORBIDDEN);
  });

  /**
   * Scenario: an envelope-shaped body whose `code` is not a string.
   * Rule: it is not treated as an envelope. Passing it through would put a
   * non-string code on the wire, which `createAuthClient` cannot map — the very
   * failure the envelope contract exists to prevent.
   */
  it('does not treat a non-string code as an envelope', () => {
    const { host, getStatus, getBody } = makeHost();

    filter.catch(new HttpException({ error: { code: 42 } }, HttpStatus.FORBIDDEN), host);

    expect(getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(getBody()?.error.code).toBe(AUTH_ERROR_CODES.FORBIDDEN);
  });

  /**
   * Scenario: a server-side failure that already speaks the envelope.
   * Rule: it passes through with its own code. Only bodies the filter cannot
   * read are suppressed at 5xx — an envelope was written by this application or
   * the library, so there is nothing in it to withhold.
   */
  it('passes a server-status envelope through instead of suppressing it', () => {
    const { host, getStatus, getBody } = makeHost();
    const envelope = {
      error: { code: AUTH_ERROR_CODES.INTERNAL, message: 'upstream refused', details: null },
    };

    filter.catch(new HttpException(envelope, HttpStatus.SERVICE_UNAVAILABLE), host);

    expect(getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(getBody()).toEqual(envelope);
  });

  /**
   * Scenario: a plain `HttpException` at exactly 500 — the boundary between
   * "client error, answer its own body" and "server fault, suppress it".
   * Rule: 500 is a server fault. Pinning the boundary itself is what stops it
   * drifting by one and letting a server message reach the caller.
   */
  it('suppresses the body at exactly 500', () => {
    const { host, getStatus, getBody } = makeHost();

    filter.catch(new HttpException('internal detail at postgres://u:p@host/db', 500), host);

    expect(getStatus()).toBe(500);
    expect(getBody()?.error.code).toBe(AUTH_ERROR_CODES.INTERNAL);
    expect(JSON.stringify(getBody())).not.toContain('postgres://');
  });

  /**
   * Scenario: the library's own exception arrives with a body that is not the
   * envelope — the version-drift path.
   * Rule: the warning names the mismatch and the status. A blank line would
   * leave an operator with a fallback envelope on the wire and nothing in the
   * logs saying the library shape had changed.
   */
  it('names the shape mismatch and status in the drift warning', () => {
    const { host } = makeHost();
    const warn = jest.spyOn(filter['logger'], 'warn').mockImplementation(() => undefined);

    filter.catch(new HttpException({ nope: true }, HttpStatus.UNAUTHORIZED), host);
    // The library path is what logs; drive it with a real AuthException whose
    // body has drifted.
    warn.mockClear();
    const drifted = new AuthException(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
    jest.spyOn(drifted, 'getResponse').mockReturnValue({ unexpected: true });

    filter.catch(drifted, host);

    const message = String((warn.mock.calls as unknown as Array<[string]>)[0]?.[0]);
    expect(message).toContain('shape mismatch');
    expect(message).toContain(String(HttpStatus.UNAUTHORIZED));
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
   * Scenario: a driver failure whose own message quotes the connection URL it
   * could not reach — the classic shape of a Prisma or ioredis error.
   * Rule: the configured secret does not survive into the log line. The
   * logger's `redact` paths match structured fields and cannot reach a value
   * interpolated into `Error.message`, so naming the secrets is what removes
   * them. Nothing reaches the response body either way.
   */
  it('strips a configured secret from the logged message', () => {
    const secret = 'postgresql://api:hunter2@db.internal:5432/app';
    const filterWithSecrets = new AuthExceptionFilter([secret]);
    const { host, getBody } = makeHost();
    const error = jest
      .spyOn(filterWithSecrets['logger'], 'error')
      .mockImplementation(() => undefined);

    filterWithSecrets.catch(new Error(`connect ECONNREFUSED ${secret}`), host);

    // Serialise the whole log object — the description is a field on it, not the
    // message, so stringifying only the first argument would compare against
    // "[object Object]" and pass no matter what the entry held.
    const entry = (error.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]?.[0];
    const logged = JSON.stringify(entry);
    expect(logged).not.toContain('hunter2');
    expect(logged).not.toContain(secret);
    expect(entry).toMatchObject({ msg: 'auth.unhandled_exception' });
    expect(JSON.stringify(getBody())).not.toContain('hunter2');
  });

  /**
   * Scenario: an unhandled exception on a request that carries correlation ids.
   * Rule: the log line names the event, and carries the request and tenant ids
   * alongside it. The logger module attaches those through `customProps`, which
   * covers the request logger but not the `Logger` a filter holds — so without
   * reading them here this would be the one line that cannot be tied back to the
   * request that produced it.
   */
  it('logs the event name with the request and tenant ids', () => {
    const { host } = makeHost({ id: 'req-42', headers: {}, user: { tenantId: 'globex' } });
    const error = jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);

    filter.catch(new Error('boom'), host);

    const entry = (error.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]?.[0];
    expect(entry).toMatchObject({
      msg: 'auth.unhandled_exception',
      requestId: 'req-42',
      tenantId: 'globex',
    });
    expect(typeof entry?.['error']).toBe('string');
  });

  /**
   * Scenario: the failure happened before any guard ran, so there is no verified
   * JWT — only the tenant the caller claimed in `X-Tenant-Id`.
   * Rule: it is logged under a separate `tenantIdUnverified` key and capped in
   * length. On this path the value is a claim rather than a fact, and a log
   * field is not a place to echo an unbounded string the caller chose.
   */
  it('records an unverified tenant separately and caps its length', () => {
    const longClaim = 'x'.repeat(200);
    const { host } = makeHost({ id: 'req-7', headers: { 'x-tenant-id': longClaim } });
    const error = jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);

    filter.catch(new Error('boom'), host);

    const entry = (error.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]?.[0];
    expect(entry?.['tenantId']).toBeUndefined();
    expect(entry?.['tenantIdUnverified']).toHaveLength(64);
  });

  /**
   * Scenario: the JWT carries an empty `tenantId`.
   * Rule: an empty string is not a tenant, so the log falls back to the header
   * rather than recording a blank field that reads as "no tenant known" while
   * actually meaning "the claim was empty".
   */
  it('falls back to the header when the JWT tenant is an empty string', () => {
    const { host } = makeHost({
      id: 'req-9',
      headers: { 'x-tenant-id': 'acme' },
      user: { tenantId: '' },
    });
    const error = jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);

    filter.catch(new Error('boom'), host);

    const entry = (error.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]?.[0];
    expect(entry?.['tenantId']).toBeUndefined();
    expect(entry?.['tenantIdUnverified']).toBe('acme');
  });

  /**
   * Scenario: the header is present but empty.
   * Rule: neither tenant field is recorded. An empty header is no more a tenant
   * than an absent one, and emitting the key would suggest a value was found.
   */
  it('records no tenant when the header is an empty string', () => {
    const { host } = makeHost({ id: 'req-10', headers: { 'x-tenant-id': '' } });
    const error = jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);

    filter.catch(new Error('boom'), host);

    const entry = (error.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]?.[0];
    expect(entry?.['tenantId']).toBeUndefined();
    expect(entry?.['tenantIdUnverified']).toBeUndefined();
    expect(entry?.['requestId']).toBe('req-10');
  });

  /**
   * Scenario: no tenant is available from either source, but the request id is.
   * Rule: the request id is still recorded. It is the identifier that ties the
   * line to its request, so dropping it along with the tenant would leave the
   * entry uncorrelatable — the exact gap this correlation exists to close.
   */
  it('keeps the request id when no tenant can be determined', () => {
    const { host } = makeHost({ id: 'req-11', headers: {} });
    const error = jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);

    filter.catch(new Error('boom'), host);

    const entry = (error.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]?.[0];
    expect(entry?.['requestId']).toBe('req-11');
  });

  /**
   * Scenario: a proxy sent the header more than once, so Express hands over an
   * array.
   * Rule: the first value is taken rather than serialising the array, so the
   * field keeps one shape whatever the caller sent.
   */
  it('takes the first value when the tenant header is repeated', () => {
    const { host } = makeHost({ id: 'req-8', headers: { 'x-tenant-id': ['acme', 'globex'] } });
    const error = jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);

    filter.catch(new Error('boom'), host);

    const entry = (error.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]?.[0];
    expect(entry?.['tenantIdUnverified']).toBe('acme');
  });

  /**
   * Scenario: the request carries neither id — an early failure, or a call that
   * never reached the tenant resolver.
   * Rule: the filter still answers and still logs. Correlation is best-effort;
   * losing it must not turn a handled 500 into an unhandled crash inside the
   * handler that exists to catch crashes.
   */
  it('still answers when the request carries no correlation ids', () => {
    const { host, getStatus, getBody } = makeHost({});
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);

    filter.catch(new Error('boom'), host);

    expect(getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(getBody()?.error.code).toBe(AUTH_ERROR_CODES.INTERNAL);
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
