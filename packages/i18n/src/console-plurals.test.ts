import IntlMessageFormat from 'intl-messageformat';
import { describe, expect, it } from 'vitest';

import { adminAr } from './admin.js';
import { partnerAr } from './partner.js';

/**
 * Arabic agreement on both Arabic-only apps, and the sweep that stops it drifting back — finding 236.
 *
 * ## What was wrong
 *
 * Thirty-three counts were CONCATENATED against a noun that has to agree with them, and the
 * dashboard's «يحتاج انتباهك الآن» rows were the worst of them: `${count(n)} ${noun}` put
 * «5 حجز» and «12 شريك» at the top of the console all day. Arabic has SIX plural categories and
 * the boundaries are not an English speaker's — 3–10 takes the broken plural, **11–99 takes the
 * accusative SINGULAR**, 100 and above the bare singular — so one wording cannot be right for
 * more than one range.
 *
 * ## Two different jobs, and the second is the one that lasts
 *
 * The first half of this file renders each converted string at every boundary and asserts the
 * forms are DISTINCT where Arabic distinguishes them. That catches a category left out: a message
 * with only `one` and `other` renders happily and reads wrong from three upwards.
 *
 * The second half is a SWEEP of the whole catalogue. Converting thirteen strings does not stop the
 * fourteenth being written as a concatenation next week, and nothing else in the build would
 * notice — the failure is a grammatical one on a screen, invisible to types and to every HTTP
 * assertion. Exemptions are listed with the reason each is not an agreement, because an exemption
 * list decays in the direction of hiding things.
 */
const format = (message: string, values: Record<string, number | string>): string =>
  String(new IntlMessageFormat(message, 'ar').format(values));

/** The five counts that sit in five different CLDR categories, plus zero. */
const BOUNDARIES = [0, 1, 2, 5, 15, 100] as const;

/**
 * Both Arabic-only applications, because a count agrees with its noun on either of them.
 *
 * The console and the portal have separate catalogues and separate `plural()` helpers, and the
 * portal had BOTH spellings of one noun at once — `requestsNights` on the dashboard and `nights`
 * on الوصولات — which is what a rule enforced in one place and not the other produces.
 */
const CATALOGUES = [
  ['console', adminAr],
  ['partner', partnerAr],
] as const;

