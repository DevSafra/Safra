/**
 * Reference data seed — the rows the platform cannot function without.
 *
 * This is NOT demo content. Currencies, countries, cities, property types,
 * amenities and cancellation policies are all admin-editable tables (P-005), so
 * this file only establishes the launch baseline the SRS specifies. Everything
 * here is idempotent on its natural key, so re-running a deploy is safe.
 *
 * Cities carry a real IANA timezone because the same-day booking cutoff (§5.3) is
 * 17:00 in the CITY's local time — not the server's and not the visitor's.
 */

export interface CurrencySeed {
  code: string;
  nameAr: string;
  nameEn: string;
  nameDe: string;
  symbol: string;
  decimals: number;
  /** Whether the platform OFFERS it. See the note on `CURRENCIES`. */
  isActive: boolean;
}

/**
 * §1.4: SYP is the internal accounting currency; USD is the pricing anchor.
 *
 * ## ONE currency is offered, and it is the dollar (Bashar, 2026-09-14)
 *
 * «Remove all currencies from the system and keep only USD for everything.» So `USD` is the only
 * row with `isActive`, which is what the public `/currencies` list answers with and what the
 * platform prices, quotes, charges and displays in.
 *
 * **SYP stays as a row, and is not a contradiction.** It is not something anyone chooses: every
 * ledger leg is written with `amount_syp` and `fx_rate_to_syp` beside its own amount, because SAFRA
 * BOOKS in Syrian pounds whatever it prices in. Retiring the row would orphan the accounting basis
 * of every booking already recorded. It is inactive, so nothing offers it; the ledger addresses it
 * by code regardless.
 *
 * EUR was offered until that date and priced nothing — zero units, and `fx_rates` holds one pair,
 * USD→SYP, so a euro figure could only ever have been invented. It is dropped from this list and
 * retired in `0077_usd_only.sql`; JOD and LBP went the same way on 2026-08-30, for the same reason.
 *
 * Nothing is DELETED from an existing database: a row is cheaper to keep than a foreign key is to
 * unpick, and P-003 forbids the destructive version.
 */
export const CURRENCIES: CurrencySeed[] = [
  {
    code: 'SYP',
    nameAr: 'ليرة سورية',
    nameEn: 'Syrian Pound',
    nameDe: 'Syrisches Pfund',
    symbol: 'ل.س',
    decimals: 2,
    /* The books are kept in it; nobody picks it. */
    isActive: false,
  },
  {
    code: 'USD',
    nameAr: 'دولار أمريكي',
    nameEn: 'US Dollar',
    nameDe: 'US-Dollar',
    symbol: '$',
    decimals: 2,
    isActive: true,
  },
];

export interface CountrySeed {
  code: string;
  nameAr: string;
  nameEn: string;
  nameDe: string;
  displayCurrency: string;
  isLaunchMarket: boolean;
}

/** §1.3: Syria, Jordan and Lebanon at launch. Others are explicitly out of scope. */
export const COUNTRIES: CountrySeed[] = [
  {
    code: 'SY',
    nameAr: 'سوريا',
    nameEn: 'Syria',
    nameDe: 'Syrien',
    displayCurrency: 'USD',
    isLaunchMarket: true,
  },
  {
    code: 'JO',
    nameAr: 'الأردن',
    nameEn: 'Jordan',
    nameDe: 'Jordanien',
    /* USD, like the other two: JOD has no rate and cannot price a booking. See `CURRENCIES`. */
    displayCurrency: 'USD',
    isLaunchMarket: true,
  },
  {
    code: 'LB',
    nameAr: 'لبنان',
    nameEn: 'Lebanon',
    nameDe: 'Libanon',
    displayCurrency: 'USD',
    isLaunchMarket: true,
  },
];

export type CityCategorySeed = 'coastal' | 'mountain' | 'desert' | 'historic';

export interface CitySeed {
  country: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  nameDe: string;
  timezone: string;
  categories: CityCategorySeed[];
  latitude: string;
  longitude: string;
  descriptionAr: string;
  tagsAr: string[];
  sortOrder: number;
}

/**
 * The nine cities from the approved prototype, with its Arabic copy preserved —
 * that text was signed off as part of the design and is the launch content.
 */
