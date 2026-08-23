import { NextResponse } from 'next/server';

import { ERROR, staffRoleCreateSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Creating a partner-employee role (Bashar, 2026-08-23).
 *
 * Validated against the shared schema here as well as at the API, so the rules — a name of at
 * least two characters, at least one capability, and every capability inside
 * `PARTNER_EMPLOYEE_PERMISSIONS` — live in one place rather than being restated in the form.
 *
 * The capability check matters more here than most: the API REJECTS an unknown permission rather
 * than filtering it out, deliberately, so that a super admin is never left believing they granted
 * something the server quietly dropped. Parsing with the same schema means the console refuses it
 * for the same reason and says so under the field.
 */
export async function POST(request: Request): Promise<NextResponse> {
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

  return proxy('/admin/staff-roles', { method: 'POST', body: parsed.data });
}
