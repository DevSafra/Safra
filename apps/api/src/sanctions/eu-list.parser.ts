import type { ImportEntry } from './sanctions.service.js';

/**
 * Parses the EU consolidated list's XML export.
 *
 * ## Why hand-rolled rather than an XML library
 *
 * The document is large, deeply nested and only four fields of it matter. A DOM
 * parser would pull megabytes into memory to reach them, and every XML dependency is
 * an XXE surface on a file fetched from the network. Streaming the two element types
 * we care about with a regex is narrower in both senses — and it cannot resolve an
 * external entity, because it never resolves anything.
 *
 * The trade is real: this breaks if the publisher restructures the document. That is
 * why `parseEuSanctionsXml` throws on a document with no recognisable entries rather
 * than returning an empty list. An empty sanctions list that imports cleanly is the
 * single worst outcome available here — it would clear every partner.
 *
 * ## Shape
 *
 * Each `sanctionEntity` carries a logical id and a set of `nameAlias` elements, one
 * per spelling. Names are stored per alias so each is independently searchable.
 */
export interface ParsedList {
  readonly entries: ImportEntry[];
  readonly publishedAt: Date | undefined;
}

export function parseEuSanctionsXml(xml: string): ParsedList {
  const entries: ImportEntry[] = [];

  for (const block of matchAll(
    xml,
    /<sanctionEntity\b([^>]*)>([\s\S]*?)<\/sanctionEntity>/g,
  )) {
    const attributes = block[1] ?? '';
    const body = block[2] ?? '';

    const designationId =
      attribute(attributes, 'logicalId') ?? attribute(attributes, 'euReferenceNumber');

    if (!designationId) continue;

    /**
     * `subjectType` distinguishes a person from an organisation. It is used for
     * display and to explain a hit; matching runs against both regardless, because a
     * partner's legal name and their signatory are both worth checking.
     */
    const subjectType =
      attributeIn(body, 'subjectType', 'code') === 'P' ? 'person' : 'entity';

    const programme = attributeIn(body, 'regulation', 'programme');

    const remarks = firstText(body, /<remark>([\s\S]*?)<\/remark>/);
    const birthDate = attributeIn(body, 'birthdate', 'birthdate');

    for (const alias of matchAll(body, /<nameAlias\b([^>]*)\/?>/g)) {
      const attrs = alias[1] ?? '';

      /**
       * `wholeName` when the publisher gives it, otherwise the parts joined. Some
       * aliases carry only first/last, and skipping those would drop real spellings.
       */
      const whole =
        attribute(attrs, 'wholeName') ??
        [attribute(attrs, 'firstName'), attribute(attrs, 'lastName')]
          .filter(Boolean)
          .join(' ');

      const name = decodeEntities(whole ?? '').trim();

      if (name.length < 2) continue;

      entries.push({
        designationId,
        subjectType,
        name,
        ...(programme ? { programme } : {}),
        ...(remarks || birthDate
          ? {
              details: [birthDate ? `Born ${birthDate}` : null, remarks]
                .filter(Boolean)
                .join(' · '),
            }
          : {}),
      });
    }
  }

  /**
   * A document that yields nothing is treated as a FAILURE, not an empty list.
   *
   * If the publisher restructures the XML, the alternative is importing zero entries
   * as a valid snapshot — which would clear every partner screened against it while
   * looking entirely healthy. Refusing is the only safe reading of "we parsed nothing".
   */
  if (entries.length === 0) {
    throw new Error(
      'Parsed no entries from the sanctions feed. The document format may have ' +
        'changed; refusing to import an empty list.',
    );
  }

  return { entries, publishedAt: parseGenerationDate(xml) };
}

/** The publisher's own generation date, when the export declares one. */
function parseGenerationDate(xml: string): Date | undefined {
  const raw =
    firstText(xml, /generationDate="([^"]+)"/) ??
    firstText(xml, /<generationDate>([^<]+)</);

  if (!raw) return undefined;

  const parsed = new Date(raw);

  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function matchAll(source: string, pattern: RegExp): RegExpMatchArray[] {
  return [...source.matchAll(pattern)];
}

function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(attributes);
  const value = match?.[1]?.trim();

  return value && value.length > 0 ? value : undefined;
}

/** Finds an attribute on a nested element, e.g. `subjectType code="P"`. */
function attributeIn(body: string, element: string, name: string): string | undefined {
  const match = new RegExp(`<${element}\\b([^>]*)`, 'i').exec(body);

  return match?.[1] ? attribute(match[1], name) : undefined;
}

function firstText(source: string, pattern: RegExp): string | undefined {
  const value = pattern.exec(source)?.[1]?.trim();

  return value && value.length > 0 ? decodeEntities(value) : undefined;
}

/**
 * The five predefined XML entities, and nothing else.
 *
 * Numeric character references are deliberately NOT expanded: doing so is how a
 * parser starts interpreting content, and none of the four fields read here needs
 * it. `&amp;` in a company name is the realistic case and it is covered.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
