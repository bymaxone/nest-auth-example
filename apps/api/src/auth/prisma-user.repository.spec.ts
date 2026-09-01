/**
 * @file prisma-user.repository.spec.ts
 * @description Unit tests for `PrismaUserRepository`.
 *
 * Covers:
 * - `createWithOAuth` blocked-status guards (pre-upsert + TOCTOU window).
 * - `createWithOAuth` unknown-role rejection, unknown-status defaulting, and emailVerified defaults.
 * - `findById` tenant-scoped lookup (the tenant is part of the WHERE clause).
 * - `findByEmail` compound-index lookup.
 * - `create` with role mapping, unknown-role rejection, and status defaulting.
 * - `updatePassword`, `updateMfa`, `updateLastLogin`, `updateStatus`,
 *   `updateEmailVerified`, `updateEmail` — every write is a tenant-scoped `updateMany`.
 * - `findByOAuthId` — provider + providerId scoped to tenant.
 * - `linkOAuth` — OAuth fields update call (tenant-scoped `updateMany`).
 *
 * These paths are security-critical: regressions here would
 * break tenant isolation, allow blocked accounts to receive tokens, or corrupt
 * user credentials.
 *
 * @layer test
 * @see apps/api/src/auth/prisma-user.repository.ts
 */

import { AUTH_ERROR_CODES, AuthException } from '@bymax-one/nest-auth';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { User } from '@prisma/client';
import { Prisma, Role, UserStatus } from '@prisma/client';

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

