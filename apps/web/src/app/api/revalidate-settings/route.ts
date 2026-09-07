import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

import { OPERATING_SETTINGS_TAG } from '@safra/contracts';

/**
 * Purges this app's cached view of the operating settings, on the API's say-so.
 *
 * Bashar, 2026-09-08: *"I would like configuration changes to become visible immediately after a
 * settings update… without requiring users to wait several minutes for caches to expire."*
 * `SettingsAdminService` calls this after the write transaction commits.
 *
 * ## It takes NO tag and NO path
 *
 * That absence is the authorization, the same way the table-preferences endpoint takes no user id.
 * A caller cannot ask for an arbitrary tag to be purged or an arbitrary path to be re-rendered —
 * there is one tag, it is named in `@safra/contracts`, and this route knows it. The worst a caller
 * with the secret can do is make this app re-read one public endpoint.
 *
 * ## Fail CLOSED, and quietly
 *
 * With no `REVALIDATE_SECRET` configured the route answers 404 — the same answer a wrong secret
 * gets, and the same shape `MetricsController` uses for exactly this reason: a 401 tells an
 * attacker the route exists and that their secret was merely wrong. A deployment that forgets the
 * variable therefore loses immediacy and keeps its TTL floor, which is the safe direction to fail.
 *
 * ## Constant-time, because `===` leaks a prefix
 *
 * `timingSafeEqual` needs equal lengths, so the length check comes first and is itself a
 * comparison — but on the LENGTH, which is not the secret.
 */
export function POST(request: Request): NextResponse {
  const expected = process.env['REVALIDATE_SECRET'] ?? '';

  if (expected === '') return NextResponse.json({ ok: false }, { status: 404 });

  const offered = request.headers.get('x-safra-revalidate') ?? '';

  if (!matches(offered, expected)) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  revalidateTag(OPERATING_SETTINGS_TAG);

  return NextResponse.json({ ok: true, tag: OPERATING_SETTINGS_TAG });
}

/** Constant-time comparison, once the lengths are known to match. */
function matches(offered: string, expected: string): boolean {
  const a = Buffer.from(offered, 'utf8');
  const b = Buffer.from(expected, 'utf8');

  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
