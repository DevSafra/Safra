import type { Locale } from './locales.js';

/**
 * The one place a database state is given a word.
 *
 * ## Why this exists
 *
 * Bashar's decision, 2026-09-08: *«The same state should use the same terminology everywhere
 * unless there is a very strong reason not to. Customer Application, Partner Portal and Super
 * Admin Console should describe the same state using the same wording. I want a single canonical
 * status vocabulary for disputes and other operational workflows… Partners, customers and
 * administrators should not need to translate status names mentally between applications.»*
 *
 * Before it, each app owned its own copy and **22 of the 58 states they share were named
 * differently by two of them** — measured, not estimated. A dispute under review was «قيد
 * المراجعة» to an operator and «قيد الدراسة» to the guest they were on the phone with. An
 * authorised payment was «مُصرَّح بها» on the console and «محجوزة» to the customer. A gift card was
 * «مستخدمة» to staff and «مستبدلة» to the person holding it.
 *
 * ## And the one that was more than wording
 *
 * `disputeStatus.resolved` read «مغلق — لصالح العميل» on the console, «محسوم لصالح الضيف» in the
 * portal, and simply «محسوم» to the CUSTOMER — the only party not told in whose favour their own
 * complaint had been decided. `rejected` read «مرفوض» to them, which says their complaint was
 * refused without saying the host was found to be in the right. Bashar asked for both outcomes to
 * be legible to the customer, so both now name the party they went to, in every app and every
 * language.
 *
 * ## What lives here, and what does not
 *
 * Only vocabularies that MORE THAN ONE app shows. A console-only set — `couponStatus`,
 * `adInvoiceStatus`, `exportStatus` — has no second reader to disagree with and stays in the
 * console's own catalogue. This is not a general enum dump; it is the list of words two people
 * looking at two screens must agree about.
 *
 * ## Every state carries all three languages, together
 *
 * Not because every surface serves three: the console and the portal are Arabic-only today. The
 * three sit side by side so that «add a language» stays a task somebody can finish — the failure
 * `docs/i18n.md` opens with is a German customer reading Arabic because a word was written
 * somewhere invisible to that task. `statuses.test.ts` fails if a state is missing one.
 *
 * ## The constraint this must not break
 *
 * The console's rule 2 — no two statuses visible on ONE screen may share a word or a colour
 * (`packages/ui/src/status.ts`). Unifying a word across apps must not collapse two words within
 * one. Every choice below was checked against `apps/admin/src/lib/status-tone.test.ts`, which
 * compares words per vocabulary AND across vocabularies against `statusTone`; two of the choices
 * here — «سارية» for a live gift card rather than «نشطة», and «قيد الدراسة» for a dispute under
 * review rather than «قيد المراجعة» — improve that distinctness rather than costing it.
 */

/** One state, in every language the platform speaks. */
type Words = Readonly<Record<Locale, string>>;