export const CITIES: CitySeed[] = [
  {
    country: 'SY',
    slug: 'damascus',
    nameAr: 'دمشق',
    nameEn: 'Damascus',
    nameDe: 'Damaskus',
    timezone: 'Asia/Damascus',
    categories: ['historic'],
    latitude: '33.5138',
    longitude: '36.2765',
    descriptionAr:
      'أقدم عاصمة مأهولة في العالم. أزقة المدينة القديمة، بيوت عربية بباحات داخلية، وياسمين يتسلق الجدران. الإقامات تتنوع بين فنادق تراثية وشقق مفروشة قرب باب توما والشعلان.',
    tagsAr: ['المدينة القديمة', 'سوق الحميدية', 'الجامع الأموي', 'جبل قاسيون'],
    sortOrder: 1,
  },
  {
    country: 'SY',
    slug: 'aleppo',
    nameAr: 'حلب',
    nameEn: 'Aleppo',
    nameDe: 'Aleppo',
    timezone: 'Asia/Damascus',
    categories: ['historic'],
    latitude: '36.2021',
    longitude: '37.1343',
    descriptionAr:
      'مدينة القلعة والأسواق المسقوفة. بيوت حلبية تراثية رُمّمت بعناية تستقبل الضيوف حول باحاتها، ومطبخ يُعد الأشهر في المشرق.',
    tagsAr: ['القلعة', 'الأسواق المسقوفة', 'بيوت الأجنحة', 'المطبخ الحلبي'],
    sortOrder: 2,
  },
  {
    country: 'SY',
    slug: 'latakia',
    nameAr: 'اللاذقية',
    nameEn: 'Latakia',
    nameDe: 'Latakia',
    timezone: 'Asia/Damascus',
    categories: ['coastal'],
    latitude: '35.5317',
    longitude: '35.7915',
    descriptionAr:
      'عاصمة الساحل السوري. فلل وشاليهات على البحر مباشرة، وقرب من غابات صلنفة وكسب لمن يريد الجمع بين البحر والجبل في رحلة واحدة.',
    tagsAr: ['الشاطئ الأزرق', 'أوغاريت', 'الكورنيش الجنوبي'],
    sortOrder: 3,
  },
  {
    country: 'SY',
    slug: 'tartus',
    nameAr: 'طرطوس',
    nameEn: 'Tartus',
    nameDe: 'Tartus',
    timezone: 'Asia/Damascus',
    categories: ['coastal'],
    latitude: '34.8890',
    longitude: '35.8866',
    descriptionAr:
      'مدينة ساحلية هادئة قبالة جزيرة أرواد. شاليهات عائلية وشقق مطلة على الميناء، وأسعار ألطف من جارتها الشمالية.',
    tagsAr: ['جزيرة أرواد', 'الكورنيش', 'المدينة القديمة'],
    sortOrder: 4,
  },
  {
    country: 'SY',
    slug: 'kasab',
    nameAr: 'كسب',
    nameEn: 'Kasab',
    nameDe: 'Kasab',
    timezone: 'Asia/Damascus',
    categories: ['mountain'],
    latitude: '35.9333',
    longitude: '35.9833',
    descriptionAr:
      'بلدة جبلية على الحدود الشمالية تغفو بين غابات الصنوبر والغار. مزارع وبيوت ريفية بإطلالات على البحر من علوّ 800 متر — وجهة شهر العسل الأولى.',
    tagsAr: ['غابات الصنوبر', 'الضباب الصباحي', 'مسارات المشي'],
    sortOrder: 5,
  },
  {
    country: 'SY',
    slug: 'palmyra',
    nameAr: 'تدمر',
    nameEn: 'Palmyra',
    nameDe: 'Palmyra',
    timezone: 'Asia/Damascus',
    categories: ['desert', 'historic'],
    latitude: '34.5520',
    longitude: '38.2687',
    descriptionAr:
      'عروس الصحراء وممر القوافل القديم. مخيمات نجمية بين النخيل والأعمدة، حيث تُرى المجرّة بالعين المجردة.',
    tagsAr: ['الأعمدة الرومانية', 'قوس النصر', 'سماء الصحراء'],
    sortOrder: 6,
  },
  {
    country: 'JO',
    slug: 'aqaba',
    nameAr: 'العقبة',
    nameEn: 'Aqaba',
    nameDe: 'Akaba',
    timezone: 'Asia/Amman',
    categories: ['coastal'],
    latitude: '29.5321',
    longitude: '35.0063',
    descriptionAr:
      'بوابة الأردن على البحر الأحمر. فنادق وشقق قرب الشاطئ، وغوص بين الشعاب المرجانية، على بعد ساعة من رمال وادي رم.',
    tagsAr: ['البحر الأحمر', 'الغوص والشعاب', 'وادي رم قريباً'],
    sortOrder: 7,
  },
  {
    country: 'JO',
    slug: 'petra',
    nameAr: 'البتراء',
    nameEn: 'Petra',
    nameDe: 'Petra',
    timezone: 'Asia/Amman',
    categories: ['desert', 'historic'],
    latitude: '30.3285',
    longitude: '35.4444',
    descriptionAr:
      'المدينة الوردية المنحوتة في الصخر. مخيمات بدوية ونُزل تطل على جبال وادي موسى، وتجربة «البتراء ليلاً» على ضوء الشموع.',
    tagsAr: ['الخزنة', 'السيق', 'ليالي البتراء'],
    sortOrder: 8,
  },
  {
    country: 'LB',
    slug: 'tripoli',
    nameAr: 'طرابلس',
    nameEn: 'Tripoli',
    nameDe: 'Tripoli',
    timezone: 'Asia/Beirut',
    categories: ['coastal'],
    latitude: '34.4367',
    longitude: '35.8497',
    descriptionAr:
      'عاصمة الشمال اللبناني: قلعة مملوكية، خانات عثمانية، وأشهر حلويات الساحل. شقق مفروشة في الميناء وإطلالات على جزر النخيل.',
    tagsAr: ['قلعة طرابلس', 'خانات المدينة', 'حلويات عربية'],
    sortOrder: 9,
  },
];

export interface PropertyTypeSeed {
  code: string;
  nameAr: string;
  nameEn: string;
  nameDe: string;
  hasMultipleUnits: boolean;
  glyph: string;
  sortOrder: number;
}

