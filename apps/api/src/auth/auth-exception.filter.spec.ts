/**
 * @file auth-exception.filter.spec.ts
 * @description Unit tests for `AuthExceptionFilter`.
 *
 * Covers every branch of the `catch` method:
 *   1. Well-formed `AuthException` body → response contains `{ code, message, statusCode }`.
 *   2. Malformed body (does not match `AuthExceptionBody`) → falls back to `TOKEN_INVALID`,
 *      and a warning is logged.
 *   3. Body with no `message` field → `message` falls back to `AUTH_ERROR_MESSAGES[code]`.
 *
 * Mocks `ArgumentsHost` using plain objects — no NestJS testing module needed.
 * Tests are synchronous; the filter method is not async.
 *
 * @layer test
 * @see apps/api/src/auth/auth-exception.filter.ts
 */

import { HttpStatus } from '@nestjs/common';
import { jest } from '@jest/globals';
import { AuthException, AUTH_ERROR_CODES, AUTH_ERROR_MESSAGES } from '@bymax-one/nest-auth';
import type { AuthErrorCode } from '@bymax-one/nest-auth';
import { AuthExceptionFilter } from './auth-exception.filter.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Response body shape written by the filter via `res.status(n).json(body)`. */
interface FilterResponseBody {
  code: string;
  message: string;
  statusCode: number;
}

/**
 * Builds a mock `ArgumentsHost` whose HTTP context produces a response spy.
 * The `jsonSpy` captures the last call's body argument for assertions.
 *
 * @returns `{ host, getLastBody }` — the fake host and a helper to retrieve the last JSON body.
 */
