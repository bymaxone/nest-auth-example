/**
 * @fileoverview Next.js 16 configuration for apps/web.
 *
 * Key concerns:
 * - `/api/:path*` rewrite proxies browser requests to the NestJS API at
 *   INTERNAL_API_URL, keeping the browser on a single registrable domain — a
 *   prerequisite for HttpOnly cookie flows and `createAuthProxy`.
 * - React Compiler is enabled for React 19 performance optimisation.
 * - INTERNAL_API_URL is read directly from process.env here (not from lib/env.ts)
 *   because next.config runs before module-level env parsing in some contexts
 *   (e.g. `next build` cold-start). Next.js' built-in .env loading is sufficient.
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
    ];
  },
};

export default nextConfig;