/** §8.2. `hasMultipleUnits` drives whether the partner UI manages rooms. */
export const PROPERTY_TYPES: PropertyTypeSeed[] = [
  {
    code: 'hotel',
    nameAr: 'فندق',
    nameEn: 'Hotel',
    nameDe: 'Hotel',
    hasMultipleUnits: true,
    glyph: '🏨',
    sortOrder: 1,
  },
  {
    code: 'apartment',
    nameAr: 'شقة مفروشة',
    nameEn: 'Furnished apartment',
    nameDe: 'Möblierte Wohnung',
    hasMultipleUnits: false,
    glyph: '🏢',
    sortOrder: 2,
  },
  {
    code: 'villa',
    nameAr: 'فيلا',
    nameEn: 'Villa',
    nameDe: 'Villa',
    hasMultipleUnits: false,
    glyph: '🏡',
    sortOrder: 3,
  },
  {
    code: 'farm',
    nameAr: 'مزرعة',
    nameEn: 'Farm',
    nameDe: 'Bauernhof',
    hasMultipleUnits: false,
    glyph: '🌾',
    sortOrder: 4,
  },
  {
    code: 'chalet',
    nameAr: 'شاليه',
    nameEn: 'Chalet',
    nameDe: 'Chalet',
    hasMultipleUnits: false,
    glyph: '🏖️',
    sortOrder: 5,
  },
  {
    code: 'rural_house',
    nameAr: 'بيت ريفي',
    nameEn: 'Rural house',
    nameDe: 'Landhaus',
    hasMultipleUnits: false,
    glyph: '🏘️',
    sortOrder: 6,
  },
  {
    code: 'camp',
    nameAr: 'مخيم',
    nameEn: 'Camp',
    nameDe: 'Camp',
    hasMultipleUnits: true,
    glyph: '⛺',
    sortOrder: 7,
  },
];

export interface AmenitySeed {
  code: string;
  nameAr: string;
  nameEn: string;
  nameDe: string;
  category: string;
  isFilterable: boolean;
  sortOrder: number;
}

/** §5.5 names the required filters; these are exactly those, plus prototype extras. */
export const AMENITIES: AmenitySeed[] = [
  {
    code: 'wifi',
    nameAr: 'إنترنت',
    nameEn: 'Internet',
    nameDe: 'Internet',
    category: 'facilities',
    isFilterable: true,
    sortOrder: 1,
  },
  {
    code: 'parking',
    nameAr: 'موقف سيارات',
    nameEn: 'Parking',
    nameDe: 'Parkplatz',
    category: 'facilities',
    isFilterable: true,
    sortOrder: 2,
  },
  {
    code: 'pool',
    nameAr: 'مسبح',
    nameEn: 'Pool',
    nameDe: 'Pool',
    category: 'facilities',
    isFilterable: true,
    sortOrder: 3,
  },
  {
    code: 'breakfast',
    nameAr: 'إفطار',
    nameEn: 'Breakfast',
    nameDe: 'Frühstück',
    category: 'facilities',
    isFilterable: true,
    sortOrder: 4,
  },
  {
    code: 'air_conditioning',
    nameAr: 'تكييف',
    nameEn: 'Air conditioning',
    nameDe: 'Klimaanlage',
    category: 'facilities',
    isFilterable: true,
    sortOrder: 5,
  },
  {
    code: 'kitchen',
    nameAr: 'مطبخ',
    nameEn: 'Kitchen',
    nameDe: 'Küche',
    category: 'facilities',
    isFilterable: true,
    sortOrder: 6,
  },
  {
    code: 'heating',
    nameAr: 'تدفئة',
    nameEn: 'Heating',
    nameDe: 'Heizung',
    category: 'facilities',
    isFilterable: true,
    sortOrder: 7,
  },
  {
    code: 'reception_24h',
    nameAr: 'استقبال 24 ساعة',
    nameEn: '24h reception',
    nameDe: '24h-Rezeption',
    category: 'facilities',
    isFilterable: true,
    sortOrder: 8,
  },
  {
    code: 'sea_view',
    nameAr: 'إطلالة على البحر',
    nameEn: 'Sea view',
    nameDe: 'Meerblick',
    category: 'facilities',
    isFilterable: true,
    sortOrder: 9,
  },
  {
    code: 'pets_allowed',
    nameAr: 'يسمح بالحيوانات',
    nameEn: 'Pets allowed',
    nameDe: 'Haustiere erlaubt',
    category: 'rules',
    isFilterable: true,
    sortOrder: 10,
  },
  {
    code: 'family_friendly',
    nameAr: 'مناسب للعائلات',
    nameEn: 'Family friendly',
    nameDe: 'Familienfreundlich',
    category: 'rules',
    isFilterable: true,
    sortOrder: 11,
  },
  {
    code: 'accessible',
    nameAr: 'مناسب لذوي الاحتياجات',
    nameEn: 'Accessible',
    nameDe: 'Barrierefrei',
    category: 'accessibility',
    isFilterable: true,
    sortOrder: 12,
  },
];

export interface CancellationPolicySeed {
  code: string;
  nameAr: string;
  nameEn: string;
  nameDe: string;
  descriptionAr: string;
  descriptionEn: string;
  descriptionDe: string;
  tiers: { hoursBeforeCheckIn: number; refundPercent: number }[];
  minRefundPercent: number;
}

/**
 * §7.4: partners choose from SAFRA-approved policies rather than writing their own,
 * and no policy may refund below 50% except by explicit admin exception. The
 * database CHECK constraint enforces the floor independently of this data.
 */
export const CANCELLATION_POLICIES: CancellationPolicySeed[] = [
  {
    code: 'flex',
    nameAr: 'مرن',
    nameEn: 'Flexible',
    nameDe: 'Flexibel',
    descriptionAr: 'إلغاء مجاني حتى 48 ساعة قبل الوصول، ثم استرداد 50٪.',
    descriptionEn: 'Free cancellation up to 48 hours before check-in, then 50% refund.',
    descriptionDe:
      'Kostenlose Stornierung bis 48 Stunden vor Anreise, danach 50 % Rückerstattung.',
    tiers: [
      { hoursBeforeCheckIn: 48, refundPercent: 100 },
      { hoursBeforeCheckIn: 0, refundPercent: 50 },
    ],
    minRefundPercent: 50,
  },
  {
    code: 'moderate',
    nameAr: 'متوسط',
    nameEn: 'Moderate',
    nameDe: 'Moderat',
    descriptionAr: 'إلغاء مجاني حتى 5 أيام قبل الوصول، ثم استرداد 50٪.',
    descriptionEn: 'Free cancellation up to 5 days before check-in, then 50% refund.',
    descriptionDe:
      'Kostenlose Stornierung bis 5 Tage vor Anreise, danach 50 % Rückerstattung.',
    tiers: [
      { hoursBeforeCheckIn: 120, refundPercent: 100 },
      { hoursBeforeCheckIn: 0, refundPercent: 50 },
    ],
    minRefundPercent: 50,
  },
  {
    code: 'strict',
    nameAr: 'صارم',
    nameEn: 'Strict',
    nameDe: 'Streng',
    descriptionAr: 'استرداد 50٪ حتى 7 أيام قبل الوصول، وهو الحد الأدنى المسموح في سفرة.',
    descriptionEn: '50% refund up to 7 days before check-in — the minimum SAFRA permits.',
    descriptionDe:
      '50 % Rückerstattung bis 7 Tage vor Anreise — das von SAFRA erlaubte Minimum.',
    tiers: [{ hoursBeforeCheckIn: 168, refundPercent: 50 }],
    minRefundPercent: 50,
  },
];

