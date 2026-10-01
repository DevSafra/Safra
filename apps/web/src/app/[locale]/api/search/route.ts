import { NextResponse } from 'next/server';

import { isLocale } from '@/i18n/routing';
import { savedSlugs, searchSafely } from '@/lib/api';
import { getAmenities, getLandmarks } from '@/lib/catalog';
import { localisedText } from '@/lib/localise';
import { toCardModels } from '@/lib/search-cards';
import { parseSearch, toQueryString, toSearchParams } from '@/lib/search-query';
import { getSession } from '@/lib/session-server';

/**
 * The next batch of results, for the list that loads as the reader scrolls (Bashar, 2026-10-01:
 * «implement a lazy loading when I scroll to the bottom. Do not use pagination»).
 *
 * The browser never talks to the API directly, so this is the server-side half: it parses the
 * query with the SAME function the page uses, asks the API for the batch after `cursor`, and
 * answers cards already written in the reader's language — the shape the page rendered the first
 * batch in, so the twenty-first card cannot read differently from the first.
 *
 * ## What it refuses
 *
 * A cursor that is not the API's own shape is dropped before it is forwarded, and a parameter
 * nobody here understands never reaches the API at all — `parseSearch` is the allow-list. A
 * browser that NAVIGATES here (a pasted link, an opened tab) is sent to the results page for the
 * same search instead of being shown a JSON body, which is never a page a person should land on.
 */
export const dynamic = 'force-dynamic';

const CURSOR = /^[A-Za-z0-9_-]{1,200}$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string }> },
): Promise<NextResponse> {
  const { locale } = await params;

  if (!isLocale(locale)) return NextResponse.json({ code: 'not_found' }, { status: 404 });

  const url = new URL(request.url);
  const raw = Object.fromEntries(
    [...new Set(url.searchParams.keys())].map((key) => {
      const values = url.searchParams.getAll(key);
      return [key, values.length > 1 ? values : values[0]];
    }),
  );

  const amenities = await getAmenities();
  const parsed = parseSearch(
    raw,
    new Set(amenities.filter((one) => one.propertyCount > 0).map((one) => one.code)),
  );

  const navigation =
    request.headers.get('sec-fetch-mode') === 'navigate' ||
    (request.headers.get('accept') ?? '').includes('text/html');

  if (navigation) {
    /* A relative Location: there is no host here to get wrong. */
    return new NextResponse(null, {
      status: 303,
      headers: { Location: `/${locale}/search?${toQueryString(parsed)}` },
    });
  }

  const cursorParam = url.searchParams.get('cursor') ?? '';
  const cursor = CURSOR.test(cursorParam) ? cursorParam : undefined;

  if (!cursor)
    return NextResponse.json(
      { cards: [], nextCursor: null, truncated: false },
      { status: 400 },
    );

  const results = await searchSafely(toSearchParams(parsed, { cursor }));

  if (results.failed)
    return NextResponse.json({ cards: [], nextCursor: null }, { status: 502 });

  const session = await getSession();
  const saved = session
    ? await savedSlugs(
        session.accessToken,
        results.items.map((item) => item.slug),
      )
    : new Set<string>();

  const landmarks = parsed.nearLandmark ? await getLandmarks(parsed.citySlug) : [];
  const landmark = landmarks.find((one) => one.slug === parsed.nearLandmark);

  const cards = await toCardModels(results.items, {
    locale,
    stay: `?${new URLSearchParams({
      checkIn: parsed.checkIn,
      checkOut: parsed.checkOut,
      adults: String(parsed.adults),
      children: String(parsed.children),
      infants: String(parsed.infants),
    }).toString()}`,
    adults: parsed.adults,
    nearLandmarkName: landmark
      ? localisedText(landmark.name, locale) || undefined
      : undefined,
    amenities,
    saved,
  });

  return NextResponse.json(
    { cards, nextCursor: results.nextCursor, truncated: results.truncated },
    /* A batch depends on live availability and, through the hearts, on who is asking. */
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
