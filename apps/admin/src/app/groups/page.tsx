import { getGeography, getGroupTrips } from '@/lib/api';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { GroupTripManager } from '@/components/group-trip-manager';
import { pageNumber } from '@/lib/search-params';
import { refuseSection } from '@/components/section-refusal';
import { resolvePageSize } from '@/lib/table-size';
import { sidebarCounts } from '@/lib/console';
import { t } from '@/lib/strings';

/**
 * جروبات — where a super admin writes a group trip (Bashar, 2026-09-27; built 2026-09-28).
 *
 * *«only the admin can create a group trip for this»* — so this is the only place one comes from.
 * There is no partner route and no customer one, which is why the section carries no «who owns
 * this» column: every row is SAFRA's.
 *
 * ## Why it is a section of its own and not a panel on كتالوج المنصّة
 *
 * Everything on that screen is REFERENCE data — a short, bounded list read by other screens. A trip
 * is a published thing with a life: it is drafted, announced, and eventually archived, and the list
 * grows with time rather than being bounded by the business. It pages like a registry because it is
 * one, which is exactly what the catalogue panels are not.
 */
export const dynamic = 'force-dynamic';

export default async function GroupTripsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
    FIRST, before any fetch. `staffFetch` maps a 403 to 'unauthenticated', so a guard placed after
    the reads would render «انتهت الجلسة» to somebody whose session is perfectly fine.
  */
  const refused = await refuseSection('groupTrips', t.nav.groupTrips);

  if (refused) return refused;

  const query = await searchParams;
  const first = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;

  const page = pageNumber(first(query['page']));
  /* The URL, then this reader's saved size for THIS registry, then ten. */
  const size = await resolvePageSize('groupTrips', first(query['size']));

  const [result, geography, counts] = await Promise.all([
    getGroupTrips({ page, size }),
    getGeography(),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell title={t.nav.groupTrips} counts={counts}>
      <ConsolePanel>
        {result === 'unauthenticated' || geography === 'unauthenticated' ? (
          <p className="text-14 text-muted">{t.dashboard.sessionExpired}</p>
        ) : result === 'failed' || geography === 'failed' ? (
          <p className="text-14 text-bad">{t.dashboard.queueFailed}</p>
        ) : (
          <GroupTripManager
            trips={result.items}
            cities={geography.cities.map((city) => ({
              slug: city.slug,
              nameAr: city.nameAr,
            }))}
            currencies={geography.currencies.map((one) => ({ code: one.code }))}
            page={page}
            pages={Math.max(1, Math.ceil(result.total / size))}
            total={result.total}
            capped={result.capped}
            size={size}
          />
        )}
      </ConsolePanel>
    </ConsoleShell>
  );
}