export interface PartnerTypeSeed {
  code: string;
  nameAr: string;
  nameEn: string;
  nameDe: string;
  capabilities: string[];
}

/**
 * §12: mobility must be addable without rebuilding. It is seeded now, inactive at
 * the application level, precisely to prove the architecture allows it.
 */
export const PARTNER_TYPES: PartnerTypeSeed[] = [
  {
    code: 'accommodation',
    nameAr: 'شريك إقامة',
    nameEn: 'Accommodation partner',
    nameDe: 'Unterkunftspartner',
    capabilities: ['properties', 'calendar', 'bookings'],
  },
  {
    code: 'restaurant',
    nameAr: 'شريك مطعم',
    nameEn: 'Restaurant partner',
    nameDe: 'Restaurantpartner',
    capabilities: ['ads'],
  },
  {
    code: 'activity',
    nameAr: 'شريك نشاط',
    nameEn: 'Activity partner',
    nameDe: 'Aktivitätspartner',
    capabilities: ['ads', 'activities'],
  },
  {
    code: 'mobility',
    nameAr: 'شريك تنقل',
    nameEn: 'Mobility partner',
    nameDe: 'Mobilitätspartner',
    capabilities: ['vehicles', 'routes'],
  },
];

/**
 * §3 P-005 and §2.1: every operational value the admin must be able to change
 * without a deploy. Bookings snapshot the ones they use, so editing these never
 * rewrites history.
 */
