import { getNotifications, type NotificationItem, type Notifications } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { count, shortDateTime } from '@/lib/format';
import { ConsolePanel, ConsoleShell, Pager } from '@/components/console-shell';
import {
  AdminTable,
  FootNote,
  Ltr,
  StatusPill,
  ToneText,
  type AdminColumn,
  type Tone,
} from '@/components/admin-table';
import { TableToolbar } from '@/components/table-toolbar';
import { AR, label } from '@/lib/strings';
import { listParams } from '@/lib/search-params';

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
  const { q, cursor } = await listParams(searchParams);
  const params = await searchParams;
  const rawStatus = params['status'];
  const status =
    (Array.isArray(rawStatus) ? rawStatus[0] : rawStatus)?.trim() || undefined;

  const [result, counts] = await Promise.all([
    getNotifications({ q, cursor, status }),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell title={AR.nav.whatsapp} counts={counts}>
      {result === 'unauthenticated' ? (
        <ConsolePanel>
          <p className="text-[12.5px] text-muted">{AR.dashboard.sessionExpired}</p>
        </ConsolePanel>
      ) : result === 'failed' ? (
        <ConsolePanel>
          <p className="text-[12.5px] text-bad">{AR.dashboard.queueFailed}</p>
        </ConsolePanel>
      ) : (
        <div className="grid gap-4">
          <Templates templates={result.templates} />

          <ConsolePanel>
            <TableToolbar
              action="/comms"
              query={q}
              placeholder={AR.sections.comms.searchPlaceholder}
              end={<Summary counters={result.counters} />}
            >
              <select
                name="status"
                defaultValue={status ?? ''}
                aria-label={AR.table.colStatus}
                className="cursor-pointer rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] text-text"
              >
                <option value="">{AR.sections.bookings.allStatuses}</option>
                {(['queued', 'sent', 'delivered', 'failed'] as const).map((value) => (
                  <option key={value} value={value}>
                    {label(AR.enums.notificationStatus, value)}
                  </option>
                ))}
              </select>
            </TableToolbar>

            <AdminTable
              columns={COLUMNS}
              rows={result.items}
              template={TEMPLATE}
              rowKey={(row) => `${row.at}-${row.templateKey}-${row.channel}`}
              minWidth={680}
              empty={AR.table.empty}
            />
            <Pager
              basePath="/comms"
              query={{ q, status }}
              nextCursor={result.nextCursor}
            />

            <FootNote>{AR.sections.comms.note}</FootNote>
            <FootNote>{AR.sections.comms.whatsappBlocked}</FootNote>
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
          {AR.sections.comms.templates}
        </h2>
        <span className="ms-auto text-[11px] text-faint">
          {AR.sections.comms.templatesLocales}
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
              {template.nameAr}
              {template.implemented ? null : (
                <span className="ms-1.5 text-[10px]">({AR.sections.comms.notWired})</span>
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
      {AR.sections.comms.window(count(counters.windowDays))}
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
    header: AR.sections.comms.colChannel,
    render: (row) => (
      <ToneText tone={row.channel === 'whatsapp' ? 'ok' : 'sky'}>
        {channelLabel(row.channel)}
      </ToneText>
    ),
  },
  {
    key: 'template',
    header: AR.sections.comms.colTemplate,
    render: (row) => (
      <span className="text-text">
        {row.templateKey}
        <span className="ms-1.5 text-[10px] text-faint">({row.locale})</span>
      </span>
    ),
  },
  {
    key: 'linked',
    header: AR.sections.payments.colLinked,
    render: (row) => (
      <Ltr className="text-sky">{row.subjectReference ?? AR.admin.noData}</Ltr>
    ),
  },
  {
    key: 'at',
    header: AR.table.colTime,
    render: (row) => <Ltr className="text-muted">{shortDateTime(row.at)}</Ltr>,
  },
  {
    key: 'status',
    header: AR.table.colStatus,
    render: (row) => (
      <div className="grid gap-1">
        <StatusPill tone={statusTone(row.status)}>
          {label(AR.enums.notificationStatus, row.status)}
        </StatusPill>
        {/*
          The failure reason and the attempt count, because a retry that hid the previous error
          would hide the pattern: one template failing for every German recipient is a bug.
        */}
        {row.status === 'failed' ? (
          <span className="text-[10px] leading-tight text-faint">
            {AR.sections.comms.attempts(count(row.attempts))}
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
      return AR.sections.comms.channelWhatsapp;
    case 'email':
      return AR.sections.comms.channelEmail;
    default:
      return AR.sections.comms.channelInApp;
  }
}

function statusTone(status: string): Tone {
  switch (status) {
    case 'delivered':
      return 'ok';
    case 'sent':
      return 'sky';
    case 'failed':
      return 'bad';
    default:
      return 'warn';
  }
}
