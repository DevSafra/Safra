import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Adding to the platform's geography — «+ إضافة».
 *
 * A thin proxy: the API's own schema is the authority on the shape, and `GEO_MANAGE` is checked
 * there. Nothing about which markets exist is decided in this app.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ message: 'A body is required.' }, { status: 400 });
  }

  return proxy('/admin/geo/cities', { method: 'POST', body });
}
