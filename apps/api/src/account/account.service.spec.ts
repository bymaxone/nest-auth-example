/**
 * @file account.service.spec.ts
 * @description Unit tests for `AccountService`.
 *
 * Verifies:
 * - `changePassword`: user-not-found (null) → BadRequestException.
 * - `changePassword`: user with null passwordHash (OAuth-only) → BadRequestException.
 * - `changePassword`: wrong current password → UnauthorizedException.
 * - `changePassword`: correct current password → updates hash and resolves to void.
 *
 * The scrypt helper functions (`verifyScrypt`, `hashScrypt`) are module-scope
 * closures not exported by the service. They are exercised through the public
 * `changePassword` method. The success path uses real scrypt operations via
 * `node:crypto` to verify end-to-end correctness without mocking the crypto layer.
 *
 * The wrong-password path creates a valid hash for a different password, ensuring
 * `timingSafeEqual` fires the mismatch path without any mocking.
 *
 * @layer test
 * @see apps/api/src/account/account.service.ts
 */

import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { randomBytes, scrypt as nodeScrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service.js';
import { AccountService } from './account.service.js';
import type { ChangePasswordDto } from './dto/change-password.dto.js';

// ─── Scrypt helpers (mirrors service constants) ───────────────────────────────

/** Must match the service constants to produce compatible hashes. */
const SCRYPT_PARAMS = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const SCRYPT_KEY_LEN = 64;
const SALT_BYTES = 16;

const scryptAsync = promisify(nodeScrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Produces a `scrypt:{salt_hex}:{derived_hex}` hash matching the service format.
 *
 * @param plain - Plaintext password to hash.
 */
async function makeHash(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(plain, salt, SCRYPT_KEY_LEN, SCRYPT_PARAMS);
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('AccountService', () => {
  let service: AccountService;
  let userFindUnique: jest.Mock<() => Promise<{ id: string; passwordHash: string | null } | null>>;
  let userUpdate: jest.Mock<() => Promise<unknown>>;

  beforeEach(async () => {
    userFindUnique = jest.fn<() => Promise<{ id: string; passwordHash: string | null } | null>>();
    userUpdate = jest.fn<() => Promise<unknown>>();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        {
          provide: PrismaService,
          useValue: {
            user: { findUnique: userFindUnique, update: userUpdate },
          },
        },
      ],
    }).compile();

    service = moduleRef.get(AccountService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ─── changePassword ────────────────────────────────────────────────────────

  describe('changePassword', () => {
    it('throws BadRequestException when the user record is not found', async () => {
      // A null row means the userId+tenantId combination does not exist —
      // either an expired session or a cross-tenant attempt. Must fail with 400
      // before any crypto work is done.
      userFindUnique.mockResolvedValue(null);
      const dto: ChangePasswordDto = {
        currentPassword: 'OldPassword1!',
        newPassword: 'NewPassword1!',
      };

      await expect(service.changePassword('missing-user', 'acme', dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the user has no passwordHash (OAuth-only account)', async () => {
      // OAuth-only users never set a password — attempting to change it must fail
      // with 400 rather than UnauthorizedException so the client knows the reason.
      userFindUnique.mockResolvedValue({ id: 'user-1', passwordHash: null });
      const dto: ChangePasswordDto = {
        currentPassword: 'AnyPassword1!',
        newPassword: 'NewPassword1!',
      };

      await expect(service.changePassword('user-1', 'acme', dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when currentPassword does not match the stored hash', async () => {
      // The wrong current password must be rejected with 401. A real scrypt hash
      // is produced for a different password to exercise the timingSafeEqual mismatch path
      // without mocking the crypto layer.
      const storedHash = await makeHash('CorrectPassword1!');
      userFindUnique.mockResolvedValue({ id: 'user-1', passwordHash: storedHash });
      const dto: ChangePasswordDto = {
        currentPassword: 'WrongPassword1!',
        newPassword: 'NewPassword1!',
      };

      await expect(service.changePassword('user-1', 'acme', dto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(userUpdate).not.toHaveBeenCalled();
    }, 15_000 /* scrypt is intentionally slow — allow 15 s */);

    it('returns undefined and calls prisma.user.update when currentPassword is correct', async () => {
      // The happy path — current password matches, new hash is stored. The service
      // must call update exactly once with the new hash and resolve to void.
      const storedHash = await makeHash('CorrectPassword1!');
      userFindUnique.mockResolvedValue({ id: 'user-1', passwordHash: storedHash });
      userUpdate.mockResolvedValue({});
      const dto: ChangePasswordDto = {
        currentPassword: 'CorrectPassword1!',
        newPassword: 'NewPassword2!',
      };

      const result = await service.changePassword('user-1', 'acme', dto);

      expect(result).toBeUndefined();
      expect(userUpdate).toHaveBeenCalledTimes(1);
      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'user-1', tenantId: 'acme' },
        data: { passwordHash: expect.stringMatching(/^scrypt:[0-9a-f]+:[0-9a-f]+$/) },
      });
    }, 30_000 /* two scrypt ops — allow 30 s */);

    it('writes a new hash in scrypt:{salt}:{derived} format on success', async () => {
      // The new hash must be stored in the same format the library's PasswordService
      // uses so the library can verify it on subsequent logins.
      const storedHash = await makeHash('CorrectPassword1!');
      userFindUnique.mockResolvedValue({ id: 'user-1', passwordHash: storedHash });
      userUpdate.mockResolvedValue({});
      const dto: ChangePasswordDto = {
        currentPassword: 'CorrectPassword1!',
        newPassword: 'NewPassword2!',
      };

      await service.changePassword('user-1', 'acme', dto);

      const callData = (
        userUpdate.mock.calls[0] as unknown as [{ where: unknown; data: { passwordHash: string } }]
      )[0];
      const parts = callData.data.passwordHash.split(':');
      expect(parts[0]).toBe('scrypt');
      expect(parts[1]).toMatch(/^[0-9a-f]{32}$/); // 16-byte salt → 32 hex chars
      expect(parts[2]).toMatch(/^[0-9a-f]{128}$/); // 64-byte derived → 128 hex chars
    }, 30_000 /* two scrypt ops — allow 30 s */);

    it('scopes both findUnique and update queries by tenantId', async () => {
      // Both the lookup and update must include tenantId in their WHERE clause
      // to enforce tenant isolation at the DB level.
      const storedHash = await makeHash('CorrectPassword1!');
      userFindUnique.mockResolvedValue({ id: 'user-1', passwordHash: storedHash });
      userUpdate.mockResolvedValue({});
      const dto: ChangePasswordDto = {
        currentPassword: 'CorrectPassword1!',
        newPassword: 'NewPassword2!',
      };

      await service.changePassword('user-1', 'tenant-xyz', dto);

      expect(userFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1', tenantId: 'tenant-xyz' } }),
      );
      expect(userUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1', tenantId: 'tenant-xyz' } }),
      );
    }, 30_000);

    it('throws UnauthorizedException when the stored hash has the wrong format (missing scrypt prefix)', async () => {
      // verifyScrypt returns false immediately when the hash is not in
      // `scrypt:{salt}:{derived}` format — the guard at line 55 is triggered.
      userFindUnique.mockResolvedValue({ id: 'user-1', passwordHash: 'invalid-hash-no-colons' });
      const dto: ChangePasswordDto = {
        currentPassword: 'AnyPassword1!',
        newPassword: 'NewPassword2!',
      };

      await expect(service.changePassword('user-1', 'acme', dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when the stored hash has an empty salt segment', async () => {
      // verifyScrypt returns false when parts[1] (salt) is an empty string —
      // the `!saltHex` guard at line 59 is triggered.
      userFindUnique.mockResolvedValue({ id: 'user-1', passwordHash: 'scrypt::somedrived' });
      const dto: ChangePasswordDto = {
        currentPassword: 'AnyPassword1!',
        newPassword: 'NewPassword2!',
      };

      await expect(service.changePassword('user-1', 'acme', dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when the stored hash has a derived value shorter than SCRYPT_KEY_LEN', async () => {
      // verifyScrypt returns false when the decoded derived buffer is shorter than
      // 64 bytes — the `stored.length !== SCRYPT_KEY_LEN` guard at line 63 is triggered.
      userFindUnique.mockResolvedValue({
        id: 'user-1',
        passwordHash: 'scrypt:deadbeef:0102', // 1-byte salt, 1-byte derived (too short)
      });
      const dto: ChangePasswordDto = {
        currentPassword: 'AnyPassword1!',
        newPassword: 'NewPassword2!',
      };

      await expect(service.changePassword('user-1', 'acme', dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
