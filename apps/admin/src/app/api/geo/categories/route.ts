import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/** Adding a city category — «+ إضافة فئة». The API's schema and `GEO_MANAGE` are the authority. */
export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ message: 'A body is required.' }, { status: 400 });
  }

  return proxy('/admin/geo/categories', { method: 'POST', body });
}
