import { NextResponse } from 'next/server';

import { isLocale } from '@/i18n/routing';
import { savedSlugs, searchMapSafely } from '@/lib/api';
import { getLandmarks } from '@/lib/catalog';
import { localisedText } from '@/lib/localise';
import { toMapStays } from '@/lib/search-cards';
import { toQueryString, toSearchParams } from '@/lib/search-query';
import { readSearchRequest } from '@/lib/search-request';
import { getSession } from '@/lib/session-server';

/**
 * The stays the full map draws for the area on screen (Bashar, 2026-10-01: «I see only one price,
 * while there are so many hotels»).
 *
 * The map drew the cards of the page it was opened from, so it showed whatever twenty the list
 * happened to hold. It now asks here each time it settles, with its own box as `bbox`, and gets
 * every matching stay in view: the page's filters, parsed by the page's allow-list, plus the box.
 * The answer is written in the reader's language by the same card builder the list uses.
 *
 * A browser that NAVIGATES here is sent to the results page, as the batch route does.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string }> },
): Promise<NextResponse> {
  const { locale } = await params;

  if (!isLocale(locale)) return NextResponse.json({ code: 'not_found' }, { status: 404 });

  const { parsed, amenities, navigation } = await readSearchRequest(request);

  if (navigation) {
    return new NextResponse(null, {
      status: 303,
      headers: { Location: `/${locale}/search?${toQueryString(parsed)}` },
    });
  }

  const result = await searchMapSafely(toSearchParams(parsed));

  if (!result) return NextResponse.json({ stays: [], capped: false }, { status: 502 });

  /*
    The hearts on the map's cards say what THIS reader saved (Bashar, 2026-10-01). Read with the
    reader's own token on the server, and only ever about the stays in this answer.
  */
  const session = await getSession();
  const saved = session
    ? await savedSlugs(
        session.accessToken,
        result.items.map((item) => item.slug),
      )
    : new Set<string>();

  const landmarks = parsed.nearLandmark ? await getLandmarks(parsed.citySlug) : [];
  const landmark = landmarks.find((one) => one.slug === parsed.nearLandmark);

  const stays = await toMapStays(result.items, {
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
    { stays, capped: result.capped },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