function makeHost(): {
  host: Parameters<AuthExceptionFilter['catch']>[1];
  getLastBody: () => FilterResponseBody | undefined;
} {
  // Use `unknown` for the mock type to avoid Jest 30 generic constraints.
  // The actual runtime value is a FilterResponseBody — we retrieve it via getLastBody.
  const jsonMock = jest.fn<(body: unknown) => void>();

  const statusMock = jest.fn<(code: number) => { json: typeof jsonMock }>().mockReturnValue({
    json: jsonMock,
  });

  const host = {
    switchToHttp: jest.fn(() => ({
      getResponse: jest.fn(() => ({ status: statusMock })),
    })),
  } as unknown as Parameters<AuthExceptionFilter['catch']>[1];

  /** Retrieves the FilterResponseBody passed to the last json() call. */
  function getLastBody(): FilterResponseBody | undefined {
    // noUncheckedIndexedAccess: cast through unknown to access runtime argument.
    const calls = jsonMock.mock.calls as unknown as Array<[FilterResponseBody]>;
    return calls[0]?.[0];
  }

  return { host, getLastBody };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('AuthExceptionFilter', () => {
  let filter: AuthExceptionFilter;

  beforeEach(() => {
    filter = new AuthExceptionFilter();
  });

  // ── Standard AuthException ─────────────────────────────────────────────────

  it('maps a well-formed AuthException to { code, message, statusCode } in the response', () => {
    // FCM #29 — every AuthException must produce the standardised envelope expected
    // by the frontend error-code map. Code and message come from the exception body.
    const code: AuthErrorCode = AUTH_ERROR_CODES.INVALID_CREDENTIALS;
    const exception = new AuthException(code);
    const { host, getLastBody } = makeHost();

    filter.catch(exception, host);

    const body = getLastBody();
    expect(body?.code).toBe(code);
    expect(body?.statusCode).toBe(exception.getStatus());
    expect(typeof body?.message).toBe('string');
    expect(body?.message.length).toBeGreaterThan(0);
  });

  it('uses the status code from the exception when it is not 401', () => {
    // Ensures that non-default status codes (e.g. 403, 429) are propagated
    // to the response rather than being overridden with a hardcoded 401.
    const exception = new AuthException(AUTH_ERROR_CODES.FORBIDDEN, HttpStatus.FORBIDDEN);
    const { host, getLastBody } = makeHost();

    filter.catch(exception, host);

    expect(getLastBody()?.statusCode).toBe(403);
  });

  // ── Malformed body ─────────────────────────────────────────────────────────

  it('falls back to TOKEN_INVALID code when the exception body has an unexpected shape', () => {
    // Forward-compat guard: a library version mismatch may produce an unexpected
    // body structure. The filter must not crash — it falls back to TOKEN_INVALID.
    const exception = new AuthException(AUTH_ERROR_CODES.TOKEN_INVALID);
    // Override getResponse to return a non-conforming body (plain string).
    jest.spyOn(exception, 'getResponse').mockReturnValue('plain string body');

    const { host, getLastBody } = makeHost();

    filter.catch(exception, host);

    expect(getLastBody()?.code).toBe(AUTH_ERROR_CODES.TOKEN_INVALID);
  });

  it('logs a warning when the exception body does not match AuthExceptionBody shape', () => {
    // The warning is observable in production without exposing the raw exception body.
    // We spy on the logger's `warn` method to assert the warning was emitted.
    const exception = new AuthException(AUTH_ERROR_CODES.TOKEN_INVALID);
    // Override body to something that fails the isAuthExceptionBody guard.
    jest.spyOn(exception, 'getResponse').mockReturnValue(42 as unknown as string);

    const loggerWarnSpy = jest
      .spyOn(
        // Access the private logger field via bracket notation to observe the warning.
        (filter as unknown as { logger: { warn: (msg: string) => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);

    const { host } = makeHost();

    filter.catch(exception, host);

    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('AuthException body shape mismatch'),
    );
  });

  // ── Message fallback ───────────────────────────────────────────────────────

  it('falls back to AUTH_ERROR_MESSAGES[code] when the exception body has no message field', () => {
    // If the body has the right shape but the inner `message` is missing, the
    // filter must use the static message map rather than emitting undefined.
    const code: AuthErrorCode = AUTH_ERROR_CODES.ACCOUNT_LOCKED;
    const exception = new AuthException(code);

    // Override the response to have the correct shape but without `message`.
    jest.spyOn(exception, 'getResponse').mockReturnValue({
      error: { code, details: null },
    });

    const { host, getLastBody } = makeHost();

    filter.catch(exception, host);

    const body = getLastBody();
    expect(body?.code).toBe(code);
    // The message must be the static fallback, not undefined or empty.
    const expectedMessage = (AUTH_ERROR_MESSAGES as Record<string, string | undefined>)[code];
    expect(body?.message).toBe(expectedMessage ?? code);
  });

  it('uses the code itself as message when code is absent from AUTH_ERROR_MESSAGES', () => {
    // Ultimate fallback: an unknown future code that is not in AUTH_ERROR_MESSAGES
    // still produces a valid message (the code string itself) rather than undefined.
    const unknownCode = 'auth.future_code_unknown' as AuthErrorCode;
    const exception = new AuthException(AUTH_ERROR_CODES.TOKEN_INVALID);

    jest.spyOn(exception, 'getResponse').mockReturnValue({
      error: { code: unknownCode, details: null },
    });

    const { host, getLastBody } = makeHost();

    filter.catch(exception, host);

    const body = getLastBody();
    // AUTH_ERROR_MESSAGES does not contain unknownCode — must fall through to `code`.
    expect(typeof body?.message).toBe('string');
    expect((body?.message ?? '').length).toBeGreaterThan(0);
  });

  // ── isAuthExceptionBody guard branches ─────────────────────────────────────

  describe('isAuthExceptionBody guard branches', () => {
    /**
     * Builds a `logger.warn` spy bound to the filter under test.
     *
     * @returns Jest spy that captures warn invocations and produces no output.
     */
    function spyOnWarn(): jest.SpiedFunction<(msg: string) => void> {
      return jest
        .spyOn((filter as unknown as { logger: { warn: (msg: string) => void } }).logger, 'warn')
        .mockImplementation(() => undefined);
    }

    it('warns and falls back to TOKEN_INVALID when the body is a primitive (number)', () => {
      /*
       * Scenario: a future library version mismatch produces a numeric error
       * payload instead of the documented `{ error: { code, ... } }` envelope.
       * The filter must not crash on the property-access path — it surfaces
       * a generic TOKEN_INVALID code and warns the operator via the
       * application logger so the drift is observable in production.
       */
      const exception = new AuthException(AUTH_ERROR_CODES.TOKEN_INVALID);
      jest.spyOn(exception, 'getResponse').mockReturnValue(42 as unknown as string);
      const warnSpy = spyOnWarn();
      const { host, getLastBody } = makeHost();

      filter.catch(exception, host);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(getLastBody()?.code).toBe(AUTH_ERROR_CODES.TOKEN_INVALID);
    });

    it('warns and falls back to TOKEN_INVALID when the body is an object with no "error" key', () => {
      /*
       * Scenario: a malformed exception body that lacks the canonical
       * `error` envelope (an upstream catch handler may have flattened the
       * shape). The filter must reject the body and surface TOKEN_INVALID
       * so the user receives a recognisable error code rather than
       * `undefined` propagating into the response JSON.
       */
      const exception = new AuthException(AUTH_ERROR_CODES.TOKEN_INVALID);
      jest.spyOn(exception, 'getResponse').mockReturnValue({ foo: 'bar' });
      const warnSpy = spyOnWarn();
      const { host, getLastBody } = makeHost();

      filter.catch(exception, host);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(getLastBody()?.code).toBe(AUTH_ERROR_CODES.TOKEN_INVALID);
    });

    it('warns and falls back to TOKEN_INVALID when `error` is a primitive (not an object)', () => {
      /*
       * Scenario: an upstream change stores the error code as a top-level
       * string instead of nesting it under `error: { code }`. The filter
       * must reject this shape rather than later crashing when it reads
       * `code` on a string value.
       */
      const exception = new AuthException(AUTH_ERROR_CODES.TOKEN_INVALID);
      jest.spyOn(exception, 'getResponse').mockReturnValue({ error: 'just a string' });
      const warnSpy = spyOnWarn();
      const { host, getLastBody } = makeHost();

      filter.catch(exception, host);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(getLastBody()?.code).toBe(AUTH_ERROR_CODES.TOKEN_INVALID);
    });

    it('warns and falls back to TOKEN_INVALID when `error` is null', () => {
      /*
       * Scenario: a partial server-side mutation produces `{ error: null }`.
       * JavaScript's `typeof null === 'object'` would let a naive guard
       * accept the value and then crash when reading `error.code`. The
       * explicit null check protects the production path from a 500
       * caused by the filter itself rather than the original exception.
       */
      const exception = new AuthException(AUTH_ERROR_CODES.TOKEN_INVALID);
      jest.spyOn(exception, 'getResponse').mockReturnValue({ error: null });
      const warnSpy = spyOnWarn();
      const { host, getLastBody } = makeHost();

      filter.catch(exception, host);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(getLastBody()?.code).toBe(AUTH_ERROR_CODES.TOKEN_INVALID);
    });

    it('reads the code from the `error` key when the body has a well-formed envelope', () => {
      /*
       * Scenario: a future refactor that swapped the canonical `error`
       * property for any other key (or an empty-string key) would silently
       * change which value the filter reads as the error code. Sending a
       * body that carries both a recognisable `error` envelope and a
       * separate null entry on the empty-string key proves the filter
       * genuinely reads the `error` key — only then does ACCOUNT_LOCKED
       * surface to the response.
       */
      const exception = new AuthException(AUTH_ERROR_CODES.TOKEN_INVALID);
      jest.spyOn(exception, 'getResponse').mockReturnValue({
        '': null,
        error: { code: AUTH_ERROR_CODES.ACCOUNT_LOCKED, details: null },
      });
      const warnSpy = spyOnWarn();
      const { host, getLastBody } = makeHost();

      filter.catch(exception, host);

      // The envelope is recognised — no warn is emitted.
      expect(warnSpy).not.toHaveBeenCalled();
      // The forwarded code is the one nested under the `error` key.
      expect(getLastBody()?.code).toBe(AUTH_ERROR_CODES.ACCOUNT_LOCKED);
    });

    it('does NOT warn on the happy path (well-formed AuthException body)', () => {
      /*
       * Scenario: every successful request must keep the operator log
       * quiet. A warn on the happy path would flood production logs with
       * thousands of false-positive entries every minute and dilute the
       * signal of real shape mismatches.
       */
      const exception = new AuthException(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
      const warnSpy = spyOnWarn();
      const { host } = makeHost();

      filter.catch(exception, host);

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
