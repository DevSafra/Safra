import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

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
        ],
      },
    ]);
  },
};

export default withNextIntl(config);
