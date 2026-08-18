import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { renderRedactions } from '@safra/i18n';

import { AccountShell } from '@/components/account-shell';
import { BackLink } from '@/components/back-link';
import { SupportForm } from '@/components/support-forms';
import { SupportClose } from '@/components/support-close';
import { getAccountSummary, getSupportThread } from '@/lib/account';
import { returnTo } from '@/lib/return-to';
import { ACCOUNT_METADATA, requireAccount } from '@/lib/account-page';
import { dynamicMessage } from '@/lib/dynamic-message';
import { ltrIsolate } from '@/lib/bidi';

/**
 * One support thread (الدعم).
 *
 * ## A thread that is not yours is a 404
 *
 * The API answers 404 for somebody else's ticket indistinguishably from one that does not exist, and this
 * page renders `notFound()` for both. `CNV-` references are sequential, so any difference between the two
 * answers would let somebody count other people's support requests.
 *
 * ## Internal staff notes are not here
 *
 * Staff use the same thread to write to each other — `messages.internal`. The API filters those out in one
 * place and this page has no way to ask for them, which is the point: there is no flag to get wrong.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = ACCOUNT_METADATA;

const SENDER_KEY = {
  customer: 'supportSenderCustomer',
  partner: 'supportSenderPartner',
  staff: 'supportSenderStaff',
  system: 'supportSenderSystem',
} as const;

export default async function AccountSupportThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; reference: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: requested, reference } = await params;
  /* Where the reader came from, so «رجوع» goes back there rather than to this section's list. */
  const query = await searchParams;
  const { locale } = await requireAccount(
    requested,
    `/support/${encodeURIComponent(reference)}`,
  );

  const summaryRead = await getAccountSummary();
  const summary =
    summaryRead === 'failed' || summaryRead === 'unauthenticated' ? null : summaryRead;

  const t = await getTranslations('account');
  const thread = await getSupportThread(reference);

  if (thread === 'unauthenticated') {
    return (
      <AccountShell
        locale={locale}
        active="support"
        summary={summary}
        title={t('navSupport')}
      >
        <p className="text-sm text-muted">{t('sessionExpired')}</p>
      </AccountShell>
    );
  }

  if (thread === 'failed') notFound();

  return (
    <AccountShell
      locale={locale}
      active="support"
      summary={summary}
      title={t('navSupport')}
    >
      <div className="grid gap-6">
        <BackLink
          href={returnTo(locale, query['from'], 'support', query['ref'])}
          locale={locale}
        />

        <section className="rounded-card border border-line bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-sm text-text">{ltrIsolate(thread.reference)}</p>
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] ${
                thread.closed
                  ? 'border-line bg-field text-faint'
                  : 'border-ok/40 bg-ok/10 text-ok'
              }`}
            >
              {thread.closed ? t('supportClosedLabel') : t('supportOpenLabel')}
            </span>
          </div>

          <ol className="mt-4 space-y-3">
            {thread.messages.map((message) => (
              <li
                key={message.id}
                /*
                  Staff messages are tinted differently from the reader's own. Colour is not the only
                  signal — every message carries its sender's name above it — so this is reinforcement.
                */
                className={`rounded-lg border p-3 ${
                  message.sender === 'staff'
                    ? 'border-sky/30 bg-sky/5'
                    : 'border-line bg-field'
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-muted">
                    {dynamicMessage(t, SENDER_KEY[message.sender], message.sender)}
                  </span>
                  <span className="text-xs text-faint" dir="ltr">
                    {message.createdAt.slice(0, 16).replace('T', ' ')}
                  </span>
                </div>

                <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-text">
                  {/*
                    `renderRedactions`, so «⟨entfernt⟩» reads in German to a German customer. The
                    body is stored with a language-neutral token where a phone number was removed —
                    see `O-i18n-2`; before this it was stored in Arabic and every reader got Arabic.
                  */}
                  {renderRedactions(message.body, locale)}
                </p>

                {/*
                  Said out loud when it happens. Somebody whose number was masked will otherwise wait for
                  a call that cannot come — the redaction is silent in the body itself.
                */}
                {message.redactedCount > 0 ? (
                  <p className="mt-2 text-xs text-warn">
                    {t('supportRedacted', { count: message.redactedCount })}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>

        {thread.closed ? (
          <p className="rounded-lg border border-line bg-card p-4 text-sm text-muted">
            {t('supportClosedNote')}
          </p>
        ) : (
          <section className="rounded-card border border-line bg-card p-5">
            <SupportForm
              locale={locale}
              reference={thread.reference}
              labels={{
                field: t('supportReplyLabel'),
                hint: t('supportBodyHint'),
                submit: t('supportReplySubmit'),
                submitting: t('supportSubmitting'),
                failed: t('supportFailed'),
              }}
            />

            {/* Ending the request sits under the reply, not beside it: the common action leads. */}
            <div className="mt-5 border-t border-line pt-5">
              <SupportClose
                locale={locale}
                reference={thread.reference}
                labels={{
                  submit: t('supportCloseLabel'),
                  submitting: t('supportCloseSubmitting'),
                  hint: t('supportCloseHint'),
                  failed: t('supportCloseFailed'),
                }}
              />
            </div>
          </section>
        )}
      </div>
    </AccountShell>
  );
}
