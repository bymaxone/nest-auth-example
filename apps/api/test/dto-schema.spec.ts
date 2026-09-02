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
 *     (`SessionService`, `OtpService`, `PasswordResetService`,
 *     `PlatformAuthService`, `EmailChangeService`, `InvitationService`).
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
  PlatformAuthService,
  EmailChangeService,
  InvitationService,
} from '@bymax-one/nest-auth';

// ── Types (import-only to confirm public surface) ─────────────────────────────

import type {
  SessionInfo,
  AuthResult,
  MfaChallengeResult,
  MfaSetupResult,
  MfaTempPayload,
  OAuthMfaChallengeResult,
  PlatformAuthResult,
  RotatedTokenResult,
  CreateSessionParams,
  ListSessionsParams,
  RevokeSessionParams,
  RevokeAllSessionsParams,
  RevokeAllExceptCurrentParams,
  RevocableTokenPayload,
  UpdateMfaData,
  AuthFieldError,
  AuthGuardFamily,
  BymaxAuthRateLimitOptions,
  ClientIpSource,
  AuthRateLimitWindow,
  OpenApiSecurityRequirement,
  AuthDocumentSecurityParams,
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

  it('PlatformAuthService is importable from @bymax-one/nest-auth', () => {
    /**
     * Scenario: apps that build custom platform-admin flows (e.g. scripted
     * bootstrap of the first platform administrator) inject PlatformAuthService
     * from the library module.
     * Rule: PlatformAuthService is accessible as a named export.
     */
    expect(PlatformAuthService).toBeDefined();
  });

  it('EmailChangeService is importable from @bymax-one/nest-auth', () => {
    /**
     * Scenario: apps that orchestrate the two-step address change outside the
     * mounted controllers (e.g. an admin-driven migration tool) inject
     * EmailChangeService to start and confirm changes programmatically.
     * Rule: EmailChangeService is accessible as a named export.
     */
    expect(EmailChangeService).toBeDefined();
  });

  it('InvitationService is importable from @bymax-one/nest-auth', () => {
    /**
     * Scenario: apps that persist invitations in their own store (as this
     * example does via `POST /api/invitations`) inject InvitationService to
     * mint and validate the library's invitation tokens.
     * Rule: InvitationService is accessible as a named export.
     */
    expect(InvitationService).toBeDefined();
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
     * Scenario: Importing SessionInfo, AuthResult, MfaChallengeResult,
     * MfaSetupResult, MfaTempPayload, OAuthMfaChallengeResult, PlatformAuthResult,
     * RotatedTokenResult, and shared types confirms the full type surface.
     * Rule: all named result types are publicly exported.
     *
     * Each binding below is declared as `T | undefined` and left undefined:
     * it names the type without asserting anything about a value, so no cast
     * is involved. If a type is removed from the library, this file stops
     * compiling.
     */
    const _sessionInfo: SessionInfo | undefined = undefined;
    const _authResult: AuthResult | undefined = undefined;
    const _mfaChallengeResult: MfaChallengeResult | undefined = undefined;
    const _mfaSetupResult: MfaSetupResult | undefined = undefined;
    const _mfaTempPayload: MfaTempPayload | undefined = undefined;
    const _oauthMfaChallengeResult: OAuthMfaChallengeResult | undefined = undefined;
    const _platformAuthResult: PlatformAuthResult | undefined = undefined;
    const _rotatedTokenResult: RotatedTokenResult | undefined = undefined;

    // Session-service parameter objects (object params so tenantId can never
    // be transposed with another string argument).
    const _createSessionParams: CreateSessionParams | undefined = undefined;
    const _listSessionsParams: ListSessionsParams | undefined = undefined;
    const _revokeSessionParams: RevokeSessionParams | undefined = undefined;
    const _revokeAllSessionsParams: RevokeAllSessionsParams | undefined = undefined;
    const _revokeAllExceptCurrentParams: RevokeAllExceptCurrentParams | undefined = undefined;

    // Revocation, MFA persistence, and validation-envelope shapes.
    const _revocableTokenPayload: RevocableTokenPayload | undefined = undefined;
    const _updateMfaData: UpdateMfaData | undefined = undefined;
    const _authFieldError: AuthFieldError | undefined = undefined;

    // Rate-limiter configuration surface.
    const _bymaxAuthRateLimitOptions: BymaxAuthRateLimitOptions | undefined = undefined;
    const _clientIpSource: ClientIpSource | undefined = undefined;
    const _authRateLimitWindow: AuthRateLimitWindow | undefined = undefined;

    // OpenAPI document-security surface (see library-utilities.spec.ts for
    // the runtime demonstration of authDocumentSecurity).
    const _authGuardFamily: AuthGuardFamily | undefined = undefined;
    const _openApiSecurityRequirement: OpenApiSecurityRequirement | undefined = undefined;
    const _authDocumentSecurityParams: AuthDocumentSecurityParams | undefined = undefined;

    // Shared types
    const _authUserClient: AuthUserClient | undefined = undefined;
    const _loginResult: LoginResult | undefined = undefined;
    const _sharedMfaChallengeResult: SharedMfaChallengeResult | undefined = undefined;
    const _sharedMfaTempPayload: SharedMfaTempPayload | undefined = undefined;
    const _sharedPlatformAuthResult: SharedPlatformAuthResult | undefined = undefined;
    const _platformJwtPayload: PlatformJwtPayload | undefined = undefined;
    const _platformLoginResult: PlatformLoginResult | undefined = undefined;
    const _tokenDeliveryMode: TokenDeliveryMode | undefined = undefined;
    const _authContextKind: AuthContextKind | undefined = undefined;
    const _authCookieNames: AuthCookieNames | undefined = undefined;
    const _authJwtPayload: AuthJwtPayload | undefined = undefined;
    const _authResponseCode: AuthResponseCode | undefined = undefined;
    const _sharedAuthResult: SharedAuthResult | undefined = undefined;

    // Suppress 'declared but never read' lint errors — these are type guards.
    void _sessionInfo;
    void _authResult;
    void _mfaChallengeResult;
    void _mfaSetupResult;
    void _mfaTempPayload;
    void _oauthMfaChallengeResult;
    void _platformAuthResult;
    void _rotatedTokenResult;
    void _createSessionParams;
    void _listSessionsParams;
    void _revokeSessionParams;
    void _revokeAllSessionsParams;
    void _revokeAllExceptCurrentParams;
    void _revocableTokenPayload;
    void _updateMfaData;
    void _authFieldError;
    void _bymaxAuthRateLimitOptions;
    void _clientIpSource;
    void _authRateLimitWindow;
    void _authGuardFamily;
    void _openApiSecurityRequirement;
    void _authDocumentSecurityParams;
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
