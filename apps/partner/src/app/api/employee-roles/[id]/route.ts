import { NextResponse } from 'next/server';

import { ERROR, employeeRoleUpdateSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Editing a role, or withdrawing one.
 *
 * ## PUT, not PATCH — and the difference is not pedantry
 *
 * A partial permission set is ambiguous: `{ permissions: ['booking.read_own'] }` could mean "this
 * is now the whole set" or "add this one". The first is what a checkbox form means and the second
 * is what a reader might assume, and getting it wrong REMOVES capabilities somebody thought they
 * were keeping. `PUT` replaces, the form always sends the complete set, and there is nothing to
 * infer. `project-e9` demonstrated the replacement empirically on the console screen rather than
 * assuming it.
 *
 * ## Ownership is not decided here
 *
 * `encodeURIComponent` keeps a crafted segment inside the path, but the reason a partner cannot
 * edit another partner's role is that the API resolves the row with `partner_id` from the verified
 * token in the WHERE clause and answers a stranger's role identically to one that never existed.
 * One place decides that, and it is the one holding the query.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const parsed = employeeRoleUpdateSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? ERROR.REQUEST_VALIDATION_FAILED },
      { status: 400 },
    );
  }

  return proxy(`/partner/employee-roles/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: parsed.data,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  return proxy(`/partner/employee-roles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
