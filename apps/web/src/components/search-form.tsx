import { getTranslations } from 'next-intl/server';

import type { Locale } from '@/i18n/routing';
import { DateRangeField } from '@/components/date-range-field';
import { GuestsField } from '@/components/guests-field';
import { GuestsIcon, PinIcon } from '@/components/icons';
import { localisedName } from '@/lib/localise';

interface City {
  slug: string;
  nameAr: string;
  nameEn: string;
  nameDe: string;
}

/**
 * The search engine from §5.1 / §5.2.
 *
 * A plain GET form with no client JavaScript. That is a deliberate choice, not a
 * shortcut: the search state lives entirely in the URL, so results are
 * shareable, linkable, indexable and survive a page reload — and the form works
 * before any script has loaded, which matters on the mobile networks these
 * markets actually use.
 *
 * §5.2 makes arrival, departure and guests mandatory, so those inputs are
 * `required` and the browser enforces it before a request is even made.
 *
 * ## The bar (Bashar, 2026-09-01: «designed same as the form on booking.com»)
 *
 * It was a five-column grid of separately bordered boxes, and six fields plus a button do not
 * divide by five: «الرضّع» and «ابحث عن إقامة» dropped onto a second row with a hole beside them,
 * which is the state Bashar screenshotted. The arrangement is now the one booking.com uses — a
 * single joined bar inside a thick accent frame, fields grouped by MEANING rather than laid out
 * one per column, and the action at the end of the bar.
 *
 * Three groups, not six columns: where you are going, when, and who is coming. That grouping is
 * the actual borrowing; the row of boxes was what made a six-field form look like a spreadsheet.
 *
 * ## The dates and the occupancy are booking.com's popovers (Bashar, 2026-09-02, two screenshots)
 *
 * They were two native date inputs and three native selects, and the comment here said the
 * popovers were «a real feature with a real cost and not something to slip in behind a styling
 * request». They were asked for directly, so the cost is now paid: `DateRangeField` opens the
 * two-month range calendar and `GuestsField` opens the stepper panel.
 *
 * **The destination is untouched**, on instruction — it stays the native select it has always been.
 *
 * **The no-JavaScript guarantee above still holds.** Both components render the ORIGINAL native
 * controls until they mount, with the same `name`s and the same `min`, so a browser that never ran
 * a script submits exactly the URL it submitted yesterday. Nothing about the GET form, the URL
 * state or the indexability changed; what changed is that a browser which DOES run scripts gets a
 * better control over the same values.
 *
 * ## The panel and its action (Bashar, 2026-09-02, with a screenshot of «احجز الآن»)
 *
 * The frame was a solid gold block with the segments cut out of it — booking.com's yellow bar. The
 * action inside it was therefore `sky`, because a gold button on a gold frame cannot be seen and
 * because `text-bg` on `--color-gold` is 3.56:1 on a light surface.
 *
 * Both are now the PROTOTYPE's, read from `SAFRA - موقع سفرة 20.08.html` rather than guessed: the
 * panel is `--color-card` under a 28%-gold hairline at an 18px radius, and the action is
 * `.btn-gold`, the gradient the screenshot shows. That ordering matters — the panel had to stop
 * being gold BEFORE the button could become gold, and measured against the old frame the new
 * button would have been 1.35:1 in the light theme and 1.13:1 in the dark one. Invisible.
 *
 * What survives from booking.com is the SHAPE: one joined bar, fields grouped by meaning rather
 * than laid one per column, and the action at the end of it.
 *
 * The dividers between segments used to be the gold frame showing through the grid gaps. They are
 * now the contrast between `--color-field` and `--color-card`, which holds in both themes and, like
 * the gap before it, needs no `divide-x` to mirror under `dir`.
 */
/**
 * The reachable counts, in one place.
 *
 * The native selects offer these and `GuestsField` pre-renders a label for each, so a range
 * written twice is a range that drifts: the stepper would let somebody pick a number the fallback
 * cannot express, and `adultsCounts[7]` would be `undefined` rendered as an empty trigger.
 *
 * `ADULTS` is not contiguous — the select has always skipped 7 — so the array is indexed by COUNT
 * rather than by position, which is why it is built as a dense range and the select maps over the
 * sparse one.
 */
