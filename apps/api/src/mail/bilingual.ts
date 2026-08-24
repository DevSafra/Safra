import { emailMessages, resolveLocale, fill, type EmailMessages } from '@safra/i18n';

/**
 * Arabic first, English underneath, in one message (Bashar, 2026-08-23).
 *
 * ## Why every email carries both, rather than the recipient's language
 *
 * An email is the one surface where we do not get to ask. The reader forwards it to a colleague,
 * opens it on a phone with no Arabic font, or holds an account somebody else created by invitation
 * and has never chosen a language at all. Everywhere else the reader picks; here we guess, and
 * guessing wrong means an unreadable message about a locked account or an expiring link.
 *
 * ## German is not dropped by a rule about Arabic and English
 *
 * The instruction names two languages and the catalogue has three. A German customer losing their
 * language as a SIDE EFFECT of this rule would be the exact failure `.claude/CLAUDE.md` opens with
 * — "the way you find out it was there is a German customer reading Arabic". So: Arabic, English,
 * and then the recipient's own if it is neither. Two blocks where three are due is a regression
 * wearing a rule's clothes.
 *
 * ## One helper, not twenty-two hand-concatenations
 *
 * The ordering is a decision, and a decision made in twenty-two places is twenty-two chances to
 * make it differently. `mail.templates.test.ts` still checks each template, because a helper test
 * proves the helper works and says nothing about the template that forgot to call it.
 */

/** The two fields every catalogue entry carries. */
type Copy = { readonly subject: string; readonly body: string };

/**
 * What gets interpolated — a fixed record, or a function of the block's OWN language.
 *
 * Most values are language-neutral: a URL, a reference, a count. Two are not. `staffInvitationMail`
 * interpolates a ROLE NAME and `partnerContractReadyMail` a CONTRACT KIND, and both come from the
 * catalogue — so a fixed record would put the Arabic word inside the English block, which is the
 * defect this whole rule exists to prevent, arriving one layer down.
 *
 * The function form receives the messages for the block being rendered, so each block resolves its
 * own words. It is not a general escape hatch: everything else passes a record, and a template
 * reaching for the function form should be able to say which catalogue lookup made it necessary.
 */
type Values =
  | Record<string, string | number>
  | ((messages: EmailMessages) => Record<string, string | number>);

/**
 * The rule between the language blocks.
 *
 * A visible divider rather than a blank line: plain-text mail clients collapse whitespace
 * unpredictably, and two paragraphs of different scripts running together is harder to read than
 * either alone.
 */
const DIVIDER = '\n\n—————————————\n\n';

/** Subjects are joined on one line; `·` is the same separator the console uses between facts. */
const SUBJECT_SEPARATOR = ' · ';

/**
 * Which languages this message is rendered in, in order.
 *
 * Arabic, English, and the recipient's own if it is neither. Deduplicated, so an Arabic or English
 * reader gets two blocks rather than the same text twice.
 */
export function localesFor(preferred: string): ('ar' | 'en' | 'de')[] {
  const own = resolveLocale(preferred);
  const ordered: ('ar' | 'en' | 'de')[] = ['ar', 'en'];

  return ordered.includes(own) ? ordered : [...ordered, own];
}

/**
 * Renders one catalogue entry into every required language.
 *
 * `select` picks the entry rather than the caller passing a key, so the return type is checked:
 * a template naming a section that does not exist fails to compile instead of sending an email
 * with `undefined` in it.
 *
 * `values` are filled into EVERY block — a link or a code appears once per language because it is
 * one message rendered twice, and printing a token in only one block would leave the other reader
 * with a sentence about a link that is not there.
 */
export function compose(
  select: (messages: EmailMessages) => Copy,
  preferred: string,
  values: Values = {},
): { subject: string; text: string } {
  const rendered = localesFor(preferred).map((locale) => {
    const messages = emailMessages(locale);
    const copy = select(messages);
    const filled = typeof values === 'function' ? values(messages) : values;

    return {
      /*
        The SUBJECT is filled too, and it has to be: fourteen of the catalogue's twenty-two subjects
        carry a placeholder — «تم اعتماد حسابك على سفرة — {reference}». Joining them raw put the
        literal `{reference}` in the one line a person scans in an inbox list. `fill` over a subject
        with no placeholder is a no-op, so it is applied to all of them rather than to a list
        somebody has to keep.
      */
      subject: fill(copy.subject, filled),
      body: fill(copy.body, filled),
    };
  });

  return {
    subject: rendered.map((copy) => copy.subject).join(SUBJECT_SEPARATOR),
    text: rendered.map((copy) => copy.body).join(DIVIDER),
  };
}
