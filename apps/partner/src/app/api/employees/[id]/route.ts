import { NextResponse } from 'next/server';

import { ERROR, employeeUpdateSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Changing an employee's role, suspending them, or removing them.
 *
 * ## The id is encoded, and it is still not a capability
 *
 * `encodeURIComponent` keeps a crafted segment from escaping the path, but the reason a partner
 * cannot reach another partner's employee is not this line — it is that the API resolves the row
 * with `WHERE id = … AND partner_id = …`, taking the partner from the verified token, and answers
 * a stranger's employee identically to one that does not exist. This route deliberately adds no
 * second opinion about ownership: one place decides, and it is the one holding the WHERE clause.
 *
 * ## PATCH and DELETE, not one endpoint with an action
 *
 * Suspending is reversible and removing is not. Collapsing them behind a field would put that
 * difference inside a request body, where a mistyped value is the difference between somebody
 * being paused and somebody being gone.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const parsed = employeeUpdateSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? ERROR.REQUEST_VALIDATION_FAILED },
      { status: 400 },
    );
  }

  return proxy(`/partner/employees/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: parsed.data,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  return proxy(`/partner/employees/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
