import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

import { PROPERTY_SLUG_MAX, PROPERTY_SLUG_PATTERN, propertyTag } from '@safra/contracts';

/**
 * Purges this app's cached view of ONE listing, on the API's say-so.
 *
 * Bashar, 2026-09-13: a photograph changed by a partner waited out the property page's minute.
 * `revalidate = 60` was doing what it says; what was missing is the purge.
 *
 * ## This one DOES take a parameter, unlike its two neighbours
 *
 * `revalidate-settings` and `revalidate-catalogue` take nothing, and that absence is their
 * authorization. A per-listing purge cannot work that way — it has to say WHICH listing — so the
 * safety is moved rather than dropped:
 *
 *   - the caller sends a SLUG, never a tag. The tag is assembled here by `propertyTag`, so no
 *     caller can name a key in this app's cache;
 *   - the slug is matched against `PROPERTY_SLUG_PATTERN` and a length cap BEFORE it is used, so
 *     what reaches the tag is lowercase Latin, digits and single hyphens — the alphabet the API's
 *     own `slugify` produces and nothing else;
 *   - a slug that fails either check is answered exactly like a wrong secret.
 *
 * So the worst a caller holding the secret can do is make this app re-read one public property
 * endpoint — the same bounded blast radius as the routes next door, expressed differently because
 * the capability genuinely differs.
 *
 * ## Fail CLOSED, and quietly
 *
 * With no `REVALIDATE_SECRET` configured the route answers 404 — the same answer a wrong secret,
 * a malformed body and a bad slug all get, so none of them tells a caller which one it was. A
 * deployment that forgets the variable loses immediacy and keeps its TTL floor.
 *
 * ## Constant-time, because `===` leaks a prefix
 *
 * `timingSafeEqual` needs equal lengths, so the length check comes first and is itself a
 * comparison — but on the LENGTH, which is not the secret.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const expected = process.env['REVALIDATE_SECRET'] ?? '';

  if (expected === '') return refuse();

  const offered = request.headers.get('x-safra-revalidate') ?? '';

  if (!matches(offered, expected)) return refuse();

  const slug = await slugOf(request);

  if (slug === null) return refuse();

  revalidateTag(propertyTag(slug));

  return NextResponse.json({ ok: true, tag: propertyTag(slug) });
}

/** The one answer this route gives to everything it will not do. */
function refuse(): NextResponse {
  return NextResponse.json({ ok: false }, { status: 404 });
}

/** The body's slug, or null if the body is not what it must be. */
async function slugOf(request: Request): Promise<string | null> {
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== 'object' || body === null) return null;

  const slug = (body as { slug?: unknown }).slug;

  if (typeof slug !== 'string') return null;
  if (slug.length === 0 || slug.length > PROPERTY_SLUG_MAX) return null;
  if (!PROPERTY_SLUG_PATTERN.test(slug)) return null;

  return slug;
}

/** Constant-time comparison, once the lengths are known to match. */
function matches(offered: string, expected: string): boolean {
  const a = Buffer.from(offered, 'utf8');
  const b = Buffer.from(expected, 'utf8');

  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
