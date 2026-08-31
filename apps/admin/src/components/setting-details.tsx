'use client';

import { useEffect, useState } from 'react';

import type { EditableSetting } from '@/lib/api';
import { Ltr } from '@/components/admin-table';
import { shortDate } from '@/lib/format';
import { fill, t } from '@/lib/strings';
import {
  historyChange,
  settingHistorySchema,
  valueTypeName,
  type SettingHistoryEntry,
} from '@/lib/settings-display';

/**
 * One setting's technical drawer: its key, its type, and every change ever made to it.
 *
 * ## What it is for
 *
 * Two things that were both wrong before it existed.
 *
 * **The key was in the reading flow.** `commission.partner_rate` sat under every label in Latin
 * monospace — eighteen of them down an Arabic page. `docs/i18n.md` lists a setting key under «what
 * is NOT copy», because a machine reads it; that is exactly the argument for keeping it out of a
 * sentence a person reads. It is still needed — an audit entry, a runbook and a migration all name
 * the key — so it moved somewhere a person opens on purpose (Bashar, 2026-08-31).
 *
 * **`settings_history` could not be read anywhere.** The table is written inside the same
 * transaction as every setting change and its own docblock says why: "The history table exists to
 * answer 'what was the commission in March?', and a booking's snapshot is only explicable
 * alongside it." Until now that question needed `psql`.
 *
 * ## Fetched when opened, not with the page
 *
 * Eighteen rows means eighteen history queries, and nobody reads eighteen change logs. So the
 * fetch happens on the first open and the result is kept — reopening the same drawer costs
 * nothing, and a page load costs nothing extra at all.
 */
export function SettingDetails({
  setting,
  alwaysUsd,
}: {
  setting: EditableSetting;
  alwaysUsd: boolean;
}) {
  const [state, setState] = useState<
    | { readonly status: 'loading' }
    | { readonly status: 'failed' }
    | { readonly status: 'ready'; readonly entries: SettingHistoryEntry[] }
  >({ status: 'loading' });

  useEffect(() => {
    let live = true;

    async function read() {
      try {
        const response = await fetch(
          `/api/settings/${encodeURIComponent(setting.key)}/history`,
        );

        if (!response.ok) throw new Error('history unavailable');

        const body: unknown = await response.json();
        /*
          Parsed, not cast. The two values in an entry are `unknown` by design — they are whatever
          that setting's own schema says — so nothing downstream would notice a payload that had
          lost its shape, and the failure would surface as «[object Object]» in a change log.
        */
        const parsed = settingHistorySchema.parse(body);

        if (live) setState({ status: 'ready', entries: parsed.history });
      } catch {
        if (live) setState({ status: 'failed' });
      }
    }

    void read();

    return () => {
      live = false;
    };
  }, [setting.key]);

  return (
    <div className="mt-3 rounded-[11px] border border-line bg-field p-3.5">
      <dl className="grid gap-2 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-[10.5px] text-faint2">
            {t.sections.settings.technicalKey}
          </dt>
          {/* The key is a Latin identifier on an Arabic line, so it is isolated. */}
          <dd className="mt-0.5">
            <Ltr className="font-mono text-[11.5px] break-all text-text2">
              {setting.key}
            </Ltr>
          </dd>
        </div>

        <div className="min-w-0">
          <dt className="text-[10.5px] text-faint2">{t.sections.settings.valueType}</dt>
          <dd className="mt-0.5 text-[11.5px] text-text2">
            {valueTypeName(setting.valueSchema)}
          </dd>
        </div>
      </dl>

      <h4 className="mt-3.5 text-[11.5px] font-bold text-gold">
        {t.sections.settings.historyTitle}
      </h4>

      {state.status === 'loading' ? (
        <p className="mt-1.5 text-[11px] text-faint">
          {t.sections.settings.historyLoading}
        </p>
      ) : null}

      {state.status === 'failed' ? (
        <p role="alert" className="mt-1.5 text-[11px] text-bad">
          {t.sections.settings.historyFailed}
        </p>
      ) : null}

      {state.status === 'ready' && state.entries.length === 0 ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
          {t.sections.settings.historyEmpty}
        </p>
      ) : null}

      {/*
        The log scrolls in its OWN box rather than growing the page.

        Nothing is truncated: a setting somebody changes weekly has fifty entries by the API's own
        limit, and a drawer that adds fifty rows to the page pushes every setting below it off the
        screen. Hiding the older ones behind a «show more» would be worse — the question the log
        answers is «what was it in March», which is the oldest end of it.
      */}
      {state.status === 'ready' && state.entries.length > 0 ? (
        <ol className="mt-2 grid max-h-72 gap-2.5 overflow-y-auto pe-1">
          {state.entries.map((entry) => (
            <li
              key={`${entry.createdAt}-${entry.changedByEmail ?? ''}`}
              className="border-t border-line2 pt-2 first:border-t-0 first:pt-0"
            >
              {/*
                «من X إلى Y», both values formatted the way the ROW formats them — with their unit
                and their currency. A change log that reads «من 10 إلى 12» about a fine is the same
                defect as a bare amount on the row above it.
              */}
              <p className="text-[12px] leading-snug font-semibold text-text">
                {historyChange(entry, setting, alwaysUsd)}
              </p>

              <p className="mt-0.5 text-[10.5px] text-faint">
                {fill(t.sections.settings.historyBy, {
                  who: entry.changedByEmail ?? t.sections.settings.historySystem,
                  when: shortDate(entry.createdAt),
                })}
              </p>

              <p className="mt-0.5 text-[10.5px] leading-relaxed text-faint2">
                {entry.reason
                  ? fill(t.sections.settings.historyReason, { reason: entry.reason })
                  : t.sections.settings.historyNoReason}
              </p>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
