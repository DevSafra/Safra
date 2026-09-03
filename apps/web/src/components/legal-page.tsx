import Link from 'next/link';

import type { Locale } from '@/i18n/routing';

/**
 * The shell both legal pages share: a heading, a date, sections, and the notice about what is
 * still outstanding.
 *
 * ## Why the two pages share a component rather than each rendering its own prose
 *
 * They differ only in their sections. Two hand-built pages would drift in the ways that matter
 * least and cost most to notice — one gaining a "last updated" line the other lacks, one wrapping
 * its measure and the other not — and a legal page that looks unmaintained is read as one that is.
 *
 * ## The pending notice is deliberately at the TOP, and deliberately specific
 *
 * `docs/FUTURE-WORK.md` records these pages as needing legal copy that is not an engineer's to
 * write: the registered entity, the privacy contact, the supervisory authority, the governing law.
 * Everything else here is derived from what the platform actually does and is accurate.
 *
 * Saying so plainly is the project's existing pattern — the console dims a control it cannot honour
 * rather than pretending, and `AccountNotBuilt` names what is missing. A legal page carrying
 * confident boilerplate around blanks would be the opposite: it would read as finished, and the
 * first person to discover otherwise would be somebody relying on it.
 *
 * It doubles as the checklist for whoever completes them.
 */
export function LegalPage({
  locale,
  title,
  intro,
  updated,
  pending,
  sections,
  backLabel,
}: {
  readonly locale: Locale;
  readonly title: string;
  readonly intro: string;
  readonly updated: string;
  readonly pending: { readonly title: string; readonly body: string };
  readonly sections: readonly { readonly heading: string; readonly body: string }[];
  readonly backLabel: string;
}) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 [&_p]:max-w-[57ch]">
      {/*
        `57ch` on the PROSE, not a wider container. Measured at 105 characters a line, against the
        65–75 a reader can track without losing their place returning to the start of the next one —
        and legal text is the one surface nobody reads out of enthusiasm, so the measure is doing all
        the work. The heading and the meta line stay full width; only the running text is capped,
        which is why the cap is a descendant selector rather than a width on the article.

        57 and not 65, because `ch` is the advance of «0» and that is wider than average lowercase:
        the same cap renders about 65 Arabic characters and about 85 Latin ones. 57ch lands both
        scripts inside the range instead of only the one the value was chosen against — measured on
        `/ar/terms` and `/en/terms`, not assumed from the unit.
      */}
      <h1 className="font-display text-3xl font-bold text-gold">{title}</h1>
      <p className="mt-2 text-xs text-faint">{updated}</p>

      <p className="mt-5 text-base leading-relaxed text-muted">{intro}</p>

      <aside
        /*
          `role="note"` rather than `alert`: it is standing context about the page, not something
          that just happened. An alert would be announced on every visit and interrupt a screen
          reader working down the document.
        */
        role="note"
        className="mt-6 rounded-card border border-warn/40 bg-warn/10 p-4"
      >
        <h2 className="text-sm font-bold text-warn">{pending.title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-text2">{pending.body}</p>
      </aside>

      <div className="mt-8 grid gap-7">
        {sections.map((section) => (
          <section key={section.heading}>
            <h2 className="font-display text-lg font-bold text-text">
              {section.heading}
            </h2>
            {/*
              `whitespace-pre-line` so a catalogue string can carry paragraphs as `\\n\\n`.

              The alternative was an array per section, which no other namespace uses and which
              `t()` cannot type-check — a legal page is the last place to introduce a shape where a
              missing entry fails silently.
            */}
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted">
              {section.body}
            </p>
          </section>
        ))}
      </div>

      <Link
        href={`/${locale}`}
        className="mt-10 inline-flex min-h-10 items-center text-sm text-gold hover:underline lg:min-h-0"
      >
        {backLabel}
      </Link>
    </article>
  );
}
