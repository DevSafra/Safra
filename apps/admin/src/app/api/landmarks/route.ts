import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Adding a landmark — «+ إضافة معلم».
 *
 * The API's schema and `GEO_MANAGE` are the authority; this hands over the staff bearer and
 * nothing else. Note what is NOT validated here: the coordinates and their distance from the
 * city are checked in `LandmarkService`, so a caller bypassing this screen meets the same rule.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ message: 'A body is required.' }, { status: 400 });
  }

  return proxy('/admin/landmarks', { method: 'POST', body });
}
