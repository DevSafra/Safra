import type { MetadataRoute } from 'next';

import { robotsPolicy } from '@/lib/robots';
import { siteOrigin } from '@/lib/site-url';

/**
 * `/robots.txt`. See `robotsPolicy` for what it says and why.
 *
 * Rendered per request rather than once at build: one image is built and then deployed to staging
 * and production, so the answer has to come from the environment the server is RUNNING in. It is a
 * tiny response, and a build-time answer would carry the build machine's setting everywhere.
 */
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return robotsPolicy(siteOrigin(), process.env['SITE_INDEXING']);
}
