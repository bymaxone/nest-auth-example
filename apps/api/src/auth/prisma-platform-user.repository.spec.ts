/**
 * @file prisma-platform-user.repository.spec.ts
 * @description Unit tests for `PrismaPlatformUserRepository`.
 *
 * Verifies all public methods and the `toAuthPlatformUser` private mapping:
 * - `findById`: found/not-found, optional field presence rules.
 * - `findByEmail`: found/not-found, lower-case normalisation.
 * - `updateLastLogin`, `updateMfa`, `updatePassword`, `updateStatus`.
 *
 * Security-critical invariants validated here:
 * - `mfaSecret` is absent (not undefined) when null in the DB.
 * - `mfaRecoveryCodes` is absent when `mfaEnabled=false`.
 * - `platformId` is absent when null in the DB.
 * - `updateStatus` throws on unrecognised status strings.
 *
 * @layer test
 * @see apps/api/src/auth/prisma-platform-user.repository.ts
 */

import type { AuthPlatformUser } from '@bymax-one/nest-auth';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PlatformRole, UserStatus, type PlatformUser } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';
import { PrismaPlatformUserRepository } from './prisma-platform-user.repository.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Builds a minimal valid Prisma `PlatformUser` row with optional overrides. */
function makePlatformUserRow(overrides: Partial<PlatformUser> = {}): PlatformUser {
  return {
    id: 'platform-user-1',
    email: 'admin@platform.test',
    name: 'Platform Admin',
    passwordHash: 'scrypt-hash',
    role: PlatformRole.SUPER_ADMIN,
    status: UserStatus.ACTIVE,
    mfaEnabled: false,
    mfaSecret: null,
    mfaRecoveryCodes: [],
    platformId: null,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// findById
// ─────────────────────────────────────────────────────────────────────────────

describe('PrismaPlatformUserRepository.findById', () => {
  let repo: PrismaPlatformUserRepository;
  let platformUserFindUnique: jest.Mock<() => Promise<PlatformUser | null>>;

  beforeEach(async () => {
    platformUserFindUnique = jest.fn<() => Promise<PlatformUser | null>>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaPlatformUserRepository,
        {
          provide: PrismaService,
          useValue: { platformUser: { findUnique: platformUserFindUnique } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaPlatformUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('returns a mapped AuthPlatformUser when the row exists', async () => {
    // Happy path — the row must be mapped to AuthPlatformUser with all required
    // fields populated correctly.
    platformUserFindUnique.mockResolvedValue(makePlatformUserRow());

    const result = await repo.findById('platform-user-1');

    expect(result).not.toBeNull();
    expect(result?.id).toBe('platform-user-1');
    expect(result?.email).toBe('admin@platform.test');
    expect(result?.passwordHash).toBe('scrypt-hash');
    expect(platformUserFindUnique).toHaveBeenCalledWith({ where: { id: 'platform-user-1' } });
  });

  it('returns null when no platform user matches the given id', async () => {
    // Not-found must propagate as null so callers can distinguish it from errors.
    platformUserFindUnique.mockResolvedValue(null);

    const result = await repo.findById('nonexistent');

    expect(result).toBeNull();
  });

  it('omits mfaSecret from the result when the DB row has mfaSecret=null', async () => {
    // exactOptionalPropertyTypes: true — the key must be absent, not undefined.
    // A present-but-undefined key would break library consumers that check `in`.
    platformUserFindUnique.mockResolvedValue(makePlatformUserRow({ mfaSecret: null }));

    const result = await repo.findById('platform-user-1');

    expect(result).not.toBeNull();
    expect('mfaSecret' in (result as AuthPlatformUser)).toBe(false);
  });

  it('includes mfaSecret in the result when the DB row has a non-null mfaSecret', async () => {
    // An encrypted TOTP secret must reach the library so it can verify OTP codes.
    platformUserFindUnique.mockResolvedValue(
      makePlatformUserRow({ mfaEnabled: true, mfaSecret: 'encrypted-totp-secret' }),
    );

    const result = await repo.findById('platform-user-1');

    expect(result?.mfaSecret).toBe('encrypted-totp-secret');
  });

  it('omits mfaRecoveryCodes from the result when mfaEnabled is false', async () => {
    // Codes stored as the Prisma default [] are meaningless when MFA is off.
    // Forwarding them would allow the library to incorrectly report "codes consumed".
    platformUserFindUnique.mockResolvedValue(
      makePlatformUserRow({ mfaEnabled: false, mfaRecoveryCodes: ['stale-code'] }),
    );

    const result = await repo.findById('platform-user-1');

    expect('mfaRecoveryCodes' in (result as AuthPlatformUser)).toBe(false);
  });

  it('includes mfaRecoveryCodes in the result when mfaEnabled is true', async () => {
    // Active MFA recovery codes must be available for the library to verify.
    const codes = ['hash-1', 'hash-2'];
    platformUserFindUnique.mockResolvedValue(
      makePlatformUserRow({ mfaEnabled: true, mfaRecoveryCodes: codes }),
    );

    const result = await repo.findById('platform-user-1');

    expect(result?.mfaRecoveryCodes).toEqual(codes);
  });

  it('includes empty mfaRecoveryCodes array when mfaEnabled is true and all codes consumed', async () => {
    // An empty array (all codes used) is a valid MFA state — it must be forwarded
    // so the library can inform the user that all recovery codes are exhausted.
    platformUserFindUnique.mockResolvedValue(
      makePlatformUserRow({ mfaEnabled: true, mfaRecoveryCodes: [] }),
    );

    const result = await repo.findById('platform-user-1');

    expect(result?.mfaRecoveryCodes).toEqual([]);
    expect('mfaRecoveryCodes' in (result as AuthPlatformUser)).toBe(true);
  });

  it('omits platformId from the result when the DB row has platformId=null', async () => {
    // Single-platform deployments have no platformId. The key must be absent —
    // not present with undefined — per exactOptionalPropertyTypes.
    platformUserFindUnique.mockResolvedValue(makePlatformUserRow({ platformId: null }));

    const result = await repo.findById('platform-user-1');

    expect('platformId' in (result as AuthPlatformUser)).toBe(false);
  });

  it('includes platformId in the result when the DB row has a non-null platformId', async () => {
    // Multi-platform deployments use platformId to scope administrative access.
    platformUserFindUnique.mockResolvedValue(makePlatformUserRow({ platformId: 'plat-xyz' }));

    const result = await repo.findById('platform-user-1');

    expect(result?.platformId).toBe('plat-xyz');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findByEmail
// ─────────────────────────────────────────────────────────────────────────────

describe('PrismaPlatformUserRepository.findByEmail', () => {
  let repo: PrismaPlatformUserRepository;
  let platformUserFindUnique: jest.Mock<() => Promise<PlatformUser | null>>;

  beforeEach(async () => {
    platformUserFindUnique = jest.fn<() => Promise<PlatformUser | null>>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaPlatformUserRepository,
        {
          provide: PrismaService,
          useValue: { platformUser: { findUnique: platformUserFindUnique } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaPlatformUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('returns the mapped AuthPlatformUser when the email exists', async () => {
    // Email lookup is the login entry point — the correct row must be returned.
    platformUserFindUnique.mockResolvedValue(makePlatformUserRow());

    const result = await repo.findByEmail('admin@platform.test');

    expect(result).not.toBeNull();
    expect(result?.email).toBe('admin@platform.test');
    expect(platformUserFindUnique).toHaveBeenCalledWith({
      where: { email: 'admin@platform.test' },
    });
  });

  it('returns null when no platform user with the given email exists', async () => {
    // A missing user must produce null so callers handle "not found" correctly.
    platformUserFindUnique.mockResolvedValue(null);

    const result = await repo.findByEmail('nobody@platform.test');

    expect(result).toBeNull();
  });

  it('normalises email to lower-case before querying', async () => {
    // Upper-case email input must be lower-cased before the DB lookup to ensure
    // the unique index is consulted case-insensitively, matching write behaviour.
    platformUserFindUnique.mockResolvedValue(makePlatformUserRow());

    await repo.findByEmail('ADMIN@PLATFORM.TEST');

    expect(platformUserFindUnique).toHaveBeenCalledWith({
      where: { email: 'admin@platform.test' },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateLastLogin
// ─────────────────────────────────────────────────────────────────────────────

describe('PrismaPlatformUserRepository.updateLastLogin', () => {
  let repo: PrismaPlatformUserRepository;
  let platformUserUpdate: jest.Mock<() => Promise<PlatformUser>>;

  beforeEach(async () => {
    platformUserUpdate = jest.fn<() => Promise<PlatformUser>>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaPlatformUserRepository,
        {
          provide: PrismaService,
          useValue: { platformUser: { update: platformUserUpdate } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaPlatformUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('calls prisma.platformUser.update with lastLoginAt set to the current time', async () => {
    // The timestamp must be generated at call time so successive logins record
    // accurate timestamps rather than a static value baked in at startup.
    const before = Date.now();
    platformUserUpdate.mockResolvedValue(makePlatformUserRow());

    await repo.updateLastLogin('platform-user-1');

    const after = Date.now();
    expect(platformUserUpdate).toHaveBeenCalledTimes(1);
    // Cast through unknown to inspect the dynamic call argument safely.
    const callArg = (
      platformUserUpdate.mock.calls[0] as unknown as [
        { where: { id: string }; data: { lastLoginAt: Date } },
      ]
    )[0];
    expect(callArg.where).toEqual({ id: 'platform-user-1' });
    const ts = callArg.data.lastLoginAt.getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateMfa
// ─────────────────────────────────────────────────────────────────────────────

describe('PrismaPlatformUserRepository.updateMfa', () => {
  let repo: PrismaPlatformUserRepository;
  let platformUserUpdate: jest.Mock<() => Promise<PlatformUser>>;

  beforeEach(async () => {
    platformUserUpdate = jest.fn<() => Promise<PlatformUser>>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaPlatformUserRepository,
        {
          provide: PrismaService,
          useValue: { platformUser: { update: platformUserUpdate } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaPlatformUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('writes all MFA fields verbatim when mfaRecoveryCodes is provided', async () => {
    // The library pre-hashes recovery codes before calling this method.
    // The repository must store them as-is without any transformation.
    platformUserUpdate.mockResolvedValue(makePlatformUserRow());

    await repo.updateMfa('platform-user-1', {
      mfaEnabled: true,
      mfaSecret: 'encrypted-secret',
      mfaRecoveryCodes: ['hash-a', 'hash-b'],
    });

    expect(platformUserUpdate).toHaveBeenCalledWith({
      where: { id: 'platform-user-1' },
      data: {
        mfaEnabled: true,
        mfaSecret: 'encrypted-secret',
        mfaRecoveryCodes: ['hash-a', 'hash-b'],
      },
    });
  });

  it('defaults mfaRecoveryCodes to [] when null is passed (MFA-disable flow)', async () => {
    // When MFA is being disabled, the library passes null for mfaRecoveryCodes.
    // The repository must coerce this to [] to keep the Prisma scalar non-null.
    platformUserUpdate.mockResolvedValue(makePlatformUserRow());

    await repo.updateMfa('platform-user-1', {
      mfaEnabled: false,
      mfaSecret: null,
      mfaRecoveryCodes: null,
    });

    expect(platformUserUpdate).toHaveBeenCalledWith({
      where: { id: 'platform-user-1' },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
        mfaRecoveryCodes: [],
      },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updatePassword
// ─────────────────────────────────────────────────────────────────────────────

describe('PrismaPlatformUserRepository.updatePassword', () => {
  let repo: PrismaPlatformUserRepository;
  let platformUserUpdate: jest.Mock<() => Promise<PlatformUser>>;

  beforeEach(async () => {
    platformUserUpdate = jest.fn<() => Promise<PlatformUser>>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaPlatformUserRepository,
        {
          provide: PrismaService,
          useValue: { platformUser: { update: platformUserUpdate } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaPlatformUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('calls prisma.platformUser.update with the correct id and passwordHash', async () => {
    // The library's PasswordService produces the hash before calling this.
    // The repository must forward it verbatim — never re-hash.
    platformUserUpdate.mockResolvedValue(makePlatformUserRow());

    await repo.updatePassword('platform-user-1', 'new-scrypt-hash');

    expect(platformUserUpdate).toHaveBeenCalledWith({
      where: { id: 'platform-user-1' },
      data: { passwordHash: 'new-scrypt-hash' },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateStatus
// ─────────────────────────────────────────────────────────────────────────────

describe('PrismaPlatformUserRepository.updateStatus', () => {
  let repo: PrismaPlatformUserRepository;
  let platformUserUpdate: jest.Mock<() => Promise<PlatformUser>>;

  beforeEach(async () => {
    platformUserUpdate = jest.fn<() => Promise<PlatformUser>>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaPlatformUserRepository,
        {
          provide: PrismaService,
          useValue: { platformUser: { update: platformUserUpdate } },
        },
      ],
    }).compile();

    repo = moduleRef.get(PrismaPlatformUserRepository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('calls prisma.platformUser.update with the resolved UserStatus enum', async () => {
    // Valid status strings must be translated to the typed enum before persisting,
    // preventing accidental storage of a raw string that bypasses Prisma validation.
    platformUserUpdate.mockResolvedValue(makePlatformUserRow());

    await repo.updateStatus('platform-user-1', 'SUSPENDED');

    expect(platformUserUpdate).toHaveBeenCalledWith({
      where: { id: 'platform-user-1' },
      data: { status: UserStatus.SUSPENDED },
    });
  });

  it('throws when an unknown status string is supplied', async () => {
    // Unrecognised status strings must cause an immediate error so that
    // library/schema divergence is caught early rather than silently corrupting data.
    await expect(repo.updateStatus('platform-user-1', 'SUPERADMIN')).rejects.toThrow(
      /Unknown UserStatus/,
    );
    expect(platformUserUpdate).not.toHaveBeenCalled();
  });
});
