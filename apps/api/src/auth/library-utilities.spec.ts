/**
 * @file library-utilities.spec.ts
 * @description Runtime demonstrations of the library's standalone utilities.
 *
 * Where `test/dto-schema.spec.ts` pins the compile-time type surface, this
 * spec exercises the exported helper FUNCTIONS a consumer reaches for
 * directly — how `authDocumentSecurity` derives an OpenAPI security default,
 * what shape `describeError`/`describeChannelStatus` log lines take,
 * `redactSecrets` scrubbing a credential from channel text,
 * `reduceToBaseWord` folding decorated passwords onto their blocklist base,
 * and the `AllowAllBreachChecker` escape hatch.
 *
 * @layer test
 * @see docs/guidelines/nest-auth-guidelines.md
 * @see docs/guidelines/testing-guidelines.md
 */

import {
  AUTH_SECURITY_SCHEMES,
  AllowAllBreachChecker,
  authDocumentSecurity,
  describeError,
  redactSecrets,
  reduceToBaseWord,
} from '@bymax-one/nest-auth';

// ── OpenAPI document security ─────────────────────────────────────────────────

describe('authDocumentSecurity', () => {
  it('derives the cookie scheme for a cookie-mode dashboard deployment', () => {
    /*
     * Scenario: this app guards its own routes with JwtAuthGuard (the
     * 'dashboard' family) and runs cookie tokenDelivery — the derived
     * document-level default must name exactly the access-cookie scheme so
     * generated clients authenticate the way the server actually reads.
     * Rule: one requirement entry, keyed by AUTH_SECURITY_SCHEMES.accessCookie,
     * with an empty scopes list (the schemes are scope-less).
     */
    const security = authDocumentSecurity({ guard: 'dashboard', tokenDelivery: 'cookie' });

    expect(security).toEqual([{ [AUTH_SECURITY_SCHEMES.accessCookie]: [] }]);
  });

  it('derives a two-entry OR list under tokenDelivery both', () => {
    /*
     * Scenario: under 'both' a caller may authenticate with either
     * transport. OpenAPI reads a LIST of requirement objects as OR, so the
     * derivation must produce two single-scheme entries — merging them into
     * one entry would mean AND (the same credential demanded twice).
     * Rule: two entries, each naming exactly one dashboard scheme.
     */
    const security = authDocumentSecurity({ guard: 'dashboard', tokenDelivery: 'both' });

    expect(security).toHaveLength(2);
    expect(security).toEqual([
      { [AUTH_SECURITY_SCHEMES.accessCookie]: [] },
      { [AUTH_SECURITY_SCHEMES.accessBearer]: [] },
    ]);
  });

  it('derives the platform bearer scheme regardless of tokenDelivery', () => {
    /*
     * Scenario: the platform family is always bearer-mode — only the
     * dashboard family varies with delivery, which is why the function
     * takes the guard family and not just the delivery mode.
     * Rule: platform guard yields the single platform-bearer requirement.
     */
    const security = authDocumentSecurity({ guard: 'platform', tokenDelivery: 'cookie' });

    expect(security).toEqual([{ [AUTH_SECURITY_SCHEMES.platformBearer]: [] }]);
  });

  it('accepts an unset tokenDelivery and falls back to the library default', () => {
    /*
     * Scenario: tokenDelivery is optional on BymaxAuthModuleOptions, and the
     * function accepts it exactly as written — including undefined — so a
     * deployment on defaults never hardcodes 'cookie' at the call site.
     * Rule: undefined resolves to the library's cookie default.
     */
    const security = authDocumentSecurity({ guard: 'dashboard', tokenDelivery: undefined });

    expect(security).toEqual([{ [AUTH_SECURITY_SCHEMES.accessCookie]: [] }]);
  });
});

describe('AUTH_SECURITY_SCHEMES', () => {
  it('exposes the four stable scheme names generated clients depend on', () => {
    /*
     * Scenario: scheme NAMES are wire-stable identifiers — renaming one is a
     * break every generated client feels, so the constant pins all four.
     * Rule: the map carries exactly the documented name per transport.
     */
    expect(AUTH_SECURITY_SCHEMES).toEqual({
      accessCookie: 'bymaxAuthAccessCookie',
      accessBearer: 'bymaxAuthAccessBearer',
      refreshCookie: 'bymaxAuthRefreshCookie',
      platformBearer: 'bymaxPlatformAccessBearer',
    });
  });
});

// ── Log-line describers ───────────────────────────────────────────────────────

describe('describeError', () => {
  it('describes an Error in one line with known secrets redacted', () => {
    /*
     * Scenario: for failures whose message rendered nothing that must be
     * withheld, describeError keeps the channel's explanation but scrubs
     * every value the caller names — here a recipient address.
     * Rule: the line carries the error name and message with the secret
     * replaced by the redaction marker.
     */
    const line = describeError(new Error('send to user@example.com failed'), ['user@example.com']);

    expect(line).toContain('Error');
    expect(line).toContain('<redacted>');
    expect(line).not.toContain('user@example.com');
  });

  it('describes a non-Error thrown value by its type', () => {
    /*
     * Scenario: JavaScript lets any value be thrown; the describer must
     * produce a single safe line rather than crash on a string throw.
     * Rule: non-Error values are described by their typeof, not their content.
     */
    const line = describeError('boom', []);

    expect(line).toBe('<non-error: string>');
  });
});

// ── Secret redaction ──────────────────────────────────────────────────────────

describe('redactSecrets', () => {
  it('replaces every occurrence of a known secret in channel text', () => {
    /*
     * Scenario: a policy relay rejects a message by quoting the body back —
     * the raised error then carries the OTP in clear text. Before that text
     * reaches a log line, every known credential value must be scrubbed.
     * Rule: exact, case-sensitive substring replacement with <redacted>.
     */
    const scrubbed = redactSecrets('550 rejected: "Your code is 699647."', ['699647']);

    expect(scrubbed).toBe('550 rejected: "Your code is <redacted>."');
  });
});

// ── Password blocklist normalisation ──────────────────────────────────────────

describe('reduceToBaseWord', () => {
  it('folds a l33t-decorated, suffixed password onto its base word', () => {
    /*
     * Scenario: this reduction is what the default CommonPasswordChecker's
     * `password.blocklist` matching runs on — both the candidate password
     * AND every blocklist entry are folded to a base word, so blocking
     * 'password' also blocks 'P@ssw0rd123!' without listing each variant.
     * Rule: lowercase + strip trailing decoration + un-l33t = the base word.
     */
    expect(reduceToBaseWord('P@ssw0rd123!')).toBe('password');
    expect(reduceToBaseWord('Password123')).toBe('password');
    expect(reduceToBaseWord('password')).toBe('password');
  });
});

// ── Breach-checker escape hatch ───────────────────────────────────────────────

describe('AllowAllBreachChecker', () => {
  it('reports every password as not breached', async () => {
    /*
     * Scenario: the explicit opt-out checker exists for deployments that
     * must screen nothing (legacy-account migration, fixed e2e fixtures) —
     * this app binds it under PASSWORD_BREACH_CHECKER=off. It must approve
     * even a canonical weak password, because approving everything is its
     * entire documented contract.
     * Rule: isBreached resolves false for any input.
     */
    const checker = new AllowAllBreachChecker();

    await expect(checker.isBreached('password1')).resolves.toBe(false);
  });
});