/** The canonical word for every state two or more apps show. */
const CATALOGUE = {
  /**
   * `booking_status`. The guest, the host and the operator all read this one.
   *
   * `checked_in` takes the customer's fuller «تم تسجيل الوصول» over the console's «تم الوصول»:
   * arrival and CHECK-IN are different moments, and the shorter word does not say which. `disputed`
   * takes the customer's «قيد النزاع» over «متنازع عليه» for the same reason «قيد الدراسة» wins
   * below — it names an ongoing process rather than a quality of the booking.
   */
  bookingStatus: {
    draft: { ar: 'مسودة', en: 'Draft', de: 'Entwurf' },
    pending_payment: {
      ar: 'بانتظار الدفع',
      en: 'Awaiting payment',
      de: 'Zahlung ausstehend',
    },
    pending_confirmation: {
      ar: 'قيد التأكيد',
      en: 'Awaiting confirmation',
      de: 'Bestätigung ausstehend',
    },
    confirmed: { ar: 'مؤكد', en: 'Confirmed', de: 'Bestätigt' },
    cancelled: { ar: 'ملغى', en: 'Cancelled', de: 'Storniert' },
    checked_in: { ar: 'تم تسجيل الوصول', en: 'Checked in', de: 'Eingecheckt' },
    completed: { ar: 'مكتمل', en: 'Completed', de: 'Abgeschlossen' },
    disputed: { ar: 'قيد النزاع', en: 'Disputed', de: 'Strittig' },
  },

  /**
   * `payment_status`, and the union الدفع paints — thirteen values on one table.
   *
   * Three were renamed to the customer's word because the customer's word says what HAPPENED and
   * the console's said how the attempt went: `authorized` is «محجوزة» (the money is held) rather
   * than «مُصرَّح بها» (it was authorised); `captured` is «مقبوضة» (it was received) rather than
   * «ناجحة» (it succeeded — at what?); and `requires_action` is «تحتاج تحققاً», which names the
   * 3-D Secure step the payer has to complete rather than an unspecified «إجراء».
   */
  paymentStatus: {
    initiated: { ar: 'بدأت', en: 'Started', de: 'Gestartet' },
    requires_action: {
      ar: 'تحتاج تحققاً',
      en: 'Needs verification',
      de: 'Bestätigung erforderlich',
    },
    authorized: { ar: 'محجوزة', en: 'Held', de: 'Reserviert' },
    captured: { ar: 'مقبوضة', en: 'Captured', de: 'Eingezogen' },
    failed: { ar: 'فشلت', en: 'Failed', de: 'Fehlgeschlagen' },
    expired: { ar: 'منتهية', en: 'Expired', de: 'Abgelaufen' },
    refunded: { ar: 'مستردة', en: 'Refunded', de: 'Erstattet' },
    partially_refunded: {
      ar: 'مستردة جزئياً',
      en: 'Partially refunded',
      de: 'Teilweise erstattet',
    },
    pending: { ar: 'بالانتظار', en: 'Pending', de: 'Ausstehend' },
    processing: { ar: 'قيد المعالجة', en: 'Processing', de: 'In Bearbeitung' },
    completed: { ar: 'مكتمل', en: 'Completed', de: 'Abgeschlossen' },
    collected: { ar: 'محصلة', en: 'Collected', de: 'Eingenommen' },
    waived: { ar: 'معفاة', en: 'Waived', de: 'Erlassen' },
  },

  /**
   * `dispute_status` — the vocabulary Bashar named explicitly.
   *
   * `resolved` and `rejected` both state the party the decision went TO, because that is the fact
   * all three readers need and none of the three old wordings gave the customer. «مرفوض» told them
   * their complaint was refused; it did not tell them SAFRA had found the host to be in the right,
   * which is what a rejection means.
   *
   * `investigating` is «قيد الدراسة», the word the guest and the host already read, rather than the
   * console's «قيد المراجعة» — which the console also uses for a listing awaiting review, so this
   * choice removes a collision as well as a divergence.
   */
  disputeStatus: {
    open: { ar: 'مفتوح', en: 'Open', de: 'Offen' },
    investigating: { ar: 'قيد الدراسة', en: 'Under review', de: 'In Prüfung' },
    resolved: {
      ar: 'محسوم لصالح العميل',
      en: 'Settled in the customer’s favour',
      de: 'Zugunsten des Kunden entschieden',
    },
    rejected: {
      ar: 'محسوم لصالح الشريك',
      en: 'Settled in the partner’s favour',
      de: 'Zugunsten des Partners entschieden',
    },
  },

  /**
   * `dispute_kind` as a LABEL — what the category is called on a list, a filter and a case file.
   *
   * The three apps had three registers of one category: the console named it with its SRS code
   * («العقار غير متاح (EC-006)»), the portal described it, and the customer app asked it as a
   * first-person question («المكان كان مغلقاً أو غير متاح عند وصولي»). The question is a genuinely
   * different job and keeps its own copy — `disputeReasons` in the customer catalogue, which is
   * what the form's options read. This is the noun all three now show.
   *
   * The console appends its EC code where an operator needs the traceability, so nothing was lost:
   * a code beside a canonical label is composition, not a second vocabulary.
   */
  disputeKind: {
    property_unavailable: {
      ar: 'العقار غير متاح',
      en: 'Property unavailable',
      de: 'Unterkunft nicht verfügbar',
    },
    not_as_described: {
      ar: 'غير مطابق للوصف',
      en: 'Not as described',
      de: 'Nicht wie beschrieben',
    },
    partner_no_response: {
      ar: 'الشريك لم يردّ',
      en: 'Host did not respond',
      de: 'Gastgeber hat nicht geantwortet',
    },
    complaint: { ar: 'شكوى أخرى', en: 'Other complaint', de: 'Andere Beschwerde' },
  },

  /**
   * `gift_card_status`.
   *
   * A gift card is REDEEMED, not «used», and it is «سارية» while it is in force rather than
   * «نشطة» — which the console also spends on a live coupon, an active user and a running ad.
   */
  giftCardStatus: {
    active: { ar: 'سارية', en: 'Active', de: 'Aktiv' },
    used: { ar: 'مستبدلة', en: 'Redeemed', de: 'Eingelöst' },
    expired: { ar: 'منتهية', en: 'Expired', de: 'Abgelaufen' },
    cancelled: { ar: 'ملغاة', en: 'Cancelled', de: 'Storniert' },
  },

  /** `payout_status`. The console and the portal already agreed; recorded here so they cannot stop. */
  payoutStatus: {
    accruing: { ar: 'قيد التجميع', en: 'Accruing', de: 'Wird angesammelt' },
    pending_release: {
      ar: 'بانتظار الإفراج',
      en: 'Awaiting release',
      de: 'Freigabe ausstehend',
    },
    on_hold: { ar: 'معلَّق', en: 'On hold', de: 'Zurückgehalten' },
    scheduled: { ar: 'مجدول', en: 'Scheduled', de: 'Geplant' },
    paid: { ar: 'مدفوع', en: 'Paid', de: 'Ausgezahlt' },
    cancelled: { ar: 'ملغى', en: 'Cancelled', de: 'Storniert' },
  },

  /** `payout_account_status` (§11.4). Already agreed; recorded so it stays that way. */
  payoutAccountStatus: {
    pending: { ar: 'قيد المراجعة', en: 'Under review', de: 'In Prüfung' },
    verified: { ar: 'موثَّق', en: 'Verified', de: 'Verifiziert' },
    rejected: { ar: 'مرفوض', en: 'Rejected', de: 'Abgelehnt' },
  },

  /**
   * `property_status`.
   *
   * `suspended` takes the console's «موقوف مؤقتاً» over the portal's «موقوف»: the word a partner
   * reads about their own listing must say that it is TEMPORARY, which is the difference between a
   * problem to fix and a business that has ended.
   */
  propertyStatus: {
    draft: { ar: 'مسودة', en: 'Draft', de: 'Entwurf' },
    pending_review: { ar: 'قيد المراجعة', en: 'Under review', de: 'In Prüfung' },
    rejected: { ar: 'مرفوض', en: 'Rejected', de: 'Abgelehnt' },
    approved: { ar: 'معتمد', en: 'Approved', de: 'Genehmigt' },
    published: { ar: 'منشور', en: 'Published', de: 'Veröffentlicht' },
    suspended: { ar: 'موقوف مؤقتاً', en: 'Suspended', de: 'Vorübergehend gesperrt' },
    archived: { ar: 'مؤرشف', en: 'Archived', de: 'Archiviert' },
  },

  /**
   * `violation_kind`. The partner's fuller wording wins throughout.
   *
   * The console's were operator shorthand — «عدم الرد», «رفض بعد الدفع», «وصف غير مطابق» — and the
   * partner's name the same thing precisely enough to be read by the person it is charged against:
   * failing to answer a BOOKING REQUEST, rejecting a booking AFTER PAYMENT, inaccurate LISTING
   * data. An operator loses nothing by reading the precise version.
   */
  violationKind: {
    no_response: {
      ar: 'عدم الرد على طلب حجز',
      en: 'No response to a booking request',
      de: 'Keine Antwort auf eine Buchungsanfrage',
    },
    rejected_after_payment: {
      ar: 'رفض الحجز بعد الدفع',
      en: 'Booking rejected after payment',
      de: 'Buchung nach Zahlung abgelehnt',
    },
    stale_calendar: {
      ar: 'تقويم غير محدَّث',
      en: 'Calendar not kept up to date',
      de: 'Kalender nicht aktuell',
    },
    inaccurate_listing: {
      ar: 'بيانات إعلان غير دقيقة',
      en: 'Inaccurate listing data',
      de: 'Ungenaue Angebotsdaten',
    },
    no_show: {
      ar: 'عدم استقبال الضيف',
      en: 'Guest not received',
      de: 'Gast nicht empfangen',
    },
  },

  /**
   * `violation_stage` — the enforcement ladder.
   *
   * Nouns naming the RUNG, consistently. The console had verb phrases («سُجّلت», «صدر إنذار», «رُفع
   * إلى الإيقاف») and the portal nouns, so the same ladder read as two. `warned` is «إنذار» rather
   * than the portal's «تحذير» because «إنذار» is the platform's own word for it everywhere else —
   * the mail a partner receives is «إنذار على حسابك».
   */
  violationStage: {
    recorded: { ar: 'مسجّلة', en: 'Recorded', de: 'Erfasst' },
    warned: { ar: 'إنذار', en: 'Warning', de: 'Verwarnung' },
    fined: { ar: 'غرامة', en: 'Fine', de: 'Geldbuße' },
    suspension: { ar: 'إيقاف', en: 'Suspension', de: 'Sperrung' },
  },
} as const satisfies Record<string, Record<string, Words>>;

