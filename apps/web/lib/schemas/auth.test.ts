/**
 * @fileoverview Unit tests for authentication Zod schemas.
 *
 * Verifies positive (valid data passes) and negative (invalid data fails with
 * the correct path) cases for every schema exported from `lib/schemas/auth`.
 *
 * @module lib/schemas/auth.test
 */

import { describe, it, expect } from 'vitest';
import {
  loginSchema,
  registerSchema,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordTokenSchema,
  resetPasswordOtpSchema,
  mfaChallengeSchema,
  acceptInvitationSchema,
} from './auth.js';

// ── loginSchema ───────────────────────────────────────────────────────────────

describe('loginSchema', () => {
  it('accepts a valid email and non-empty password', () => {
    /*
     * Scenario: a well-formed email and a non-empty password string must parse
     * successfully — the happy path used on the login page form submit.
     * Protects: baseline login form validation.
     */
    const result = loginSchema.safeParse({ email: 'user@example.com', password: 'secret123' });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid email format', () => {
    /*
     * Scenario: submitting a string that is not a valid email must fail so the
     * user sees an inline validation error before the request is sent.
     * Protects: email field constraint in loginSchema.
     */
    const result = loginSchema.safeParse({ email: 'not-an-email', password: 'secret123' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('email');
    }
  });

  it('rejects an empty password', () => {
    /*
     * Scenario: submitting an empty password string must fail — the password
     * field requires at least one character.
     * Protects: password min(1) constraint in loginSchema.
     */
    const result = loginSchema.safeParse({ email: 'user@example.com', password: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('password');
    }
  });
});

// ── registerSchema ────────────────────────────────────────────────────────────

describe('registerSchema', () => {
  it('accepts a fully valid registration payload', () => {
    /*
     * Scenario: all fields meet their constraints — happy path for the
     * registration form submit.
     * Protects: baseline registerSchema validation.
     */
    const result = registerSchema.safeParse({
      email: 'new@example.com',
      name: 'Alice',
      password: 'SuperSecure1!',
      tenantId: 'tenant-cuid-123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid email format', () => {
    /*
     * Scenario: a malformed email must fail even when all other fields are
     * valid, producing an error on the email path.
     * Protects: email constraint in registerSchema.
     */
    const result = registerSchema.safeParse({
      email: 'bad-email',
      name: 'Alice',
      password: 'SuperSecure1!',
      tenantId: 'tenant-cuid-123',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path[0]).toBe('email');
    }
  });

  it('rejects a name that is shorter than 2 characters', () => {
    /*
     * Scenario: a single-character name must fail because the field requires
     * a minimum length of 2.
     * Protects: name min(2) constraint in registerSchema.
     */
    const result = registerSchema.safeParse({
      email: 'new@example.com',
      name: 'A',
      password: 'SuperSecure1!',
      tenantId: 'tenant-cuid-123',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('name');
    }
  });

  it('rejects a password shorter than 8 characters', () => {
    /*
     * Scenario: a 7-character password must fail because the field requires
     * at least 8 characters.
     * Protects: password min(8) constraint in registerSchema.
     */
    const result = registerSchema.safeParse({
      email: 'new@example.com',
      name: 'Alice',
      password: 'short1!',
      tenantId: 'tenant-cuid-123',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('password');
    }
  });

  it('rejects a missing tenantId', () => {
    /*
     * Scenario: omitting tenantId (or passing an empty string) must fail
     * because a workspace must be selected before registering.
     * Protects: tenantId min(1) constraint in registerSchema.
     */
    const result = registerSchema.safeParse({
      email: 'new@example.com',
      name: 'Alice',
      password: 'SuperSecure1!',
      tenantId: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('tenantId');
    }
  });
});

// ── verifyEmailSchema ─────────────────────────────────────────────────────────

describe('verifyEmailSchema', () => {
  it('accepts exactly a 6-digit code', () => {
    /*
     * Scenario: a 6-character string must pass — that is the exact length
     * sent by the backend.
     * Protects: otp length(6) constraint in verifyEmailSchema.
     */
    const result = verifyEmailSchema.safeParse({ otp: '123456' });
    expect(result.success).toBe(true);
  });

  it('rejects a 5-digit code (too short)', () => {
    /*
     * Scenario: a 5-character string must fail because the OTP is exactly
     * 6 digits.
     * Protects: otp length(6) lower bound in verifyEmailSchema.
     */
    const result = verifyEmailSchema.safeParse({ otp: '12345' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path[0]).toBe('otp');
    }
  });

  it('rejects a 7-digit code (too long)', () => {
    /*
     * Scenario: a 7-character string must fail because the OTP is exactly
     * 6 digits.
     * Protects: otp length(6) upper bound in verifyEmailSchema.
     */
    const result = verifyEmailSchema.safeParse({ otp: '1234567' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path[0]).toBe('otp');
    }
  });
});

// ── forgotPasswordSchema ──────────────────────────────────────────────────────

describe('forgotPasswordSchema', () => {
  it('accepts a valid email address', () => {
    /*
     * Scenario: a properly-formed email must parse successfully — happy path
     * for the forgot-password form.
     * Protects: baseline forgotPasswordSchema validation.
     */
    const result = forgotPasswordSchema.safeParse({ email: 'user@example.com' });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid email address', () => {
    /*
     * Scenario: a malformed email must fail validation so the user corrects
     * their input before the reset request is sent.
     * Protects: email constraint in forgotPasswordSchema.
     */
    const result = forgotPasswordSchema.safeParse({ email: 'plaintext' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path[0]).toBe('email');
    }
  });
});

// ── resetPasswordTokenSchema ──────────────────────────────────────────────────

describe('resetPasswordTokenSchema', () => {
  it('accepts matching passwords that meet the minimum length', () => {
    /*
     * Scenario: two identical passwords of at least 8 characters must pass
     * both field constraints and the .refine check.
     * Protects: baseline resetPasswordTokenSchema validation.
     */
    const result = resetPasswordTokenSchema.safeParse({
      newPassword: 'NewPass1!',
      confirmPassword: 'NewPass1!',
    });
    expect(result.success).toBe(true);
  });

  it('rejects mismatching passwords with an error on confirmPassword', () => {
    /*
     * Scenario: when the two password fields differ the .refine must attach
     * the error to the confirmPassword path.
     * Protects: .refine passwords-match rule in resetPasswordTokenSchema.
     */
    const result = resetPasswordTokenSchema.safeParse({
      newPassword: 'NewPass1!',
      confirmPassword: 'DifferentPass!',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('confirmPassword');
    }
  });

  it('rejects a newPassword shorter than 8 characters', () => {
    /*
     * Scenario: a short newPassword must fail before the refine even runs.
     * Protects: newPassword min(8) constraint in resetPasswordTokenSchema.
     */
    const result = resetPasswordTokenSchema.safeParse({
      newPassword: 'short',
      confirmPassword: 'short',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('newPassword');
    }
  });
});

// ── resetPasswordOtpSchema ────────────────────────────────────────────────────

describe('resetPasswordOtpSchema', () => {
  it('accepts a valid OTP + matching passwords', () => {
    /*
     * Scenario: an OTP within range and matching passwords must all pass —
     * happy path for the OTP-based reset flow.
     * Protects: baseline resetPasswordOtpSchema validation.
     */
    const result = resetPasswordOtpSchema.safeParse({
      otp: '1234',
      newPassword: 'NewPass1!',
      confirmPassword: 'NewPass1!',
    });
    expect(result.success).toBe(true);
  });

  it('rejects mismatching passwords with an error on confirmPassword', () => {
    /*
     * Scenario: the .refine must fire when newPassword !== confirmPassword
     * and attach the error to the confirmPassword path.
     * Protects: .refine passwords-match rule in resetPasswordOtpSchema.
     */
    const result = resetPasswordOtpSchema.safeParse({
      otp: '1234',
      newPassword: 'NewPass1!',
      confirmPassword: 'WrongPass2!',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('confirmPassword');
    }
  });

  it('rejects an OTP shorter than 4 characters', () => {
    /*
     * Scenario: a 3-character OTP must fail because the field requires at
     * least 4 characters.
     * Protects: otp min(4) constraint in resetPasswordOtpSchema.
     */
    const result = resetPasswordOtpSchema.safeParse({
      otp: '123',
      newPassword: 'NewPass1!',
      confirmPassword: 'NewPass1!',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('otp');
    }
  });

  it('rejects an OTP longer than 8 characters', () => {
    /*
     * Scenario: a 9-character OTP must fail because the field caps at 8
     * characters.
     * Protects: otp max(8) constraint in resetPasswordOtpSchema.
     */
    const result = resetPasswordOtpSchema.safeParse({
      otp: '123456789',
      newPassword: 'NewPass1!',
      confirmPassword: 'NewPass1!',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('otp');
    }
  });
});

// ── mfaChallengeSchema ────────────────────────────────────────────────────────

describe('mfaChallengeSchema', () => {
  it('accepts type=totp with a 6-digit code', () => {
    /*
     * Scenario: the TOTP branch of the discriminated union must accept a
     * 6-character code — the standard TOTP length.
     * Protects: totp branch of mfaChallengeSchema.
     */
    const result = mfaChallengeSchema.safeParse({ type: 'totp', code: '654321' });
    expect(result.success).toBe(true);
  });

  it('rejects type=totp with a 5-digit code', () => {
    /*
     * Scenario: a TOTP code that is not exactly 6 characters must fail — the
     * user must enter the full code.
     * Protects: code length(6) constraint in the totp branch.
     */
    const result = mfaChallengeSchema.safeParse({ type: 'totp', code: '12345' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('code');
    }
  });

  it('accepts type=recovery with any non-empty code', () => {
    /*
     * Scenario: the recovery branch must accept any non-empty string because
     * recovery codes vary in length.
     * Protects: recovery branch of mfaChallengeSchema (min(1) only).
     */
    const result = mfaChallengeSchema.safeParse({ type: 'recovery', code: 'ABCD-EFGH-1234' });
    expect(result.success).toBe(true);
  });

  it('rejects type=recovery with an empty code', () => {
    /*
     * Scenario: an empty recovery code must fail — the field requires at
     * least one character.
     * Protects: code min(1) constraint in the recovery branch.
     */
    const result = mfaChallengeSchema.safeParse({ type: 'recovery', code: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('code');
    }
  });

  it('rejects an unknown type value', () => {
    /*
     * Scenario: a discriminated union must reject a type value that is not
     * one of the declared literals ('totp' | 'recovery').
     * Protects: discriminatedUnion exhaustiveness in mfaChallengeSchema.
     */
    const result = mfaChallengeSchema.safeParse({ type: 'sms', code: '123456' });
    expect(result.success).toBe(false);
  });
});

// ── acceptInvitationSchema ────────────────────────────────────────────────────

describe('acceptInvitationSchema', () => {
  it('accepts a valid name and matching passwords', () => {
    /*
     * Scenario: a name with at least 2 chars and matching passwords of at
     * least 8 chars must parse successfully — happy path.
     * Protects: baseline acceptInvitationSchema validation.
     */
    const result = acceptInvitationSchema.safeParse({
      name: 'Bob',
      password: 'Welcome1!',
      confirmPassword: 'Welcome1!',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a name that is shorter than 2 characters', () => {
    /*
     * Scenario: a single-character name must fail the min(2) length rule.
     * Protects: name min(2) constraint in acceptInvitationSchema.
     */
    const result = acceptInvitationSchema.safeParse({
      name: 'B',
      password: 'Welcome1!',
      confirmPassword: 'Welcome1!',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('name');
    }
  });

  it('rejects mismatching passwords with an error on confirmPassword', () => {
    /*
     * Scenario: when password !== confirmPassword the .refine must flag the
     * confirmPassword path so the inline error appears on the right field.
     * Protects: .refine passwords-match rule in acceptInvitationSchema.
     */
    const result = acceptInvitationSchema.safeParse({
      name: 'Bob',
      password: 'Welcome1!',
      confirmPassword: 'Different2!',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('confirmPassword');
    }
  });
});
