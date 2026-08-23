import { NextResponse } from 'next/server';

import { ERROR, staffRoleCreateSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Replacing a role — PUT, and the whole role travels.
 *
 * Not PATCH, and the difference is not stylistic. A partial permission set is ambiguous in a way
 * that matters: `['booking.read_own']` could mean "this is now the whole role" or "add this to what
 * it already carries", and those two readings differ by everything else the role could do. A PUT
 * carrying the complete set has one meaning, so a request that loses a capability loses it
 * visibly rather than by interpretation.
 *
 * Same schema as create, because a replacement has to satisfy the same rules — a role edited down
 * to zero capabilities would be a role that does nothing, and the API refuses that too.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const parsed = staffRoleCreateSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      {
        message: parsed.error.issues[0]?.message ?? ERROR.VALIDATION_REQUIRED,
        field: parsed.error.issues[0]?.path[0] ?? null,
      },
      { status: 400 },
    );
  }

  return proxy(`/admin/staff-roles/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: parsed.data,
  });
}

/**
 * Withdrawing a role.
 *
 * No body, and no check here for whether anybody holds it: the API refuses that with
 * `staff_role.in_use`, and restating the rule in the console would give two answers to one
 * question. What the console does instead is show `employeeCount` on every row, so the operator
 * knows before they press.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  return proxy(`/admin/staff-roles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
