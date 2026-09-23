import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Adding a landmark kind, which carries the ICON.
 *
 * The icon is SVG path data and is validated by `landmarkIconPathSchema` at the API — not
 * here. One boundary, so a caller that skips this screen meets the same alphabet.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ message: 'A body is required.' }, { status: 400 });
  }

  return proxy('/admin/landmarks/kinds', { method: 'POST', body });
}
