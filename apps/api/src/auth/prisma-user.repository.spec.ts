/**
 * @file prisma-user.repository.spec.ts
 * @description Unit tests for `PrismaUserRepository.createWithOAuth` blocked-status guards.
 *
 * Verifies both phases of the guard:
 *   1. Pre-upsert `findUnique` check — rejects blocked existing users before
 *      any DB write occurs, preventing `emailVerified` mutation as a side effect.
 *   2. Post-upsert check — catches the TOCTOU window where a user's status
 *      changes between the pre-check query and the upsert commit.
 *
 * These paths are security-critical (FCM #12, #23): a regression would let
 * blocked accounts either mutate their own data or receive OAuth tokens.
 *
 * @layer test
 * @see apps/api/src/auth/prisma-user.repository.ts
 */

import { AuthException } from '@bymax-one/nest-auth';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { User } from '@prisma/client';
import { Role, UserStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';
import { PrismaUserRepository } from './prisma-user.repository.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Builds a minimal valid Prisma `User` row with optional overrides. */
function makeUserRow(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    tenantId: 'acme',
    email: 'alice@example.test',
    name: 'Alice Test',
    passwordHash: null,
    role: Role.MEMBER,
    status: UserStatus.ACTIVE,
    emailVerified: true,
    mfaEnabled: false,
    mfaSecret: null,
    mfaRecoveryCodes: [],
    oauthProvider: 'google',
    oauthProviderId: 'google-sub-123',
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** Minimal `CreateWithOAuthData` payload for all test cases. */
const TEST_OAUTH_DATA = {
  email: 'alice@example.test',
  name: 'Alice Test',
  tenantId: 'acme',
  role: 'MEMBER',
  status: 'ACTIVE',
  oauthProvider: 'google',
  oauthProviderId: 'google-sub-123',
  emailVerified: true,
} as const;

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('PrismaUserRepository.createWithOAuth — blocked-status guards', () => {
  let repo: PrismaUserRepository;
  let userFindUnique: jest.Mock<() => Promise<{ status: UserStatus } | null>>;
  let userUpsert: jest.Mock<() => Promise<User>>;

  beforeEach(async () => {
    userFindUnique = jest.fn<() => Promise<{ status: UserStatus } | null>>();
    userUpsert = jest.fn<() => Promise<User>>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaUserRepository,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: userFindUnique,
              upsert: userUpsert,
            },
          },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ─── Pre-upsert guard ────────────────────────────────────────────────────

  it('throws AuthException before the upsert when the pre-check finds a blocked existing user', async () => {
    // FCM #23 — A BANNED user who triggers the OAuth flow must be rejected
    // immediately. The upsert must NOT run, so emailVerified is never mutated
    // on the blocked row as a side effect of a rejected authentication attempt.
    userFindUnique.mockResolvedValue({ status: UserStatus.BANNED });

    await expect(repo.createWithOAuth(TEST_OAUTH_DATA)).rejects.toThrow(AuthException);
    expect(userUpsert).not.toHaveBeenCalled();
  });

  it('throws AuthException before the upsert for every blocked status (INACTIVE, SUSPENDED)', async () => {
    // All three blocked statuses must be rejected — not just BANNED. A regression
    // that removes INACTIVE or SUSPENDED from BLOCKED_USER_STATUSES would allow
    // those users to skip email verification via the OAuth path.
    for (const blockedStatus of [UserStatus.INACTIVE, UserStatus.SUSPENDED]) {
      userFindUnique.mockResolvedValue({ status: blockedStatus });

      await expect(repo.createWithOAuth(TEST_OAUTH_DATA)).rejects.toThrow(AuthException);
      expect(userUpsert).not.toHaveBeenCalled();

      jest.resetAllMocks();
    }
  });

  // ─── Post-upsert guard (TOCTOU window) ───────────────────────────────────

  it('throws AuthException from the post-upsert check when the account is blocked in the TOCTOU window', async () => {
    // The narrow window between the pre-check query and the upsert commit allows
    // an admin to suspend an account. The post-upsert check catches this by reading
    // the row's status as committed — not as it was at pre-check time.
    userFindUnique.mockResolvedValue({ status: UserStatus.ACTIVE });
    userUpsert.mockResolvedValue(makeUserRow({ status: UserStatus.SUSPENDED }));

    await expect(repo.createWithOAuth(TEST_OAUTH_DATA)).rejects.toThrow(AuthException);
  });

  // ─── Happy path ──────────────────────────────────────────────────────────

  it('returns AuthUser when no existing user is found (new OAuth user — create path)', async () => {
    // A first-time OAuth sign-in with a brand-new email takes the upsert create
    // branch. The pre-check returns null (no row exists) and the post-check passes.
    userFindUnique.mockResolvedValue(null);
    userUpsert.mockResolvedValue(makeUserRow());

    const result = await repo.createWithOAuth(TEST_OAUTH_DATA);

    expect(result.email).toBe('alice@example.test');
    expect(result.tenantId).toBe('acme');
    expect(result.oauthProvider).toBe('google');
    expect(userUpsert).toHaveBeenCalledTimes(1);
  });

  it('returns AuthUser when an existing non-blocked user links OAuth (update path)', async () => {
    // An ACTIVE user linking OAuth for the first time takes the upsert update
    // branch. Neither guard fires, and the result is the updated AuthUser.
    userFindUnique.mockResolvedValue({ status: UserStatus.ACTIVE });
    userUpsert.mockResolvedValue(makeUserRow());

    const result = await repo.createWithOAuth(TEST_OAUTH_DATA);

    expect(result.oauthProvider).toBe('google');
    expect(result.oauthProviderId).toBe('google-sub-123');
    expect(userUpsert).toHaveBeenCalledTimes(1);
  });
});
