/**
 * @file probe.ts
 * TEMPORARY — delete during Phase 3 (see docs/DEVELOPMENT_PLAN.md §Phase 3).
 *
 * Imports one symbol from each `@bymax-one/nest-auth` subpath to verify that
 * the pnpm link resolves correctly and all type definitions compile cleanly.
 * Has no runtime purpose — the exported object exists only to prevent
 * "unused import" diagnostics from the TypeScript compiler.
 */

import type { BymaxAuthModuleOptions } from '@bymax-one/nest-auth';
import { AUTH_ERROR_CODES } from '@bymax-one/nest-auth/shared';
import type { AuthClientConfig } from '@bymax-one/nest-auth/client';
import type { AuthProviderProps } from '@bymax-one/nest-auth/react';
import type { AuthProxyConfig } from '@bymax-one/nest-auth/nextjs';

/** Do not consume at runtime — exported only to satisfy unused-import diagnostics. */
export const _probe = {
  options: null as BymaxAuthModuleOptions | null,
  codes: AUTH_ERROR_CODES,
  client: null as AuthClientConfig | null,
  react: null as AuthProviderProps | null,
  next: null as AuthProxyConfig | null,
} as const;
