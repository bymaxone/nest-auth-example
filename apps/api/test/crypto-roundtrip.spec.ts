/**
 * @file crypto-roundtrip.spec.ts
 * @description Round-trip and correctness tests for the cryptographic utility
 * functions exported from `@bymax-one/nest-auth`.
 *
 * These tests demonstrate and verify the library's `encrypt`/`decrypt`
 * (AES-256-GCM), `hmacSha256`, `timingSafeCompare`, and `sleep` utilities.
 * The functions are consumed here via their public export to confirm every
 * symbol is reachable from application code.
 *
 * All keys and test inputs are synthetic — never use these values in production.
 *
 * @layer test
 */

import { encrypt, decrypt, hmacSha256, timingSafeCompare, sleep } from '@bymax-one/nest-auth';

// ── Key fixture ───────────────────────────────────────────────────────────────

/**
 * 32-byte AES-256-GCM key encoded as base64.
 *
 * Hardcoded for deterministic test execution. Do NOT derive secrets from test
 * fixtures; this key is for unit-test assertions only.
 */
const TEST_KEY_BASE64 = Buffer.alloc(32, 0xab).toString('base64');

// ── encrypt / decrypt ─────────────────────────────────────────────────────────

describe('encrypt / decrypt', () => {
  it('round-trips short ASCII plaintext', () => {
    /**
     * Scenario: calling encrypt then decrypt with the same key returns the
     * original string.
     * Rule: decrypt(encrypt(x, key), key) === x for any plaintext x.
     */
    const plaintext = 'hello, world!';
    const ciphertext = encrypt(plaintext, TEST_KEY_BASE64);
    expect(decrypt(ciphertext, TEST_KEY_BASE64)).toBe(plaintext);
  });

  it('round-trips an empty string', () => {
    /**
     * Scenario: the empty string is a valid plaintext (edge case for AES-GCM
     * — zero-byte messages must not produce invalid ciphertext).
     * Rule: round-trip holds for the empty string.
     */
    const ciphertext = encrypt('', TEST_KEY_BASE64);
    expect(decrypt(ciphertext, TEST_KEY_BASE64)).toBe('');
  });

  it('round-trips a long unicode string', () => {
    /**
     * Scenario: multi-byte UTF-8 characters (emoji, non-ASCII) must survive
     * the encrypt/decrypt cycle without corruption.
     * Rule: unicode content is preserved exactly after round-trip.
     */
    const plaintext = '🔐 secret data — naïve café résumé 日本語 — end';
    const ciphertext = encrypt(plaintext, TEST_KEY_BASE64);
    expect(decrypt(ciphertext, TEST_KEY_BASE64)).toBe(plaintext);
  });

  it('produces distinct ciphertexts for the same plaintext (randomised IV)', () => {
    /**
     * Scenario: AES-256-GCM uses a random IV per call, so two encryptions of
     * the same plaintext must not yield the same ciphertext.
     * Rule: IVs are not reused (semantic security property).
     */
    const plaintext = 'same message';
    const c1 = encrypt(plaintext, TEST_KEY_BASE64);
    const c2 = encrypt(plaintext, TEST_KEY_BASE64);
    expect(c1).not.toBe(c2);
  });

  it('throws on ciphertext tampered with a wrong key', () => {
    /**
     * Scenario: decrypting with a different key must fail. AES-256-GCM
     * authentication tag verification catches any key or ciphertext mismatch.
     * Rule: the library must not silently return garbage data.
     */
    const ciphertext = encrypt('secret', TEST_KEY_BASE64);
    const wrongKey = Buffer.alloc(32, 0xcd).toString('base64');
    expect(() => decrypt(ciphertext, wrongKey)).toThrow();
  });
});

// ── hmacSha256 ────────────────────────────────────────────────────────────────

describe('hmacSha256', () => {
  it('produces a stable hex digest for the same inputs', () => {
    /**
     * Scenario: HMAC is deterministic — the same message and secret always
     * yield the same digest. Essential for token verification workflows.
     * Rule: hmacSha256(msg, secret) is a pure function.
     */
    const digest1 = hmacSha256('hello', 'my-secret');
    const digest2 = hmacSha256('hello', 'my-secret');
    expect(digest1).toBe(digest2);
  });

  it('produces different digests for different messages', () => {
    /**
     * Scenario: changing the message changes the digest (collision-resistance
     * property of HMAC-SHA-256).
     * Rule: distinct inputs produce distinct outputs.
     */
    const d1 = hmacSha256('message-a', 'secret');
    const d2 = hmacSha256('message-b', 'secret');
    expect(d1).not.toBe(d2);
  });

  it('produces different digests for different secrets', () => {
    /**
     * Scenario: a different HMAC secret changes the digest even for the same
     * message. Prevents cross-tenant token confusion.
     * Rule: distinct secrets yield distinct MACs.
     */
    const d1 = hmacSha256('message', 'secret-a');
    const d2 = hmacSha256('message', 'secret-b');
    expect(d1).not.toBe(d2);
  });

  it('returns a 64-character lowercase hex string (SHA-256 = 32 bytes)', () => {
    /**
     * Scenario: HMAC-SHA-256 output is always 256 bits = 32 bytes = 64 hex chars.
     * Rule: output length is fixed regardless of input length.
     */
    const digest = hmacSha256('any message', 'any secret');
    expect(digest).toHaveLength(64);
    expect(digest).toMatch(/^[0-9a-f]+$/);
  });
});

// ── timingSafeCompare ─────────────────────────────────────────────────────────

describe('timingSafeCompare', () => {
  it('returns true for equal strings', () => {
    /**
     * Scenario: two identical strings must compare as equal. This is the
     * happy path for token validation (recovery-code comparison, HMAC check).
     * Rule: timingSafeCompare(a, a) === true.
     */
    expect(timingSafeCompare('same-value', 'same-value')).toBe(true);
  });

  it('returns false for strings that differ by one character', () => {
    /**
     * Scenario: a one-character difference must cause a false result. Protects
     * against off-by-one acceptance of invalid tokens.
     * Rule: timingSafeCompare('abc', 'abX') === false.
     */
    expect(timingSafeCompare('abc', 'abX')).toBe(false);
  });

  it('returns false when the strings have different lengths', () => {
    /**
     * Scenario: a length mismatch must never result in a true (e.g. an attacker
     * submitting a prefix or suffix of a valid token must not be granted access).
     * Rule: length mismatch is always false.
     */
    expect(timingSafeCompare('short', 'short-but-longer')).toBe(false);
  });

  it('returns false for empty string vs non-empty string', () => {
    /**
     * Scenario: empty vs non-empty must not accidentally be equal.
     * Rule: comparing an empty string to any non-empty string returns false.
     */
    expect(timingSafeCompare('', 'non-empty')).toBe(false);
  });

  it('returns true for two empty strings', () => {
    /**
     * Scenario: the identity case for empty strings — comparing two empty strings
     * must succeed (edge case for optional fields where both sides are empty).
     * Rule: timingSafeCompare('', '') === true.
     */
    expect(timingSafeCompare('', '')).toBe(true);
  });
});

// ── sleep ─────────────────────────────────────────────────────────────────────

describe('sleep', () => {
  it('resolves after the specified delay', async () => {
    /**
     * Scenario: sleep(ms) must return a Promise that resolves after at least
     * `ms` milliseconds. Used in auth flows for rate-limiting back-pressure.
     * Rule: the returned Promise resolves (does not reject).
     */
    await expect(sleep(1)).resolves.toBeUndefined();
  });
});
