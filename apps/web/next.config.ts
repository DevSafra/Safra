import { join } from 'node:path';

import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

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
        ],
      },
      /**
       * The ad click redirect sends NO referrer, overriding the rule above.
       *
       * `strict-origin-when-cross-origin` still hands the advertiser `https://safra.sy` on the way
       * out. Which city a customer was browsing — and that they were on SAFRA at all — is ours, not
       * theirs, and this is the one route whose whole purpose is to hand a browser to somebody else.
       *
       * Set HERE rather than on the route's own response: a `headers()` rule wins over a header a
       * route handler sets, which is how the handler's own `no-referrer` came back as the global
       * value when this was driven in a browser. Listed after the catch-all because the last
       * matching rule for a key is the one that applies.
       */
      {
        source: '/:locale/api/ads/:reference/click',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
    ]);
  },
};

export default withNextIntl(config);
