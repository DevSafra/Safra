import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Activates Emergency Mode (EC-009).
 *
 * A thin proxy: the API owns the validation, the Super-Admin check, the audit entry and the
 * rate limit. Re-validating here would create a second definition of what a valid activation is,
 * and the two would drift — so this only checks that a body arrived at all.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ message: 'A request body is required.' }, { status: 400 });
  }

  return proxy('/admin/emergency', { method: 'POST', body });
}
