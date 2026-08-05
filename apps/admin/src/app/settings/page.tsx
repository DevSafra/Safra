import { getSettings, type EditableSetting } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { FootNote } from '@/components/admin-table';
import { SettingRow } from '@/components/setting-row';
import { t } from '@/lib/strings';

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
 * `commission.partner_rate`. Within each group the layout is the design's grid, and the field
 * treatment — label, value, unit suffix, hint line — is the design's exactly.
 *
 * ## Saved per field, not with one button
 *
 * The design has a single "حفظ الإعدادات". Each row saves itself instead, because every change
 * writes an audited history row naming the value it replaced: one bulk submit would either
 * collapse several distinct decisions into one audit entry or write entries for fields nobody
 * touched. Documented in the gap report.
 */
export const dynamic = 'force-dynamic';

const GROUPS: ReadonlyArray<{ title: string; note: string; prefixes: string[] }> = [
  {
    title: t.sections.settings.groupMoney,
    note: t.sections.settings.groupMoneyNote,
    prefixes: ['commission.', 'money.', 'refund.'],
  },
  {
    title: t.sections.settings.groupBooking,
    note: t.sections.settings.groupBookingNote,
    prefixes: ['booking.'],
  },
  {
    title: t.sections.settings.groupPartners,
    note: t.sections.settings.groupPartnersNote,
    prefixes: ['partner.', 'wallet.'],
  },
  {
    title: t.sections.settings.groupPermissions,
    note: t.sections.settings.groupPermissionsNote,
    prefixes: ['rbac.'],
  },
];

export default async function SettingsPage() {
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

  const groups = GROUPS.map((group) => {
    const settings = result.settings.filter((setting) => {
      const belongs = group.prefixes.some((prefix) => setting.key.startsWith(prefix));

      if (belongs) claimed.add(setting.key);

      return belongs;
    });

    return { ...group, settings };
  });

  /**
   * Anything unmatched still appears.
   *
   * A settings screen that silently omits a key is worse than an untidy section: the setting
   * still governs the platform, and hiding it means nobody knows it is there.
   */
  const other = result.settings.filter((setting) => !claimed.has(setting.key));

  return (
    <ConsoleShell title={t.nav.settings} counts={counts}>
      <div className="grid gap-4">
        <ConsolePanel>
          <h2 className="text-[14.5px] font-extrabold text-gold">
            {t.sections.settings.title}
          </h2>
          <FootNote>{t.sections.settings.hint}</FootNote>
        </ConsolePanel>

        {groups.map((group) =>
          group.settings.length === 0 ? null : (
            <Group
              key={group.title}
              title={group.title}
              note={group.note}
              settings={group.settings}
            />
          ),
        )}

        {other.length > 0 ? (
          <Group
            title={t.sections.settings.groupOther}
            note={t.sections.settings.groupOtherNote}
            settings={other}
          />
        ) : null}
      </div>
    </ConsoleShell>
  );
}

function Group({
  title,
  note,
  settings,
}: {
  title: string;
  note: string;
  settings: EditableSetting[];
}) {
  return (
    <ConsolePanel title={title}>
      <p className="mb-3.5 text-[11.5px] leading-relaxed text-faint">{note}</p>

      {/* The design's `auto-fit / minmax(220px, 1fr)` field grid. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3.5">
        {settings.map((setting) => (
          <SettingRow key={setting.key} setting={setting} />
        ))}
      </div>
    </ConsolePanel>
  );
}
