import { DEFAULT_LOCALE, type Locale } from './locales.js';
import { ar } from './messages/content/ar.js';
import { de } from './messages/content/de.js';
import { en } from './messages/content/en.js';
import type { Translated } from './shape.js';

/**
 * What a reader sees where a message had contact details removed.
 *
 * ## This used to be baked into the row, and that was the bug
 *
 * Redaction happens on the way INTO the database — a phone number is replaced before the message
 * is stored, and the original is discarded on purpose. So the replacement was written in
 * `DEFAULT_LOCALE`, one stored string for three possible readers, and a German customer opening a
 * thread a Syrian partner had written read `⟨محجوب⟩`. That is the exact failure the project's
 * i18n rule exists to prevent, and it was recorded as `O-i18n-2` rather than fixed, because
 * fixing it needs the stored text and the rendered text to stop being the same thing.
 *
 * ## So they are now two different things
 *
 * `REDACTION_TOKEN` goes into the row. It carries no language. `redactionMask` is the word the
 * reader sees, resolved against THEIR locale by `renderRedactions` at the point of display — the
 * same shape as an error code travelling to the client and being resolved by `errorMessage`.
 *
 * The three masks were already written here in 2026-08-07, precisely so this day would be a
 * rendering change rather than also a translation one. It was.
 */
export type ContentMessages = Translated<typeof ar>;

const CATALOGUES: Record<Locale, ContentMessages> = { ar, en, de };

/**
 * The mask, in one language.
 *
 * Still defaults to `DEFAULT_LOCALE`, for the callers that genuinely have no reader — a console
 * that is Arabic-only passes `'ar'` explicitly, and the customer app passes the route's locale.
 */
export function contentMessages(locale: Locale = DEFAULT_LOCALE): ContentMessages {
  return CATALOGUES[locale];
}

/**
 * What stands in the stored text where something was removed.
 *
 * ## Why these characters
 *
 * `⟦` and `⟧` (U+27E6/U+27E7) around an ellipsis: no letters, no digits, no `@`, no dot followed
 * by a word. That is not decoration — it is what makes redaction IDEMPOTENT. A stored body is run
 * through the redactor again whenever it is edited or re-checked, and a token that matched one of
 * those patterns would be redacted into a token containing a token, forever.
 *
 * ## And why it is not a word
 *
 * It is the fallback rendering as well as the token. If a display path is ever added that forgets
 * to call `renderRedactions`, the reader sees `⟦…⟧` — which says "something is missing here" in
 * Arabic, German and English alike, because it says it in no language at all. A token reading
 * `[REDACTED]` would fail that same test by being English at the one moment it is on screen.
 */
export const REDACTION_TOKEN = '⟦…⟧';

/**
 * The masks written into message bodies before 2026-08-14, when the token replaced them.
 *
 * Deliberately FROZEN LITERALS rather than read from the catalogues above. They are not copy any
 * more — they are historical data, and the whole point of the change is that the catalogue entries
 * are free to be reworded. Deriving this list from them would mean a translator improving the
 * Arabic wording silently stopped older threads from rendering.
 *
 * `messages` is append-only — `deny_mutation` raises on UPDATE — so these rows cannot be migrated
 * to the token, and there is no version of this fix in which the list goes away. That is the right
 * outcome and not merely the available one: those bodies are evidence in a dispute, and rewriting
 * them to render more nicely is exactly what the append-only guarantee is there to refuse.
 */
const LEGACY_MASKS: readonly string[] = ['⟨محجوب⟩', '⟨redacted⟩', '⟨entfernt⟩'];

/**
 * Everything a stored body might carry where a contact detail was removed.
 *
 * Exported because the count of removed spans is DERIVED FROM THE TEXT in one place — the disputes
 * query recomputes it rather than storing a counter that could drift from what the reader sees —
 * and that SQL has to know every marker it might meet. It bound `'⟨محجوب⟩'` as a literal until
 * 2026-08-14, so the day the token arrived every notice silently read zero.
 */
export const REDACTION_MARKERS: readonly string[] = [REDACTION_TOKEN, ...LEGACY_MASKS];

/** `RegExp`-safe: a marker is punctuation, and `[`, `]` and `.` all mean something in a pattern. */
function escapeForPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const MARKER_PATTERN = new RegExp(REDACTION_MARKERS.map(escapeForPattern).join('|'), 'g');

/**
 * Renders a stored body for one reader: every removed span reads in their language.
 *
 * Call this at the point of DISPLAY, on every surface that shows a message body, a dispute title
 * or a delivery failure — the three places `redactContactDetails` writes to. The console and the
 * partner portal pass `'ar'` because they are Arabic-only; the customer app passes the locale of
 * the route it is rendering.
 */
export function renderRedactions(body: string, locale: Locale): string {
  const mask = CATALOGUES[locale].redactionMask;

  /* A fresh pattern per call: a module-level /g regex carries `lastIndex` between calls. */
  return body.replace(new RegExp(MARKER_PATTERN.source, 'g'), mask);
}

/**
 * Strips markers a WRITER typed, so nobody can forge a redaction.
 *
 * Without this, pasting `⟦…⟧` into a message renders to the recipient as «⟨محجوب⟩» — a claim that
 * the platform removed a phone number that was never there. Small, but it is a lie told in the
 * platform's own voice, and the notice above the thread ("N contact details were removed") is what
 * the reader trusts to tell the difference.
 *
 * Removed rather than escaped: these markers have no legitimate use in a sentence, so there is
 * nothing to preserve, and an escaping scheme would need its own reverse in every render path.
 */
export function stripRedactionMarkers(body: string): string {
  return body.replace(new RegExp(MARKER_PATTERN.source, 'g'), '');
}

/** The content catalogues, for the completeness tests. */
export const CONTENT_CATALOGUES: Readonly<Record<Locale, ContentMessages>> = CATALOGUES;
