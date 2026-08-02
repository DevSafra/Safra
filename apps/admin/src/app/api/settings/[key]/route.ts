import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/** Changes one operational setting (§9.3, P-005). */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<NextResponse> {
  const { key } = await params;
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== 'object' || body === null || !('value' in body)) {
    return NextResponse.json({ message: 'A value is required.' }, { status: 400 });
  }

  return proxy(`/admin/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body,
  });
}