describe('PrismaUserRepository.createWithOAuth', () => {
  let repo: PrismaUserRepository;
  let userCreate: jest.Mock<() => Promise<User>>;

  /** The unique-violation Prisma raises when `(tenantId, email)` is taken. */
  function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['tenantId', 'email'] },
    });
  }

  beforeEach(async () => {
    userCreate = jest.fn<() => Promise<User>>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaUserRepository,
        {
          provide: PrismaService,
          useValue: { user: { create: userCreate } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ─── Address already taken (the race) ────────────────────────────────────

  it('translates a unique violation into auth.oauth_email_mismatch', async () => {
    /*
     * Scenario: a registration for the same address commits between the
     * library's `findByEmail` and this insert. Updating the row that got there
     * first would attach the OAuth identity to an account this flow never
     * verified — silent email-based linking, which 1.4.x removed — so the
     * conflict is refused with the same code the library raises on the
     * non-racing path. The answer must not depend on who wins the race.
     * Protects: the P2002 translation, and the create-not-upsert shape.
     */
    userCreate.mockRejectedValue(uniqueViolation());

    const thrown = await repo.createWithOAuth(TEST_OAUTH_DATA).catch((err: unknown) => err);

    expect(thrown).toBeInstanceOf(AuthException);
    // The code travels in the library's error envelope, which is what the
    // exception filter renders and what the web error map keys off.
    expect((thrown as AuthException).getResponse()).toMatchObject({
      error: { code: AUTH_ERROR_CODES.OAUTH_EMAIL_MISMATCH },
    });
  });

  it('rethrows a database error that is not a unique violation', async () => {
    /*
     * Scenario: a connection drop, a constraint other than the email one, a
     * driver bug. Mapping everything to "that address is taken" would turn an
     * outage into a misleading answer and hide the real failure from the logs.
     * Protects: the `error.code === 'P2002'` narrowing.
     */
    const other = new Prisma.PrismaClientKnownRequestError('Connection lost', {
      code: 'P1001',
      clientVersion: 'test',
    });
    userCreate.mockRejectedValue(other);

    await expect(repo.createWithOAuth(TEST_OAUTH_DATA)).rejects.toBe(other);
  });

  it('rethrows a non-Prisma error unchanged', async () => {
    /*
     * Scenario: anything thrown that is not a `PrismaClientKnownRequestError`
     * at all. The instanceof half of the guard is what keeps such an error from
     * being read as a unique violation.
     * Protects: the `instanceof` narrowing.
     */
    const boom = new Error('boom');
    userCreate.mockRejectedValue(boom);

    await expect(repo.createWithOAuth(TEST_OAUTH_DATA)).rejects.toBe(boom);
  });

  // ─── Blocked status on the created row ───────────────────────────────────

  it('throws AuthException when the created row carries a blocked status', async () => {
    /*
     * Scenario: `data.status` comes from the caller, and the library's
     * OAuthService issues tokens without consulting status — so this check is
     * the only thing between a blocked status and a live session.
     * Protects: the post-create status guard.
     */
    userCreate.mockResolvedValue(makeUserRow({ status: UserStatus.SUSPENDED }));

    await expect(repo.createWithOAuth(TEST_OAUTH_DATA)).rejects.toThrow(AuthException);
  });

  it('rejects every blocked status, not only the first one', async () => {
    /*
     * Scenario: a regression that dropped INACTIVE or SUSPENDED from
     * BLOCKED_USER_STATUSES would let those accounts through the OAuth path
     * while BANNED kept working, which is the kind of gap a single-status test
     * never notices.
     * Protects: the full `BLOCKED_USER_STATUSES` membership check.
     */
    for (const blocked of [UserStatus.INACTIVE, UserStatus.SUSPENDED, UserStatus.BANNED]) {
      userCreate.mockResolvedValue(makeUserRow({ status: blocked }));

      await expect(repo.createWithOAuth(TEST_OAUTH_DATA)).rejects.toThrow(AuthException);
    }
  });

  // ─── Happy path ──────────────────────────────────────────────────────────

  it('returns the AuthUser for a brand-new OAuth account', async () => {
    /*
     * Scenario: the ordinary first Google sign-in on an address nobody holds.
     * Protects: the create call and the mapping of its row onto `AuthUser`.
     */
    userCreate.mockResolvedValue(makeUserRow());

    const result = await repo.createWithOAuth(TEST_OAUTH_DATA);

    expect(result.email).toBe('alice@example.test');
    expect(result.tenantId).toBe('acme');
    expect(result.oauthProvider).toBe('google');
    expect(result.oauthProviderId).toBe('google-sub-123');
    expect(userCreate).toHaveBeenCalledTimes(1);
  });

  // ─── Role, status and email normalisation ────────────────────────────────

  it('defaults role to MEMBER when role is omitted from the payload', async () => {
    /*
     * Scenario: the library omits `role` for a standard OAuth registration.
     * Protects: the `data.role === undefined ? Role.MEMBER` branch.
     */
    userCreate.mockResolvedValue(makeUserRow({ role: Role.MEMBER }));

    const { role: _removed, ...dataWithoutRole } = TEST_OAUTH_DATA;
    const result = await repo.createWithOAuth(dataWithoutRole);

    expect(result.role).toBe(Role.MEMBER);
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: Role.MEMBER }) }),
    );
  });

  it('throws when an unknown role is supplied — prevents a library/schema mismatch passing silently', async () => {
    /*
     * Scenario: FCM #32 — an unrecognised role string must surface as a runtime
     * error rather than being stored. Nothing may be written.
     * Protects: the unknown-role guard, and that it runs before the insert.
     */
    await expect(
      repo.createWithOAuth({
        ...TEST_OAUTH_DATA,
        role: 'SUPERUSER',
      }),
    ).rejects.toThrow(/Unknown Role/);
    expect(userCreate).not.toHaveBeenCalled();
  });

  it('forwards a recognised status string verbatim', async () => {
    /*
     * Scenario: the library hands over a known `UserStatus`. Collapsing every
     * OAuth signup to ACTIVE would mask a library-side status drift instead of
     * surfacing it.
     * Protects: the status resolution against the enum.
     */
    userCreate.mockResolvedValue(makeUserRow({ status: UserStatus.ACTIVE }));

    await repo.createWithOAuth({ ...TEST_OAUTH_DATA, status: 'ACTIVE' });

    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: UserStatus.ACTIVE }) }),
    );
  });

  it('preserves a non-default valid status (PENDING) verbatim', async () => {
    /*
     * Scenario: a tenant that requires admin approval before activation. PENDING
     * must survive the round trip — collapsing it to ACTIVE would skip the gate.
     * Using a value other than the enum's first member also distinguishes this
     * from a predicate that always matches.
     * Protects: the status resolution returning the supplied member.
     */
    userCreate.mockResolvedValue(makeUserRow({ status: UserStatus.PENDING }));

    await repo.createWithOAuth({ ...TEST_OAUTH_DATA, status: 'PENDING' });

    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: UserStatus.PENDING }) }),
    );
  });

  it('defaults status to ACTIVE when an unknown status string is supplied', async () => {
    /*
     * Scenario: a forward-compatible or unrecognised status. It must default to
     * ACTIVE — not PENDING as `create()` does — so the OAuth user can sign in
     * without an admin having to activate them.
     * Protects: the `?? UserStatus.ACTIVE` fallback.
     */
    userCreate.mockResolvedValue(makeUserRow({ status: UserStatus.ACTIVE }));

    const result = await repo.createWithOAuth({ ...TEST_OAUTH_DATA, status: 'FUTURE_STATUS' });

    expect(result.status).toBe(UserStatus.ACTIVE);
    expect(userCreate).toHaveBeenCalledTimes(1);
  });

  it('lowercases the email before writing it', async () => {
    /*
     * Scenario: a provider returns the address in a casing that does not match
     * the canonical stored form. Without normalisation the `(tenantId, email)`
     * unique index would admit a second row for the same person — and the
     * mismatch refusal above would stop firing for them.
     * Protects: the `toLowerCase()` normalisation.
     */
    userCreate.mockResolvedValue(makeUserRow());

    await repo.createWithOAuth({ ...TEST_OAUTH_DATA, email: 'Mixed@Example.TEST' });

    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'mixed@example.test' }) }),
    );
  });

  it('defaults emailVerified to false when the payload omits it', async () => {
    /*
     * Scenario: the library omits `emailVerified`. A new account must start
     * unverified — the address belongs to whoever controls the OAuth identity,
     * and marking it verified would make the consumer's "this email is proven"
     * invariant false from the first login.
     * Protects: the `?? false` default.
     */
    const { emailVerified: _omit, ...dataWithoutEmailVerified } = TEST_OAUTH_DATA;
    userCreate.mockResolvedValue(makeUserRow({ emailVerified: false }));

    await repo.createWithOAuth(dataWithoutEmailVerified);

    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ emailVerified: false }) }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findById
