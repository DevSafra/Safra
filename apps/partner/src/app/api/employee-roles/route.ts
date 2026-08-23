import { NextResponse } from 'next/server';

import { ERROR, employeeRoleCreateSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Creating a role for this partner's own staff.
 *
 * ## The bound is the SHARED schema, deliberately
 *
 * `employeeRoleCreateSchema` refuses any capability outside `PARTNER_EMPLOYEE_PERMISSIONS`, and it
 * lives in `@safra/contracts` so the console's screen, this one and the API all validate against
 * one list. Restating the allowed set here would be a second answer to the question the allow-list
 * exists to have one answer to — and the day somebody widened one copy, the other would still be
 * refusing, or worse, still be permitting.
 *
 * This is not the security boundary. The API validates the same schema and then intersects again
 * when the token is built, so a capability smuggled past this line still resolves to nothing. What
 * this buys is that a typo answers from here rather than after a round trip.
 *
 * Nothing here names the partner: the API takes the owner from the verified token on every one of
 * these routes, so "define a role in another business" is not expressible.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const parsed = employeeRoleCreateSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? ERROR.REQUEST_VALIDATION_FAILED },
      { status: 400 },
    );
  }

  return proxy('/partner/employee-roles', { method: 'POST', body: parsed.data });
}
