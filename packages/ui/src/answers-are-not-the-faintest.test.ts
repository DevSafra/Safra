import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A figure or a status a person acts on is never the smallest or faintest text on its screen.
 *
 * ## What went wrong
 *
 * Bashar, 2026-09-09: _«Important business information should never be the smallest or faintest
 * text in the interface.»_ It repeatedly was, and always in the same shape — a block whose LABEL
 * was set at the readable tier and whose ANSWER was set below it:
 *
 * - a property's cancellation policy explained at 14px and its refund floor, the number a guest
 *   actually needs, at 13px in the faintest colour;
 * - a refund's amount at 14px semibold with «when will it arrive» and «what percentage» beneath
 *   it at 13px faint — the two questions the amount raises;
 * - an invoice's payment METHOD at 14px and its payment STATUS at 13px, when «مدفوع» versus
 *   «مرفوض» is the consequential half;
 * - a booking's timeline payload — where a dispute's occurrence number and fine live — at 13px.
 *
 * None of it failed a contrast check; every one of those colours clears AA. Readability is not
 * only contrast, and nothing in the suite could see the difference between a label and an answer.
 *
 * ## What this holds
 *
 * An element whose class list puts it at the METADATA tier — `text-xs`, or an explicit 13px — or
 * paints it in `text-faint`, the lowest-signal colour, must not RENDER an answer. An answer is a
 * value resolved through one of the helpers below: money through `amount`/`money`/`formatMoney`,
 * a status word through the enum catalogues.
 *
 * The helper list is the point of precision. «Does this text matter» is not decidable from source,
 * but «is this text a formatted amount or a translated status» is, exactly, and those two are the
 * categories Bashar named. A heading, a caption, a hint or a label passes through untouched
 * because it calls none of them.
 *
 * ## The floor
 *
 * It reads the SOURCE, so it cannot see a class assembled from a variable, a value passed down as
 * a prop and formatted elsewhere, or a size inherited from an ancestor. It is a floor, not a
 * ceiling — the same standing as `no-bare-amounts` and `colour-tokens`.
 */
const ROOT = new URL('../../../', import.meta.url).pathname;

const APPS = ['apps/admin/src', 'apps/web/src', 'apps/partner/src', 'packages/ui/src'];

/** The tiers an answer may not sit in: the metadata size, and the lowest-signal colour. */
const TOO_QUIET = /\btext-xs\b|\btext-\[13px\]\b|\btext-faint\b/;

/**
 * What makes a run of text an ANSWER rather than a label.
 *
 * Every one of these resolves a stored value into something a person reads and acts on. A label
 * is a constant from the catalogue and calls none of them.
 */
const ANSWERS = [
  /\bamount\(/,
  /\bmoney\(/,
  /\bformatMoney\(/,
  /\blocalStatus\(/,
  /\bbookingStatus\(/,
  /\bcustomerBookingStatus\(/,
  /\bcancellationReason\(/,
  /*
    A STATE, not every enum.

    `t.enums` also holds classifications — an amenity, a room type, a payment provider, a star
    rating — and those legitimately live in a chip at the metadata tier; Bashar's decision of
    2026-09-09 names chips as small-text territory explicitly. What must not be quiet is a value
    that tells somebody where a thing STANDS and whether it needs them.

    Named rather than inferred: `verification` and `violationStage` do not end in «Status» and are
    both states somebody acts on, and a rule that guessed from the spelling would miss them.
  */
  /\blabel\(t\.enums\.(?:[A-Za-z]*Status|verification|violationStage)\b/,
];

function sources(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) sources(path, found);
    else if (path.endsWith('.tsx')) found.push(path);
  }

  return found;
}

/**
 * Comments go first, and they have to.
 *
 * This codebase explains its money and status decisions in prose directly above the elements that
 * make them, so a comment mentioning `amount(` sits one line from a `text-xs` caption constantly.
 * Left in, the noise would bury the real findings — which is how an assertion stops being read.
 */
function withoutComments(source: string): string {
  /*
    Newlines are KEPT, so a reported line number is the line in the file.

    Collapsing a twelve-line comment to a space shifts every offence below it, and an offence
    nobody can find is barely better than one nobody is told about — the first triage of this
    sweep was read against the wrong lines entirely.
  */
  const blank = (match: string) => match.replace(/[^\n]/g, ' ');

  return source.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^\s*\/\/.*$/gm, blank);
}

/**
 * The text an element renders, approximately: everything from the end of its class list to the
 * start of the next element that declares one.
 *
 * Approximate on purpose. A real parse would be exact and would also mean carrying a JSX parser
 * to answer a question this shape answers well enough — the next `className` is where the next
 * element's content begins, so what lies between belongs to this one or to a child with no styling
 * of its own, and a child with no styling of its own inherits precisely the tier under test.
 */
function renderedBy(source: string, from: number): string {
  /*
    Stops at the element's OWN closing tag as well as at the next styled element, and the closing
    tag is the half that matters. Without it the window ran on past `</span>` into whatever
    followed — so `<span className="text-faint">{c.noAccount}</span>` was reported for the
    `StatusPill` in the OTHER branch of its ternary, four lines below and styled by nothing here.
    Four of the first nine findings were that, and a sweep with a false-positive rate like that is
    one somebody switches off.
  */
  const ends = [source.indexOf('className', from), source.indexOf('</', from)].filter(
    (at) => at !== -1,
  );

  return source.slice(from, ends.length === 0 ? source.length : Math.min(...ends));
}

describe('an answer is never the quietest text on the screen', () => {
  it('renders no amount or status at the metadata tier or in the faintest colour', () => {
    const offences: string[] = [];

    for (const app of APPS) {
      for (const file of sources(join(ROOT, app))) {
        const source = withoutComments(readFileSync(file, 'utf8'));
        const classes = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g;

        for (let hit = classes.exec(source); hit; hit = classes.exec(source)) {
          const list = hit[1] ?? hit[2] ?? '';

          if (!TOO_QUIET.test(list)) continue;

          const content = renderedBy(source, hit.index + hit[0].length);
          const answer = ANSWERS.find((pattern) => pattern.test(content));

          if (answer === undefined) continue;

          const line = source.slice(0, hit.index).split('\n').length;

          offences.push(
            `${file.replace(ROOT, '')}:${line} — ${String(answer)} inside «${list.trim()}»`,
          );
        }
      }
    }

    expect(offences).toEqual([]);
  });
});
