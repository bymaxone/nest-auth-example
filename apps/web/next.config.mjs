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
 * - Both `dev` and `build` scripts pass `--webpack` because Turbopack (the
 *   default in Next.js 16) cannot resolve subpath exports from symlinked
 *   workspace packages (`@bymax-one/nest-auth/client`, `/shared`, `/react`,
 *   `/nextjs`). Turbopack follows the symlink to the library's real path and
 *   loses the project's node_modules context when resolving transitive
 *   self-referencing imports, resulting in "Module not found" even with
 *   `turbopack.resolveAlias` or `transpilePackages`. Webpack handles symlinked
 *   packages with subpath exports correctly out of the box.
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
