import { getNotifications, type NotificationItem, type Notifications } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { count, shortDateTime } from '@/lib/format';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { TablePagination } from '@/components/table-pagination';
import {
  AdminTable,
  FootNote,
  Ltr,
  StatusPill,
  ToneText,
  type AdminColumn,
} from '@/components/admin-table';
import { TableToolbar } from '@/components/table-toolbar';
import { fill, label, t, plural } from '@/lib/strings';
import { statusTone } from '@/lib/status-tone';
import { listParamsFor } from '@/lib/table-size';

/**
 * واتساب والبريد — the delivery log (design handoff §8).
 *
 * Template chips above, delivery log below, as the design lays it out.
 *
 * ## The template inventory comes from CODE
 *
 * A template that exists but has never been sent must still appear, which a query over the log
 * cannot do. So the catalogue is a constant in the API and the log is data — and the chips show
 * which templates are actually wired, because the ad template is deliberately inert until the
 * one-message-maximum rule can be enforced.
 *
 * ## No recipient address anywhere
 *
 * The obvious column is "who did it go to". It is absent: rule 1 forbids full PII in logs, every
 * support agent reads this screen, and the recipient is already on the record the reference points
 * at. The linked booking is what an operator needs to act.
 */
export const dynamic = 'force-dynamic';

/** The design's `grid-template-columns`, verbatim. */
const TEMPLATE = '.8fr 1.4fr 1.1fr .9fr .9fr';

export default async function CommsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { q, page, size } = await listParamsFor('comms', searchParams);
  const params = await searchParams;
  const rawStatus = params['status'];
  const status =
    (Array.isArray(rawStatus) ? rawStatus[0] : rawStatus)?.trim() || undefined;

  const [result, counts] = await Promise.all([
    getNotifications({ q, status, page, limit: size }),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell title={t.nav.whatsapp} counts={counts}>
      {result === 'unauthenticated' ? (
        <ConsolePanel>
          <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
        </ConsolePanel>
      ) : result === 'failed' ? (
        <ConsolePanel>
          <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
        </ConsolePanel>
      ) : (
        <div className="grid gap-4">
          <Templates templates={result.templates} />

          <ConsolePanel>
            <TableToolbar
              action="/comms"
              query={q}
              size={size}
              placeholder={t.sections.comms.searchPlaceholder}
              end={<Summary counters={result.counters} />}
            >
              <select
                name="status"
                defaultValue={status ?? ''}
                aria-label={t.table.colStatus}
                className="cursor-pointer rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] text-text"
              >
                <option value="">{t.sections.bookings.allStatuses}</option>
                {(['queued', 'sent', 'delivered', 'failed'] as const).map((value) => (
                  <option key={value} value={value}>
                    {label(t.enums.notificationStatus, value)}
                  </option>
                ))}
              </select>
            </TableToolbar>

            <AdminTable
              columns={COLUMNS}
              rows={result.items}
              template={TEMPLATE}
              rowKey={(row) => `${row.at}-${row.templateKey}-${row.channel}`}
              minWidth={780}
              empty={t.table.empty}
            />
            <TablePagination
              basePath="/comms"
              section="comms"
              query={{ q, status }}
              page={result.page}
              pages={result.pages}
              total={result.total}
              capped={result.capped}
              size={size}
            />

            <FootNote>{t.sections.comms.note}</FootNote>
            <FootNote>{t.sections.comms.whatsappBlocked}</FootNote>
          </ConsolePanel>
        </div>
      )}
    </ConsoleShell>
  );
}

function Templates({ templates }: { templates: Notifications['templates'] }) {
  return (
    <ConsolePanel>
      <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
        <h2 className="text-[14px] font-extrabold text-gold">
          {t.sections.comms.templates}
        </h2>
        <span className="ms-auto text-[11px] text-faint">
          {t.sections.comms.templatesLocales}
        </span>
      </div>

      <ul className="flex flex-wrap gap-2">
        {templates.map((template) => (
          <li key={template.key}>
            {/*
              An unwired template is dimmed and labelled, not hidden. The ad template is the live
              case: §8 allows exactly one non-intrusive WhatsApp advertisement, and until that
              limit can be enforced the template stays inert — which staff need to know.
            */}
            <span
              title={template.channels.join(' · ')}
              className={`inline-block rounded-full border px-3.5 py-1.5 text-xs ${
                template.implemented
                  ? 'border-line bg-field text-text2'
                  : 'border-dashed border-line text-faint2'
              }`}
            >
              {label(t.notificationTemplate, template.key)}
              {template.implemented ? null : (
                <span className="ms-1.5 text-[10px]">({t.sections.comms.notWired})</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </ConsolePanel>
  );
}

/** Sent and failed per channel over the window, so a systematic failure is visible. */
function Summary({ counters }: { counters: Notifications['counters'] }) {
  const entries = Object.entries(counters.byChannel);

  if (entries.length === 0) return null;

  return (
    <span className="text-[11px] text-faint">
      {fill(t.sections.comms.window, { days: count(counters.windowDays) })}
      {entries.map(([channel, statuses]) => {
        const failed = statuses['failed'] ?? 0;
        const delivered = (statuses['delivered'] ?? 0) + (statuses['sent'] ?? 0);

        return (
          <span key={channel} className="ms-2.5">
            {channelLabel(channel)} <span className="text-ok">{count(delivered)}</span>
            {failed > 0 ? <span className="text-bad"> / {count(failed)}</span> : null}
          </span>
        );
      })}
    </span>
  );
}

const COLUMNS: readonly AdminColumn<NotificationItem>[] = [
  {
    key: 'channel',
    header: t.sections.comms.colChannel,
    render: (row) => (
      <ToneText tone={row.channel === 'whatsapp' ? 'ok' : 'sky'}>
        {channelLabel(row.channel)}
      </ToneText>
    ),
  },
  {
    key: 'template',
    header: t.sections.comms.colTemplate,
    render: (row) => (
      <span className="text-text">
        {row.templateKey}
        <span className="ms-1.5 text-[10px] text-faint">({row.locale})</span>
      </span>
    ),
  },
  {
    key: 'linked',
    header: t.sections.payments.colLinked,
    render: (row) => (
      <Ltr className="text-sky">{row.subjectReference ?? t.admin.noData}</Ltr>
    ),
  },
  {
    key: 'at',
    header: t.table.colTime,
    render: (row) => <Ltr className="text-muted">{shortDateTime(row.at)}</Ltr>,
  },
  {
    key: 'status',
    header: t.table.colStatus,
    render: (row) => (
      <div className="grid gap-1">
        <StatusPill tone={statusTone(row.status)}>
          {label(t.enums.notificationStatus, row.status)}
        </StatusPill>
        {/*
          The failure reason and the attempt count, because a retry that hid the previous error
          would hide the pattern: one template failing for every German recipient is a bug.
        */}
        {row.status === 'failed' ? (
          <span className="text-[10px] leading-tight text-faint">
            {plural(t.sections.comms.attempts, { n: row.attempts })}
            {row.failureReason ? ` · ${row.failureReason}` : ''}
          </span>
        ) : null}
      </div>
    ),
  },
];

function channelLabel(channel: string): string {
  switch (channel) {
    case 'whatsapp':
      return t.sections.comms.channelWhatsapp;
    case 'email':
      return t.sections.comms.channelEmail;
    default:
      return t.sections.comms.channelInApp;
  }
}
