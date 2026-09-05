import type { SafraRevenue } from '@/lib/api';
import { amount } from '@/lib/format';
import { t } from '@/lib/strings';

/**
 * What SAFRA has earned, taken out, and is still owed to itself.
 *
 * ## Every figure carries SYP
 *
 * Revenue arrives in five currencies and the ledger normalises to `amount_syp`, so these are SYP —
 * and «٣٬٤٧٥٬١١٨٬٩٦٠» with no currency beside it is a number nobody can act on. `amount()` rather
 * than `money()`, per the standing rule: if you cannot point at the currency, you use the one that
 * carries it.
 *
 * ## Outstanding is the figure that matters, so it reads differently
 *
 * Accrued and transferred are history. Outstanding is a question — money the platform has earned
 * and not yet collected — and it is the one an operator opens this screen for. It is gold; the
 * other two are not, and none of the three is a tile with an icon.
 *
 * ## The breakdown names its sources
 *
 * `safra_commission_partner` is not a word anybody reads. A stream added to the ledger and not to
 * the catalogue falls back to «مصدر آخر» with its code beside it, so a new revenue account shows
 * up as an unnamed source rather than vanishing from a total it contributes to.
 */
export function SafraRevenueSummary({ revenue }: { readonly revenue: SafraRevenue }) {
  const c = t.sections.treasury;

  return (
    <section className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Figure label={c.accrued} value={revenue.accrued} />
        <Figure label={c.transferred} value={revenue.transferred} />
        <Figure label={c.outstanding} value={revenue.outstanding} emphasis />
      </div>

      <div className="grid gap-2">
        <h3 className="text-[12px] font-bold text-faint">{c.bySource}</h3>

        <ul className="grid gap-1.5">
          {revenue.byAccount.map((row) => (
            <li
              key={row.account}
              data-revenue-source={row.account}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-line2 px-3 py-2 text-[12.5px]"
            >
              <span className="font-semibold text-text">{sourceLabel(row.account)}</span>

              <span className="ms-auto text-text2">
                {c.colAccrued}: {amount(row.accrued, 'SYP')}
              </span>
              <span className="text-faint">
                {c.colTransferred}: {amount(row.transferred, 'SYP')}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * One figure.
 *
 * A bordered panel with a label above a number, not a metric tile: no icon, no accent bar, no
 * supporting statistic. The craft floor names that template as a default to refuse, and it earns
 * the refusal here — three of them in a row with icons would say less than three sentences would.
 */
function Figure({
  label,
  value,
  emphasis,
}: {
  readonly label: string;
  readonly value: string;
  readonly emphasis?: boolean;
}) {
  return (
    <div
      data-figure={label}
      className={`grid gap-1 rounded-card border p-4 ${
        emphasis
          ? 'border-[rgba(var(--goldA),0.4)] bg-[rgba(var(--goldA),0.05)]'
          : 'border-line bg-card'
      }`}
    >
      <span className="text-[11.5px] text-faint">{label}</span>
      <span
        className={`text-[19px] font-extrabold tabular-nums ${emphasis ? 'text-gold' : 'text-text'}`}
      >
        {amount(value, 'SYP')}
      </span>
    </div>
  );
}

/** The ledger account as a word. An unmapped one is named, never dropped from the list. */
function sourceLabel(account: string): string {
  const c = t.sections.treasury;

  if (account === 'safra_commission_partner') return c.sourceCommissionPartner;
  if (account === 'safra_commission_customer') return c.sourceCommissionCustomer;
  if (account === 'ad_revenue') return c.sourceAdRevenue;

  return `${c.sourceOther} (${account})`;
}
