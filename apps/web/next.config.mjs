/**
 * @fileoverview Next.js 16 configuration for apps/web.
 *
 * Key concerns:
 * - `/api/:path*` rewrite proxies browser requests to the NestJS API at
 *   INTERNAL_API_URL, keeping the browser on a single registrable domain — a
 *   prerequisite for HttpOnly cookie flows and `createAuthProxy`.
 * - `/ws/:path*` rewrite proxies WebSocket upgrade requests to the same NestJS
 *   server. Browser WebSocket connections to the same origin automatically carry
 *   HttpOnly cookies (SameSite=Strict), enabling cookie-based WS auth in the
 *   `NotificationsGateway` without exposing tokens to JavaScript.
 * - INTERNAL_API_URL is read directly from process.env here (not from lib/env.ts)
 *   because next.config runs before module-level env parsing in some contexts
 *   (e.g. `next build` cold-start). Next.js' built-in .env loading is sufficient.
 * - Turbopack (the Next.js 16 default bundler) resolves the `@bymax-one/nest-auth`
 *   subpath exports (`/client`, `/shared`, `/react`, `/nextjs`) correctly now
 *   that the library is consumed from npm rather than a `link:../nest-auth`
 *   workspace. Earlier revisions of this file mandated `--webpack` to work
 *   around a Turbopack symlink-resolution issue — that is no longer needed.
 * - `output: 'standalone'` produces a self-contained server.js for production
 *   Docker images (Phase 19).  `outputFileTracingRoot` is set to the monorepo
 *   root so that Next.js traces dependencies relative to the workspace root,
 *   keeping the standalone output's node_modules path structure consistent with
 *   how pnpm resolves packages — avoids broken symlink references at runtime.
 *
 * @module next.config
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 'standalone' is only activated when building the Docker image (the
  // Dockerfile sets NEXT_STANDALONE=true).  In local dev and CI Playwright
  // runs, `next start` is used instead — it requires standard output and is
  // incompatible with standalone mode (standalone must be served via server.js).
  ...(process.env['NEXT_STANDALONE'] === 'true'
    ? {
        output: 'standalone',
        // Trace deps relative to monorepo root so pnpm's virtual-store paths
        // resolve correctly inside the standalone tree (stable option since Next 13).
        outputFileTracingRoot: path.resolve(__dirname, '../..'),
      }
    : {}),

  async rewrites() {
    const internalApiUrl = process.env['INTERNAL_API_URL'] ?? 'http://localhost:4000';
    return [
      {
        source: '/api/:path*',
        destination: `${internalApiUrl}/api/:path*`,
      },
      {
        source: '/ws/:path*',
        destination: `${internalApiUrl}/ws/:path*`,
      },
    ];
  },
};

export default nextConfig;
