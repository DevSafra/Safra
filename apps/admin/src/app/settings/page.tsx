import { getSettings, type EditableSetting } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { SettingsBoard, type SettingsGroup } from '@/components/settings-board';
import { ALWAYS_USD_SETTING_KEY } from '@safra/contracts';
import { t } from '@/lib/strings';
import { refuseSection } from '@/components/section-refusal';

/**
 * الإعدادات — the Rules Engine (SRS §9.3, P-005, design handoff §8).
 *
 * P-005 requires commissions, SLA windows, fines and the same-day cutoff to be configuration
 * rather than code. They have been since the schema was written, and were editable only by hand —
 * which honoured the letter of the principle and none of its intent.
 *
 * ## Grouped, not a flat grid
 *
 * The design shows eight fields in one `auto-fit` grid. That is right for eight; there are
 * seventeen settings here and more will arrive, so they are grouped by what a setting DOES.
 * Somebody adjusting the partner commission is thinking about money, not about the string
 * `commission.partner_rate`.
 *
 * The field grid itself is gone. It put cells of unequal height in three columns so nothing lined
 * up across a group, pushed «تعديل» to the far inline-end of each cell — which at 390px landed it
 * on the line above its own label — and reflowed the whole group whenever one editor opened. The
 * groups are lists of rows now; `setting-row.tsx` carries the reasoning.
 *
 * ## Saved per field, not with one button
 *
 * The design has a single "حفظ الإعدادات". Each row saves itself instead, because every change
 * writes an audited history row naming the value it replaced: one bulk submit would either
 * collapse several distinct decisions into one audit entry or write entries for fields nobody
 * touched. Documented in the gap report.
 *
 * ## Grouping happens here, filtering happens in the browser
 *
 * The prefixes below are ROUTING — which card a key belongs on — so they stay in the page next to
 * the fetch. The words that name each group are catalogue entries. Searching is the client's, in
 * `settings-board.tsx`, because a filter that could only see one card would be worse than none.
 */
export const dynamic = 'force-dynamic';

const GROUPS: ReadonlyArray<{
  id: string;
  title: string;
  note: string;
  prefixes: string[];
}> = [
  {
    id: 'money',
    title: t.sections.settings.groupMoney,
    note: t.sections.settings.groupMoneyNote,
    prefixes: ['commission.', 'money.', 'refund.'],
  },
  {
    id: 'booking',
    title: t.sections.settings.groupBooking,
    note: t.sections.settings.groupBookingNote,
    prefixes: ['booking.'],
  },
  {
    id: 'partners',
    title: t.sections.settings.groupPartners,
    note: t.sections.settings.groupPartnersNote,
    prefixes: ['partner.', 'wallet.'],
  },
  {
    id: 'permissions',
    title: t.sections.settings.groupPermissions,
    note: t.sections.settings.groupPermissionsNote,
    prefixes: ['rbac.'],
  },
];

export default async function SettingsPage() {
  /*
    FIRST, before any fetch.

    `staffFetch` maps a 403 to 'unauthenticated', so a guard placed after the fetches never
    runs: the page has already rendered «انتهت الجلسة» to somebody whose session is fine, and
    signing in again lands them here again.
  */
  const refused = await refuseSection('settings', t.nav.settings);

  if (refused) return refused;

  const [result, counts] = await Promise.all([getSettings(), sidebarCounts()]);

  if (result === 'unauthenticated' || result === 'failed') {
    return (
      <ConsoleShell title={t.nav.settings} counts={counts}>
        <ConsolePanel>
          <p
            className={`text-[12.5px] ${result === 'failed' ? 'text-bad' : 'text-muted'}`}
          >
            {result === 'failed' ? t.dashboard.queueFailed : t.dashboard.sessionExpired}
          </p>
        </ConsolePanel>
      </ConsoleShell>
    );
  }

  const claimed = new Set<string>();

  const groups: SettingsGroup[] = GROUPS.map((group) => {
    const settings = result.settings.filter((setting) => {
      const belongs = group.prefixes.some((prefix) => setting.key.startsWith(prefix));

      if (belongs) claimed.add(setting.key);

      return belongs;
    });

    return { id: group.id, title: group.title, note: group.note, settings };
  }).filter((group) => group.settings.length > 0);

  /**
   * Anything unmatched still appears.
   *
   * A settings screen that silently omits a key is worse than an untidy section: the setting
   * still governs the platform, and hiding it means nobody knows it is there.
   */
  const other = result.settings.filter((setting) => !claimed.has(setting.key));

  if (other.length > 0) {
    groups.push({
      id: 'other',
      title: t.sections.settings.groupOther,
      note: t.sections.settings.groupOtherNote,
      settings: other,
    });
  }

  return (
    <ConsoleShell title={t.nav.settings} counts={counts}>
      <SettingsBoard groups={groups} alwaysUsd={alwaysUsd(result.settings)} />
    </ConsoleShell>
  );
}

/**
 * Whether `money.always_usd` is on, read from the SAME payload the rows came from.
 *
 * Not a second fetch and not a second read of the settings service. The override decides what a
 * money row actually means, so it has to agree with the row printed beside it — a value read at a
 * different moment could disagree with the amount it is annotating. Defaults to the seeded default
 * (`true`) when the key is absent, which is what `MoneySettingsService` also falls back to.
 */
function alwaysUsd(settings: EditableSetting[]): boolean {
  const row = settings.find((setting) => setting.key === ALWAYS_USD_SETTING_KEY);

  return typeof row?.value === 'boolean' ? row.value : true;
}