/** The vocabularies the canonical catalogue owns. */
export type StatusVocabulary = keyof typeof CATALOGUE;

export const STATUS_VOCABULARIES = Object.keys(CATALOGUE) as readonly StatusVocabulary[];

/** Every state in one vocabulary, in every language — for the tests and for the apps' catalogues. */
export const STATUS_CATALOGUE: Readonly<
  Record<StatusVocabulary, Readonly<Record<string, Words>>>
> = CATALOGUE;

/**
 * One vocabulary, flattened into `{value: word}` for a single locale.
 *
 * This is the shape every app's own catalogue already had, which is the point: an app's table
 * becomes a call to this instead of a list of words, so there is nothing left to edit out of step.
 * Memoised because the console builds its filter dropdowns on every render.
 */
const flattened = new Map<string, Readonly<Record<string, string>>>();

export function statusWords(
  vocabulary: StatusVocabulary,
  locale: Locale,
): Readonly<Record<string, string>> {
  const key = `${vocabulary}:${locale}`;
  const cached = flattened.get(key);

  if (cached) return cached;

  /*
    Read through `STATUS_CATALOGUE` rather than the literal.

    The literal's `as const satisfies` type is a union of ten differently-shaped members, so
    indexing it by a VARIABLE vocabulary widens to `any` — and the lint rule is right to refuse
    that: an `any` here would return `undefined` for a locale nobody had added and the screen would
    print nothing rather than failing. The exported alias carries the declared shape.
  */
  const table: Record<string, string> = Object.fromEntries(
    Object.entries(STATUS_CATALOGUE[vocabulary]).map(([value, words]) => [
      value,
      words[locale],
    ]),
  );

  flattened.set(key, table);

  return table;
}

