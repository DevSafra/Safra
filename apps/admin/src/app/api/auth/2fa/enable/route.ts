import { NextResponse } from 'next/server';

import { ERROR, totpEnableSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Commits the pending secret once a live code proves the authenticator has it.
 *
 * Validated here as well as at the API against the same schema, so an obviously
 * malformed code does not spend one of the account's ten attempts a minute.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = totpEnableSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ code: ERROR.VALIDATION_CODE_SIX_DIGITS }, { status: 400 });
  }

  return proxy('/auth/2fa/enable', { method: 'POST', body: parsed.data });
}