const ADULT_CHOICES = [1, 2, 3, 4, 5, 6, 8] as const;
const ADULTS = Array.from({ length: 9 }, (_, index) => index);
const CHILDREN = Array.from({ length: 7 }, (_, index) => index);
const INFANTS = Array.from({ length: 4 }, (_, index) => index);
/* One through six, matching the stepper's floor and ceiling. */
const BEDROOMS = Array.from({ length: 6 }, (_, index) => index + 1);

/**
 * The placeholder `increase`/`decrease` carry, filled with the field's own name in the client.
 *
 * next-intl resolves `{field}` here on the server, so the token has to survive that pass intact —
 * hence a literal `{field}` passed AS the value, which comes back out the other side unchanged and
 * is substituted per stepper row. The alternative is three pre-rendered pairs, which is six more
 * strings for no gain.
 */
const FIELD_TOKEN = '{field}';

/** The next calendar day, for the departure the popover path must always have. */
function nextDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

export async function SearchForm({
  locale,
  cities,
  attributes = [],
  attributesLabel = '',
  defaults,
  minDate,
}: {
  locale: Locale;
  cities: City[];
  /** The trip attributes offered as tags, already translated by the caller. */
  attributes?: readonly { code: string; label: string }[];
  /** «صفات الرحلة:» — the row's own label. */
  attributesLabel?: string;
  defaults?: {
    attributes?: readonly string[] | undefined;
    children?: number | undefined;
    infants?: number | undefined;
    citySlug?: string | undefined;
    checkIn?: string | undefined;
    checkOut?: string | undefined;
    adults?: number | undefined;
    bedrooms?: number | undefined;
  };
  minDate: string;
}) {
  const t = await getTranslations('search');

  return (
    <form
      action={`/${locale}/search`}
      method="get"
      /* The prototype's panel: the card colour under a gold hairline, 18px, 12px of padding. */
      className="rounded-[18px] border border-gold/30 bg-card p-3 shadow-sm"
    >
      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-[1.1fr_1.35fr_1.75fr_auto]">
        {/* ── Where ─────────────────────────────────────────────────────── */}
        <Segment icon={<PinIcon />}>
          <Field label={t('destinationOptional')} htmlFor="q-city">
            <select
              id="q-city"
              name="citySlug"
              defaultValue={defaults?.citySlug ?? ''}
              className="w-full cursor-pointer truncate bg-transparent text-text focus:outline-none"
            >
              <option value="">{t('allCities')}</option>
              {cities.map((city) => (
                <option key={city.slug} value={city.slug}>
                  {localisedName(city, locale)}
                </option>
              ))}
            </select>
          </Field>
        </Segment>

        {/*
          ── When ────────────────────────────────────────────────────────

          No icon of ours in this one. `input[type=date]` draws its own calendar picker
          indicator, and two of them beside a third of ours made three calendar glyphs in one
          segment. Hiding the native indicators would have kept the symmetry and taken the
          picker with it: on desktop Chrome that indicator is the only thing that opens the
          calendar, so the field would be type-only. The affordance wins over the rhythm.
        */}
        <Segment>
          <DateRangeField
            locale={locale}
            minDate={minDate}
            labels={{
              dates: t('dates'),
              checkIn: t('checkIn'),
              checkOut: t('checkOut'),
              done: t('done'),
              previousMonth: t('previousMonth'),
              nextMonth: t('nextMonth'),
            }}
            defaults={{
              checkIn: defaults?.checkIn ?? minDate,
              /*
                A night, where the caller has no departure. The native fallback still starts empty
                and still carries `required`; this path cannot, so it starts valid instead. See the
                invariant in `DateRangeField`.
              */
              checkOut: defaults?.checkOut ?? nextDay(defaults?.checkIn ?? minDate),
            }}
          >
            <Field label={t('checkIn')} required htmlFor="q-in">
              <input
                id="q-in"
                type="date"
                name="checkIn"
                required
                // §5.3: today is not selectable once the city's 17:00 cutoff has passed.
                // The API re-checks, but blocking it here avoids a pointless round trip.
                min={minDate}
                defaultValue={defaults?.checkIn ?? minDate}
                className="w-full bg-transparent text-text focus:outline-none"
              />
            </Field>
            <Divider />
            <Field label={t('checkOut')} required htmlFor="q-out">
              <input
                id="q-out"
                type="date"
                name="checkOut"
                required
                min={minDate}
                defaultValue={defaults?.checkOut ?? ''}
                className="w-full bg-transparent text-text focus:outline-none"
              />
            </Field>
          </DateRangeField>
        </Segment>

        {/*
          §5.2: «عدد الأشخاص — يشمل البالغين والأطفال والرضع عند الحاجة».

          Three fields, not one. The API has taken `adults`, `children` and `infants` since the
          booking contract was written and this form only ever sent the first, so a family could not
          say what it was — and `max_guests` was then matched against an undercount, which is how a
          party of four ends up in a unit that sleeps two. Found by the SRS audit, 2026-08-25.

          Infants are asked for and deliberately do NOT count toward occupancy: both the search and
          the booking service compute `adults + children` and say so. They are carried because the
          PARTNER needs to know a cot is coming, not because they need a bed.

          Grouped into ONE segment so they read as «who is coming» rather than as three unrelated
          questions, which is the whole point of the arrangement booking.com uses.
        */}
        <Segment>
          <GuestsField
            icon={<GuestsIcon />}
            labels={{
              occupancy: t('occupancy'),
              adults: t('adults'),
              childrenLabel: t('children'),
              infants: t('infants'),
              infantsHint: t('infantsHint'),
              bedrooms: t('bedrooms'),
              done: t('done'),
              increase: t('increase', { field: FIELD_TOKEN }),
              decrease: t('decrease', { field: FIELD_TOKEN }),
              adultsCounts: ADULTS.map((count) => t('guestsCount', { count })),
              childrenCounts: CHILDREN.map((count) => t('childrenCount', { count })),
              infantsCounts: INFANTS.map((count) => t('infantsCount', { count })),
            }}
            defaults={{
              adults: defaults?.adults ?? 2,
              children: defaults?.children ?? 0,
              infants: defaults?.infants ?? 0,
              bedrooms: defaults?.bedrooms ?? 1,
            }}
          >
            <Field label={t('adults')} required htmlFor="q-adults">
              <select
                id="q-adults"
                name="adults"
                defaultValue={String(defaults?.adults ?? 2)}
                className="w-full cursor-pointer truncate bg-transparent text-text focus:outline-none"
              >
                {ADULT_CHOICES.map((count) => (
                  <option key={count} value={count}>
                    {t('guestsCount', { count })}
                  </option>
                ))}
              </select>
            </Field>
            <Divider />
            <Field label={t('children')} htmlFor="q-children">
              <select
                id="q-children"
                name="children"
                defaultValue={String(defaults?.children ?? 0)}
                className="w-full cursor-pointer truncate bg-transparent text-text focus:outline-none"
              >
                {CHILDREN.map((count) => (
                  <option key={count} value={count}>
                    {t('childrenCount', { count })}
                  </option>
                ))}
              </select>
            </Field>
            <Divider />
            {/* Said plainly, because «0» beside «الرضع» otherwise reads as a bed they are not getting. */}
            <Field label={t('infants')} htmlFor="q-infants">
              <select
                id="q-infants"
                name="infants"
                defaultValue={String(defaults?.infants ?? 0)}
                className="w-full cursor-pointer truncate bg-transparent text-text focus:outline-none"
              >
                {INFANTS.map((count) => (
                  <option key={count} value={count}>
                    {t('infantsCount', { count })}
                  </option>
                ))}
              </select>
            </Field>
            <Divider />
            {/*
              Bedrooms, as a select, for the same reason the three above it are selects: this block
              renders until `GuestsField` mounts, so the form still submits every field it owns from
              a browser that never ran a script. A control that only exists after hydration is a
              control some readers do not have.
            */}
            <Field label={t('bedrooms')} htmlFor="q-bedrooms">
              <select
                id="q-bedrooms"
                name="bedrooms"
                defaultValue={String(defaults?.bedrooms ?? 1)}
                className="w-full cursor-pointer truncate bg-transparent text-text focus:outline-none"
              >
                {BEDROOMS.map((count) => (
                  <option key={count} value={count}>
                    {t('bedroomsCount', { count })}
                  </option>
                ))}
              </select>
            </Field>
          </GuestsField>
        </Segment>

        <button
          type="submit"
          className="btn-gold min-h-12 cursor-pointer rounded-lg px-6 text-base font-bold transition-[opacity] duration-200 ease-out-strong hover:opacity-90 sm:col-span-2 lg:col-span-1"
        >
          {t('submit')}
        </button>
      </div>

      {attributes.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          <span className="text-[12.5px] font-semibold text-muted">
            {attributesLabel}
          </span>
          {attributes.map(({ code, label }) => (
            /*
              A checkbox styled as a chip, INSIDE the form (Bashar, 2026-09-03: «should be
              selectable as a search tag same as it is on the prototype»).

              They were links, each carrying exactly one attribute to `/search` — so picking «بحر»
              and then «مسبح» gave you the second one and silently dropped the first, and neither
              survived a change of dates. As checkboxes they are part of the search: any number can
              be on at once, they submit with the dates and the party, and the results page already
              parses a repeated `attributes` parameter.

              No JavaScript. `has-[:checked]` does the whole selected state, so this works before
              hydration and with a keyboard, and `sr-only` keeps the real control focusable rather
              than hidden from it.

              **Nothing moves on press** (Bashar, 2026-09-03: «I do not like the click animation»).
              The prototype's own chip computes `transform: none`, and he said the same thing about
              the slider arrows in August — a control that changes SIZE when pressed is the thing he
              keeps rejecting, so the press is answered in colour alone.

              The weight is 600 at REST, which is the design's own (`12px/600` sampled from the
              prototype's chip) and what Bashar asked for. It is deliberately not a weight that
              CHANGES on selection: `font-semibold` applied only when checked made the chip wider
              than it was a frame earlier, so choosing «بحر» nudged every chip after it along the
              row — a jitter nobody can name but everybody feels. Border, fill and text colour carry
              the state at a constant width, in 150ms.
            */
            <label
              key={code}
              className="inline-flex min-h-10 cursor-pointer items-center rounded-full border border-line bg-card px-3 py-1.5 text-[12.5px] font-semibold text-muted transition-[color,border-color,background-color] duration-150 ease-out-strong has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold has-[:checked]:border-gold has-[:checked]:bg-gold/15 has-[:checked]:text-gold lg:min-h-8 hover:border-gold/60 hover:bg-gold/5 hover:text-gold"
            >
              <input
                type="checkbox"
                name="attributes"
                value={code}
                defaultChecked={defaults?.attributes?.includes(code)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
      ) : null}
    </form>
  );
}

/**
 * One group in the bar — an icon, then whatever fields the caller puts in it.
 *
 * The caller composes its own `Field`s rather than passing a label here, because a group can hold
 * one field or three and a component that special-cased the difference nested the second field
 * inside the first. The icon is `aria-hidden`: it repeats the label rather than adding to it, and
 * a screen reader announcing «pin, destination» is noise. Every control keeps a real
 * `<label for>`, so the visual grouping costs nothing in the accessibility tree.
 */
function Segment({
  icon,
  children,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-12 items-center gap-2.5 rounded-lg bg-field px-3 py-2">
      {icon ? (
        <span aria-hidden className="shrink-0 text-muted">
          {icon}
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">{children}</div>
    </div>
  );
}

/** A label above its control, in the small type the bar uses throughout. */
function Field({
  label,
  htmlFor,
  required = false,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center">
      <label htmlFor={htmlFor} className="truncate text-xs text-muted">
        {label}
        {/*
          Decorative. The requirement is carried by the `required` attribute, which is what a screen
          reader announces and what the browser enforces; the asterisk is the visual affordance
          beside it, so it is held to the 3:1 non-text floor rather than the 4.5:1 text one.
        */}
        {required ? (
          <span aria-hidden className="text-gold">
            {' '}
            *
          </span>
        ) : null}
      </label>
      <div className="text-sm">{children}</div>
    </div>
  );
}

/** A hairline between two fields sharing one segment. */
function Divider() {
  return <span aria-hidden className="h-8 w-px shrink-0 bg-line" />;
}

/*
  The two icons this bar uses now live in `components/icons.tsx`, with the reasoning that put them
  here in the first place: the customer app has no icon dependency and should not gain one for a
  handful of glyphs. What changed is that there are icons on more than one screen now, and one
  stroke spec in two files is how the two files end up half a pixel apart.
*/