// ─────────────────────────────────────────────────────────────────────────────

describe('PrismaUserRepository.findById', () => {
  let repo: PrismaUserRepository;
  let userFindFirst: jest.Mock<() => Promise<User | null>>;

  beforeEach(async () => {
    userFindFirst = jest.fn<() => Promise<User | null>>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaUserRepository,
        {
          provide: PrismaService,
          useValue: { user: { findFirst: userFindFirst } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('returns AuthUser with both id and tenantId in the WHERE clause', async () => {
    // findById must pass both `id` and `tenantId` in the WHERE clause — the
    // tenant is part of the query (not a post-filter), so cross-tenant rows
    // are never fetched. This is the tenant-isolation requirement.
    userFindFirst.mockResolvedValue(makeUserRow());

    const result = await repo.findById({ id: 'user-1', tenantId: 'acme' });

    expect(result).not.toBeNull();
    expect(result?.id).toBe('user-1');
    expect(userFindFirst).toHaveBeenCalledWith({
      where: { id: 'user-1', tenantId: 'acme' },
    });
  });

  it('returns null when no user matches the given id', async () => {
    // A missing user must propagate as null so callers can distinguish
    // "not found" from other error states.
    userFindFirst.mockResolvedValue(null);

    const result = await repo.findById({ id: 'nonexistent-id', tenantId: 'acme' });

    expect(result).toBeNull();
  });

  it('maps optional fields correctly — omits mfaSecret when null', async () => {
    // exactOptionalPropertyTypes: true — the key must be absent from the object,
    // not present with value undefined. Verify the conditional assignment path.
    userFindFirst.mockResolvedValue(makeUserRow({ mfaSecret: null, mfaEnabled: false }));

    const result = await repo.findById({ id: 'user-1', tenantId: 'acme' });

    expect(result).not.toBeNull();
    expect('mfaSecret' in (result ?? {})).toBe(false);
  });

  it('includes mfaSecret and mfaRecoveryCodes when MFA is enabled', async () => {
    // When mfaEnabled=true, both mfaSecret and mfaRecoveryCodes must be present
    // on the returned AuthUser so the library can verify TOTP codes.
    const codes = ['code-a', 'code-b'];
    userFindFirst.mockResolvedValue(
      makeUserRow({ mfaEnabled: true, mfaSecret: 'encrypted-secret', mfaRecoveryCodes: codes }),
    );

    const result = await repo.findById({ id: 'user-1', tenantId: 'acme' });

    expect(result?.mfaSecret).toBe('encrypted-secret');
    expect(result?.mfaRecoveryCodes).toEqual(codes);
  });

  it('omits mfaRecoveryCodes when mfaEnabled is false', async () => {
    // Codes stored as default [] are semantically meaningless when MFA is off.
    // They must not be forwarded to the library to prevent confusion with
    // "all codes consumed" state.
    userFindFirst.mockResolvedValue(
      makeUserRow({ mfaEnabled: false, mfaRecoveryCodes: ['leftover'] }),
    );

    const result = await repo.findById({ id: 'user-1', tenantId: 'acme' });

    expect('mfaRecoveryCodes' in (result ?? {})).toBe(false);
  });

  it('includes oauthProvider and oauthProviderId when non-null', async () => {
    // OAuth-linked users carry provider identity — mapping must forward these.
    userFindFirst.mockResolvedValue(
      makeUserRow({ oauthProvider: 'google', oauthProviderId: 'sub-xyz' }),
    );

    const result = await repo.findById({ id: 'user-1', tenantId: 'acme' });

    expect(result?.oauthProvider).toBe('google');
    expect(result?.oauthProviderId).toBe('sub-xyz');
  });

  it('omits oauthProvider and oauthProviderId when null', async () => {
    // Local (email/password) users have no OAuth identity. The optional fields
    // must be absent — not undefined — per exactOptionalPropertyTypes.
    userFindFirst.mockResolvedValue(makeUserRow({ oauthProvider: null, oauthProviderId: null }));

    const result = await repo.findById({ id: 'user-1', tenantId: 'acme' });

    expect('oauthProvider' in (result ?? {})).toBe(false);
    expect('oauthProviderId' in (result ?? {})).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findByEmail
// ─────────────────────────────────────────────────────────────────────────────

describe('PrismaUserRepository.findByEmail', () => {
  let repo: PrismaUserRepository;
  let userFindUnique: jest.Mock<() => Promise<User | null>>;

  beforeEach(async () => {
    userFindUnique = jest.fn<() => Promise<User | null>>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaUserRepository,
        {
          provide: PrismaService,
          useValue: { user: { findUnique: userFindUnique } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('returns AuthUser when user exists — uses compound tenantId+email index', async () => {
    // Lookup must use the compound unique index `(tenantId, email)` for O(1)
    // performance and must pass the email lower-cased.
    userFindUnique.mockResolvedValue(makeUserRow());

    const result = await repo.findByEmail({ email: 'alice@example.test', tenantId: 'acme' });

    expect(result).not.toBeNull();
    expect(result?.email).toBe('alice@example.test');
    expect(userFindUnique).toHaveBeenCalledWith({
      where: { tenantId_email: { tenantId: 'acme', email: 'alice@example.test' } },
    });
  });

  it('returns null when no user with the given email exists in the tenant', async () => {
    // The library relies on null to determine "user not registered" during login.
    userFindUnique.mockResolvedValue(null);

    const result = await repo.findByEmail({ email: 'nobody@example.test', tenantId: 'acme' });

    expect(result).toBeNull();
  });

  it('normalises email to lower-case before querying', async () => {
    // Upper-case input must be lower-cased before hitting the DB so that
    // the unique index is always consulted case-insensitively.
    userFindUnique.mockResolvedValue(makeUserRow());

    await repo.findByEmail({ email: 'Alice@Example.TEST', tenantId: 'acme' });

    expect(userFindUnique).toHaveBeenCalledWith({
      where: { tenantId_email: { tenantId: 'acme', email: 'alice@example.test' } },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// create
// ─────────────────────────────────────────────────────────────────────────────

describe('PrismaUserRepository.create', () => {
  let repo: PrismaUserRepository;
  let userCreate: jest.Mock<() => Promise<User>>;

  beforeEach(async () => {
    userCreate = jest.fn<() => Promise<User>>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaUserRepository,
        {
          provide: PrismaService,
          useValue: { user: { create: userCreate } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('creates user and returns mapped AuthUser for a valid role and status', async () => {
    // Happy path — valid data must persist through prisma.user.create and
    // be returned as a fully mapped AuthUser.
    const row = makeUserRow({ role: Role.MEMBER, status: UserStatus.ACTIVE });
    userCreate.mockResolvedValue(row);

    const result = await repo.create({
      email: 'alice@example.test',
      name: 'Alice Test',
      passwordHash: 'hash',
      role: 'MEMBER',
      status: 'ACTIVE',
      tenantId: 'acme',
      emailVerified: false,
    });

    expect(result.email).toBe('alice@example.test');
    expect(result.role).toBe(Role.MEMBER);
    expect(userCreate).toHaveBeenCalledTimes(1);
  });

  it('defaults role to MEMBER when role is omitted from the create payload', async () => {
    // The library may omit `role` for a standard registration — the repository
    // must default to MEMBER without throwing. Covers the
    // `data.role === undefined ? Role.MEMBER` branch.
    const row = makeUserRow({ role: Role.MEMBER });
    userCreate.mockResolvedValue(row);

    const result = await repo.create({
      email: 'alice@example.test',
      name: 'Alice',
      passwordHash: 'hash',
      status: 'ACTIVE',
      tenantId: 'acme',
    });

    expect(result.role).toBe(Role.MEMBER);
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: Role.MEMBER }) }),
    );
  });

  it('throws when an unknown role is supplied — prevents library/schema mismatch silently passing', async () => {
    // An unknown role string must throw so that schema divergence surfaces as a
    // runtime error rather than silently storing a wrong value. 'SUPERUSER' is
    // not a value in the Role enum so this exercises the undefined-find path.
    await expect(
      repo.create({
        email: 'alice@example.test',
        name: 'Alice',
        passwordHash: 'hash',
        role: 'SUPERUSER',
        status: 'ACTIVE',
        tenantId: 'acme',
      }),
    ).rejects.toThrow(/Unknown Role/);
    expect(userCreate).not.toHaveBeenCalled();
  });

  it('defaults status to PENDING when an unknown status string is supplied', async () => {
    // An unrecognised status must not throw (library may send forward-compatible
    // statuses) — it defaults to PENDING, the safest lifecycle state.
    const row = makeUserRow({ status: UserStatus.PENDING });
    userCreate.mockResolvedValue(row);

    await repo.create({
      email: 'bob@example.test',
      name: 'Bob',
      passwordHash: 'hash',
      role: 'MEMBER',
      status: 'FUTURE_STATUS',
      tenantId: 'acme',
    });

    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: UserStatus.PENDING }) }),
    );
  });

  it('stores email as lower-case on create', async () => {
    // The repository guarantees lower-case storage regardless of what the
    // library passes in, keeping the unique index query consistent.
    const row = makeUserRow();
    userCreate.mockResolvedValue(row);

    await repo.create({
      email: 'ALICE@EXAMPLE.TEST',
      name: 'Alice',
      passwordHash: 'hash',
      role: 'MEMBER',
      status: 'ACTIVE',
      tenantId: 'acme',
    });

    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'alice@example.test' }) }),
    );
  });

  it('forwards a recognised status string verbatim to prisma.user.create', async () => {
    /*
     * Scenario: the library hands the repository a known UserStatus
     * value (e.g. `'ACTIVE'`). The repository must resolve it to
     * the corresponding enum member — the same value, not the
     * default `PENDING`. A regression that swapped the find lookup
     * for a constant would silently store every new account as
     * PENDING and require manual admin activation.
     */
    const row = makeUserRow({ status: UserStatus.ACTIVE });
    userCreate.mockResolvedValue(row);

    await repo.create({
      email: 'carol@example.test',
      name: 'Carol',
      passwordHash: 'hash',
      role: 'MEMBER',
      status: 'ACTIVE',
      tenantId: 'acme',
    });

    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: UserStatus.ACTIVE }),
      }),
    );
  });

  it('defaults emailVerified to false when the payload omits the flag', async () => {
    /*
     * Scenario: a standard registration through the credentials
     * flow leaves emailVerified unset — the user must verify by
     * clicking the link in the verification email before their
     * account becomes usable. A drift that flipped the default to
     * `true` would skip the verification gate entirely.
     */
    const row = makeUserRow({ emailVerified: false });
    userCreate.mockResolvedValue(row);

    await repo.create({
      email: 'dave@example.test',
      name: 'Dave',
      passwordHash: 'hash',
      role: 'MEMBER',
      status: 'ACTIVE',
      tenantId: 'acme',
      // emailVerified deliberately omitted to exercise the default.
    });

    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ emailVerified: false }),
      }),
    );
  });

  it('preserves emailVerified=true when the payload sets it explicitly', async () => {
    /*
     * Scenario: an invitation flow accepts the invitee with
     * pre-verified email (the invitation link itself proves
     * the email is reachable). The repository must forward
     * `emailVerified: true` verbatim — a regression that always
     * coerced to `false` would require the invitee to verify
     * their email again after accepting the invitation.
     */
    const row = makeUserRow({ emailVerified: true });
    userCreate.mockResolvedValue(row);

    await repo.create({
      email: 'invitee@example.test',
      name: 'Invitee',
      passwordHash: 'hash',
      role: 'MEMBER',
      status: 'ACTIVE',
      tenantId: 'acme',
      emailVerified: true,
    });

    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ emailVerified: true }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updatePassword
// ─────────────────────────────────────────────────────────────────────────────

describe('PrismaUserRepository.updatePassword', () => {
  let repo: PrismaUserRepository;
  let userUpdateMany: jest.Mock<() => Promise<{ count: number }>>;

  beforeEach(async () => {
    userUpdateMany = jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 1 });

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaUserRepository,
        {
          provide: PrismaService,
          useValue: { user: { updateMany: userUpdateMany } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('calls prisma.user.updateMany scoped by id AND tenantId with the passwordHash', async () => {
    // The library's PasswordService produces the hash before calling this method.
    // The repository must pass it through verbatim — never re-hash. The write is
    // an updateMany scoped by (id, tenantId) so it can never land on another
    // tenant's row — the library's port contract for every tenant-scoped write.
    await repo.updatePassword({ id: 'user-1', tenantId: 'acme', passwordHash: 'new-scrypt-hash' });

    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', tenantId: 'acme' },
      data: { passwordHash: 'new-scrypt-hash' },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateMfa
// ─────────────────────────────────────────────────────────────────────────────

describe('PrismaUserRepository.updateMfa', () => {
  let repo: PrismaUserRepository;
  let userUpdateMany: jest.Mock<() => Promise<{ count: number }>>;

  beforeEach(async () => {
    userUpdateMany = jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 1 });

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaUserRepository,
        {
          provide: PrismaService,
          useValue: { user: { updateMany: userUpdateMany } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('writes mfaEnabled, mfaSecret, and mfaRecoveryCodes scoped by id AND tenantId', async () => {
    // The repository stores MFA fields verbatim — the library already encrypted
    // the secret and hashed the recovery codes before calling this method.
    await repo.updateMfa({
      id: 'user-1',
      tenantId: 'acme',
      data: {
        mfaEnabled: true,
        mfaSecret: 'encrypted',
        mfaRecoveryCodes: ['hash-a', 'hash-b'],
      },
    });

    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', tenantId: 'acme' },
      data: {
        mfaEnabled: true,
        mfaSecret: 'encrypted',
        mfaRecoveryCodes: ['hash-a', 'hash-b'],
      },
    });
  });

  it('defaults mfaRecoveryCodes to [] when null is passed (MFA-disable flow)', async () => {
    // The MFA-disable path clears codes by passing null. The repository must
    // coerce null → [] so the Prisma scalar field is never null in the DB.
    await repo.updateMfa({
      id: 'user-1',
      tenantId: 'acme',
      data: {
        mfaEnabled: false,
        mfaSecret: null,
        mfaRecoveryCodes: null,
      },
    });

    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', tenantId: 'acme' },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
        mfaRecoveryCodes: [],
      },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateLastLogin
// ─────────────────────────────────────────────────────────────────────────────

describe('PrismaUserRepository.updateLastLogin', () => {
  let repo: PrismaUserRepository;
  let userUpdateMany: jest.Mock<() => Promise<{ count: number }>>;

  beforeEach(async () => {
    userUpdateMany = jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 1 });

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaUserRepository,
        {
          provide: PrismaService,
          useValue: { user: { updateMany: userUpdateMany } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('calls prisma.user.updateMany scoped by id AND tenantId with lastLoginAt set to the current time', async () => {
    // The timestamp must be a Date instance constructed at call time, not a
    // static constant, so the recorded login time is accurate per invocation.
    const before = Date.now();

    await repo.updateLastLogin({ id: 'user-1', tenantId: 'acme' });

    const after = Date.now();
    expect(userUpdateMany).toHaveBeenCalledTimes(1);
    // Cast through unknown to inspect the dynamic call argument safely.
    const callArg = (
      userUpdateMany.mock.calls[0] as unknown as [
        { where: { id: string; tenantId: string }; data: { lastLoginAt: Date } },
      ]
    )[0];
    expect(callArg.where).toEqual({ id: 'user-1', tenantId: 'acme' });
    const ts = callArg.data.lastLoginAt.getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateStatus
// ─────────────────────────────────────────────────────────────────────────────

describe('PrismaUserRepository.updateStatus', () => {
  let repo: PrismaUserRepository;
  let userUpdateMany: jest.Mock<() => Promise<{ count: number }>>;

  beforeEach(async () => {
    userUpdateMany = jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 1 });

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaUserRepository,
        {
          provide: PrismaService,
          useValue: { user: { updateMany: userUpdateMany } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('calls prisma.user.updateMany scoped by id AND tenantId with the resolved status enum value', async () => {
    // Passing 'ACTIVE' must translate to the UserStatus.ACTIVE enum and reach
    // the DB — the library owns the status lifecycle, the repo just persists it.
    await repo.updateStatus({ id: 'user-1', tenantId: 'acme', status: 'ACTIVE' });

    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', tenantId: 'acme' },
      data: { status: UserStatus.ACTIVE },
    });
  });

  it('throws when an unknown status string is supplied', async () => {
    // An unrecognised status string must surface as an error immediately so
    // that library/schema mismatch is caught early rather than silently stored.
    await expect(
      repo.updateStatus({ id: 'user-1', tenantId: 'acme', status: 'GODMODE' }),
    ).rejects.toThrow(/Unknown UserStatus/);
    expect(userUpdateMany).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateEmailVerified
// ─────────────────────────────────────────────────────────────────────────────

describe('PrismaUserRepository.updateEmailVerified', () => {
  let repo: PrismaUserRepository;
  let userUpdateMany: jest.Mock<() => Promise<{ count: number }>>;

  beforeEach(async () => {
    userUpdateMany = jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 1 });

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaUserRepository,
        {
          provide: PrismaService,
          useValue: { user: { updateMany: userUpdateMany } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('calls prisma.user.updateMany scoped by id AND tenantId with emailVerified: true', async () => {
    // Verification confirmation — must persist true to allow the user to log in.
    await repo.updateEmailVerified({ id: 'user-1', tenantId: 'acme', verified: true });

    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', tenantId: 'acme' },
      data: { emailVerified: true },
    });
  });

  it('calls prisma.user.updateMany with emailVerified: false (revoke verification)', async () => {
    // An admin may revoke email verification — false must be stored verbatim.
    await repo.updateEmailVerified({ id: 'user-1', tenantId: 'acme', verified: false });

    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', tenantId: 'acme' },
      data: { emailVerified: false },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateEmail
// ─────────────────────────────────────────────────────────────────────────────

describe('PrismaUserRepository.updateEmail', () => {
  let repo: PrismaUserRepository;
  let userUpdateMany: jest.Mock<() => Promise<{ count: number }>>;

  beforeEach(async () => {
    userUpdateMany = jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 1 });

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaUserRepository,
        {
          provide: PrismaService,
          useValue: { user: { updateMany: userUpdateMany } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('calls prisma.user.updateMany scoped by id AND tenantId with the new email', async () => {
    // The library's email-change flow calls this after the new address is
    // verified. The write must be tenant-scoped like every other write on
    // this port so the address can never move on another tenant's row.
    await repo.updateEmail({ id: 'user-1', tenantId: 'acme', email: 'new@example.test' });

    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', tenantId: 'acme' },
      data: { email: 'new@example.test' },
    });
  });

  it('lower-cases the new email before persisting it', async () => {
    // Lower-case storage keeps the compound unique index (tenantId, email)
    // consulted case-insensitively — mixed-case input must never create a
    // second logical identity for the same address.
    await repo.updateEmail({ id: 'user-1', tenantId: 'acme', email: 'New@Example.TEST' });

    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', tenantId: 'acme' },
      data: { email: 'new@example.test' },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findByOAuthId
// ─────────────────────────────────────────────────────────────────────────────

describe('PrismaUserRepository.findByOAuthId', () => {
  let repo: PrismaUserRepository;
  let userFindFirst: jest.Mock<() => Promise<User | null>>;

  beforeEach(async () => {
    userFindFirst = jest.fn<() => Promise<User | null>>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaUserRepository,
        {
          provide: PrismaService,
          useValue: { user: { findFirst: userFindFirst } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('returns the matching AuthUser for a known provider + providerId + tenantId', async () => {
    // OAuth login for an already-linked account must locate the user by their
    // external identity scoped to the tenant — cross-tenant collisions must be
    // impossible even if the provider reuses subject identifiers across tenants.
    userFindFirst.mockResolvedValue(makeUserRow());

    const result = await repo.findByOAuthId({
      provider: 'google',
      providerId: 'google-sub-123',
      tenantId: 'acme',
    });

    expect(result).not.toBeNull();
    expect(result?.oauthProvider).toBe('google');
    expect(userFindFirst).toHaveBeenCalledWith({
      where: { oauthProvider: 'google', oauthProviderId: 'google-sub-123', tenantId: 'acme' },
    });
  });

  it('returns null when no user matches the provider credentials', async () => {
    // An unknown provider identity should produce null so the OAuth service
    // falls through to the create path.
    userFindFirst.mockResolvedValue(null);

    const result = await repo.findByOAuthId({
      provider: 'google',
      providerId: 'unknown-sub',
      tenantId: 'acme',
    });

    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// linkOAuth
// ─────────────────────────────────────────────────────────────────────────────

describe('PrismaUserRepository.linkOAuth', () => {
  let repo: PrismaUserRepository;
  let userUpdateMany: jest.Mock<() => Promise<{ count: number }>>;

  beforeEach(async () => {
    userUpdateMany = jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 1 });

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaUserRepository,
        {
          provide: PrismaService,
          useValue: { user: { updateMany: userUpdateMany } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('calls prisma.user.updateMany scoped by id AND tenantId with provider and providerId', async () => {
    // Account-linking must write exactly the two OAuth fields; other user data
    // (name, role, status) must not be touched. The write is tenant-scoped like
    // every other write on this port.
    await repo.linkOAuth({
      id: 'user-1',
      tenantId: 'acme',
      provider: 'google',
      providerId: 'sub-abc',
    });

    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', tenantId: 'acme' },
      data: { oauthProvider: 'google', oauthProviderId: 'sub-abc' },
    });
  });
});
