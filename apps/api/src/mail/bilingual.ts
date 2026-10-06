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
const DIVIDER = '\n\n─────────────\n\n';

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
 * The values that are a LINK or a CODE, by name: `url`, `code`, and any `…Url`.
 *
 * Decided by the placeholder's name rather than by a list each template passes, because every
 * template already names its link `url` and its secret `code`, and a list would be twenty-two more
 * chances to forget one. `catalogue shape` in `mail.templates.test.ts` holds the copy to the layout
 * `extractShared` relies on.
 */
const SHARED_KEY = /^(url|code|\w+Url)$/;

/** One link or code, and the sentence that introduces it in each language, in block order. */
type SharedValue = {
  readonly key: string;
  readonly value: string;
  readonly captions: string[];
};

/**
 * Takes the link and code lines OUT of one block's copy, and the sentence that leads into each.
 *
 * Two layouts exist in the catalogue, and only two — the sweep in `mail.templates.test.ts` fails on
 * a third:
 *
 *  - the value on a line of its own, introduced by the nearest line above it that ends in a colon
 *    («افتح الرابط التالي لاختيار كلمة مرور جديدة:» then `{url}`). That lead-in travels with the
 *    value, because left behind it is a sentence ending in a colon with nothing after it.
 *  - a label and the value on one line, «رمز التحقق: {code}». The label is the caption.
 *
 * A value introduced by a whole paragraph (no colon) keeps the paragraph where it is and travels
 * alone; that paragraph already says what the link is for.
 */
function extractShared(body: string): {
  body: string;
  found: { key: string; caption: string }[];
} {
  const lines = body.split('\n');
  const removed = new Set<number>();
  const found: { key: string; caption: string }[] = [];

  lines.forEach((line, index) => {
    const key = [...line.matchAll(/\{(\w+)\}/g)]
      .map((match) => match[1] ?? '')
      .find((name) => SHARED_KEY.test(name));

    if (!key) return;

    removed.add(index);

    const label = line.replace(`{${key}}`, '').trim();

    if (label !== '') {
      found.push({ key, caption: label });
      return;
    }

    let above = index - 1;

    while (above >= 0 && (lines[above] ?? '').trim() === '') above -= 1;

    const leadIn = (lines[above] ?? '').trim();

    if (above >= 0 && !removed.has(above) && /[:：]$/.test(leadIn)) {
      removed.add(above);
      found.push({ key, caption: leadIn });
    } else {
      found.push({ key, caption: '' });
    }
  });

  return {
    body: lines
      .filter((_, index) => !removed.has(index))
      .join('\n')
      /* A lifted line leaves its paragraph breaks behind; two blank lines read as a missing paragraph. */
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    found,
  };
}

/**
 * Renders one catalogue entry into every required language.
 *
 * `select` picks the entry rather than the caller passing a key, so the return type is checked:
 * a template naming a section that does not exist fails to compile instead of sending an email
 * with `undefined` in it.
 *
 * ## Every link and code appears ONCE (Bashar, 2026-10-06: «One link, shared»)
 *
 * They used to be filled into every block, on the reasoning that a sentence about a link should
 * not sit in a block without it. The cost was a reset link or a gift card code printed two or
 * three times in one message, which reads as two different tokens — and a reader who forwards
 * «the second link» has no way to know it was the same one.
 *
 * So the language blocks carry the prose, and the links and codes follow them in one shared
 * section, each introduced by its own lead-in in every language, Arabic first. The lead-in moves
 * with the value because it is the sentence that says what the value is FOR; left in the block it
 * would end in a colon pointing at nothing.
 *
 * Everything else — a reference, a property, an amount — is still filled into every block. Those
 * are part of sentences, and a block without them would not say what it is about.
 */
export function compose(
  select: (messages: EmailMessages) => Copy,
  preferred: string,
  values: Values = {},
): { subject: string; text: string } {
  const shared: SharedValue[] = [];

  const rendered = localesFor(preferred).map((locale) => {
    const messages = emailMessages(locale);
    const copy = select(messages);
    const filled = typeof values === 'function' ? values(messages) : values;
    const { body, found } = extractShared(copy.body);

    for (const { key, caption } of found) {
      const value = filled[key];

      let entry = shared.find((candidate) => candidate.key === key);

      if (!entry) {
        /*
          A value the template forgot stays visible as its placeholder, exactly as `fill` leaves
          one, so «leaves no unfilled placeholder» still catches it rather than the line vanishing.
        */
        entry = {
          key,
          value: value === undefined ? `{${key}}` : String(value),
          captions: [],
        };
        shared.push(entry);
      }

      if (caption !== '') entry.captions.push(fill(caption, filled));
    }

    return {
      /*
        The SUBJECT is filled too, and it has to be: fourteen of the catalogue's twenty-two subjects
        carry a placeholder — «تم اعتماد حسابك على سفرة — {reference}». Joining them raw put the
        literal `{reference}` in the one line a person scans in an inbox list. `fill` over a subject
        with no placeholder is a no-op, so it is applied to all of them rather than to a list
        somebody has to keep.
      */
      subject: fill(copy.subject, filled),
      body: fill(body, filled),
    };
  });

  const blocks = rendered.map((copy) => copy.body);

  if (shared.length > 0) {
    blocks.push(
      shared.map((entry) => [...entry.captions, entry.value].join('\n')).join('\n\n'),
    );
  }

  return {
    subject: rendered.map((copy) => copy.subject).join(SUBJECT_SEPARATOR),
    text: blocks.join(DIVIDER),
  };
}
