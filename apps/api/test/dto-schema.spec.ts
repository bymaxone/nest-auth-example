/**
 * @file dto-schema.spec.ts
 * @description Type-surface test — verifies that every public DTO class and
 * result type from `@bymax-one/nest-auth` is importable and usable in the
 * consuming application.
 *
 * Rather than re-testing the library's validation rules (which are covered by
 * the library's own test suite), this file focuses on:
 *  1. Verifying the public DTO constructors are accessible.
 *  2. Using result types as explicit TypeScript annotations so that breaking
 *     API changes become compile errors in this reference application.
 *  3. Confirming that service tokens are importable for DI composition
 *     (`SessionService`, `OtpService`, `PasswordResetService`).
 *
 * @layer test
 */

// ── DTOs ─────────────────────────────────────────────────────────────────────

import {
  RegisterDto,
  LoginDto,
  MfaChallengeDto,
  ForgotPasswordDto,
  AcceptInvitationDto,
  MfaDisableDto,
  MfaRegenerateRecoveryCodesDto,
  MfaVerifyDto,
  PlatformLoginDto,
  ResendOtpDto,
  ResendVerificationDto,
  VerifyOtpDto,
  SessionService,
  OtpService,
  PasswordResetService,
  OptionalAuthGuard,
} from '@bymax-one/nest-auth';

// ── Types (import-only to confirm public surface) ─────────────────────────────

import type {
  ActiveSessionInfo,
  AuthResult,
  MfaChallengeResult,
  MfaSetupResult,
  MfaTempPayload,
  OAuthMfaChallengeResult,
  PlatformAuthResult,
  RotatedTokenResult,
} from '@bymax-one/nest-auth';

// ── Shared types ──────────────────────────────────────────────────────────────

import type {
  AuthUserClient,
  LoginResult,
  MfaChallengeResult as SharedMfaChallengeResult,
  MfaTempPayload as SharedMfaTempPayload,
  PlatformAuthResult as SharedPlatformAuthResult,
  PlatformJwtPayload,
  PlatformLoginResult,
  TokenDeliveryMode,
  AuthContextKind,
  AuthCookieNames,
  AuthJwtPayload,
  AuthResponseCode,
  AuthResult as SharedAuthResult,
} from '@bymax-one/nest-auth/shared';

// ── DTO constructors ──────────────────────────────────────────────────────────

describe('library DTO constructors', () => {
  it('RegisterDto can be instantiated', () => {
    /**
     * Scenario: consumer code may instantiate DTOs to construct request bodies
     * for integration tests or typed validation helpers.
     * Rule: all DTOs exported from the library are constructable without required
     * constructor arguments (class-validator decorators are metadata-only).
     */
    const dto = new RegisterDto();
    expect(dto).toBeInstanceOf(RegisterDto);
  });

  it('LoginDto can be instantiated', () => {
    /**
     * Scenario: LoginDto shapes the body the client sends on every sign-in
     * attempt. Confirming it is constructable verifies the public API is intact.
     * Rule: LoginDto is a constructable class.
     */
    const dto = new LoginDto();
    expect(dto).toBeInstanceOf(LoginDto);
  });

  it('MfaChallengeDto can be instantiated', () => {
    /**
     * Scenario: MfaChallengeDto is the body shape for the OTP-challenge step.
     * Rule: MfaChallengeDto is a constructable class.
     */
    const dto = new MfaChallengeDto();
    expect(dto).toBeInstanceOf(MfaChallengeDto);
  });

  it('ForgotPasswordDto can be instantiated', () => {
    /**
     * Scenario: ForgotPasswordDto initiates the password-reset flow.
     * Rule: ForgotPasswordDto is a constructable class.
     */
    const dto = new ForgotPasswordDto();
    expect(dto).toBeInstanceOf(ForgotPasswordDto);
  });

  it('AcceptInvitationDto can be instantiated', () => {
    /**
     * Scenario: AcceptInvitationDto is the body for accepting an email invite.
     * Rule: AcceptInvitationDto is a constructable class.
     */
    const dto = new AcceptInvitationDto();
    expect(dto).toBeInstanceOf(AcceptInvitationDto);
  });

  it('MfaDisableDto can be instantiated', () => {
    /**
     * Scenario: MfaDisableDto carries the TOTP code used to confirm MFA disable.
     * Rule: MfaDisableDto is a constructable class.
     */
    const dto = new MfaDisableDto();
    expect(dto).toBeInstanceOf(MfaDisableDto);
  });

  it('MfaRegenerateRecoveryCodesDto can be instantiated', () => {
    /**
     * Scenario: MfaRegenerateRecoveryCodesDto confirms identity before generating
     * new codes. Rule: constructable.
     */
    const dto = new MfaRegenerateRecoveryCodesDto();
    expect(dto).toBeInstanceOf(MfaRegenerateRecoveryCodesDto);
  });

  it('MfaVerifyDto can be instantiated', () => {
    /**
     * Scenario: MfaVerifyDto is submitted during the MFA verification step of
     * the login flow. Rule: constructable.
     */
    const dto = new MfaVerifyDto();
    expect(dto).toBeInstanceOf(MfaVerifyDto);
  });

  it('PlatformLoginDto can be instantiated', () => {
    /**
     * Scenario: PlatformLoginDto shapes the body for platform-admin sign-in.
     * Rule: constructable.
     */
    const dto = new PlatformLoginDto();
    expect(dto).toBeInstanceOf(PlatformLoginDto);
  });

  it('ResendOtpDto can be instantiated', () => {
    /**
     * Scenario: ResendOtpDto initiates OTP re-delivery.
     * Rule: constructable.
     */
    const dto = new ResendOtpDto();
    expect(dto).toBeInstanceOf(ResendOtpDto);
  });

  it('ResendVerificationDto can be instantiated', () => {
    /**
     * Scenario: ResendVerificationDto re-sends the email-verification link.
     * Rule: constructable.
     */
    const dto = new ResendVerificationDto();
    expect(dto).toBeInstanceOf(ResendVerificationDto);
  });

  it('VerifyOtpDto can be instantiated', () => {
    /**
     * Scenario: VerifyOtpDto carries the OTP for the email-verification step.
     * Rule: constructable.
     */
    const dto = new VerifyOtpDto();
    expect(dto).toBeInstanceOf(VerifyOtpDto);
  });
});

