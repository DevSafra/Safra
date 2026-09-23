import { getGeography, getLandmarkKinds, getLandmarks } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { FootNote } from '@/components/admin-table';
import { LandmarkKindsManager } from '@/components/landmark-kinds-manager';
import { LandmarkRegistry } from '@/components/landmark-registry';
import { pageNumber } from '@/lib/search-params';
import { t } from '@/lib/strings';
import { refuseSection } from '@/components/section-refusal';
import { resolvePageSize } from '@/lib/table-size';

/**
 * المعالم — the landmark registry (Bashar, 2026-09-23).
 *
 * ## Why this screen exists
 *
 * Landmarks shipped as SEED DATA, which satisfied «operational data is managed without a code
 * change» in the data and not at all in the workflow: adding one meant editing a seed file,
 * getting it reviewed and deploying. Bashar closed that the same day he approved the map work
 * — «I do not want landmarks to remain seed-only data».
 *
 * ## Two panels, because they are two decisions
 *
 * The KINDS carry the icon and the grouping; there are eight and a platform with fifty has a
 * taxonomy problem rather than a paging problem, so they are an unpaginated panel — the
 * documented exception `geo-bounds.integration.test.ts` already holds for countries and
 * currencies, extended here by `landmark-bounds.integration.test.ts`.
 *
 * The LANDMARKS themselves are paged, filtered and searched. Forty-one today across nine
 * cities, and the number grows with every city SAFRA opens — this is a list somebody searches,
 * not a queue they scan.
 */
export const dynamic = 'force-dynamic';

export default async function LandmarksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
    FIRST, before any fetch. `staffFetch` maps a 403 to 'unauthenticated', so a guard placed
    after the fetches renders «انتهت الجلسة» to somebody whose session is perfectly fine.
  */
  const refused = await refuseSection('landmarks', t.nav.landmarks);

  if (refused) return refused;

  const query = await searchParams;
  const first = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;

  const page = pageNumber(first(query['page']));
  /*
    Three sources in this order: the URL, this reader's saved size for THIS registry, then ten.
    The URL wins so a shared link looks the same to both people, and following somebody's link
    never overwrites your own preference.
  */
  const size = await resolvePageSize('landmarks', first(query['size']));

  const citySlug = first(query['citySlug']) || undefined;
  const kindCode = first(query['kindCode']) || undefined;
  const search = first(query['q'])?.trim() || undefined;

  const [result, kinds, geography, counts] = await Promise.all([
    getLandmarks({ page, size, citySlug, kindCode, q: search }),
    getLandmarkKinds(),
    getGeography(),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell title={t.nav.landmarks} counts={counts}>
      <ConsolePanel>
        {result === 'unauthenticated' || kinds === 'unauthenticated' ? (
          <p className="text-14 text-muted">{t.dashboard.sessionExpired}</p>
        ) : result === 'failed' || kinds === 'failed' ? (
          <p className="text-14 text-bad">{t.dashboard.queueFailed}</p>
        ) : (
          <>
            <LandmarkRegistry
              items={result.items}
              total={result.total}
              capped={result.capped}
              page={page}
              size={size}
              citySlug={citySlug}
              kindCode={kindCode}
              q={search}
              kinds={kinds.kinds}
              cities={
                geography === 'unauthenticated' || geography === 'failed'
                  ? []
                  : geography.cities.map((city) => ({
                      slug: city.slug,
                      nameAr: city.nameAr,
                      latitude: city.latitude,
                      longitude: city.longitude,
                    }))
              }
            />

            <div className="mt-8">
              <LandmarkKindsManager kinds={kinds.kinds} />
            </div>
          </>
        )}

        <FootNote>{t.sections.landmarks.note}</FootNote>
      </ConsolePanel>
    </ConsoleShell>
  );
}