describe('the console’s Arabic agreement', () => {
  const admin = adminAr.admin;
  const sections = adminAr.sections;

  /**
   * Every converted message, at every boundary.
   *
   * `one`, `two`, `few` and `many` must each produce something DIFFERENT — that is the whole
   * content of the change. `other` is allowed to match `many`'s wording in Arabic (both take the
   * singular) and frequently does, so it is not required to differ.
   */
  const CONVERTED: ReadonlyArray<readonly [string, string, string]> = [
    ['attentionArrivals', admin.attentionArrivals, 'n'],
    ['attentionUnconfirmed', admin.attentionUnconfirmed, 'n'],
    ['attentionRefundsOwed', admin.attentionRefundsOwed, 'n'],
    ['attentionPartners', admin.attentionPartners, 'n'],
    ['attentionProperties', admin.attentionProperties, 'n'],
    ['bookings.count', sections.bookings.count, 'n'],
    ['bookings.countAtLeast', sections.bookings.countAtLeast, 'n'],
    ['payouts.lastAccrual', sections.payouts.lastAccrual, 'n'],
    ['propertyDetail.morePhotos', sections.propertyDetail.morePhotos, 'n'],
    ['propertyTypes.inUse', sections.propertyTypes.inUse, 'n'],
    ['partnerTwoFactor.done', sections.partnerTwoFactor.done, 'n'],
    ['contracts.expiringIn', sections.contracts.expiringIn, 'days'],
    ['comms.window', sections.comms.window, 'days'],
    ['screening.listStale', sections.screening.listStale, 'days'],
    /* The PORTAL's half, converted in the same pass and held to the same rule. */
    ['partner.kpiBookingsArriving', partnerAr.dashboard.kpiBookingsArriving, 'n'],
    ['partner.kpiResponseMinutes', partnerAr.dashboard.kpiResponseMinutes, 'n'],
    ['partner.kpiResponseSample', partnerAr.dashboard.kpiResponseSample, 'n'],
    ['partner.readinessGap.unit', partnerAr.dashboard.readinessGap['unit'] ?? '', 'n'],
    [
      'partner.readinessGap.photograph',
      partnerAr.dashboard.readinessGap['photograph'] ?? '',
      'n',
    ],
    ['partner.properties.count', partnerAr.properties.count, 'n'],
    ['partner.properties.units', partnerAr.properties.units, 'n'],
    ['partner.properties.reviews', partnerAr.properties.reviews, 'n'],
    ['partner.calendars.unitsInside', partnerAr.calendars.unitsInside, 'n'],
    ['partner.employeeRoles.held', partnerAr.employeeRoles.held, 'n'],
    ['partner.editProperty.unitGuests', partnerAr.editProperty.unitGuests, 'n'],
  ];

  it.each(CONVERTED)('%s agrees at one, two, few and many', (_name, message, key) => {
    const rendered = BOUNDARIES.map((n) =>
      format(message, { n, days: n, minutes: n, when: '—' }).replace(
        String(n === 0 ? 0 : n),
        '',
      ),
    );

    void key;

    /* one / two / few / many — indexes 1..4 — must be four different sentences. */
    const distinct = new Set(rendered.slice(1, 5));

    expect(distinct.size, `«${message}» renders ${[...distinct].join(' | ')}`).toBe(4);
  });

  /**
   * The dashboard's SLA row carries two counts in one sentence, and both agree.
   *
   * It is the only string in the catalogue that does, which is exactly why it is asserted on its
   * own: a conversion that made the bookings agree and left «30 دقيقة» as a literal would look
   * finished and be half done.
   */
  it('makes both counts in the SLA row agree', () => {
    const one = format(admin.attentionSla, { n: 1, minutes: 1 });
    const few = format(admin.attentionSla, { n: 5, minutes: 5 });
    const many = format(admin.attentionSla, { n: 15, minutes: 30 });

    expect(one).toContain('حجز واحد');
    expect(one).toContain('دقيقة');
    expect(few).toContain('حجوزات');
    expect(few).toContain('دقائق');
    expect(many).toContain('حجزاً');
    expect(many).toContain('30 دقيقة');
  });

  /**
   * THE SWEEP. No count may sit beside a noun without ICU deciding the form.
   *
   * The heuristic is a placeholder with an Arabic word immediately on either side of it. That is
   * broader than «a count», so every match that is NOT an agreement is listed below WITH the
   * reason it cannot be one — a name, an address, a date, a reference, a money amount or a figure
   * that is not counting anything.
   */
  const NOT_AN_AGREEMENT = new Set([
    /*
      PARTITIVES — «{n} من المدن», «{n} من الوحدات», «{n} من الشركاء».

      «من» plus the plural is correct at every count in Arabic; it is «three of the cities», not
      «three cities», and the noun after it never varies. Converting these would be a change with
      no reader behind it.
    */
    'deactivateBody',
    'deactivateAmenityBody',
    'deactivatePolicyBody',
    'deactivateTypeBody',
    'closeCountryBody',
    'closeCityBody',
    'redacted',
    /*
      POSITIONS IN A SET, not counts of a noun — «ظهر {shown} من {total}», «أحدث {shown} من
      {total}», «أكثر من {n}». The word beside the placeholder is «من», which is a preposition.
    */
    'countShown',
    'showingRecent',
    'countCapped',
    /* «صفحة [١] من {n}» — the page COUNT beside «من». The noun is «صفحة», before the input. */
    'pageOf',
    /*
      «{incomplete} من {total} من إعلاناتك ينقصها شيء» — a position in a set, twice over. Both
      numbers sit beside «من», and «إعلاناتك» is already plural and possessive; it does not vary.
    */
    'readinessSome',
    /* «حُجبت {count} من بيانات الاتصال» — a partitive, like the console's `redacted`. */
    /* «{n} من 5» is a star rating: the 5 is a scale, not a plural. */
    'rating',
    /* «التكرار رقم {n}» / «المخالفة رقم {n}» are ORDINALS. The noun does not vary with them. */
    'occurrenceNumber',
    'occurrence',
  ]);

  it.each(CATALOGUES)(
    'leaves no count concatenated against a noun (%s)',
    (app, catalogue) => {
      const offenders: string[] = [];

      const walk = (node: unknown, path: string): void => {
        if (typeof node === 'string') {
          if (node.includes('plural,')) return;

          const key = path.split('.').pop() ?? '';

          if (NOT_AN_AGREEMENT.has(key)) return;

          for (const match of node.matchAll(/\{(\w+)\}/g)) {
            const name = match[1] ?? '';

            /* Only placeholders that can hold a COUNT. A name or a date agrees with nothing. */
            if (!/^(n|count|total|days|minutes|hours|rooms|units|nights)$/.test(name)) {
              continue;
            }

            const before = node.slice(Math.max(0, match.index - 8), match.index);
            const after = node.slice(
              match.index + match[0].length,
              match.index + match[0].length + 8,
            );

            if (/[؀-ۿ]\s*$/.test(before) || /^\s*[؀-ۿ]/.test(after)) {
              offenders.push(`${path}: ${node.slice(0, 70)}`);
              break;
            }
          }

          return;
        }

        if (node && typeof node === 'object') {
          for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`);
        }
      };

      walk(catalogue, app);

      expect(
        offenders,
        'a count beside an Arabic noun must go through `plural()`, or be exempted here with its reason',
      ).toEqual([]);
    },
  );
});
