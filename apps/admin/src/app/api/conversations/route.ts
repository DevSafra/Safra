import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * SAFRA writing first — «محادثة جديدة».
 *
 * The body is forwarded as it arrived and validated by the API's own schema. Nothing about WHO is
 * decided here: the recipient is a reference the API resolves inside the reader's own scope, so a
 * console that skipped this route could not name a customer, a city or a conversation id.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ message: 'A message is required.' }, { status: 400 });
  }

  return proxy('/admin/conversations', { method: 'POST', body });
}
