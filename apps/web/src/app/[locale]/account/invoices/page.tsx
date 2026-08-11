import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { AccountNotBuilt, AccountShell } from '@/components/account-shell';
import { getAccountSummary } from '@/lib/account';
import { ACCOUNT_METADATA, requireAccount } from '@/lib/account-page';

/**
 * One of handoff §6's eight sections, with no data source behind it yet.
 *
 * It is a real route rather than a dimmed nav item because it can explain itself in a sentence — see
 * `AccountShell` for why that choice differs from the console's. The panel NAMES what is missing:
 * an empty list here would say "you have none", which is a different and false statement.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = ACCOUNT_METADATA;

export default async function AccountSectionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: requested } = await params;
  const { locale } = await requireAccount(requested, '/invoices');

  const summaryRead = await getAccountSummary();
  const summary =
    summaryRead === 'failed' || summaryRead === 'unauthenticated' ? null : summaryRead;

  const t = await getTranslations('account');

  return (
    <AccountShell
      locale={locale}
      active="invoices"
      summary={summary}
      title={t('navInvoices')}
    >
      <AccountNotBuilt reason={t('invoicesNotBuilt')} />
    </AccountShell>
  );
}
