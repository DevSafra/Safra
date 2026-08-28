import type { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Records that the caller has opened one of their own console sections.
 *
 * A thin proxy. The API validates the section against `SEEN_SECTIONS`, stamps the moment with its
 * own `now()`, and writes `claims.sub` — so this handler has nothing to check that would not be a
 * second, drifting definition of the same rule.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);

  return proxy('/admin/me/seen', { method: 'POST', body });
}
