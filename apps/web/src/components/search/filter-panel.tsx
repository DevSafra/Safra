'use client';

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { ltrIsolate } from '@safra/i18n';
import { StarRating } from '@safra/ui';

import type { Locale } from '@/i18n/routing';
import type { SearchFacets } from '@/lib/api';
import {
  activeFilterCount,
  BATHROOM_FLOORS,
  CENTRE_CEILINGS,
  clearedFilters,
  RADII_KM,
  RATING_FLOORS,
  toQueryString,
  type ParsedSearch,
} from '@/lib/search-query';

import { BudgetFilter } from './budget-filter';

export interface FilterOption {
  code: string;
  label: string;
}

/** How many options a long group shows before «اعرض الكل». */
const SHORT_LIST = 6;

/**
 * The sidebar of filters, booking.com's in SAFRA's hand (Bashar, 2026-10-01).
 *
 * ## Every change applies at once
 *
 * There is no «طبّق» button: ticking a box navigates to the URL for the new view, in a transition,
 * and the results and every count beside every option refresh together. That is how booking.com
 * behaves and it is what makes the counts honest — a count is only true of the filters already
 * applied. The URL is rebuilt by `toQueryString` from the PARSED view, the same function the server
 * uses, so the browser cannot write a parameter the server would not.
 *
 * ## Counts
 *
 * From the facet query, taken under every OTHER group's selection, so ticking «٤ نجوم» does not
 * zero the five-star count beside it. An option with nothing behind it is hidden unless it is the
 * reader's own selection — booking.com hides them, and a checked box nobody can see would be a
 * filter in force with no way to remove it. When counts are unavailable the options render with no
 * numbers rather than numbers nobody can trust.
 *
 * ## On a phone
 *
 * Below `lg` the panel is a full-screen sheet behind a sticky bar of «الترتيب · التصفية · الخريطة»,
 * the bar every booking site puts there. Escape and the close control dismiss it and return focus
 * to the button that opened it; Tab stays inside while it is open.
 */