export const SETTINGS: {
  key: string;
  value: unknown;
  valueSchema: string;
  descriptionAr: string;
  descriptionEn: string;
}[] = [
  /**
   * §3 P-005 and §2.1: every operational value the admin edits from the Rules
   * Engine settings page, with the units that page shows.
   *
   * NOTE on the customer fee: it is a FLAT amount ($1.99), not a percentage. The
   * approved settings screen labels it "رسوم ثابتة تضاف على كل حجز" (a fixed fee
   * added to every booking), while only the PARTNER side is a 7% commission. An
   * earlier reading of SRS §2.1 had both sides at 7%; the settings page is the
   * authority and this is the corrected model.
   *
   * `customer_fee_mode` exists so the admin can switch to a percentage later
   * without a deploy — bookings snapshot the mode and value they used, so history
   * stays correct across a change.
   */
  {
    key: 'commission.customer_fee_mode',
    value: 'flat',
    valueSchema: 'feeMode',
    descriptionAr: 'طريقة حساب رسوم خدمة العميل',
    descriptionEn: 'Customer fee mode: flat or percent',
  },
  {
    key: 'commission.customer_fee_value',
    value: 1.99,
    valueSchema: 'money',
    descriptionAr: 'رسوم خدمة العميل — رسوم ثابتة تضاف على كل حجز',
    descriptionEn: 'Customer service fee, flat amount added to every booking',
  },
  {
    /*
      Whether the fee is NAMED to the customer, as opposed to charged. `false` because that is what
      the platform does today (Bashar, 2026-09-03) — a seeded `true` would re-expose the fee on
      every screen the next time somebody ran the seed. See `@safra/contracts/customer-fee.ts`.
    */
    key: 'commission.customer_fee_visible',
    value: false,
    valueSchema: 'boolean',
    descriptionAr: 'إظهار رسوم الخدمة كبند منفصل للعميل',
    descriptionEn: 'Show the SAFRA service fee as its own line to the customer',
  },
  {
    key: 'commission.partner_rate',
    value: 0.07,
    valueSchema: 'rate',
    descriptionAr: 'عمولة الشريك — تخصم من مستحقاته قبل التحويل',
    descriptionEn: 'Partner commission, deducted before payout (§2.1)',
  },
  {
    key: 'booking.confirmation_window_minutes',
    value: 120,
    valueSchema: 'positiveInt',
    /*
      The «(ساعتان)» is gone: a label must not state the VALUE beside it.

      It was true for 120 and becomes a lie the moment somebody sets 180 — and the screen prints
      «120 دقيقة» next to it now, so the label was also saying it twice.
    */
    descriptionAr: 'مهلة الشريك لتأكيد الحجز',
    descriptionEn: 'Partner confirmation SLA in minutes (§6.4)',
  },
  {
    key: 'booking.same_day_cutoff_hour',
    value: 17,
    valueSchema: 'hourOfDay',
    descriptionAr: 'إغلاق حجز اليوم نفسه — بتوقيت المدينة',
    descriptionEn: 'Same-day booking cutoff, city-local (§5.3)',
  },
  /*
    The switch for the rule above (Bashar, 2026-09-04).

    TRUE by default, deliberately: «existing behaviour should remain the safe default unless the
    administrator explicitly changes it». Off, the cutoff stops applying entirely — the global hour
    and every per-city hour with it — and the first bookable date becomes the city's local today.
    Yesterday stays unbookable either way; that is a separate rule with a separate reason.
  */
  {
    key: 'booking.same_day_cutoff_enabled',
    value: true,
    valueSchema: 'boolean',
    descriptionAr: 'تفعيل إغلاق حجز اليوم نفسه',
    descriptionEn: 'Whether the same-day booking cutoff applies at all (§5.3)',
  },
  {
    key: 'booking.pending_payment_timeout_minutes',
    value: 30,
    valueSchema: 'positiveInt',
    /*
      No English inside an Arabic sentence.

      It read «مهلة Pending Payment» — the name of a booking status, in English, in the middle of
      the label an operator reads on الإعدادات (Bashar, 2026-08-31). The console names its settings
      from `@safra/i18n` now and this column is only the fallback, but a fallback that reaches a
      screen reaches it in the reader's language too. `post/0019` backfills the seeded row.
    */
    descriptionAr: 'مهلة انتظار الدفع — يُلغى الحجز تلقائياً إن لم يكتمل',
    descriptionEn: 'Pending payment expiry; booking auto-cancels (EC-001)',
  },
  {
    key: 'partner.first_violation_fine',
    value: 10,
    valueSchema: 'money',
    descriptionAr: 'غرامة عدم الرد (أول مخالفة)',
    descriptionEn: 'No-response fine, first violation (§6.4)',
  },
  {
    key: 'wallet.sla_compensation',
    value: 10,
    valueSchema: 'money',
    descriptionAr: 'تعويض محفظة العميل عند خيبة الأمل (P-007)',
    descriptionEn: 'Customer wallet compensation on partner failure (P-007)',
  },
  /**
   * Whether every money setting is dollars regardless of its own currency.
   *
   * On by default, which is what makes §6.4 fair: with it off, a fine of "10"
   * applied in the booking's currency costs a partner ~$14 on a JOD booking and $10
   * on a USD one for identical conduct. Turning it off is the escape hatch for a
   * market that genuinely needs local amounts, not the default.
   */
  {
    key: 'money.always_usd',
    value: true,
    valueSchema: 'boolean',
    descriptionAr: 'اعتبار كل القيم المالية بالدولار الأمريكي',
    descriptionEn: 'Treat every money setting as USD, whatever currency it names',
  },
  /**
   * Off by default. Rate changes move every SYP figure on the platform, so widening
   * who may make them is a decision rather than a default (roadmap 150f).
   */
  {
    key: 'rbac.finance_can_manage_fx',
    value: false,
    valueSchema: 'boolean',
    descriptionAr: 'السماح لمسؤول المالية بإدارة أسعار الصرف',
    descriptionEn: 'Grant fx_rate.manage to finance_officer while enabled',
  },
  /**
   * How hard sanctions screening bites (Bashar, 2026-08-21).
   *
   * `advisory` by default: screening runs and is recorded, and it blocks nothing. Set `required`
   * to restore the hard gate on partner approval and partner payout, `off` to stop offering it.
   *
   * The value and the reasoning behind it live in `@safra/contracts/compliance`, and the review
   * that produced the choice is `docs/sanctions-screening-review.md`. The three values are NOT
   * repeated here — `sanctionsPolicy` is validated against that contract, so a fourth invented
   * here would be refused by the editor rather than quietly stored.
   */
  {
    key: 'compliance.sanctions_screening',
    value: 'advisory',
    valueSchema: 'sanctionsPolicy',
    descriptionAr: 'إلزامية فحص العقوبات: مُلزِم أو استرشادي أو معطّل',
    descriptionEn: 'Sanctions screening policy: required, advisory or off',
  },
  {
    key: 'refund.minimum_percent',
    value: 50,
    valueSchema: 'percent',
    descriptionAr: 'الحد الأدنى للاسترداد',
    descriptionEn: 'Refund floor across all policies (§7.4)',
  },
  {
    /**
     * Which gateway serves which country, in preference order (ADR 0002).
     *
     * Only `manual_transfer` is listed because it is the only rail
     * `Safra Technologies GmbH` can operate with no third-party agreement. The four
     * approved customer-facing methods (Visa, Mastercard, Klarna, Sham Cash) each
     * need one first: the card schemes need an acquirer, Klarna a merchant
     * agreement, Sham Cash a Syrian collection relationship. Until then
     * `GET /payments/methods` correctly returns an empty list rather than
     * advertising a rail that cannot be served.
     *
     * A provider is added HERE, not in code — that is the point of the abstraction.
     */
    key: 'payment.provider_routing',
    value: { SY: ['manual_transfer'], '*': ['manual_transfer'] },
    valueSchema: 'json',
    descriptionAr: 'توجيه مزودي الدفع حسب البلد — بترتيب الأولوية',
    descriptionEn: 'Payment provider routing per country, in preference order (§7.1)',
  },
  {
    key: 'payment.merchant_of_record',
    value: 'Safra Technologies GmbH',
    valueSchema: 'string',
    descriptionAr: 'الجهة التعاقدية التي تحصّل المدفوعات',
    descriptionEn: 'Contracting entity that collects payment (ADR 0002)',
  },
  {
    /*
      The header banner, and it is DATA rather than copy (Bashar, 2026-09-11).

      He asked to keep the line and to own it: «the super admin should be able to manage it example
      hide/show and write the message himself». Two rows rather than one object, because the switch
      and the words are edited at different moments and by different reasoning — turning a notice
      off during an incident should not require re-typing it.

      Seeded with the sentence he wrote on 2026-09-10, so the banner behaves exactly as it did
      before this became configurable and the first edit is his, not a migration's.
    */
    key: 'site.announcement_enabled',
    value: true,
    valueSchema: 'boolean',
    descriptionAr: 'إظهار شريط الإعلان أعلى الموقع',
    descriptionEn: 'Show the announcement bar at the top of the customer site',
  },
  {
    key: 'site.announcement_text',
    value: {
      ar: 'دعمك وتعويضك مسؤوليتنا، لا مسؤولية العقار.',
      en: "Your support and compensation are our responsibility, not the property's.",
      de: 'Support und Entschädigung liegen bei uns, nicht bei der Unterkunft.',
    },
    valueSchema: 'localisedText',
    descriptionAr: 'نص شريط الإعلان بكل لغة — اتركه فارغاً لإخفائه عن قرّاء تلك اللغة',
    descriptionEn:
      'Announcement text per language — leave one empty to hide it from that language',
  },
  {
    key: 'search.max_nights',
    value: 90,
    valueSchema: 'positiveInt',
    descriptionAr: 'أقصى عدد ليالٍ للحجز',
    descriptionEn: 'Maximum nights per booking',
  },
];

