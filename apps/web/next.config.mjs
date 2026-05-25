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
 *
 * @module next.config
 */

import process from 'node:process';

/** @type {import('next').NextConfig} */
const nextConfig = {
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