export function FilterPanel({
  locale,
  parsed: fromServer,
  facets: facetsPromise,
  options,
  sortSlot,
  mapThumbnailSlot,
  mapButtonSlot,
  layout = 'page',
}: {
  locale: Locale;
  parsed: ParsedSearch;
  /**
   * The counts, still on their way. A promise rather than a value so the panel is drawn with the
   * results and STAYS mounted when the counts land: swapping in a second panel once they arrived
   * threw away a box the reader had ticked in the meantime.
   */
  facets: Promise<SearchFacets | null>;
  options: {
    cityName: string | undefined;
    /** Whether a result proves the city has a placed centre; the counts can prove it too. */
    hasCentre: boolean;
    propertyTypes: FilterOption[];
    facilities: FilterOption[];
    houseRules: FilterOption[];
    accessibility: FilterOption[];
    attributes: FilterOption[];
    landmarks: FilterOption[];
    landmarkKinds: FilterOption[];
  };
  /** Rendered in the phone bar; the desktop sort lives in the results header. */
  sortSlot: ReactNode;
  mapThumbnailSlot: ReactNode;
  mapButtonSlot: ReactNode;
  /**
   * `column` is the same filters as one always-open column, for the full map (Bashar, 2026-10-01:
   * the map «same as booking.com», which filters beside it). The phone bar and its sheet are the
   * page's, so a column draws neither; a change navigates the page exactly as the sidebar's does,
   * which is what lets the map and the list behind it stay one search.
   */
  layout?: 'page' | 'column';
}) {
  const t = useTranslations('search.results');
  const facets = useArrived(facetsPromise);
  const ts = useTranslations('search');
  const tstar = useTranslations('starRating');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);

  /*
    The view as the reader has just set it, ahead of the server.

    A box drawn from the URL alone does not tick until the new results arrive, and a control that
    answers a press a quarter of a second late reads as broken. So a change is shown at once and
    the navigation follows; when the server's answer lands, its parsed view replaces this one.
  */
  const [parsed, setParsed] = useState(fromServer);
  useEffect(() => setParsed(fromServer), [fromServer]);

  const active = activeFilterCount(parsed);

  const go = (overrides: Parameters<typeof toQueryString>[1]) => {
    const href = `/${locale}/search?${toQueryString(parsed, overrides)}`;
    setParsed((current) => {
      const next = { ...current };
      for (const [key, value] of Object.entries(overrides ?? {})) {
        (next as unknown as Record<string, unknown>)[key] =
          value === null ? undefined : value;
      }
      return next;
    });
    startTransition(() => router.push(href, { scroll: false }));
  };

  const toggleIn = <T extends string | number>(list: readonly T[], value: T): T[] =>
    list.includes(value) ? list.filter((one) => one !== value) : [...list, value];

  /* The sheet: Escape closes, Tab is kept inside, focus returns to the opener. */
  useEffect(() => {
    if (!open) return undefined;

    const previous = document.activeElement as HTMLElement | null;
    sheet.current?.querySelector<HTMLElement>('button, a, input, select')?.focus();
    document.documentElement.style.overflow = 'hidden';

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key !== 'Tab' || !sheet.current) return;
      const focusable = [
        ...sheet.current.querySelectorAll<HTMLElement>('button, a[href], input, select'),
      ].filter((node) => !node.hasAttribute('disabled'));
      const firstNode = focusable[0];
      const lastNode = focusable[focusable.length - 1];
      if (!firstNode || !lastNode) return;
      if (event.shiftKey && document.activeElement === firstNode) {
        event.preventDefault();
        lastNode.focus();
      } else if (!event.shiftKey && document.activeElement === lastNode) {
        event.preventDefault();
        firstNode.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = '';
      (opener.current ?? previous)?.focus();
    };
  }, [open]);

  const count = (group: Record<string, number> | undefined, key: string | number) =>
    facets ? (group?.[String(key)] ?? 0) : undefined;

  /* Shown when it has something behind it, or when it is the reader's own selection. */
  const visible = (n: number | undefined, checked: boolean) =>
    checked || n === undefined || n > 0;

  const facilityCounts = facets?.amenities ?? {};
  const popularAmenities = [...options.facilities]
    .sort((a, b) => (facilityCounts[b.code] ?? 0) - (facilityCounts[a.code] ?? 0))
    .slice(0, 3);

  const groups = (
    <div className="grid gap-0 divide-y divide-line">
      {facets?.price ? (
        <Section>
          <BudgetFilter
            locale={locale}
            price={facets.price}
            selected={{ min: parsed.minPrice, max: parsed.maxPrice }}
            labels={{
              title: t('budget'),
              /* Each VALUE isolated, never the sentence: «$66» inside Arabic otherwise reads «66$». */
              range: (min, max) =>
                t('budgetRange', { min: ltrIsolate(min), max: ltrIsolate(max) }),
              min: t('budgetMin'),
              max: t('budgetMax'),
              bars: t('budgetBars'),
            }}
            onCommit={({ min, max }) => {
              if (
                (min ?? undefined) === parsed.minPrice &&
                (max ?? undefined) === parsed.maxPrice
              )
                return;
              go({ minPrice: min, maxPrice: max });
            }}
          />
        </Section>
      ) : null}

      <Group title={t('popular')}>
        <Check
          label={t('freeCancellation')}
          count={facets ? facets.freeCancellation : undefined}
          checked={parsed.freeCancellationOnly}
          onChange={() => go({ freeCancellationOnly: !parsed.freeCancellationOnly })}
        />
        {visible(count(facets?.ratings, 4), parsed.minRating === 4) ? (
          <Check
            label={t('ratingFloor', { word: t('ratingVeryGood'), score: '4' })}
            count={count(facets?.ratings, 4)}
            checked={parsed.minRating === 4}
            onChange={() => go({ minRating: parsed.minRating === 4 ? null : 4 })}
          />
        ) : null}
        {popularAmenities.map((option) => {
          const n = count(facets?.amenities, option.code);
          const checked = parsed.amenityCodes.includes(option.code);
          return visible(n, checked) ? (
            <Check
              key={option.code}
              label={option.label}
              count={n}
              checked={checked}
              onChange={() =>
                go({ amenityCodes: toggleIn(parsed.amenityCodes, option.code) })
              }
            />
          ) : null;
        })}
      </Group>

      {options.propertyTypes.length > 0 ? (
        <Group title={ts('propertyType')}>
          <Radio
            name="propertyTypeCode"
            label={ts('anyPropertyType')}
            checked={!parsed.propertyTypeCode}
            onChange={() => go({ propertyTypeCode: null })}
          />
          {options.propertyTypes.map((option) => {
            const n = count(facets?.propertyTypes, option.code);
            const checked = parsed.propertyTypeCode === option.code;
            return visible(n, checked) ? (
              <Radio
                key={option.code}
                name="propertyTypeCode"
                value={option.code}
                label={option.label}
                count={n}
                checked={checked}
                onChange={() => go({ propertyTypeCode: option.code })}
              />
            ) : null;
          })}
        </Group>
      ) : null}

      <Group title={t('rooms')}>
        <Stepper
          label={t('bedroomsLabel')}
          value={parsed.bedrooms}
          min={1}
          max={10}
          labels={{ fewer: t('fewer'), more: t('more') }}
          onChange={(value) => go({ bedrooms: value })}
        />
        <Stepper
          label={t('bathroomsLabel')}
          value={parsed.minBathrooms}
          min={0}
          max={BATHROOM_FLOORS[BATHROOM_FLOORS.length - 1] ?? 4}
          labels={{ fewer: t('fewer'), more: t('more') }}
          onChange={(value) => go({ minBathrooms: value })}
        />
      </Group>

      <AmenityGroup
        title={t('facilities')}
        options={options.facilities}
        counts={facets ? facets.amenities : undefined}
        selected={parsed.amenityCodes}
        labels={{ showAll: (n) => t('showAll', { count: n }), showLess: t('showLess') }}
        onToggle={(code) => go({ amenityCodes: toggleIn(parsed.amenityCodes, code) })}
      />
      <AmenityGroup
        title={t('houseRules')}
        options={options.houseRules}
        counts={facets ? facets.amenities : undefined}
        selected={parsed.amenityCodes}
        labels={{ showAll: (n) => t('showAll', { count: n }), showLess: t('showLess') }}
        onToggle={(code) => go({ amenityCodes: toggleIn(parsed.amenityCodes, code) })}
      />

      <Group title={ts('starRating')}>
        {[5, 4, 3, 2, 1].map((value) => {
          const n = count(facets?.starRatings, value);
          const checked = parsed.starRatings.includes(value);
          return visible(n, checked) ? (
            <Check
              key={value}
              name="starRatings"
              value={String(value)}
              label={tstar('stars', { count: value })}
              visual={
                <StarRating
                  value={value}
                  label={tstar('stars', { count: value })}
                  decorative
                />
              }
              count={n}
              checked={checked}
              onChange={() => go({ starRatings: toggleIn(parsed.starRatings, value) })}
            />
          ) : null;
        })}
        <p className="mt-1 text-13 leading-relaxed text-muted">
          {ts('starRatingHotelsOnly')}
        </p>
      </Group>

      <Group title={t('reviewScore')}>
        <Radio
          name="minRating"
          label={t('anyOption')}
          checked={parsed.minRating === undefined}
          onChange={() => go({ minRating: null })}
        />
        {RATING_FLOORS.map((floor) => {
          const word = {
            4.5: t('ratingExcellent'),
            4: t('ratingVeryGood'),
            3.5: t('ratingGood'),
            3: t('ratingPleasant'),
          }[floor];
          const n = count(facets?.ratings, floor);
          const checked = parsed.minRating === floor;
          return visible(n, checked) ? (
            <Radio
              key={floor}
              name="minRating"
              value={String(floor)}
              label={t('ratingFloor', { word, score: String(floor) })}
              count={n}
              checked={checked}
              onChange={() => go({ minRating: floor })}
            />
          ) : null;
        })}
      </Group>

      {parsed.citySlug &&
      (options.hasCentre || Object.values(facets?.centre ?? {}).some((n) => n > 0)) &&
      options.cityName ? (
        <Group title={t('centre', { city: options.cityName })}>
          <Radio
            name="maxCentreKm"
            label={t('anyOption')}
            checked={parsed.maxCentreKm === undefined}
            onChange={() => go({ maxCentreKm: null })}
          />
          {CENTRE_CEILINGS.map((km) => {
            const n = count(facets?.centre, km);
            const checked = parsed.maxCentreKm === km;
            return visible(n, checked) ? (
              <Radio
                key={km}
                name="maxCentreKm"
                value={String(km)}
                label={t('centreUnder', { km })}
                count={n}
                checked={checked}
                onChange={() => go({ maxCentreKm: km })}
              />
            ) : null;
          })}
        </Group>
      ) : null}

      <Group title={t('bedType')}>
        <Radio
          name="bedType"
          label={t('anyOption')}
          checked={!parsed.bedType}
          onChange={() => go({ bedType: null })}
        />
        {(['double', 'single'] as const).map((type) => {
          const n = count(facets?.bedTypes, type);
          const checked = parsed.bedType === type;
          return visible(n, checked) ? (
            <Radio
              key={type}
              name="bedType"
              value={type}
              label={type === 'double' ? t('bedDouble') : t('bedSingle')}
              count={n}
              checked={checked}
              onChange={() => go({ bedType: type })}
            />
          ) : null;
        })}
      </Group>

      <Group title={t('bookingPolicy')}>
        <Check
          name="freeCancellationOnly"
          value="true"
          label={t('freeCancellation')}
          count={facets ? facets.freeCancellation : undefined}
          checked={parsed.freeCancellationOnly}
          onChange={() => go({ freeCancellationOnly: !parsed.freeCancellationOnly })}
        />
      </Group>

      <Group title={ts('attributes')}>
        {options.attributes.map((option) => {
          const n = count(facets?.attributes, option.code);
          const checked = parsed.attributes.includes(option.code);
          return visible(n, checked) ? (
            <Check
              key={option.code}
              name="attributes"
              value={option.code}
              label={option.label}
              count={n}
              checked={checked}
              onChange={() =>
                go({ attributes: toggleIn(parsed.attributes, option.code) })
              }
            />
          ) : null;
        })}
      </Group>

      <AmenityGroup
        title={t('accessibility')}
        options={options.accessibility}
        counts={facets ? facets.amenities : undefined}
        selected={parsed.amenityCodes}
        labels={{ showAll: (n) => t('showAll', { count: n }), showLess: t('showLess') }}
        onToggle={(code) => go({ amenityCodes: toggleIn(parsed.amenityCodes, code) })}
      />

      {parsed.citySlug && options.landmarks.length > 0 ? (
        <Group title={ts('nearTitle')}>
          <SelectRow
            label={ts('nearTitle')}
            value={parsed.nearLandmark ?? ''}
            options={[{ code: '', label: ts('nearAny') }, ...options.landmarks]}
            onChange={(value) =>
              go({
                nearLandmark: value || null,
                sort: value
                  ? parsed.sort
                  : parsed.sort === 'distance_asc'
                    ? 'recommended'
                    : parsed.sort,
              })
            }
          />
          {options.landmarkKinds.length > 0 ? (
            <SelectRow
              label={ts('nearKind')}
              value={parsed.nearKind ?? ''}
              options={[{ code: '', label: ts('nearKindAny') }, ...options.landmarkKinds]}
              onChange={(value) => go({ nearKind: value || null })}
            />
          ) : null}
          {parsed.nearLandmark || parsed.nearKind ? (
            <SelectRow
              label={ts('nearRadius')}
              value={String(parsed.withinKm)}
              options={RADII_KM.map((km) => ({
                code: String(km),
                label: ts('nearRadiusKm', { value: km }),
              }))}
              onChange={(value) => go({ withinKm: Number(value) })}
            />
          ) : null}
        </Group>
      ) : null}
    </div>
  );

  const heading = (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-16 font-bold text-text">{t('filterBy')}</h2>
      {active > 0 ? (
        <a
          href={`/${locale}/search?${clearedFilters(parsed)}`}
          onClick={(event) => {
            event.preventDefault();
            startTransition(() =>
              router.push(`/${locale}/search?${clearedFilters(parsed)}`, {
                scroll: false,
              }),
            );
          }}
          className="inline-flex min-h-10 items-center text-14 font-semibold text-sky underline-offset-4 hover:underline lg:min-h-0"
        >
          {t('clearAll')}
        </a>
      ) : null}
    </div>
  );

  if (layout === 'column') {
    return (
      <div
        className="rounded-card border border-line bg-card px-4 py-3"
        aria-busy={pending}
      >
        {heading}
        <div
          className={`transition-opacity duration-200 ease-out ${pending ? 'opacity-60' : ''}`}
        >
          {groups}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ── Phone: the sticky bar ─────────────────────────────────────── */}
      <div className="sticky top-[var(--header-height,4.5rem)] z-30 -mx-4 flex items-center gap-2 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur-sm lg:hidden">
        {sortSlot}
        <button
          ref={opener}
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-3 text-14 font-bold text-text transition-[transform,border-color] duration-150 ease-out hover:border-gold active:scale-[0.97] motion-reduce:transition-none"
        >
          {t('filterButton')}
          {active > 0 ? (
            <span className="grid min-w-5 place-items-center rounded-full bg-gold px-1.5 text-12 font-bold text-ink">
              {active}
            </span>
          ) : null}
        </button>
        {mapButtonSlot}
      </div>

      {/* ── Desktop: the sidebar ──────────────────────────────────────── */}
      <div className="hidden lg:grid lg:gap-4">
        {mapThumbnailSlot}
        <div
          className="rounded-card border border-line bg-card px-4 py-3"
          aria-busy={pending}
        >
          {heading}
          <div
            className={`transition-opacity duration-200 ease-out ${pending ? 'opacity-60' : ''}`}
          >
            {groups}
          </div>
        </div>
      </div>

      {/* ── Phone: the sheet ──────────────────────────────────────────── */}
      {open ? (
        <div
          ref={sheet}
          role="dialog"
          aria-modal="true"
          aria-label={t('filterButton')}
          className="fixed inset-0 z-[70] flex flex-col bg-bg transition-[opacity,translate] duration-250 ease-out-strong starting:translate-y-4 starting:opacity-0 motion-reduce:transition-none lg:hidden"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            {heading}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-10 shrink-0 cursor-pointer items-center rounded-lg border border-line bg-card px-3 text-14 font-semibold text-text"
            >
              {t('closeFilters')}
            </button>
          </div>
          <div
            className={`flex-1 overflow-y-auto px-4 transition-opacity duration-200 ${pending ? 'opacity-60' : ''}`}
          >
            {groups}
          </div>
          <div className="border-t border-line bg-card px-4 py-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn-gold inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-lg px-4 text-15 font-bold"
            >
              {pending
                ? t('updating')
                : facets
                  ? t('showResults', { count: facets.total })
                  : t('showResultsNoCount')}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * A long amenity group: the busiest options first, the rest behind «اعرض الكل».
 *
 * Top-level, not declared inside the panel: a component defined during render is a NEW component
 * on every render, so React would remount it and throw away whether it was expanded.
 */
function AmenityGroup({
  title,
  options,
  counts,
  selected,
  labels,
  onToggle,
}: {
  title: string;
  options: FilterOption[];
  counts: Record<string, number> | undefined;
  selected: readonly string[];
  labels: { showAll: (count: number) => string; showLess: string };
  onToggle: (code: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const countOf = (code: string) => (counts ? (counts[code] ?? 0) : undefined);
  const shown = options.filter((option) => {
    const n = countOf(option.code);
    return selected.includes(option.code) || n === undefined || n > 0;
  });

  if (shown.length === 0) return null;

  const head = expanded ? shown : shown.slice(0, SHORT_LIST);

  return (
    <Group title={title}>
      {head.map((option) => (
        <Check
          key={option.code}
          name="amenityCodes"
          value={option.code}
          label={option.label}
          count={countOf(option.code)}
          checked={selected.includes(option.code)}
          onChange={() => onToggle(option.code)}
        />
      ))}
      {shown.length > SHORT_LIST ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="mt-1 inline-flex min-h-10 w-fit cursor-pointer items-center gap-1 text-14 font-semibold text-sky underline-offset-4 hover:underline lg:min-h-0 lg:py-1"
        >
          {expanded ? labels.showLess : labels.showAll(shown.length)}
        </button>
      ) : null}
    </Group>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <div className="py-4">{children}</div>;
}

/**
 * One sidebar group: a heading and its options.
 *
 * A labelled `role="group"` rather than `<fieldset>`/`<legend>`: it is announced the same way,
 * and a legend is laid out by the browser outside the box's own spacing, which left more room
 * under every title than above it — the heading floated away from the options it names.
 */
function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="grid gap-0.5 pb-4 pt-5">
      <h3 id={id} className="mb-1.5 text-15 font-bold text-text">
        {title}
      </h3>
      {children}
    </div>
  );
}

const row =
  'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md text-14 text-text2 transition-colors duration-150 ease-out hover:text-text lg:min-h-9';

function Count({ value }: { value: number | undefined }) {
  return value === undefined ? null : (
    <span className="ms-auto text-13 tabular-nums text-muted">{value}</span>
  );
}

function Check({
  name,
  value,
  label,
  visual,
  count,
  checked,
  onChange,
}: {
  /** The URL parameter this box writes, so the control says what it is to a test and a reader. */
  name?: string;
  value?: string;
  label: string;
  visual?: ReactNode;
  count?: number | undefined;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className={row}>
      <input
        type="checkbox"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="size-4.5 shrink-0 cursor-pointer accent-gold"
      />
      {visual ? (
        <>
          {visual}
          <span className="sr-only">{label}</span>
        </>
      ) : (
        <span>{label}</span>
      )}
      <Count value={count} />
    </label>
  );
}

function Radio({
  name,
  value = '',
  label,
  count,
  checked,
  onChange,
}: {
  name: string;
  value?: string;
  label: string;
  count?: number | undefined;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className={row}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="size-4.5 shrink-0 cursor-pointer accent-gold"
      />
      <span>{label}</span>
      <Count value={count} />
    </label>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  labels,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  labels: { fewer: string; more: string };
  onChange: (value: number) => void;
}) {
  const button =
    'grid size-10 cursor-pointer place-items-center rounded-lg border border-line bg-field text-18 font-bold text-text transition-[transform,border-color] duration-150 ease-out hover:border-gold active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none lg:size-9';
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-14 text-text2">
      <span>{label}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`${labels.fewer}: ${label}`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
          className={button}
        >
          −
        </button>
        <output
          aria-live="polite"
          className="w-6 text-center text-15 font-bold tabular-nums text-text"
        >
          {value}
        </output>
        <button
          type="button"
          aria-label={`${labels.more}: ${label}`}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
          className={button}
        >
          +
        </button>
      </div>
    </div>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 py-1 text-13 text-muted">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-10 w-full cursor-pointer rounded-lg border border-line bg-field px-3 text-14 text-text"
      >
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The value a promise settles to, or null until it does.
 *
 * Null again the moment a NEW promise arrives: a new search is a new set of counts, and the old
 * numbers beside a new list would be counts of something the reader is no longer looking at.
 */
function useArrived<T>(promise: Promise<T | null>): T | null {
  const [arrived, setArrived] = useState<{
    from: Promise<T | null>;
    value: T | null;
  } | null>(null);

  useEffect(() => {
    let current = true;
    promise.then(
      (value) => {
        if (current) setArrived({ from: promise, value });
      },
      () => {
        if (current) setArrived({ from: promise, value: null });
      },
    );
    return () => {
      current = false;
    };
  }, [promise]);

  return arrived?.from === promise ? arrived.value : null;
}
