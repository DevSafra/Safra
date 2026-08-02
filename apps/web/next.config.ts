import { createHash } from 'node:crypto';

import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

import { THEME_SCRIPT } from './src/lib/theme-script';

/**
 * The CSP hash for the one inline script this app serves.
 *
 * Computed from the same constant the component renders, so the two cannot drift. The
 * alternative — `script-src 'unsafe-inline'` — would allow ALL inline script in order
 * to permit one known line, which is precisely the protection CSP exists to give up
 * last.
 */
const THEME_SCRIPT_HASH = `'sha256-${createHash('sha256').update(THEME_SCRIPT).digest('base64')}'`;

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Type and lint errors must fail the build. Next's defaults already do this;
  // stating it prevents a future "just ship it" flag from being added quietly.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },

  images: {
    // §14.1 budgets a 2-second home page on an image-heavy design, so modern
    // formats are not optional.
    formats: ['image/avif', 'image/webp'],
  },

  // Not async: there is nothing to await, and Next accepts a returned promise.
  headers() {
    return Promise.resolve([
      {
        source: '/(.*)',
        headers: [
          // Defence in depth behind Cloudflare, which will also set these.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self)',
          },
          /**
           * Set here as well as at the edge. Cloudflare will also send it, but a
           * header that only exists at the edge is absent the moment traffic reaches
           * the app by any other route — a staging host, a direct origin pull, a
           * misrouted DNS record.
           */
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          /**
           * The customer app had NO Content-Security-Policy while the admin app did,
           * which is backwards: this is the app that renders partner-supplied text and
           * images and carries the checkout flow, so it is the one a reflected payload
           * would be aimed at.
           *
           * `img-src` allows https: because property photography is served from object
           * storage or a CDN whose hostname is deployment configuration, not known
           * here. Everything else is self-only, and script is self plus the single
           * hashed theme line.
           */
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              `script-src 'self' ${THEME_SCRIPT_HASH}`,
              // Next injects critical CSS inline; there is no hash-stable equivalent.
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self'",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "form-action 'self'",
              "base-uri 'none'",
              "object-src 'none'",
              'upgrade-insecure-requests',
            ].join('; '),
          },
        ],
      },
    ]);
  },
};

export default withNextIntl(config);