// ─── Landmarks ───────────────────────────────────────────────────────────────

export interface LandmarkSeed {
  /** `cities.slug` this landmark belongs to. */
  city: string;
  slug: string;
  kind:
    | 'city_centre'
    | 'airport'
    | 'transit'
    | 'attraction'
    | 'beach'
    | 'shopping'
    | 'hospital'
    | 'university';
  nameAr: string;
  nameEn: string;
  nameDe: string;
  latitude: string;
  longitude: string;
  sortOrder: number;
}

/**
 * The places a guest measures a listing against.
 *
 * ## These coordinates are exact, and that is correct
 *
 * A property's position is rounded to ~100 m before it leaves the API, because it is
 * somebody's home. An airport's is a published fact on every map in the world, and rounding
 * it would make every distance wrong while protecting nobody. The asymmetry IS the model:
 * the listing is the secret, the landmark is the reference frame, and the distance between
 * them is computed from the listing's ROUNDED pair — so no set of distances can locate a
 * building more precisely than the rounding already allows. See `publicDistanceMetres`.
 *
 * ## Reference data, not demo content
 *
 * This file's own header says it: currencies, countries and cities are seeded because the
 * product cannot function without them, and the same is true here — a distance list with no
 * landmarks is an empty section on every property page in the country.
 *
 * Sorted within a city by what a guest planning a trip actually asks first: where the centre
 * is, then how to arrive, then what to see.
 */
