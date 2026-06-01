/**
 * @file prisma-user.repository.spec.ts
 * @description Unit tests for `PrismaUserRepository`.
 *
 * Covers:
 * - `createWithOAuth` blocked-status guards (pre-upsert + TOCTOU window).
 * - `createWithOAuth` unknown-role rejection, unknown-status defaulting, and emailVerified defaults.
 * - `findById` tenant-scoped and unscoped lookups.
 * - `findByEmail` compound-index lookup.
 * - `create` with role mapping, unknown-role rejection, and status defaulting.
 * - `updatePassword`, `updateMfa`, `updateLastLogin`, `updateStatus`, `updateEmailVerified`.
 * - `findByOAuthId` — provider + providerId scoped to tenant.
 * - `linkOAuth` — OAuth fields update call.
 *
 * These paths are security-critical: regressions here would
 * break tenant isolation, allow blocked accounts to receive tokens, or corrupt
 * user credentials.
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

  // ─── Default role (createWithOAuth) ─────────────────────────────────────

  it('defaults role to MEMBER when role is omitted from the createWithOAuth payload', async () => {
    // The library may omit `role` for a standard OAuth registration — the
    // repository must default to MEMBER without throwing. Covers the
    // `data.role === undefined ? Role.MEMBER` branch.
    userFindUnique.mockResolvedValue(null);
    userUpsert.mockResolvedValue(makeUserRow({ role: Role.MEMBER }));

    const { role: _removed, ...dataWithoutRole } = TEST_OAUTH_DATA;
    const result = await repo.createWithOAuth(dataWithoutRole);

    expect(result.role).toBe(Role.MEMBER);
    expect(userUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ role: Role.MEMBER }) }),
    );
  });

  // ─── Unknown role guard (createWithOAuth) ────────────────────────────────

  it('throws when an unknown role is supplied to createWithOAuth — prevents library/schema mismatch silently passing', async () => {
    // FCM #32 — an unknown role string in the OAuth payload must throw immediately
    // so schema divergence surfaces as a runtime error rather than silently storing
    // a wrong value. The upsert must NOT run.
    await expect(
      repo.createWithOAuth({
        ...TEST_OAUTH_DATA,
        role: 'SUPERUSER',
      }),
    ).rejects.toThrow(/Unknown Role/);
    expect(userUpsert).not.toHaveBeenCalled();
  });

  // ─── Unknown status default (createWithOAuth) ────────────────────────────

  it('forwards a recognised status string verbatim to createWithOAuth upsert', async () => {
    /*
     * Scenario: the library hands the repository a known
     * UserStatus value (e.g. `'ACTIVE'`). The repository must
     * resolve it to the corresponding enum member, not
     * silently coerce every OAuth signup to ACTIVE. A
     * regression that always returned ACTIVE would mask a
     * library-side status drift instead of catching it.
     */
    userFindUnique.mockResolvedValue(null);
    userUpsert.mockResolvedValue(makeUserRow({ status: UserStatus.ACTIVE }));

    await repo.createWithOAuth({
      ...TEST_OAUTH_DATA,
      status: 'ACTIVE',
    });

    expect(userUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: UserStatus.ACTIVE }),
      }),
    );
  });

  it('preserves a non-default valid status (PENDING) verbatim through createWithOAuth', async () => {
    /*
     * Scenario: a custom registration flow hands createWithOAuth
     * a PENDING status (e.g. for a tenant that requires admin
     * approval before activation). The repository MUST forward
     * PENDING — collapsing it to ACTIVE would skip the approval
     * gate. Using a status OTHER than the enum's first value
     * also distinguishes this from any predicate that always
     * matches (which would return the enum's first member
     * regardless of input).
     */
    userFindUnique.mockResolvedValue(null);
    userUpsert.mockResolvedValue(makeUserRow({ status: UserStatus.PENDING }));

    await repo.createWithOAuth({
      ...TEST_OAUTH_DATA,
      status: 'PENDING',
    });

    expect(userUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: UserStatus.PENDING }),
      }),
    );
  });

  it('lowercases the email before passing it to the createWithOAuth upsert', async () => {
    /*
     * Scenario: an OAuth provider returns the user's email in
     * a case that does not match the canonical lower-case form
     * stored in the database. The repository MUST normalise to
     * lower case so the (tenantId, email) unique index keeps a
     * single row per email — without normalisation a typo in
     * casing would create duplicate accounts.
     */
    userFindUnique.mockResolvedValue(null);
    userUpsert.mockResolvedValue(makeUserRow());

    await repo.createWithOAuth({
      ...TEST_OAUTH_DATA,
      email: 'Mixed@Example.TEST',
    });

    expect(userUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ email: 'mixed@example.test' }),
      }),
    );
  });

  it('defaults status to ACTIVE when an unknown status string is supplied to createWithOAuth', async () => {
    // A forward-compatible or unrecognised status from the library must default to
    // ACTIVE (not PENDING as in create()) so the OAuth user can immediately sign in
    // without requiring manual activation by an admin.
    userFindUnique.mockResolvedValue(null);
    userUpsert.mockResolvedValue(makeUserRow({ status: UserStatus.ACTIVE }));

    const result = await repo.createWithOAuth({
      ...TEST_OAUTH_DATA,
      status: 'FUTURE_STATUS',
    });

    expect(result.status).toBe(UserStatus.ACTIVE);
    expect(userUpsert).toHaveBeenCalledTimes(1);
  });

  // ─── emailVerified default branches (createWithOAuth) ────────────────────

  it('defaults emailVerified to true on the update branch and false on the create branch when emailVerified is omitted', async () => {
    // The upsert payload uses `emailVerified ?? true` on the update path and
    // `emailVerified ?? false` on the create path. When the library omits
    // emailVerified, these defaults must apply so the upsert is called with the
    // correct defaults rather than storing undefined.
    const { emailVerified: _omit, ...dataWithoutEmailVerified } = TEST_OAUTH_DATA;
    userFindUnique.mockResolvedValue(null);
    userUpsert.mockResolvedValue(makeUserRow({ emailVerified: false }));

    await repo.createWithOAuth(dataWithoutEmailVerified);

    // Verify the upsert was called — the specific emailVerified value is asserted
    // by inspecting the call argument.
    expect(userUpsert).toHaveBeenCalledTimes(1);
    const upsertArg = userUpsert.mock.calls[0] as unknown as [
      {
        create: { emailVerified: boolean };
        update: { emailVerified: boolean };
      },
    ];
    // update path defaults to true (link existing account → mark verified)
    expect(upsertArg[0].update.emailVerified).toBe(true);
    // create path defaults to false (new account → pending email verification)
    expect(upsertArg[0].create.emailVerified).toBe(false);
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

  it('returns AuthUser scoped to tenantId when tenantId is provided', async () => {
    // findById must pass both `id` and `tenantId` in the WHERE clause when
    // tenantId is supplied — this is the tenant-isolation requirement.
    userFindFirst.mockResolvedValue(makeUserRow());

    const result = await repo.findById('user-1', 'acme');

    expect(result).not.toBeNull();
    expect(result?.id).toBe('user-1');
    expect(userFindFirst).toHaveBeenCalledWith({
      where: { id: 'user-1', tenantId: 'acme' },
    });
  });

  it('returns AuthUser without tenantId scoping when tenantId is omitted', async () => {
    // Platform-level or library-internal lookups may omit tenantId.
    // The WHERE clause must only contain `id` to avoid excluding the row.
    userFindFirst.mockResolvedValue(makeUserRow());

    const result = await repo.findById('user-1');

    expect(result).not.toBeNull();
    expect(userFindFirst).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });

  it('returns null when no user matches the given id', async () => {
    // A missing user must propagate as null so callers can distinguish
    // "not found" from other error states.
    userFindFirst.mockResolvedValue(null);

    const result = await repo.findById('nonexistent-id', 'acme');

    expect(result).toBeNull();
  });

  it('maps optional fields correctly — omits mfaSecret when null', async () => {
    // exactOptionalPropertyTypes: true — the key must be absent from the object,
    // not present with value undefined. Verify the conditional assignment path.
    userFindFirst.mockResolvedValue(makeUserRow({ mfaSecret: null, mfaEnabled: false }));

    const result = await repo.findById('user-1');

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

    const result = await repo.findById('user-1');

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

    const result = await repo.findById('user-1');

    expect('mfaRecoveryCodes' in (result ?? {})).toBe(false);
  });

  it('includes oauthProvider and oauthProviderId when non-null', async () => {
    // OAuth-linked users carry provider identity — mapping must forward these.
    userFindFirst.mockResolvedValue(
      makeUserRow({ oauthProvider: 'google', oauthProviderId: 'sub-xyz' }),
    );

    const result = await repo.findById('user-1');

    expect(result?.oauthProvider).toBe('google');
    expect(result?.oauthProviderId).toBe('sub-xyz');
  });

  it('omits oauthProvider and oauthProviderId when null', async () => {
    // Local (email/password) users have no OAuth identity. The optional fields
    // must be absent — not undefined — per exactOptionalPropertyTypes.
    userFindFirst.mockResolvedValue(makeUserRow({ oauthProvider: null, oauthProviderId: null }));

    const result = await repo.findById('user-1');

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

    const result = await repo.findByEmail('alice@example.test', 'acme');

    expect(result).not.toBeNull();
    expect(result?.email).toBe('alice@example.test');
    expect(userFindUnique).toHaveBeenCalledWith({
      where: { tenantId_email: { tenantId: 'acme', email: 'alice@example.test' } },
    });
  });

  it('returns null when no user with the given email exists in the tenant', async () => {
    // The library relies on null to determine "user not registered" during login.
    userFindUnique.mockResolvedValue(null);

    const result = await repo.findByEmail('nobody@example.test', 'acme');

    expect(result).toBeNull();
  });

  it('normalises email to lower-case before querying', async () => {
    // Upper-case input must be lower-cased before hitting the DB so that
    // the unique index is always consulted case-insensitively.
    userFindUnique.mockResolvedValue(makeUserRow());

    await repo.findByEmail('Alice@Example.TEST', 'acme');

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
  let userUpdate: jest.Mock<() => Promise<User>>;

  beforeEach(async () => {
    userUpdate = jest.fn<() => Promise<User>>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaUserRepository,
        {
          provide: PrismaService,
          useValue: { user: { update: userUpdate } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('calls prisma.user.update with the correct id and passwordHash', async () => {
    // The library's PasswordService produces the hash before calling this method.
    // The repository must pass it through verbatim — never re-hash.
    userUpdate.mockResolvedValue(makeUserRow());

    await repo.updatePassword('user-1', 'new-scrypt-hash');

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: 'new-scrypt-hash' },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateMfa
// ─────────────────────────────────────────────────────────────────────────────

describe('PrismaUserRepository.updateMfa', () => {
  let repo: PrismaUserRepository;
  let userUpdate: jest.Mock<() => Promise<User>>;

  beforeEach(async () => {
    userUpdate = jest.fn<() => Promise<User>>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaUserRepository,
        {
          provide: PrismaService,
          useValue: { user: { update: userUpdate } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('writes mfaEnabled, mfaSecret, and mfaRecoveryCodes when all fields are provided', async () => {
    // The repository stores MFA fields verbatim — the library already encrypted
    // the secret and hashed the recovery codes before calling this method.
    userUpdate.mockResolvedValue(makeUserRow());

    await repo.updateMfa('user-1', {
      mfaEnabled: true,
      mfaSecret: 'encrypted',
      mfaRecoveryCodes: ['hash-a', 'hash-b'],
    });

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
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
    userUpdate.mockResolvedValue(makeUserRow());

    await repo.updateMfa('user-1', {
      mfaEnabled: false,
      mfaSecret: null,
      mfaRecoveryCodes: null,
    });

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
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
  let userUpdate: jest.Mock<() => Promise<User>>;

  beforeEach(async () => {
    userUpdate = jest.fn<() => Promise<User>>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaUserRepository,
        {
          provide: PrismaService,
          useValue: { user: { update: userUpdate } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('calls prisma.user.update with lastLoginAt set to the current time', async () => {
    // The timestamp must be a Date instance constructed at call time, not a
    // static constant, so the recorded login time is accurate per invocation.
    const before = Date.now();
    userUpdate.mockResolvedValue(makeUserRow());

    await repo.updateLastLogin('user-1');

    const after = Date.now();
    expect(userUpdate).toHaveBeenCalledTimes(1);
    // Cast through unknown to inspect the dynamic call argument safely.
    const callArg = (
      userUpdate.mock.calls[0] as unknown as [
        { where: { id: string }; data: { lastLoginAt: Date } },
      ]
    )[0];
    expect(callArg.where).toEqual({ id: 'user-1' });
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
  let userUpdate: jest.Mock<() => Promise<User>>;

  beforeEach(async () => {
    userUpdate = jest.fn<() => Promise<User>>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaUserRepository,
        {
          provide: PrismaService,
          useValue: { user: { update: userUpdate } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('calls prisma.user.update with the resolved status enum value', async () => {
    // Passing 'ACTIVE' must translate to the UserStatus.ACTIVE enum and reach
    // the DB — the library owns the status lifecycle, the repo just persists it.
    userUpdate.mockResolvedValue(makeUserRow());

    await repo.updateStatus('user-1', 'ACTIVE');

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { status: UserStatus.ACTIVE },
    });
  });

  it('throws when an unknown status string is supplied', async () => {
    // An unrecognised status string must surface as an error immediately so
    // that library/schema mismatch is caught early rather than silently stored.
    await expect(repo.updateStatus('user-1', 'GODMODE')).rejects.toThrow(/Unknown UserStatus/);
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateEmailVerified
// ─────────────────────────────────────────────────────────────────────────────

describe('PrismaUserRepository.updateEmailVerified', () => {
  let repo: PrismaUserRepository;
  let userUpdate: jest.Mock<() => Promise<User>>;

  beforeEach(async () => {
    userUpdate = jest.fn<() => Promise<User>>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaUserRepository,
        {
          provide: PrismaService,
          useValue: { user: { update: userUpdate } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('calls prisma.user.update with emailVerified: true', async () => {
    // Verification confirmation — must persist true to allow the user to log in.
    userUpdate.mockResolvedValue(makeUserRow());

    await repo.updateEmailVerified('user-1', true);

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { emailVerified: true },
    });
  });

  it('calls prisma.user.update with emailVerified: false (revoke verification)', async () => {
    // An admin may revoke email verification — false must be stored verbatim.
    userUpdate.mockResolvedValue(makeUserRow());

    await repo.updateEmailVerified('user-1', false);

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { emailVerified: false },
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

    const result = await repo.findByOAuthId('google', 'google-sub-123', 'acme');

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

    const result = await repo.findByOAuthId('google', 'unknown-sub', 'acme');

    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// linkOAuth
// ─────────────────────────────────────────────────────────────────────────────

describe('PrismaUserRepository.linkOAuth', () => {
  let repo: PrismaUserRepository;
  let userUpdate: jest.Mock<() => Promise<User>>;

  beforeEach(async () => {
    userUpdate = jest.fn<() => Promise<User>>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaUserRepository,
        {
          provide: PrismaService,
          useValue: { user: { update: userUpdate } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('calls prisma.user.update with provider and providerId for the target user', async () => {
    // Account-linking must write exactly the two OAuth fields; other user data
    // (name, role, status) must not be touched.
    userUpdate.mockResolvedValue(makeUserRow());

    await repo.linkOAuth('user-1', 'google', 'sub-abc');

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { oauthProvider: 'google', oauthProviderId: 'sub-abc' },
    });
  });
});
