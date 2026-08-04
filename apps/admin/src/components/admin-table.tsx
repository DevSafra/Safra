import type { ReactNode } from 'react';

/**
 * The console's table, built to the design handoff's admin-table spec (§8).
 *
 * ## Why a `<table>` when the handoff draws a CSS grid
 *
 * The prototype renders every admin table as `display: grid` with `display: contents` row
 * wrappers. That is a DELIBERATE deviation here, recorded in `docs/design-gap-report.md` §6:
 * `display: contents` removes the row element from the accessibility tree, so a screen reader
 * loses the row/column relationships entirely and reads twelve columns of a seven-column
 * table as one flat run of text. Handoff §3 says to use the codebase's own primitives
 * restyled to its tokens rather than introduce a parallel component set, which is exactly
 * this.
 *
 * The metrics are the handoff's, literally: header cells 11px/700 `--faint` with a
 * `1px solid var(--line)` bottom, body cells 10px padding with `1px solid var(--line2)`,
 * 12.5px body text.
 *
 * ## Column widths
 *
 * `template` takes the design's own `grid-template-columns` string — e.g.
 * `'1.1fr 1.3fr 1fr 1fr .7fr 1fr .8fr'` — copied verbatim from the prototype and converted
 * to `<col>` percentages. Keeping the design's string in the page source means a fidelity
 * review can compare it against the handoff without re-deriving anything.
 */
export interface AdminColumn<T> {
  /** Stable key, used for React keys and the CSV header. */
  readonly key: string;
  /** Arabic column heading, verbatim from the handoff. */
  readonly header: string;
  readonly render: (row: T) => ReactNode;
  readonly align?: 'start' | 'center';
}

/**
 * Splits the design's `grid-template-columns` into `<col>` percentages.
 *
 * Only `fr` units appear in the handoff's admin tables. A malformed entry falls back to 1fr
 * rather than throwing — a mistyped width should not blank the screen.
 */
function widths(template: string): readonly number[] {
  const parts = template.trim().split(/\s+/);
  const fractions = parts.map((part) => {
    const value = Number.parseFloat(part);

    return Number.isFinite(value) && value > 0 ? value : 1;
  });
  const total = fractions.reduce((sum, value) => sum + value, 0);

  return fractions.map((value) => (value / total) * 100);
}

export function AdminTable<T>({
  columns,
  rows,
  template,
  rowKey,
  minWidth = 640,
  empty,
}: {
  readonly columns: readonly AdminColumn<T>[];
  readonly rows: readonly T[];
  /** The design's `grid-template-columns` value, verbatim. */
  readonly template: string;
  readonly rowKey: (row: T) => string;
  /** Below this the table scrolls inside its own box rather than squashing. */
  readonly minWidth?: number;
  readonly empty: string;
}) {
  if (rows.length === 0) {
    return <p className="py-2 text-[12.5px] text-faint">{empty}</p>;
  }

  const cols = widths(template);

  return (
    /*
      The table scrolls inside this box, never the page body. A console table has eight
      columns of Arabic text and cannot narrow indefinitely; letting the document scroll
      sideways would move the sidebar off screen too.
    */
    <div className="overflow-x-auto">
      <table
        className="w-full table-fixed border-collapse text-[12.5px]"
        style={{ minWidth: `${minWidth}px` }}
      >
        <colgroup>
          {cols.map((width, index) => (
            <col key={columns[index]?.key ?? index} style={{ width: `${width}%` }} />
          ))}
        </colgroup>

        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`border-b border-line px-2.5 py-2 text-[11px] font-bold text-faint ${
                  column.align === 'center' ? 'text-center' : 'text-start'
                }`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`border-b border-line2 p-2.5 align-middle ${
                    column.align === 'center' ? 'text-center' : 'text-start'
                  }`}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A status pill: coloured outline, transparent fill, 99px radius.
 *
 * The handoff uses `color: X; border: 1px solid X` with no background — the colour carries
 * the meaning and the outline keeps it legible against `--card` and `--field` alike.
 */
const TONES = {
  ok: 'text-ok border-ok',
  warn: 'text-warn border-warn',
  bad: 'text-bad border-bad',
  sky: 'text-sky border-sky',
  /** Pending confirmation. Purple, never gold — handoff §1 and §14. */
  pend: 'text-pend border-pend',
  gold: 'text-gold border-gold',
  faint: 'text-faint border-faint',
} as const;

export type Tone = keyof typeof TONES;

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10.5px] font-bold ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Coloured text without the pill, for the design's النوع and الدور columns. */
export function ToneText({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`text-[11.5px] font-bold ${TONES[tone].split(' ')[0]}`}>
      {children}
    </span>
  );
}

/**
 * A Latin run inside an RTL line — a reference, an email, an amount, a timestamp.
 *
 * `dir="ltr"` with `text-align: right` is the handoff's own rule (§4.1): without it a
 * bidirectional algorithm can reorder `BKG-2026-000431` or move a leading `$` to the wrong
 * end of the number.
 */
export function Ltr({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span dir="ltr" className={`inline-block text-end ${className}`}>
      {children}
    </span>
  );
}

/**
 * The footnote every admin section closes with.
 *
 * These are not decoration: each one states a business rule the operator has to know — that
 * a partner is never hard-deleted (P-003), that a ledger row is immutable, that opening a
 * dispute freezes a payout. The handoff spells each one out and they are quoted verbatim.
 */
export function FootNote({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[11px] leading-relaxed text-faint">{children}</p>;
}
