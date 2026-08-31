'use client';

import { useMemo, useState } from 'react';

import { useConfirm } from '@safra/ui';

import type { EditableSetting } from '@/lib/api';
import { ConsolePanel } from '@/components/console-panel';
import { SettingRow } from '@/components/setting-row';
import { isEditableSchema, matchesFilter } from '@/lib/settings-display';
import { fill, plural, t } from '@/lib/strings';

/** One group of settings, as the page sorted them. `id` is routing; `title` and `note` are copy. */
export interface SettingsGroup {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  readonly settings: EditableSetting[];
}

/**
 * الإعدادات, as a searchable board (§9.3, P-005).
 *
 * ## Why the whole board is a client component
 *
 * The filter has to reach across groups: `search.max_nights` sits in «إعدادات أخرى» and
 * `booking.same_day_cutoff_hour` in «قواعد الحجز», five hundred pixels apart, and «ابحث» that only
 * searched one card would be worse than none. So the grouping is still decided on the server —
 * it is routing, and the copy that names each group lives in the catalogue — and the rendering of
 * it happens here.
 *
 * Everything on this screen is already interactive: seventeen rows that each save themselves. There
 * is no server-rendered content being given up.
 *
 * ## One dialog, not seventeen
 *
 * `useConfirm` lives here and its `ask` is passed down. A hook per row would mount a dialog per
 * row, and two open at once is a state the component cannot represent.
 */
export function SettingsBoard({
  groups,
  alwaysUsd,
}: {
  groups: SettingsGroup[];
  /** `money.always_usd`, read once by the page so every money row explains itself the same way. */
  alwaysUsd: boolean;
}) {
  const [query, setQuery] = useState('');
  const { ask, dialog } = useConfirm();

  const all = useMemo(() => groups.flatMap((group) => group.settings), [groups]);

  const shown = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          settings: group.settings.filter((setting) => matchesFilter(setting, query)),
        }))
        .filter((group) => group.settings.length > 0),
    [groups, query],
  );

  const shownCount = shown.reduce((total, group) => total + group.settings.length, 0);
  const editable = all.filter((setting) => isEditableSchema(setting.valueSchema)).length;

  return (
    <div className="grid gap-4">
      <ConsolePanel>
        <h2 className="text-[14.5px] font-extrabold text-gold">
          {t.sections.settings.title}
        </h2>
        <p className="mt-1.5 max-w-[80ch] text-[11.5px] leading-relaxed text-text2">
          {t.sections.settings.hint}
        </p>

        {/*
          The audit warning is a CALLOUT, not a footnote.

          It was the smallest, faintest line on the screen while being the one fact that changes
          how carefully somebody presses a button: every change here is recorded against their
          name. It is also repeated inside the editor, where the decision is actually taken.
        */}
        <p className="mt-3 rounded-[9px] border border-[rgba(var(--warnA),0.3)] bg-[rgba(var(--warnA),0.07)] px-3 py-2 text-[11px] leading-relaxed text-warn">
          {t.sections.settings.auditNote}
        </p>

        <div className="mt-3.5 flex flex-wrap items-end gap-3">
          {/*
            Capped, not `flex-1`.

            A search box the width of a 1380px console reads as the page's main input rather than
            as a way to narrow a list, and a field far wider than anything anybody types into it
            invites a sentence.
          */}
          <label className="grid w-full max-w-[24rem] gap-1">
            <span className="text-[10.5px] text-faint2">
              {t.sections.settings.filterLabel}
            </span>
            <div className="flex gap-2">
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t.sections.settings.filterPlaceholder}
                /* No `dir`: a field a person types into follows the page (docs/i18n.md §9). */
                className="min-w-0 flex-1 rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] text-text"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="shrink-0 cursor-pointer rounded-[9px] border border-line px-3 text-[11px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.5)] hover:text-gold"
                >
                  {t.sections.settings.filterClear}
                </button>
              ) : null}
            </div>
          </label>

          <p className="text-[11px] text-faint">
            {query
              ? fill(t.sections.settings.countShown, {
                  shown: shownCount,
                  total: all.length,
                })
              : plural(t.sections.settings.counts, {
                  total: all.length,
                  editable,
                  readOnly: all.length - editable,
                })}
          </p>
        </div>
      </ConsolePanel>

      {shown.map((group) => (
        <ConsolePanel key={group.id} title={group.title}>
          <p className="mb-2 text-[11.5px] leading-relaxed text-faint">{group.note}</p>

          <div>
            {group.settings.map((setting) => (
              <SettingRow
                key={setting.key}
                setting={setting}
                alwaysUsd={alwaysUsd}
                ask={ask}
              />
            ))}
          </div>
        </ConsolePanel>
      ))}

      {/*
        A filter that matches nothing says so, with the term it searched for.

        An empty screen under a filled search box reads as a broken page; naming the term is what
        tells the reader it was their spelling and not the console.
      */}
      {shownCount === 0 ? (
        <ConsolePanel>
          <p className="text-[12.5px] text-muted">
            {fill(t.sections.settings.noMatch, { query })}
          </p>
        </ConsolePanel>
      ) : null}

      {dialog}
    </div>
  );
}
