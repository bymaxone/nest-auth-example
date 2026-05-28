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

  async headers() {
    const isProduction = process.env['NODE_ENV'] === 'production';
    return [
      {
        source: '/(.*)',
        headers: [
          // Prevent MIME-type sniffing — required by browsers to honour declared Content-Type.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Deny embedding in <iframe>, <embed>, or <object> to block clickjacking.
          { key: 'X-Frame-Options', value: 'DENY' },
          // Restrict Referer header to origin only on cross-origin requests.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Force HTTPS for 1 year in production; disabled in dev to avoid breaking localhost.
          ...(isProduction
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
            : []),
          // Basic CSP: allow same-origin resources; restrict inline scripts to dev only.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Unsafe-inline is required for RSC streaming and React hydration in Next.js
              "script-src 'self' 'unsafe-inline'",
              `connect-src 'self' ${process.env['NEXT_PUBLIC_API_URL'] ?? ''} ${process.env['NEXT_PUBLIC_WS_URL'] ?? ''}`,
              "img-src 'self' data:",
              "style-src 'self' 'unsafe-inline'",
              "font-src 'self'",
              "frame-ancestors 'none'",
            ]
              .join('; ')
              .trim(),
          },
        ],
      },
    ];
  },

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
