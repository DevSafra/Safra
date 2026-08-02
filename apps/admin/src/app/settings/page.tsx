import Link from 'next/link';

import { getSettings, type EditableSetting } from '@/lib/api';
import { SettingRow } from '@/components/setting-row';

/**
 * The Rules Engine (SRS §9.3, P-005).
 *
 * P-005 requires commissions, SLA windows, fines and the same-day cutoff to be
 * configuration rather than code. They have been since the schema was written, and
 * editable only by hand — which honoured the letter of the principle and none of its
 * intent. This is where an operator changes them.
 *
 * Grouped by what a setting DOES rather than alphabetically, because somebody
 * adjusting the partner commission is thinking about money, not about the string
 * `commission.partner_rate`.
 */
export const dynamic = 'force-dynamic';

const GROUPS: ReadonlyArray<{ title: string; note: string; prefixes: string[] }> = [
  {
    title: 'Money',
    note: 'What SAFRA charges and what partners are owed. A change never rewrites an existing booking — each one snapshots the values it was made under.',
    prefixes: ['commission.', 'money.', 'refund.'],
  },
  {
    title: 'Booking rules',
    note: 'The windows that decide when a booking expires or a partner is late (§6.4, EC-001).',
    prefixes: ['booking.'],
  },
  {
    title: 'Partners and compensation',
    note: 'Fines, and the wallet credit a customer receives when a partner misses their window (P-007).',
    prefixes: ['partner.', 'wallet.'],
  },
  {
    title: 'Access',
    note: 'Runtime permission grants. Enabling one takes effect within 15 minutes; disabling one revokes every session for that role immediately.',
    prefixes: ['rbac.'],
  },
];

export default async function SettingsPage() {
  const result = await getSettings();

  if (result === 'unauthenticated') {
    return (
      <Shell>
        <p className="text-sm text-muted">
          Your session expired, or this account cannot read settings.
        </p>
      </Shell>
    );
  }

  if (result === 'failed') {
    return (
      <Shell>
        <p className="text-sm text-bad">Could not load settings.</p>
      </Shell>
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
   * A settings screen that silently omits a key is worse than an untidy section: the
   * setting still governs the platform, and hiding it means nobody knows it is there.
   */
  const other = result.settings.filter((setting) => !claimed.has(setting.key));

  return (
    <Shell>
      <header>
        <h1 className="text-2xl font-semibold text-text">Rules Engine</h1>
        <p className="mt-1 text-sm text-muted">
          Operational configuration (P-005). Every change is recorded with who made it,
          when, and the value it replaced.
        </p>
      </header>

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
          title="Other"
          note="Settings outside the groups above. Some cannot be edited here — the row says which, and why."
          settings={other}
        />
      ) : null}
    </Shell>
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
    <section>
      <h2 className="text-lg text-text">{title}</h2>
      <p className="mt-1 text-xs text-faint">{note}</p>

      <ul className="mt-3 grid gap-2">
        {settings.map((setting) => (
          <li key={setting.key}>
            <SettingRow setting={setting} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/" className="text-sm text-muted hover:text-gold">
        ← Queues
      </Link>
      <div className="mt-4 grid gap-8">{children}</div>
    </main>
  );
}
