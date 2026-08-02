import { join } from 'node:path';

import type { NextConfig } from 'next';

/**
 * The staff command centre (SRS §9), deliberately a separate app.
 *
 * ADR 0001 chose this over an admin route group in `apps/web` so staff
 * authentication never shares an origin, a cookie or a bundle with the public site.
 * The practical effect is that a vulnerability in a customer-facing page cannot be
 * used to reach a verification queue, and this app can be locked to an allow-list at
 * the edge without touching the public one.
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
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
          /**
           * No inline script, no external origin, nothing framed.
           *
           * `unsafe-inline` is present for STYLES only, which Next requires for its
           * injected critical CSS; scripts get `strict-dynamic`-free self-only, so a
           * reflected payload has nowhere to execute. This app renders identity
           * documents, so the containment matters more than the convenience.
           */
          /**
           * Set here as well as at the edge. A header that exists only at the edge is
           * absent the moment traffic reaches the app another way — a staging host, a
           * direct origin pull, a misrouted record — and this app authenticates staff.
           */
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self'",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "form-action 'self'",
              "base-uri 'none'",
              "object-src 'none'",
            ].join('; '),
          },
        ],
      },
    ]);
  },
};

export default config;
