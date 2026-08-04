import { getEmergency, type EmergencyMode } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { shortDateTime } from '@/lib/format';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { Ltr, StatusPill } from '@/components/admin-table';
import { DeactivateButton, EmergencyForm } from '@/components/emergency-form';
import { AR } from '@/lib/strings';

/**
 * Emergency Mode (EC-009) — the 19th admin section (design handoff §8.3).
 *
 * Reached from the dashboard header button, as the prototype's `openEmergency` does. Not in the
 * sidebar, matching the design's own eighteen-row nav.
 *
 * The active-declaration banner is rendered here rather than console-wide. That is a deliberate
 * narrowing of the design, which shows it above every admin section: a banner on all nineteen
 * screens costs a request for active declarations on every page load, and the state is already
 * visible where it is acted on. Recorded in the gap report.
 */
export const dynamic = 'force-dynamic';

export default async function EmergencyPage() {
  const [result, counts] = await Promise.all([getEmergency(), sidebarCounts()]);

  return (
    <ConsoleShell title={AR.admin.emergencyMode} counts={counts}>
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
          {result.active.map((mode) => (
            <ActiveBanner key={mode.id} mode={mode} />
          ))}

          <EmergencyForm scopes={result.scopes} />

          <ConsolePanel title={AR.sections.emergency.history}>
            {result.history.length === 0 ? (
              <p className="text-[12.5px] text-faint">{AR.sections.emergency.never}</p>
            ) : (
              <ul className="grid gap-2.5">
                {result.history.map((mode) => (
                  <li
                    key={mode.id}
                    className="rounded-[10px] border border-line bg-field px-3.5 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-[12.5px] font-bold text-text">
                        {mode.scopeName}
                      </span>
                      <StatusPill tone={mode.deactivatedAt === null ? 'bad' : 'faint'}>
                        {mode.deactivatedAt === null ? 'مفعّل' : 'منتهٍ'}
                      </StatusPill>
                      <Ltr className="ms-auto text-[10.5px] text-faint">
                        {shortDateTime(mode.activatedAt)}
                        {mode.deactivatedAt
                          ? ` ← ${shortDateTime(mode.deactivatedAt)}`
                          : ''}
                      </Ltr>
                    </div>

                    <p className="mt-1.5 text-[11.5px] text-text2">{flagSummary(mode)}</p>

                    {/*
                      The reason is shown, always. It is the entire point of requiring one, and a
                      history that recorded the reason but never displayed it would make the
                      requirement theatre.
                    */}
                    {mode.reason ? (
                      <p className="mt-1 text-[11px] leading-relaxed text-muted">
                        {mode.reason}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </ConsolePanel>
        </div>
      )}
    </ConsoleShell>
  );
}

function ActiveBanner({ mode }: { mode: EmergencyMode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-bad bg-[rgba(var(--badA),0.12)] px-4 py-3">
      <span className="text-[13px] font-extrabold text-bad">
        {AR.sections.emergency.activeBanner(mode.scopeName)}
      </span>
      <span className="text-xs text-text2">{flagSummary(mode)}</span>
      <DeactivateButton id={mode.id} scopeName={mode.scopeName} />
    </div>
  );
}

/** Which levers are pulled, in one line — the design's own banner phrasing. */
function flagSummary(mode: EmergencyMode): string {
  const parts: string[] = [
    mode.flags.stopBookings ? AR.sections.emergency.stopBookings : null,
    mode.flags.waiveFines ? AR.sections.emergency.waiveFines : null,
    mode.flags.broadcast ? AR.sections.emergency.broadcast : null,
    mode.flags.suspendSla ? AR.sections.emergency.suspendSla : null,
  ].filter((part) => part !== null);

  return parts.length > 0 ? `${parts.join(' · ')} (EC-009)` : '(EC-009)';
}
