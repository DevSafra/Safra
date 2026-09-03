'use client';

import { useEffect, useState } from 'react';

import { FieldPopover, Stepper } from '@/components/field-popover';

/**
 * The occupancy control, as booking.com draws it (Bashar, 2026-09-02, with a screenshot).
 *
 * One trigger reading «شخصان بالغان · لا أطفال», opening a panel of stepper rows.
 *
 * ## Why every word arrives as a prop
 *
 * The counts are ICU plurals — Arabic has six forms, and «بالغان» for exactly two is not something
 * a `${n} بالغ` template can produce. Resolving them needs next-intl, which is a server module
 * here. Rather than shipping a message runtime to the browser for three numbers, the SERVER
 * pre-renders every reachable label — the ranges are 1–8, 0–6 and 0–3, so that is eighteen strings
 * — and this component indexes into them. The catalogue stays the only place words live, and the
 * client bundle carries no formatter.
 *
 * ## What booking.com has that this does not
 *
 * Their panel also carries «غرف», «مسافر للعمل؟» and «هل ستصطحب معك حيوانات أليفة؟». SAFRA books a
 * UNIT rather than a room count, and has no business-travel or pets flag anywhere in the contract,
 * so those three would be controls that collect a value nothing reads. The three we do have are
 * the three the search endpoint takes.
 *
 * ## Without JavaScript
 *
 * The native selects render until mount — the same three this replaces, with the same names — so
 * the form still submits from a browser that never ran a script. The trigger is not painted until
 * it works.
 */
export function GuestsField({
  labels,
  defaults,
  icon,
  children,
}: {
  labels: {
    occupancy: string;
    adults: string;
    childrenLabel: string;
    infants: string;
    infantsHint: string;
    bedrooms: string;
    done: string;
    increase: string;
    decrease: string;
    /** Indexed by count. `adultsCounts[2]` is «بالغان». */
    adultsCounts: readonly string[];
    childrenCounts: readonly string[];
    infantsCounts: readonly string[];
  };
  defaults: { adults: number; children: number; infants: number; bedrooms: number };
  icon: React.ReactNode;
  /** The native selects, rendered by the server and shown until this mounts. */
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [adults, setAdults] = useState(defaults.adults);
  const [kids, setKids] = useState(defaults.children);
  const [infants, setInfants] = useState(defaults.infants);
  const [bedrooms, setBedrooms] = useState(defaults.bedrooms);

  useEffect(() => setMounted(true), []);

  if (!mounted) return <>{children}</>;

  /*
    The summary is the two counts booking.com shows. Infants are deliberately absent from it: they
    do not count toward occupancy — the search and booking services both compute `adults + children`
    — so putting them in the line that answers «how many people» would misstate the party.
  */
  const summary = `${labels.adultsCounts[adults]} · ${labels.childrenCounts[kids]}`;

  return (
    <>
      <input type="hidden" name="adults" value={adults} />
      <input type="hidden" name="children" value={kids} />
      <input type="hidden" name="infants" value={infants} />
      <input type="hidden" name="bedrooms" value={bedrooms} />

      <FieldPopover
        label={labels.occupancy}
        value={summary}
        doneLabel={labels.done}
        icon={icon}
      >
        <Stepper
          label={labels.adults}
          value={adults}
          min={1}
          max={8}
          onChange={setAdults}
          increase={labels.increase}
          decrease={labels.decrease}
        />
        <Stepper
          label={labels.childrenLabel}
          value={kids}
          min={0}
          max={6}
          onChange={setKids}
          increase={labels.increase}
          decrease={labels.decrease}
        />
        <Stepper
          label={labels.infants}
          value={infants}
          min={0}
          max={3}
          onChange={setInfants}
          increase={labels.increase}
          decrease={labels.decrease}
        />
        {/* Said plainly, because a «0» beside «الرضّع» otherwise reads as a bed they are not getting. */}
        <p className="pt-1 text-[0.6875rem] leading-relaxed text-faint">
          {labels.infantsHint}
        </p>

        {/*
          Bedrooms (Bashar, 2026-09-03), and it is a REQUIREMENT rather than a quantity — «find me a
          place with at least this many bedrooms», not «book me this many rooms». One booking is one
          unit in this model (`bookings.unit_id`), so the other reading is not expressible; he chose
          this one knowing that.

          Separated by a rule, because it answers a different question from the three above it: they
          describe the PARTY, this describes the PLACE. Sitting flush under «الرضّع» it read as a
          fourth kind of guest.
        */}
        <div className="mt-1 border-t border-line pt-3">
          <Stepper
            label={labels.bedrooms}
            value={bedrooms}
            /*
              One, never zero (Bashar, 2026-09-03: «as default set it to 1, never write أي عدد»).
              Every stay has at least one bedroom in practice — 41,559 of 41,559 units — so a floor
              of one filters nothing today and reads as a real answer where «أي عدد» read as a
              missing one.
            */
            min={1}
            max={6}
            onChange={setBedrooms}
            increase={labels.increase}
            decrease={labels.decrease}
          />
        </div>
      </FieldPopover>
    </>
  );
}