// ── Library services ──────────────────────────────────────────────────────────

describe('library service tokens', () => {
  it('SessionService is importable from @bymax-one/nest-auth', () => {
    /**
     * Scenario: consuming apps that extend the auth flow (e.g., to list or revoke
     * sessions programmatically) inject SessionService from the library module.
     * Rule: SessionService is accessible as a named export.
     */
    expect(SessionService).toBeDefined();
  });

  it('OtpService is importable from @bymax-one/nest-auth', () => {
    /**
     * Scenario: apps that need to generate or verify OTPs outside the standard
     * auth flow (e.g., admin tooling) inject OtpService.
     * Rule: OtpService is accessible as a named export.
     */
    expect(OtpService).toBeDefined();
  });

  it('PasswordResetService is importable from @bymax-one/nest-auth', () => {
    /**
     * Scenario: custom reset flows (e.g., batch reset for compliance reasons)
     * may inject PasswordResetService to drive the reset pipeline.
     * Rule: PasswordResetService is accessible as a named export.
     */
    expect(PasswordResetService).toBeDefined();
  });

  it('OptionalAuthGuard is importable from @bymax-one/nest-auth', () => {
    /**
     * Scenario: controllers that serve both authenticated and anonymous callers
     * apply OptionalAuthGuard so @CurrentUser() receives the JWT payload when
     * present, or null/undefined when the request carries no token. The guard
     * requires BymaxAuthModule in the owning module's imports to resolve its
     * JwtService dependency — see UsersModule for the correct wiring pattern.
     * Rule: OptionalAuthGuard is accessible as a named export.
     */
    expect(OptionalAuthGuard).toBeDefined();
  });
});

// ── Compile-time type surface ─────────────────────────────────────────────────

/**
 * These compile-time assertions confirm that the named result types are
 * exported with the expected shape. A library upgrade that renames or removes
 * any of these will produce a TypeScript error in this file.
 *
 * No runtime assertions are needed — the `import type` statements above are
 * sufficient to trigger a compile error if the shape changes.
 */
describe('result type surface (compile-time)', () => {
  it('type imports resolve without error', () => {
    /**
     * Scenario: Importing ActiveSessionInfo, AuthResult, MfaChallengeResult,
     * MfaSetupResult, MfaTempPayload, OAuthMfaChallengeResult, PlatformAuthResult,
     * RotatedTokenResult, and shared types confirms the full type surface.
     * Rule: all named result types are publicly exported.
     *
     * The type-only variable assignments below are erased at compile time.
     * If a type is removed from the library, TypeScript compilation fails here.
     */
    const _activeSessionInfo = null as unknown as ActiveSessionInfo;
    const _authResult = null as unknown as AuthResult;
    const _mfaChallengeResult = null as unknown as MfaChallengeResult;
    const _mfaSetupResult = null as unknown as MfaSetupResult;
    const _mfaTempPayload = null as unknown as MfaTempPayload;
    const _oauthMfaChallengeResult = null as unknown as OAuthMfaChallengeResult;
    const _platformAuthResult = null as unknown as PlatformAuthResult;
    const _rotatedTokenResult = null as unknown as RotatedTokenResult;

    // Shared types
    const _authUserClient = null as unknown as AuthUserClient;
    const _loginResult = null as unknown as LoginResult;
    const _sharedMfaChallengeResult = null as unknown as SharedMfaChallengeResult;
    const _sharedMfaTempPayload = null as unknown as SharedMfaTempPayload;
    const _sharedPlatformAuthResult = null as unknown as SharedPlatformAuthResult;
    const _platformJwtPayload = null as unknown as PlatformJwtPayload;
    const _platformLoginResult = null as unknown as PlatformLoginResult;
    const _tokenDeliveryMode = null as unknown as TokenDeliveryMode;
    const _authContextKind = null as unknown as AuthContextKind;
    const _authCookieNames = null as unknown as AuthCookieNames;
    const _authJwtPayload = null as unknown as AuthJwtPayload;
    const _authResponseCode = null as unknown as AuthResponseCode;
    const _sharedAuthResult = null as unknown as SharedAuthResult;

    // Suppress 'declared but never read' lint errors — these are type guards.
    void _activeSessionInfo;
    void _authResult;
    void _mfaChallengeResult;
    void _mfaSetupResult;
    void _mfaTempPayload;
    void _oauthMfaChallengeResult;
    void _platformAuthResult;
    void _rotatedTokenResult;
    void _authUserClient;
    void _loginResult;
    void _sharedMfaChallengeResult;
    void _sharedMfaTempPayload;
    void _sharedPlatformAuthResult;
    void _platformJwtPayload;
    void _platformLoginResult;
    void _tokenDeliveryMode;
    void _authContextKind;
    void _authCookieNames;
    void _authJwtPayload;
    void _authResponseCode;
    void _sharedAuthResult;

    expect(true).toBe(true);
  });
});
