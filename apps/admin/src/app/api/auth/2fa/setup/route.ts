import type { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/** Issues a PENDING TOTP secret. Nothing is committed until `enable` confirms it. */
export async function POST(): Promise<NextResponse> {
  return proxy('/auth/2fa/setup', { method: 'POST' });
}
