import { join } from 'node:path';

import type { NextConfig } from 'next';

/**
 * لوحة الشريك (design handoff §7), deliberately a separate app.
 *
 * The fourth app, for the same reason the console is the third (ADR 0001). A partner
 * sees their own listings, their own guests' names and their own money — and nothing
 * of the other two surfaces. Sharing an origin, a cookie or a bundle with either would
 * make a bug on one a route into the other.
 *
 * Port 3002: 3000 is the public site, 3001 the console.
 */
const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * Emits a self-contained server with only the files actually imported, which is
   * what the container image ships. Without it the image needs the whole
   * `node_modules` tree — hundreds of megabytes of build-time dependencies that have
   * no business being in a running container.
   */
  output: 'standalone',

  /**
   * The workspace root, not this directory.
   *
   * In a pnpm monorepo Next infers the tracing root from the nearest lockfile and gets
   * it wrong, silently omitting the hoisted `.pnpm` store that the `@safra/*` packages
   * resolve through. The build succeeds and the container then fails at startup with a
   * missing module — a failure that only appears once it is running.
   */
  outputFileTracingRoot: join(import.meta.dirname, '../..'),

  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },

  headers() {
    return Promise.resolve([
      {
        source: '/(.*)',
        headers: [
          /**
           * Stricter than the public app's, because nothing here should ever be
           * indexed, embedded or linked from outside.
           */
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // No referrer at all: an admin URL carries partner and booking ids, and
          // there is no legitimate destination that needs to know where staff were.
          { key: 'Referrer-Policy', value: 'no-referrer' },
          /**
           * Set here as well as at the edge. A header that exists only at the edge is
           * absent the moment traffic reaches the app another way — a staging host, a
           * direct origin pull, a misrouted record — and this app authenticates staff.
           *
           * Removed by accident on 2026-08-03 while stripping the static CSP out of
           * this file, and caught by asserting the header rather than the diff.
           */
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
    ]);
  },
};

export default config;
