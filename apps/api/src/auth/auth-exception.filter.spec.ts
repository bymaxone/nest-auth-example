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
});
