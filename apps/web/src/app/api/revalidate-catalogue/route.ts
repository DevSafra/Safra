import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

import { CATALOGUE_TAG } from '@safra/contracts';

/**
 * Purges this app's cached view of the REFERENCE data, on the API's say-so.
 *
 * Bashar, 2026-09-13: staff replaced the photograph for دمشق and the landing page kept the old one
 * for five minutes. الرئيسية is prerendered with `revalidate = 300`, so the page held the old
 * picture however fresh the data behind it was — the same shape the settings route was built for,
 * and the reason this is a second ROUTE rather than a parameter on that one.
 *
 * ## It takes NO tag and NO path
 *
 * That absence is the authorization, exactly as next door. A caller cannot ask for an arbitrary
 * tag to be purged or an arbitrary path to be re-rendered: there is one tag, it is named in
 * `@safra/contracts`, and this route knows it. The worst a caller holding the secret can do is
 * make this app re-read a handful of public reference endpoints.
 *
 * Two routes rather than one that takes a tag, for that reason alone. A `{ tag }` body would turn
 * «purge one known thing» into «purge whatever you name», which is a different capability.
 *
 * ## Fail CLOSED, and quietly
 *
 * With no `REVALIDATE_SECRET` configured the route answers 404 — the same answer a wrong secret
 * gets. A deployment that forgets the variable loses immediacy and keeps its TTL floor, which is
 * the safe direction to fail.
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

  revalidateTag(CATALOGUE_TAG);

  return NextResponse.json({ ok: true, tag: CATALOGUE_TAG });
}

/** Constant-time comparison, once the lengths are known to match. */
function matches(offered: string, expected: string): boolean {
  const a = Buffer.from(offered, 'utf8');
  const b = Buffer.from(expected, 'utf8');

  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
