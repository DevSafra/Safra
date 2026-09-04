import { NextResponse } from 'next/server';

import { passwordChangeSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Changing your own password from الإعدادات (Bashar, 2026-09-04).
 *
 * `POST /auth/me/password` is role-agnostic — it reads `users` by `claims.sub`, verifies the stored
 * Argon2id digest, and revokes every refresh family — so a partner uses the same endpoint a
 * customer does. It is throttled to five a minute upstream and audited on a wrong password as well
 * as on a change, which is what makes repeated failures here visible as somebody guessing at an
 * unlocked screen.
 *
 * Parsed at the edge so a malformed body is refused before it spends one of those five attempts,
 * and so the form can say which field is wrong. Neither password is ever logged: the body is
 * forwarded, not read, and this handler holds no `console` call by design.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const parsed = passwordChangeSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? 'validation.failed' },
      { status: 400 },
    );
  }

  return proxy('/auth/me/password', { method: 'POST', body: parsed.data });
}