/**
 * One state's word, or the raw value when the catalogue does not know it.
 *
 * The fallback is the VALUE, deliberately and consistently with `label()`: a state added to an
 * enum and not to this file must look like the gap it is. Prettifying it into «Pending Review»
 * hid 43 missing translations once, and the rule since then is that a missing word reads as a
 * missing word.
 */
export function statusWord(
  vocabulary: StatusVocabulary,
  value: string,
  locale: Locale,
): string {
  return statusWords(vocabulary, locale)[value] ?? value;
}

/**
 * Every state that belongs to exactly ONE vocabulary, as `{value: word}`.
 *
 * ## What this is for
 *
 * The console's audit log renders a payload value through a single flat map, because a payload is
 * one column with one voice: `dispute.notified`'s `outcome` and `property.suspended`'s `status`
 * are read in the same table, so the map cannot be per-vocabulary. That was a fair reason to write
 * it out by hand — and it left the audit trail saying «قيد المراجعة» about a dispute the screens
 * call «قيد الدراسة», which is the divergence Bashar's decision of 2026-09-08 removes.
 *
 * Most values are not ambiguous at all: `checked_in`, `investigating`, `no_show`, `recorded` and
 * twenty more belong to one vocabulary each, so there is exactly one right word and no reason for
 * the audit log to hold a second. Those come from here.
 *
 * ## And the ones this deliberately omits
 *
 * `active` is «سارية» for a gift card and «نشط» for a coupon; `rejected` is «مرفوض» for a listing
 * and «محسوم لصالح الشريك» for a dispute. A merged lookup would pick whichever vocabulary came
 * first and print the wrong agreement with confidence, which is worse than an identifier. Those
 * stay a deliberate choice at the call site — see `enums.payloadValue` in the console's catalogue,
 * and finding 226 for the keyed-by-(key, value) shape that would resolve them properly.
 */
export function unambiguousStatusWords(locale: Locale): Readonly<Record<string, string>> {
  const seen = new Map<string, number>();

  for (const vocabulary of STATUS_VOCABULARIES) {
    for (const value of Object.keys(STATUS_CATALOGUE[vocabulary])) {
      seen.set(value, (seen.get(value) ?? 0) + 1);
    }
  }

  const words: Record<string, string> = {};

  for (const vocabulary of STATUS_VOCABULARIES) {
    for (const value of Object.keys(STATUS_CATALOGUE[vocabulary])) {
      if (seen.get(value) === 1) words[value] = statusWord(vocabulary, value, locale);
    }
  }

  return words;
}
