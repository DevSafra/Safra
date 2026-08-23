import { NextResponse } from 'next/server';

import { ERROR, employeeInviteSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Inviting an employee (الموظفون).
 *
 * Nothing here names the partner. The API takes the employer from the verified token on every one
 * of these routes, so "invite somebody into another business's team" is not a request this can
 * express — the same shape as every other write in this folder.
 *
 * Validated against the shared schema before the round trip so the address is trimmed and lowered
 * in one place rather than in the form. The API validates it again; this exists so a typo answers
 * from here instead of costing a round trip, not as the boundary.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const parsed = employeeInviteSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? ERROR.REQUEST_VALIDATION_FAILED },
      { status: 400 },
    );
  }

  return proxy('/partner/employees', { method: 'POST', body: parsed.data });
}
