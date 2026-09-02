/**
 * @file password.ts
 * @description Password-hashing helper for e2e suites that seed users directly
 * through Prisma (bypassing the register endpoint).
 *
 * Produces the PHC-style scrypt string the library's `PasswordService` writes
 * since v1.1.0: `$scrypt$ln={log2N},r={r},p={p}${b64(salt)}${b64(derived)}`.
 * The pre-1.1.0 `scrypt:{salt_hex}:{derived_hex}` form is NO LONGER parsed by
 * the library — a spec seeding it would make every seeded login answer 401.
 *
 * Parameters mirror the library defaults (N=2^17, r=8, p=1, keylen 64,
 * salt 16) and `apps/api/prisma/seed.ts`, so seeded hashes round-trip
 * byte-for-byte through `PasswordService.compare`.
 *
 * @layer test
 * @see apps/api/prisma/seed.ts
 */

import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';

/** log2 of the scrypt CPU/memory cost — the library default since v1.1.0. */
const SCRYPT_LOG2_COST = 17;
/** scrypt CPU/memory cost factor (N). */
const SCRYPT_COST = 2 ** SCRYPT_LOG2_COST;
/** scrypt block size (r). */
const SCRYPT_BLOCK_SIZE = 8;
/** scrypt parallelization (p). */
const SCRYPT_PARALLELIZATION = 1;
/** Derived key length in bytes. */
const SCRYPT_KEY_LENGTH = 64;
/** Salt length in bytes. */
const SCRYPT_SALT_BYTES = 16;
/** Memory ceiling for the Node scrypt implementation. */
const SCRYPT_MAXMEM = Math.max(SCRYPT_COST * SCRYPT_BLOCK_SIZE * 128 * 2, 64 * 1024 * 1024);

/**
 * Promisified `crypto.scrypt` exposing the `ScryptOptions` overload —
 * `util.promisify` only types the 3-argument form (no N/r/p/maxmem).
 */
function scrypt(
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, derived) => {
      if (err != null) reject(err);
      else resolve(derived);
    });
  });
}

/**
 * Encodes a buffer as PHC-style base64: standard alphabet, `=` padding
 * stripped. Mirrors the library's `toPhcB64` encoder.
 */
function toPhcB64(value: Buffer): string {
  return value.toString('base64').replace(/=+$/, '');
}

/**
 * Hashes a plaintext password in the PHC scrypt format the library verifies.
 *
 * @param plain - The plaintext password to hash.
 * @returns The full PHC string suitable for a `passwordHash` column.
 */
export async function hashPasswordForTest(plain: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = await scrypt(plain, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: SCRYPT_MAXMEM,
  });
  return `$scrypt$ln=${SCRYPT_LOG2_COST},r=${SCRYPT_BLOCK_SIZE},p=${SCRYPT_PARALLELIZATION}$${toPhcB64(salt)}$${toPhcB64(derived)}`;
}
