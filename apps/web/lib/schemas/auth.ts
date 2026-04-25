/**
 * @fileoverview Zod validation schemas for all authentication forms.
 *
 * Each schema is a stable module-level constant so it can be passed to
 * `zodResolver` without `useMemo`. Field names match the server DTOs
 * exactly where they overlap, so form data can be spread directly into
 * `authClient` calls without renaming.
 *
 * @module lib/schemas/auth
 */

import { z } from 'zod';

/** Login form — email + password. */
export const loginSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});

/** Inferred type for the login form values. */
export type LoginFormValues = z.infer<typeof loginSchema>;

/** Registration form — email, display name, password, tenant. */
export const registerSchema = z.object({
  email: z.email('Enter a valid email address.'),
  name: z.string().min(2, 'Name must be at least 2 characters.').max(100),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(128),
  tenantId: z.string().min(1, 'Please select a workspace.'),
});

/** Inferred type for the registration form values. */
export type RegisterFormValues = z.infer<typeof registerSchema>;

/**
 * Email verification form.
 * The field is named `otp` to match the `VerifyEmailDto.otp` server contract.
 */
export const verifyEmailSchema = z.object({
  otp: z.string().length(6, 'Enter the 6-digit verification code.'),
});

/** Inferred type for the verify-email form values. */
export type VerifyEmailFormValues = z.infer<typeof verifyEmailSchema>;

/** Forgot-password form — email only (tenant is read from the URL). */
export const forgotPasswordSchema = z.object({
  email: z.email('Enter a valid email address.'),
});

/** Inferred type for the forgot-password form values. */
export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

/**
 * Reset-password form for the token-based flow.
 * The token is read from the URL and is not included in the form.
 */
export const resetPasswordTokenSchema = z
  .object({
    newPassword: z.string().min(8, 'Password must be at least 8 characters.').max(128),
    confirmPassword: z.string().min(1, 'Please confirm your password.'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

/** Inferred type for the reset-password (token mode) form values. */
export type ResetPasswordTokenFormValues = z.infer<typeof resetPasswordTokenSchema>;

/**
 * Reset-password form for the OTP-based flow.
 * The OTP field maps to `ResetPasswordDto.otp` (4-8 chars).
 */
export const resetPasswordOtpSchema = z
  .object({
    otp: z.string().min(4, 'Enter the reset code.').max(8),
    newPassword: z.string().min(8, 'Password must be at least 8 characters.').max(128),
    confirmPassword: z.string().min(1, 'Please confirm your password.'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

/** Inferred type for the reset-password (OTP mode) form values. */
export type ResetPasswordOtpFormValues = z.infer<typeof resetPasswordOtpSchema>;

/**
 * MFA challenge form — discriminated by type so the active input mode
 * is reflected in the inferred type.
 */
export const mfaChallengeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('totp'),
    code: z.string().length(6, 'Enter the 6-digit code.'),
  }),
  z.object({
    type: z.literal('recovery'),
    code: z.string().min(1, 'Enter your recovery code.'),
  }),
]);

/** Inferred type for the MFA challenge form values. */
export type MfaChallengeFormValues = z.infer<typeof mfaChallengeSchema>;

/** Accept-invitation form — display name + new password + confirmation. */
export const acceptInvitationSchema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters.').max(100),
    password: z.string().min(8, 'Password must be at least 8 characters.').max(128),
    confirmPassword: z.string().min(1, 'Please confirm your password.'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

/** Inferred type for the accept-invitation form values. */
export type AcceptInvitationFormValues = z.infer<typeof acceptInvitationSchema>;
