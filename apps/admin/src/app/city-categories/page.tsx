import { getCityCategories } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { FootNote } from '@/components/admin-table';
import { CityCategoryManager } from '@/components/city-category-manager';
import { t } from '@/lib/strings';
import { refuseSection } from '@/components/section-refusal';

/**
 * الفئات — city categories, on their own screen (Bashar, 2026-08-30).
 *
 * ## Why a page and not a panel on المدن
 *
 * A category is a property of the whole platform rather than of one city: it is what the customer
 * home page's strip is built from, what the city page prints under its title, and what a search
 * filters on. المدن is already three panels and a paged table; a fourth would bury it.
 *
 * ## Unpaginated, and that is the documented exception
 *
 * Four rows today and bounded by the business rather than by usage — the same reasoning
 * `geo-bounds.integration.test.ts` holds the countries, currencies and cities lists to. If this
 * ever outgrows a screen it belongs in that test rather than behind a pager nobody needs.
 */
export const dynamic = 'force-dynamic';

export default async function CityCategoriesPage() {
  /*
    FIRST, before any fetch.

    `staffFetch` maps a 403 to 'unauthenticated', so a guard placed after the fetches never runs:
    the page has already rendered «انتهت الجلسة» to somebody whose session is fine.
  */
  const refused = await refuseSection('cityCategories', t.nav.cityCategories);

  if (refused) return refused;

  const [result, counts] = await Promise.all([getCityCategories(), sidebarCounts()]);

  return (
    <ConsoleShell title={t.nav.cityCategories} counts={counts}>
      <ConsolePanel>
        {result === 'unauthenticated' ? (
          <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
        ) : result === 'failed' ? (
          <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
        ) : (
          <CityCategoryManager categories={result.categories} />
        )}

        <FootNote>{t.sections.cityCategories.note}</FootNote>
      </ConsolePanel>
    </ConsoleShell>
  );
}