export const LANDMARKS: LandmarkSeed[] = [
  // ── Damascus ───────────────────────────────────────────────────────────────
  {
    city: 'damascus',
    slug: 'damascus-city-centre',
    kind: 'city_centre',
    nameAr: 'وسط مدينة دمشق',
    nameEn: 'Damascus city centre',
    nameDe: 'Stadtzentrum Damaskus',
    latitude: '33.510200',
    longitude: '36.291300',
    sortOrder: 1,
  },
  {
    city: 'damascus',
    slug: 'damascus-international-airport',
    kind: 'airport',
    nameAr: 'مطار دمشق الدولي',
    nameEn: 'Damascus International Airport',
    nameDe: 'Flughafen Damaskus',
    latitude: '33.411400',
    longitude: '36.515600',
    sortOrder: 2,
  },
  {
    city: 'damascus',
    slug: 'hijaz-railway-station',
    kind: 'transit',
    nameAr: 'محطة الحجاز',
    nameEn: 'Hijaz Railway Station',
    nameDe: 'Hedschasbahnhof',
    latitude: '33.504900',
    longitude: '36.293900',
    sortOrder: 3,
  },
  {
    city: 'damascus',
    slug: 'baramkeh-bus-station',
    kind: 'transit',
    nameAr: 'كراجات البرامكة',
    nameEn: 'Baramkeh Bus Station',
    nameDe: 'Busbahnhof Baramkeh',
    latitude: '33.508900',
    longitude: '36.283600',
    sortOrder: 4,
  },
  {
    city: 'damascus',
    slug: 'umayyad-mosque',
    kind: 'attraction',
    nameAr: 'الجامع الأموي',
    nameEn: 'Umayyad Mosque',
    nameDe: 'Umayyaden-Moschee',
    latitude: '33.511700',
    longitude: '36.306500',
    sortOrder: 5,
  },
  {
    city: 'damascus',
    slug: 'souq-al-hamidiyah',
    kind: 'shopping',
    nameAr: 'سوق الحميدية',
    nameEn: 'Souq Al-Hamidiyah',
    nameDe: 'Souk al-Hamidiyya',
    latitude: '33.511300',
    longitude: '36.302500',
    sortOrder: 6,
  },
  {
    city: 'damascus',
    slug: 'azm-palace',
    kind: 'attraction',
    nameAr: 'قصر العظم',
    nameEn: 'Azm Palace',
    nameDe: 'Azim-Palast',
    latitude: '33.510400',
    longitude: '36.307000',
    sortOrder: 7,
  },
  {
    city: 'damascus',
    slug: 'mount-qasioun',
    kind: 'attraction',
    nameAr: 'جبل قاسيون',
    nameEn: 'Mount Qasioun',
    nameDe: 'Berg Qasyun',
    latitude: '33.540600',
    longitude: '36.266400',
    sortOrder: 8,
  },
  {
    city: 'damascus',
    slug: 'shaalan-street',
    kind: 'shopping',
    nameAr: 'شارع الشعلان',
    nameEn: 'Shaalan Street',
    nameDe: 'Shaalan-Straße',
    latitude: '33.519400',
    longitude: '36.287100',
    sortOrder: 9,
  },
  {
    city: 'damascus',
    slug: 'damascus-university',
    kind: 'university',
    nameAr: 'جامعة دمشق',
    nameEn: 'Damascus University',
    nameDe: 'Universität Damaskus',
    latitude: '33.513800',
    longitude: '36.277900',
    sortOrder: 10,
  },
  {
    city: 'damascus',
    slug: 'al-assad-university-hospital',
    kind: 'hospital',
    nameAr: 'مشفى الأسد الجامعي',
    nameEn: 'Al-Assad University Hospital',
    nameDe: 'Al-Assad-Universitätsklinik',
    latitude: '33.486900',
    longitude: '36.238500',
    sortOrder: 11,
  },

  // ── Aleppo ─────────────────────────────────────────────────────────────────
  {
    city: 'aleppo',
    slug: 'aleppo-city-centre',
    kind: 'city_centre',
    nameAr: 'وسط مدينة حلب',
    nameEn: 'Aleppo city centre',
    nameDe: 'Stadtzentrum Aleppo',
    latitude: '36.201000',
    longitude: '37.159000',
    sortOrder: 1,
  },
  {
    city: 'aleppo',
    slug: 'aleppo-international-airport',
    kind: 'airport',
    nameAr: 'مطار حلب الدولي',
    nameEn: 'Aleppo International Airport',
    nameDe: 'Flughafen Aleppo',
    latitude: '36.180700',
    longitude: '37.224400',
    sortOrder: 2,
  },
  {
    city: 'aleppo',
    slug: 'aleppo-citadel',
    kind: 'attraction',
    nameAr: 'قلعة حلب',
    nameEn: 'Citadel of Aleppo',
    nameDe: 'Zitadelle von Aleppo',
    latitude: '36.199500',
    longitude: '37.162600',
    sortOrder: 3,
  },
  {
    city: 'aleppo',
    slug: 'souq-al-madina',
    kind: 'shopping',
    nameAr: 'الأسواق المسقوفة',
    nameEn: 'Souq Al-Madina',
    nameDe: 'Souk al-Madina',
    latitude: '36.198800',
    longitude: '37.155700',
    sortOrder: 4,
  },
  {
    city: 'aleppo',
    slug: 'great-mosque-of-aleppo',
    kind: 'attraction',
    nameAr: 'الجامع الأموي الكبير',
    nameEn: 'Great Mosque of Aleppo',
    nameDe: 'Große Moschee von Aleppo',
    latitude: '36.199300',
    longitude: '37.156700',
    sortOrder: 5,
  },
  {
    city: 'aleppo',
    slug: 'university-of-aleppo',
    kind: 'university',
    nameAr: 'جامعة حلب',
    nameEn: 'University of Aleppo',
    nameDe: 'Universität Aleppo',
    latitude: '36.217200',
    longitude: '37.125800',
    sortOrder: 6,
  },

  // ── Latakia ────────────────────────────────────────────────────────────────
  {
    city: 'latakia',
    slug: 'latakia-city-centre',
    kind: 'city_centre',
    nameAr: 'وسط مدينة اللاذقية',
    nameEn: 'Latakia city centre',
    nameDe: 'Stadtzentrum Latakia',
    latitude: '35.519600',
    longitude: '35.791500',
    sortOrder: 1,
  },
  {
    city: 'latakia',
    slug: 'bassel-al-assad-airport',
    kind: 'airport',
    nameAr: 'مطار باسل الأسد الدولي',
    nameEn: 'Bassel Al-Assad International Airport',
    nameDe: 'Flughafen Bassel al-Assad',
    latitude: '35.401100',
    longitude: '35.948700',
    sortOrder: 2,
  },
  {
    city: 'latakia',
    slug: 'latakia-port',
    kind: 'transit',
    nameAr: 'مرفأ اللاذقية',
    nameEn: 'Port of Latakia',
    nameDe: 'Hafen von Latakia',
    latitude: '35.519700',
    longitude: '35.774200',
    sortOrder: 3,
  },
  {
    city: 'latakia',
    slug: 'blue-beach',
    kind: 'beach',
    nameAr: 'الشاطئ الأزرق',
    nameEn: 'Blue Beach',
    nameDe: 'Blauer Strand',
    latitude: '35.572200',
    longitude: '35.753900',
    sortOrder: 4,
  },
  {
    city: 'latakia',
    slug: 'ugarit',
    kind: 'attraction',
    nameAr: 'أوغاريت',
    nameEn: 'Ugarit',
    nameDe: 'Ugarit',
    latitude: '35.601900',
    longitude: '35.781700',
    sortOrder: 5,
  },

  // ── Tartus ─────────────────────────────────────────────────────────────────
  {
    city: 'tartus',
    slug: 'tartus-city-centre',
    kind: 'city_centre',
    nameAr: 'وسط مدينة طرطوس',
    nameEn: 'Tartus city centre',
    nameDe: 'Stadtzentrum Tartus',
    latitude: '34.889000',
    longitude: '35.886600',
    sortOrder: 1,
  },
  {
    city: 'tartus',
    slug: 'arwad-island',
    kind: 'beach',
    nameAr: 'جزيرة أرواد',
    nameEn: 'Arwad Island',
    nameDe: 'Insel Arwad',
    latitude: '34.855600',
    longitude: '35.856400',
    sortOrder: 2,
  },
  {
    city: 'tartus',
    slug: 'tartus-cathedral',
    kind: 'attraction',
    nameAr: 'كاتدرائية طرطوس',
    nameEn: 'Cathedral of Our Lady of Tortosa',
    nameDe: 'Kathedrale von Tartus',
    latitude: '34.892500',
    longitude: '35.883000',
    sortOrder: 3,
  },

  // ── Kasab ──────────────────────────────────────────────────────────────────
  {
    city: 'kasab',
    slug: 'kasab-village-centre',
    kind: 'city_centre',
    nameAr: 'وسط كسب',
    nameEn: 'Kasab centre',
    nameDe: 'Ortszentrum Kasab',
    latitude: '35.933300',
    longitude: '35.983300',
    sortOrder: 1,
  },
  {
    city: 'kasab',
    slug: 'kasab-forest',
    kind: 'attraction',
    nameAr: 'غابات كسب',
    nameEn: 'Kasab Forest',
    nameDe: 'Wälder von Kasab',
    latitude: '35.916700',
    longitude: '35.966700',
    sortOrder: 2,
  },

  // ── Palmyra ────────────────────────────────────────────────────────────────
  {
    city: 'palmyra',
    slug: 'palmyra-town-centre',
    kind: 'city_centre',
    nameAr: 'وسط تدمر',
    nameEn: 'Palmyra town centre',
    nameDe: 'Ortszentrum Palmyra',
    latitude: '34.560600',
    longitude: '38.284100',
    sortOrder: 1,
  },
  {
    city: 'palmyra',
    slug: 'temple-of-bel',
    kind: 'attraction',
    nameAr: 'معبد بل',
    nameEn: 'Temple of Bel',
    nameDe: 'Baaltempel',
    latitude: '34.547900',
    longitude: '38.274200',
    sortOrder: 2,
  },
  {
    city: 'palmyra',
    slug: 'palmyra-colonnade',
    kind: 'attraction',
    nameAr: 'شارع الأعمدة',
    nameEn: 'Great Colonnade',
    nameDe: 'Große Kolonnade',
    latitude: '34.552000',
    longitude: '38.268700',
    sortOrder: 3,
  },

  // ── Aqaba ──────────────────────────────────────────────────────────────────
  {
    city: 'aqaba',
    slug: 'aqaba-city-centre',
    kind: 'city_centre',
    nameAr: 'وسط مدينة العقبة',
    nameEn: 'Aqaba city centre',
    nameDe: 'Stadtzentrum Aqaba',
    latitude: '29.532100',
    longitude: '35.006300',
    sortOrder: 1,
  },
  {
    city: 'aqaba',
    slug: 'king-hussein-international-airport',
    kind: 'airport',
    nameAr: 'مطار الملك حسين الدولي',
    nameEn: 'King Hussein International Airport',
    nameDe: 'King-Hussein-Flughafen',
    latitude: '29.611600',
    longitude: '35.018100',
    sortOrder: 2,
  },
  {
    city: 'aqaba',
    slug: 'aqaba-south-beach',
    kind: 'beach',
    nameAr: 'الشاطئ الجنوبي',
    nameEn: 'South Beach',
    nameDe: 'Südstrand',
    latitude: '29.437200',
    longitude: '34.975000',
    sortOrder: 3,
  },
  {
    city: 'aqaba',
    slug: 'aqaba-fort',
    kind: 'attraction',
    nameAr: 'قلعة العقبة',
    nameEn: 'Aqaba Fort',
    nameDe: 'Festung von Aqaba',
    latitude: '29.523600',
    longitude: '35.001100',
    sortOrder: 4,
  },

  // ── Petra ──────────────────────────────────────────────────────────────────
  {
    city: 'petra',
    slug: 'wadi-musa-centre',
    kind: 'city_centre',
    nameAr: 'وسط وادي موسى',
    nameEn: 'Wadi Musa centre',
    nameDe: 'Ortszentrum Wadi Musa',
    latitude: '30.322500',
    longitude: '35.479500',
    sortOrder: 1,
  },
  {
    city: 'petra',
    slug: 'petra-visitor-centre',
    kind: 'attraction',
    nameAr: 'مدخل البتراء',
    nameEn: 'Petra Visitor Centre',
    nameDe: 'Besucherzentrum Petra',
    latitude: '30.328500',
    longitude: '35.444400',
    sortOrder: 2,
  },
  {
    city: 'petra',
    slug: 'petra-treasury',
    kind: 'attraction',
    nameAr: 'الخزنة',
    nameEn: 'The Treasury',
    nameDe: 'Schatzhaus',
    latitude: '30.322200',
    longitude: '35.451500',
    sortOrder: 3,
  },

  // ── Tripoli ────────────────────────────────────────────────────────────────
  {
    city: 'tripoli',
    slug: 'tripoli-city-centre',
    kind: 'city_centre',
    nameAr: 'وسط مدينة طرابلس',
    nameEn: 'Tripoli city centre',
    nameDe: 'Stadtzentrum Tripoli',
    latitude: '34.436700',
    longitude: '35.849700',
    sortOrder: 1,
  },
  {
    city: 'tripoli',
    slug: 'tripoli-citadel',
    kind: 'attraction',
    nameAr: 'قلعة طرابلس',
    nameEn: 'Citadel of Tripoli',
    nameDe: 'Zitadelle von Tripoli',
    latitude: '34.435800',
    longitude: '35.848100',
    sortOrder: 2,
  },
  {
    city: 'tripoli',
    slug: 'tripoli-old-souqs',
    kind: 'shopping',
    nameAr: 'أسواق طرابلس القديمة',
    nameEn: 'Old Souqs of Tripoli',
    nameDe: 'Altstadt-Souks von Tripoli',
    latitude: '34.437200',
    longitude: '35.845500',
    sortOrder: 3,
  },
  {
    city: 'tripoli',
    slug: 'port-of-tripoli',
    kind: 'transit',
    nameAr: 'مرفأ طرابلس',
    nameEn: 'Port of Tripoli',
    nameDe: 'Hafen von Tripoli',
    latitude: '34.452500',
    longitude: '35.820600',
    sortOrder: 4,
  },
];
