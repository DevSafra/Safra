/**
 * The staff console's Arabic copy — the source of truth every other console locale
 * translates FROM.
 *
 * ## Why the copy left the app
 *
 * It lived in `apps/admin/src/lib/strings.ts` as a constant named `AR`, which put the
 * language in the name of every one of the 577 call sites that read it. `AR.bookings.title`
 * cannot become German without touching all 577; `t.bookings.title` can. The copy now lives
 * here, beside the customer app's and the transactional emails', so "what does SAFRA say to
 * people" is one directory rather than four.
 *
 * ## Placeholders, not functions
 *
 * Interpolated strings used to be arrow functions:
 *
 * ```ts
 * inviteSent: (email: string) => `أُرسلت الدعوة إلى ${email}.`
 * ```
 *
 * A template literal freezes word order at the point it is written, and word order is the
 * first casualty of translation. These are now `{email}`-style templates read by `fill()`,
 * which recovers the argument names from the string itself — so a call site that forgets a
 * value, or misspells one, fails to compile.
 *
 * ## The console is Arabic-only TODAY
 *
 * Bashar, 2026-08-03. Nothing here fabricates an English or German console: inventing 800
 * translations nobody has reviewed would look like progress and read as gibberish to the
 * staff who depend on this screen. What this file guarantees is that adding a language is
 * one new file whose missing keys the compiler enumerates — not an archaeology exercise
 * across 36 components. See `docs/i18n.md`.
 *
 * `as const` is load-bearing: it is what gives `fill()` the literal types it reads
 * placeholder names out of. Without it every template degrades to `string` and the
 * type checking silently stops.
 */
export const ar = {
  /** Document metadata — the browser tab and any bookmark. */
  meta: {
    title: 'سفرة — مركز القيادة',
  },

  login: {
    title: 'مركز القيادة',
    subtitle: 'الدخول مخصص لموظفي سفرة فقط.',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    showPassword: 'إظهار كلمة المرور',
    hidePassword: 'إخفاء كلمة المرور',
    submitCredentials: 'تسجيل الدخول',
    submittingCredentials: 'جارٍ التحقق…',
    code: 'رمز المصادقة',
    codeHint:
      'أدخل الرمز من تطبيق المصادقة الثنائية. إذا فقدت جهازك، يمكنك إدخال أحد رموز الاسترداد.',
    submitCode: 'تأكيد الرمز',
    submittingCode: 'جارٍ التأكيد…',
    signingInAs: 'تسجيل الدخول باسم',
    useDifferentAccount: 'استخدام حساب آخر',
  },

  /** Copy shared by more than one console screen. */
  dashboard: {
    signOut: 'تسجيل الخروج',
    signingOut: 'جارٍ تسجيل الخروج…',
    bookingReferencePlaceholder: 'BKG-2026-000123',
    findBookingLabel: 'البحث عن حجز برقم المرجع',
    findBooking: 'بحث',
    propertiesPending: 'عقارات بانتظار المراجعة',
    countersFailed: 'تعذّر تحميل العدادات. حدّث الصفحة للمحاولة مرة أخرى.',
    queueFailed: 'تعذّر تحميل هذه القائمة.',
    sessionExpired: 'انتهت جلستك. سجّل الدخول مرة أخرى.',
    /**
     * The theme toggle names the DESTINATION, not the current state.
     *
     * «الوضع الداكن» while dark is active is ambiguous read aloud — it could be reporting a
     * state or offering an action. These say which way the button goes.
     */
    themeToLight: 'التبديل إلى الوضع الفاتح',
    themeToDark: 'التبديل إلى الوضع الداكن',
    nothingWaiting: 'لا يوجد شيء بالانتظار.',
    screened: 'تم الفحص',
    notScreened: 'لم يتم الفحص',
    documents: 'مستند',
    submitted: 'قُدّم في',
  },

  /** The command-center sidebar, in the approved design's order. */
  nav: {
    heading: 'مركز قيادة سفرة',
    /** The hamburger names the ACTION, so it says which way the button goes. */
    showSidebar: 'إظهار قائمة التنقل',
    hideSidebar: 'إخفاء قائمة التنقل',
    notBuilt: 'لم يُبنَ هذا القسم بعد',
    dashboard: 'لوحة الإدارة',
    bookings: 'الحجوزات',
    partners: 'الشركاء',
    properties: 'العقارات',
    customers: 'العملاء',
    staff: 'الموظفون',
    payments: 'الدفع والفواتير',
    wallet: 'المحفظة',
    giftCards: 'بطاقات الهدايا',
    coupons: 'الكوبونات',
    ads: 'الإعلانات',
    disputes: 'النزاعات',
    messages: 'الرسائل',
    whatsapp: 'واتساب والبريد',
    geo: 'المدن والدول والعملات',
    reports: 'التقارير',
    settings: 'الإعدادات',
    audit: 'سجل التدقيق',
  },

  /** The dashboard proper, matching the approved design's panels. */
  admin: {
    title: 'لوحة الإدارة',
    emergencyMode: '⚠ وضع الطوارئ',
    kpiRow: 'مؤشرات اليوم',
    kpiBookingsToday: 'حجوزات اليوم',
    kpiBookingsTodaySub: 'عن أمس',
    kpiPending: 'قيد التأكيد',
    kpiPendingSub: 'تنتهي مهلتها قريباً',
    kpiRevenue: 'إيراد اليوم (عمولات)',
    kpiCancelled: 'إلغاءات اليوم',
    kpiCancelledSub: 'بغرامة شريك',
    kpiDisputes: 'نزاعات مفتوحة',
    kpiDisputesSub: 'مفتوحة أو قيد المراجعة',
    kpiDisputesUnavailable: 'تعذّر تحديد العدد',
    /** Prefixes a count that qualifies the card's main figure: "منها 3 …". */
    ofWhich: 'منها',
    attention: '⚑ يحتاج انتباهك الآن',
    attentionEmpty: 'لا شيء يحتاج انتباهاً عاجلاً.',
    attentionSla: 'حجز تنتهي مهلة تأكيده خلال 30 دقيقة',
    attentionPartners: 'شريك بانتظار التحقق من الوثائق',
    attentionProperties: 'عقار بانتظار المراجعة قبل النشر',
    handle: 'معالجة',
    systemActor: 'النظام',
    latestBookings: 'أحدث الحجوزات',
    viewAll: 'عرض الكل ←',
    colReference: 'رقم الحجز',
    colProperty: 'العقار',
    colCustomer: 'العميل',
    colAmount: 'المبلغ',
    colStatus: 'الحالة',
    weekRevenue: 'إيرادات الأسبوع',
    weekRevenueSub: 'عمولة الشريك 7٪ + رسوم خدمة 1.99$ · بالدولار',
    pendingPartners: 'شركاء بانتظار الموافقة',
    pendingPartnersNote: 'لا يُنشر أي عقار قبل التحقق من الوثائق والصور والعنوان (P-002)',
    recentActivity: 'سجل التدقيق — آخر العمليات',
    noData: '—',
    today: 'اليوم',
  },

  partners: {
    subtitle: 'كل شريك بانتظار التحقق من وثائقه قبل نشر أي عقار له.',
  },

  properties: {
    subtitle: 'كل عقار بانتظار المراجعة. لا يُنشر عقار قبل الموافقة (P-002).',
  },

  /** Shared table chrome. */
  table: {
    /**
     * The back control on a detail screen — «رجوع», with the arrow at its RIGHT.
     *
     * The visible word is the ACTION, not the destination (Bashar, 2026-08-05). It replaced
     * «← الحجوزات», which in turn replaced «القوائم»: naming the section made the control as wide
     * as the section's name and repeated a word the reader had just clicked. The destination is
     * still announced — see `backToLabel`, which screen readers get.
     */
    back: 'رجوع',
    /**
     * The accessible name, so «رجوع» on four different screens is still distinguishable.
     *
     * Visible text is «رجوع» and it is CONTAINED in this string, which is what WCAG 2.5.3 asks
     * of a label that differs from its accessible name — a voice-control user saying "رجوع"
     * still matches.
     */
    backToLabel: 'الرجوع إلى {section}',
    /**
     * The glyph in the back control, alone in the catalogue because its DIRECTION is language.
     *
     * Arabic reads right-to-left, so going back means going RIGHT and the arrow is «→». A
     * left-to-right locale flips it to «←» here and nowhere else — its SIDE is not language and
     * is not written down: the control is a flex row, so the arrow follows the writing direction
     * on its own. Neither glyph is bidi-mirrored, so what is written here is what is drawn.
     */
    backArrow: '→',
    /**
     * What the back control announces when it returns to a specific RECORD rather than to a list.
     *
     * Singular, because the destination is one booking, not الحجوزات. Opening the الشريك card from
     * a booking and pressing back returned to the partners REGISTRY (Bashar, 2026-08-06); it now
     * returns to the booking, and has to be able to say so.
     */
    backToOrigin: {
      bookings: 'الحجز',
      partners: 'الشريك',
      properties: 'العقار',
      messages: 'المحادثة',
      disputes: 'النزاعات',
      dashboard: 'لوحة الإدارة',
    } as Record<string, string>,
    search: 'بحث',
    pageSizeLabel: 'عدد الصفوف في الصفحة',
    /** Submits the pagination bar's form — see the note in `table-pagination.tsx`. */
    apply: 'تطبيق',
    exportCsv: 'تصدير CSV',

    /*
      The bar under every table: صفحة ‹ [١] › من ١٠٢ — اعرض [٢٥] صفًا — ٢٥٣١ نتيجة.

      Split into fragments rather than one interpolated sentence because the page number is an
      INPUT sitting inside the sentence, and a placeholder cannot hold a form control. The
      fragments are ordered by the JSX, which is the one place the visual order is decided.
    */
    page: 'صفحة',
    /** Follows the page input: "من ١٠٢". */
    pageOf: 'من {n}',
    pageLabel: 'رقم الصفحة',
    /** Precedes the rows-per-page select. */
    show: 'اعرض',
    /** Follows it, naming what is being counted. */
    rows: 'صفًا',
    /** The total the query matched, printed at the end of the bar. */
    found: '{n} نتيجة',
    /**
     * Shown instead of `found` when the count was capped.
     *
     * A total over the cap is not counted exactly, because `count(*)` over a table the size of
     * the audit log is a full scan on every page view. "أكثر من ١٠٠٠٠" is honest about that;
     * a precise-looking number nobody paid for would not be.
     */
    foundCapped: 'أكثر من {n} نتيجة',
    previousPage: 'الصفحة السابقة',
    nextPageShort: 'الصفحة التالية',
    /** Names the whole bar for a screen reader, which lands on it as a landmark. */
    paginationLabel: 'تنقّل بين الصفحات',
    /**
     * Used instead when a route carries TWO paged tables.
     *
     * Two landmarks with the same name is a real defect, not a test inconvenience: a screen-reader
     * user listing the page's navigation regions hears "تنقّل بين الصفحات" twice and cannot tell
     * which table either one moves.
     */
    paginationLabelOf: 'تنقّل بين صفحات {section}',
    empty: 'لا نتائج.',
    open: 'فتح الملف ←',
    manage: 'إدارة ←',
    profile: 'الملف ←',
    permissions: 'الصلاحيات ←',
    colId: 'المعرف',
    colStatus: 'الحالة',
    colAction: 'إجراء',
    colType: 'النوع',
    colCity: 'المدينة',
    colAmount: 'المبلغ',
    colDates: 'التواريخ',
    /**
     * A stay, with the month and year the two dates share written once — «٠٤ ← ٠٨-٠٩-٢٠٢٦».
     *
     * A template rather than a formatter's own literal, because the arrow's SIDE is language:
     * this reads right-to-left, so «←» leads from the check-in on the right to the check-out on
     * the left. A locale that reads the other way needs «→» and the two values swapped, which is
     * an edit here rather than in `dateRange()`.
     */
    dateRange: '{from} ← {to}',
    colTime: 'الوقت',
  },

  /**
   * Per-section copy, verbatim from the design handoff.
   *
   * Every `note` is a business rule an operator has to know — that a partner is never
   * hard-deleted, that a ledger row is immutable, that a dispute freezes a payout. They are
   * quoted exactly and must not be paraphrased.
   */
  sections: {
    bookings: {
      searchPlaceholder: 'بحث برقم الحجز، العقار، العميل…',
      allStatuses: 'كل الحالات',
      count: '{n} حجز · كل حجز له خط زمني وسجل تدقيق ورقم مرجعي (P-004)',
      note: 'فتح أي حجز يعرض: بيانات العميل والشريك والعقار والدفع والرسائل والواتساب والبريد والخط الزمني، مع ملاحظات داخلية لا يراها العميل أو الشريك. تغيير الحالة بصلاحيات محددة فقط ويسجَّل في سجل التدقيق.',
    },

    partners: {
      title: 'سجل الشركاء',
      suspended: 'موقوف مؤقتاً',
      searchPlaceholder: 'بحث عن شريك…',
      colPartner: 'الشريك',
      colScore: 'Score',
      colTier: 'التصنيف',
      note: 'Score يبدأ من 100: الرد السريع والتقييم المرتفع يرفعانه؛ التأخر والإلغاء وعدم تحديث التوفر يخفضونه — ويؤثر على ترتيب «موصى به من سفرة». لا حذف نهائي لأي شريك (P-003): Suspend / Deactivate فقط.',
      contracts: 'عقود الشراكة',
      contractsHint:
        'ارفع العقد الموقّع بين سفرة والشريك (PDF ≤ 10MB) — يُحفظ في سجل الشريك ويُوثّق في Audit Log',
      pendingTitle: 'بانتظار الموافقة — التحقق قبل النشر (P-002)',
    },

    properties: {
      title: 'سجل العقارات',
      searchPlaceholder: 'بحث عن عقار…',
      colProperty: 'العقار',
      colPartner: 'الشريك',
      note: 'أنواع الإقامة قابلة للإضافة من هنا دون تعديل الكود. كل وحدة لها تقويم مستقل بحالات: متاح، محجوز، مغلق، تحت الصيانة.',
    },

    customers: {
      searchPlaceholder: 'بحث عن عميل…',
      colName: 'الاسم',
      colBookings: 'حجوزات',
      colWallet: 'رصيد المحفظة',
      colLast: 'آخر نشاط',
      registered: 'مسجل',
      guest: 'ضيف',
      note: 'حسابات الضيوف تُحفظ ببيانات الحجز فقط ويمكن ترقيتها لحساب دائم. لا يرى موظفو الدعم بيانات الدفع الحساسة.',
    },

    payments: {
      searchPlaceholder: 'بحث بمعرف العملية أو الحجز…',
      colLinked: 'مرتبط بـ',
      colMethod: 'الوسيلة',
      kpiCaptured: 'مقبوضات اليوم',
      kpiRefunded: 'استردادات اليوم',
      kpiPayable: 'مستحقات شركاء غير مدفوعة',
      kpiFines: 'غرامات محصلة (هذا الشهر)',
      /**
       * The design's fourth KPI is "تحويلات شركاء مجدولة" — SCHEDULED transfers. There is no
       * payouts table and payment rails are deferred, so this shows what is OWED instead and
       * says so. Presenting an obligation as a scheduled transfer would be a fabrication.
       */
      payableNote: 'إجمالي المستحق للشركاء — لا يوجد جدول تحويلات بعد',
      typePayment: 'دفع',
      typeRefund: 'استرداد',
      typeFine: 'غرامة',
      note: 'كل حركة مالية سجل ثابت غير قابل للتعديل (immutable). منع الدفع المكرر عبر idempotency key (EC-003). لا تُخزَّن بيانات البطاقات إلا وفق PCI لدى مزود الدفع.',
      /* Was «لا يوجد جدول تحويلات بعد» until the payout ledger shipped. It exists now. */
      payoutsLink: 'تحويلات الشركاء',
      payoutsNote:
        'التحويلات إلى الشركاء لها سجلّها الخاص: كل تحويل حدث مسجَّل بدورة حياة وأثر تدقيق وحركة دفترية.',
    },

    /**
     * تحويلات الشركاء — the payout registry and one payout's page (§9.3).
     *
     * The copy is careful about one distinction throughout: «مستحق» is what SAFRA owes and
     * «تحويل» is money that moved. A screen that used them interchangeably would let an operator
     * tell a partner a transfer happened when only an obligation was recorded.
     */
    payouts: {
      title: 'تحويلات الشركاء',
      searchPlaceholder: 'بحث بالمرجع أو الشريك أو مرجع الحوالة…',
      allStatuses: 'كل الحالات',
      colReference: 'المرجع',
      colPartner: 'الشريك',
      colPeriod: 'الفترة',
      colBookings: 'الحجوزات',
      colNet: 'الصافي',
      colStatus: 'الحالة',
      colScheduled: 'موعد التحويل',
      note: 'الحساب التلقائي يضم الحجوزات المكتملة والمدفوعة فقط، ويستثني أي حجز عليه نزاع مفتوح أو قيد الفحص — تجميد المستحقات قاعدة مشتقة من النزاعات وليست علامة على الحجز.',

      /* One payout's page. */
      detailTitle: 'تحويل {reference}',
      summary: 'الملخّص',
      gross: 'الإجمالي',
      fine: 'الغرامات',
      net: 'الصافي',
      period: 'الفترة',
      status: 'الحالة',
      scheduledFor: 'مجدول ليوم',
      releasedAt: 'أُفرج عنه',
      paidAt: 'دُفع',
      paidReference: 'مرجع الحوالة',
      holdReason: 'سبب التعليق',
      coveredBookings: 'الحجوزات المشمولة',
      noBookings: 'لا حجوزات على هذا التحويل.',
      colBooking: 'الحجز',
      colProperty: 'العقار',
      colStay: 'الإقامة',
      colAmount: 'المبلغ',

      /* The audit trail and the ledger movement — the two halves of reconciliation. */
      trail: 'أثر التدقيق',
      noTrail: 'لا قرارات مسجَّلة بعد.',
      ledger: 'الحركة الدفترية',
      noLedger: 'لا حركة دفترية — تُسجَّل عند الدفع فقط.',
      ledgerMissing:
        'هذا التحويل مدفوع بلا حركة دفترية مقابلة. هذه حالة لا يُفترض أن تحدث — أبلغ عنها.',
      debit: 'مدين',
      credit: 'دائن',

      /* The actions, and what each one commits to. */
      actions: 'الإجراءات',
      close: 'إغلاق الفترة',
      closeHint: 'يوقف ضمّ حجوزات جديدة إلى هذه الفترة، ولا يحرّك أي مال.',
      release: 'الإفراج للتحويل',
      releaseHint: 'يحدّد موعد التحويل. يُعاد فحص تجميد النزاعات لحظة الإفراج.',
      releaseDate: 'تاريخ التحويل',
      releaseNotes: 'ملاحظات (اختياري)',
      markPaid: 'تسجيل الدفع',
      markPaidHint:
        'يُسجّل أن المال غادر سفرة ويُنشئ الحركة الدفترية. لا يمكن التراجع — التحويل المدفوع سجل ثابت.',
      paidReferenceLabel: 'مرجع الحوالة من البنك',
      hold: 'تعليق',
      holdHint: 'يوقف التحويل مؤقتًا مع تسجيل السبب.',
      liftHold: 'رفع التعليق',
      cancelPayout: 'إلغاء التحويل',
      cancelHint: 'يفكّ ارتباط الحجوزات فتعود إلى فترة لاحقة.',
      reason: 'السبب',
      confirm: 'تأكيد',
      cancel: 'إلغاء',
      working: 'جارٍ التنفيذ…',
      failed: 'تعذّر تنفيذ الإجراء.',
      unreachable: 'تعذّر الوصول إلى الخادم.',
      noActions: 'لا إجراءات متاحة على تحويل مدفوع.',
    },

    wallet: {
      searchPlaceholder: 'بحث بالعميل أو السبب…',
      colOperation: 'العملية',
      colCustomer: 'العميل',
      colReason: 'السبب',
      colBalanceAfter: 'الرصيد بعدها',
      note: 'المحفظة تخزن تعويضات العملاء (P-007) — مثل 10$ عند فشل الشريك بالرد أول مرة — وتُستخدم مع بطاقة هدية ووسيلة دفع أخرى في عملية واحدة. كل حركة لها سبب مسجَّل.',
    },

    giftcards: {
      searchPlaceholder: 'بحث بالكود أو المشتري…',
      create: '+ إنشاء بطاقة هدية',
      hint: 'الإنشاء والتعديل بصلاحيات إدارية محددة فقط — يسجَّل في سجل التدقيق',
      colCode: 'الكود',
      colValue: 'القيمة الأصلية',
      colRemaining: 'الرصيد المتبقي',
      colBuyer: 'الشراء بواسطة',
      colExpiry: 'الصلاحية',
      note: 'تُستخدم للحجوزات والمطاعم والأنشطة الشريكة. الرصيد المتبقي يبقى في البطاقة إذا فاقت قيمتها العملية. بطاقة منتهية أثناء الدفع؟ تُعاد الحسبة قبل التأكيد (EC-012).',
      /** Codes are hashed and never returned — see PromotionsService. */
      codeNote: 'يُعرض آخر أربعة أحرف فقط — الأكواد مُعمَّاة ولا تُسترجع من هنا.',
    },

    coupons: {
      searchPlaceholder: 'بحث بالكود أو النوع…',
      create: '+ كوبون جديد',
      hint: 'منفصلة تماماً عن بطاقات الهدايا · أنواعها: أول حجز، موسمية، مدينة، شريك، حملة تسويقية',
      colDiscount: 'الخصم',
      colMin: 'حد أدنى',
      colUsage: 'الاستخدام',
      colPeriod: 'الفترة',
    },

    geo: {
      countries: 'دول الإطلاق',
      addCountry: '+ إضافة دولة',
      currencies: 'العملات',
      addCurrency: '+ إضافة عملة',
      cities: 'المدن',
      addCity: '+ إضافة مدينة',
      searchPlaceholder: 'بحث عن مدينة…',
      accounting: 'العملة المحاسبية',
      noRate: 'لا سعر صرف مُعرَّف',
      active: 'نشطة',
      inactive: 'غير نشطة',
      colCountry: 'الدولة',
      colCategory: 'الفئة',
      colProperties: 'عقارات',
      activeCities: '{n} مدينة نشطة',
      note: 'الأسعار تُعرض للعميل حسب البلد أو العملة المختارة. أسعار الصرف تُعدَّل من هنا لا من الكود (P-005).',
      citiesNote:
        'صفحة كل مدينة: أول ثلثها صور عالية الجودة، ثم وصف وتصنيفات وعروض — وتُستخدم لأهداف SEO لاحقاً.',
      fxElsewhere: 'تعديل أسعار الصرف من شاشة أسعار الصرف — بسجل تغييرات مُدقَّق.',
    },

    reports: {
      commissionRevenue: 'إيرادات العمولات',
      commissionRevenueSub: 'رسوم خدمة 1.99$ للعميل + عمولة 7٪ شريك · هذا الأسبوع',
      occupancy: 'نسبة الإشغال',
      occupancySub: 'من الأيام المسجَّلة في تقويم الوحدات',
      cancellations: 'الإلغاءات',
      cancellationsSub: 'من حجوزات الأسبوع',
      partnerResponse: 'وسيط رد الشركاء',
      partnerResponseSub: 'المهلة القصوى ساعتان قبل الإلغاء والغرامة',
      minutes: 'دقيقة',
      noPrevious: 'لا مقارنة',
      vsPrevious: 'عن الأسبوع الماضي',
    },

    staff: {
      searchPlaceholder: 'بحث بالاسم أو البريد أو الدور…',
      /** Names the list for a screen reader, and gives the paging test a stable hook. */
      listLabel: 'حسابات الموظفين',
      kpiTotal: 'إجمالي الموظفين',
      kpiTotalSub: '{active} نشطين · {suspended} معطّل · {invited} دعوة',
      kpiSignedIn: 'دخلوا اليوم',
      kpiRoles: 'أدوار معرّفة',
      kpiRolesSub: 'من مدير عام إلى دعم',
      kpiInvites: 'دعوات معلقة',
      kpiInvitesSub: 'صالحة 48 ساعة',
      kpiTwoFactor: 'بلا مصادقة ثنائية',
      matrix: 'مصفوفة الصلاحيات',
      matrixHint:
        'ما يستطيع كل دور فعله داخل لوحة الإدارة — مقروءة من نفس الجدول الذي يفرضه الخادم',
      permission: 'الصلاحية',
      allowed: 'مسموح',
      denied: 'ممنوع',
      /**
       * The handoff's third state — ○ "بموافقة مدير" — has no equivalent in the model: a
       * permission is granted or it is not. Saying so beats drawing a symbol that implies an
       * approval workflow exists.
       */
      noApprovalTier: 'لا توجد حالة «بموافقة مدير» في النموذج: الصلاحية ممنوحة أو لا.',
      activity: 'آخر نشاط الموظفين',
      note: 'لا يُحذف حساب موظف نهائياً — يُعطّل فقط مع الاحتفاظ بأثره في سجل التدقيق. كل تغيير صلاحية يُوثّق باسم من نفّذه.',

      /** The invite form (§8.2). */
      invite: 'دعوة موظف جديد',
      inviteHint:
        'تُرسل دعوة برابط لمرة واحدة يضبط بها كلمة مروره — لا تراها أنت، ولا يعمل الحساب قبل قبول الدعوة وتمكين المصادقة الثنائية.',
      inviteEmail: 'البريد المهني',
      inviteEmailPlaceholder: 'name@safra.com',
      inviteRole: 'الدور',
      inviteSend: 'إرسال الدعوة',
      inviteSending: 'جارٍ الإرسال…',
      inviteSent: 'أُرسلت الدعوة إلى {email}.',
      inviteResend: 'إعادة إرسال الدعوة',
      inviteResent: 'أُعيد إرسال الدعوة إلى {email}.',
      inviteNote:
        'تُرسل دعوة بريدية صالحة 48 ساعة · التحقق الثنائي إلزامي لكل حساب موظف.',

      /** Row state and actions. */
      you: '— أنت',
      lastSignIn: 'آخر دخول {when}',
      neverSignedIn: 'لم يسجّل الدخول بعد',
      invitationPending: 'دعوة معلقة',
      twoFactorMissing: 'بلا مصادقة ثنائية',
      suspended: 'معطّل',
      suspend: 'تعطيل',
      reinstate: 'إعادة تنشيط',
      roleChanged: '{email} أصبح {role}.',
      suspendedNotice: 'عُطّل {email} وأُنهيت جلساته.',
      reinstatedNotice: 'أُعيد تنشيط {email}.',
      actionFailed: 'تعذّر تنفيذ هذا الإجراء.',

      /** النطاق — geographic scope (§8.2). */
      scope: 'النطاق',
      scopeAllCities: 'كل المدن',
      scopeOutsideNone: 'لا وصول خارج النطاق',
      scopeOutsideReadOnly: 'قراءة فقط خارج النطاق',
      scopeNever: 'غير قابل للتحديد',
      scopeTitle: 'نطاق العمل — مفروض من الخادم',
      scopeNote:
        'النطاق مفروض على الخادم لا في الواجهة: الحجوزات والشركاء والعقارات والنزاعات والمحادثات والإعلانات ولوحة الإدارة والتقارير كلها مُقيَّدة بمدن الموظف. الكتابة خارج النطاق مرفوضة في الوضعين. سجل التدقيق يبقى كاملاً وغير مُقيَّد — سجل تدقيق مُقيَّد ليس سجل تدقيق.',
      scopeSuperAdmin: 'المدير العام غير قابل للتقييد',
    },

    audit: {
      immutable: 'غير قابل للحذف',
      hint: 'كل عملية إدارية أو مالية أو حساسة تُسجَّل مع IP والجهاز والموظف والوقت',
      searchPlaceholder: 'بحث بالموظف أو العملية أو الكيان…',
      colStaff: 'الموظف',
      colAction: 'العملية',
      colEntity: 'الكيان',
      colIp: 'IP',
    },

    disputes: {
      searchPlaceholder: 'بحث بالنزاع أو الحجز أو العميل…',
      kpiOpen: 'نزاعات مفتوحة',
      kpiInvestigating: 'قيد المراجعة',
      kpiOldest: 'أقدم نزاع مفتوح',
      kpiFrozen: 'مستحقات مجمّدة',
      kpiFrozenSub: 'حجوزات لا تُحوَّل حتى الإغلاق',
      kpiResolved: 'أُغلقت هذا الشهر',
      hours: 'ساعة',
      evidence: '{n} صورة مرفوعة',
      open: 'فتح النزاع ←',
      frozen: 'المستحقات مجمّدة',
      note: 'فتح النزاع يجمّد استحقاق تحويل الشريك للحجز المعني حتى الإغلاق. الصور المرفوعة من العميل (EC-007) تظهر داخل ملف النزاع.',
      /** The close form. */
      close: 'إغلاق النزاع',
      outcome: 'النتيجة',
      outcomeResolved: 'لصالح العميل — تُقبل الشكوى',
      outcomeRejected: 'ترفض الشكوى',
      resolution: 'قرار الإغلاق',
      resolutionHint:
        'مطلوب — يُحفظ مع النزاع وفي سجل التدقيق، ويُقرأ لاحقاً من العميل والشريك',
      compensation: 'تعويض المحفظة (اختياري)',
      compensationHint: 'يُضاف فوراً إلى محفظة العميل بحركة مسجَّلة',
      closing: 'جارٍ الإغلاق…',
      closedBy: 'أُغلق',
      confirmClose: 'تأكيد الإغلاق',
    },

    messages: {
      searchPlaceholder: 'بحث في المحادثات…',
      subjectBooking: 'حجز',
      subjectDispute: 'نزاع',
      subjectPartner: 'شريك',
      parties: '{customer} ↔ سفرة ↔ {partner}',
      noMessages: 'لا رسائل بعد.',
      unread: 'غير مقروءة',
      closed: 'مغلقة',
      internalNote: 'ملاحظة داخلية',
      redacted: 'حُجب {n} من بيانات التواصل',
      senderCustomer: 'العميل',
      senderPartner: 'الشريك',
      senderStaff: 'سفرة',
      senderSystem: 'النظام',
      reply: 'إرسال',
      replying: 'جارٍ الإرسال…',
      replyPlaceholder: 'اكتب رداً…',
      replyInternal: 'ملاحظة داخلية — لا يراها العميل أو الشريك',
      note: 'دردشة ثلاثية: العميل، سفرة، الشريك — سفرة تراقب وتوجّه. يُمنع تبادل أرقام هواتف أو بيانات تواصل مباشرة قبل تأكيد الحجز، وتُحجب تلقائياً.',
      redactionNote: 'الحجب يطبَّق على ردود الموظفين أيضاً، ولا يُحفظ النص الأصلي.',
    },

    comms: {
      searchPlaceholder: 'بحث بالقالب أو المعرف…',
      templates: 'القوالب — بثلاث لغات',
      templatesLocales: 'ع · EN · DE',
      notWired: 'غير مُنفَّذ',
      colChannel: 'القناة',
      colTemplate: 'القالب',
      channelWhatsapp: 'واتساب',
      channelEmail: 'بريد',
      channelInApp: 'داخل التطبيق',
      attempts: '{n} محاولات',
      window: 'آخر {days} يوماً',
      note: 'واتساب للتنبيهات فقط (ليس بديلاً للدعم). تأكيد الحجز يُرسل خلال مهلة أقصاها ساعتان من الدفع. حالة كل رسالة تُسجَّل: مرسلة / فشلت / قيد الانتظار، وكل بريد يرتبط بالحجز في الخط الزمني. الإرسال عبر طابور خلفي.',
      whatsappBlocked:
        'قناة واتساب موقوفة على قرار المزود (البند 192): يُسجَّل كل ما يُفترض إرساله ولا تُرسل رسالة فعلياً. البريد يعمل.',
    },

    ads: {
      searchPlaceholder: 'بحث بالمعلن أو المدينة…',
      kpiActive: 'حملات نشطة',
      kpiPaused: 'حملات متوقفة',
      kpiEnding: 'تنتهي خلال أسبوع',
      kpiImpressions: 'مشاهدات',
      kpiClicks: 'نقرات',
      colAdvertiser: 'المعلن',
      colPeriod: 'المدة',
      colImpressions: 'مشاهدات',
      colClicks: 'نقرات',
      endsIn: 'ينتهي بعد {days} أيام',
      ended: 'انتهت المدة',
      pause: 'إيقاف',
      resume: 'تشغيل',
      pausing: 'جارٍ التنفيذ…',
      ctr: 'نسبة النقر',
      monthly: 'شهري',
      weekly: 'أسبوعي',
      quarterly: 'ربع سنوي',
      note: 'الإعلانات موجَّهة حسب مدينة حجز العميل، وتظهر بعد تأكيد الحجز أو داخل صفحة الحجز — موسومة دائماً «إعلان شريك» ولا تُخلط بترتيب البحث الطبيعي. رسالة واتساب واحدة غير مزعجة كحد أقصى.',
      noRanking:
        'لا يوجد ترتيب أو أولوية للإعلانات في نتائج البحث — لا في الواجهة ولا في قاعدة البيانات.',
    },

    contracts: {
      title: 'عقود الشراكة',
      hint: 'ارفع العقد الموقّع بين سفرة والشريك (PDF ≤ 10MB) — يُحفظ في سجل الشريك ويُوثّق في Audit Log',
      partner: 'الشريك',
      kind: 'نوع العقد',
      kindBase: 'عقد شراكة أساسي',
      kindCommissionAnnex: 'ملحق تعديل عمولة',
      kindRenewal: 'تجديد سنوي',
      expiry: 'تاريخ الانتهاء',
      file: 'ملف العقد',
      upload: 'رفع العقد',
      uploading: 'جارٍ الرفع…',
      view: 'عرض',
      markSigned: 'تسجيل التوقيع',
      signedOn: 'وُقِّع {date}',
      uploadedBy: 'رُفِع {date} بواسطة {who}',
      validUntil: 'ساري حتى {date}',
      expiringIn: 'ينتهي خلال {days} يوماً',
      expired: 'منتهٍ',
      awaitingSignature: 'بانتظار توقيع الشريك',
      superseded: 'مُستبدَل',
      terminated: 'مُنهى',
      none: 'لا عقود مرفوعة لهذا الشريك.',
      pdfOnly: 'PDF فقط، وبحد أقصى 10 ميغابايت.',
      supersedeNote:
        'رفع عقد جديد من النوع نفسه يجعل السابق «مُستبدَلاً» ولا يحذفه — أي شروط كانت سارية يوم حجز مُتنازع عليه سؤال يُطرح فعلاً.',
    },

    settings: {
      title: 'Rules Engine — قيم تشغيلية قابلة للتعديل دون كود (P-005)',
      hint: 'أي تعديل هنا يتطلب صلاحية مالية ويُسجَّل في سجل التدقيق مع IP والجهاز والوقت.',
      save: 'حفظ',
      saving: 'جارٍ الحفظ…',
      change: 'تعديل',
      cancel: 'إلغاء',
      value: 'القيمة',
      amount: 'المبلغ',
      mode: 'النمط',
      enabled: 'مفعّل',
      disabled: 'معطّل',
      reason: 'سبب التعديل — يُسجَّل مع التغيير',
      lastChanged: 'آخر تعديل: {who} · {when}',
      saveFailed: 'تعذّر حفظ هذه القيمة.',
      /** Hints per value schema, so the operator knows the expected form before typing. */
      /**
       * The four groups the seventeen settings are sorted into.
       *
       * Keyed by what a setting DOES rather than by its key prefix, which is the grouping the
       * screen presents — see the note on `settings/page.tsx`. The prefixes that map onto each
       * stay in the page: they are routing, not copy.
       */
      groupMoney: 'المال — العمولات والرسوم والاسترداد',
      groupMoneyNote:
        'ما تتقاضاه سفرة وما يُستحق للشريك. التعديل لا يُعيد حساب حجز قائم: كل حجز يحتفظ بلقطة من القيم التي أُنشئ بها.',
      groupBooking: 'قواعد الحجز',
      groupBookingNote:
        'المُهل التي تحدد متى يسقط الحجز ومتى يتأخر الشريك (§6.4، EC-001).',
      groupPartners: 'الشركاء والتعويضات',
      groupPartnersNote:
        'الغرامات، ورصيد المحفظة الذي يحصل عليه العميل عند تجاوز الشريك مهلته (P-007).',
      groupOther: 'إعدادات أخرى',
      groupOtherNote:
        'إعدادات خارج المجموعات أعلاه. بعضها غير قابل للتعديل من هنا — يوضح الصف السبب.',
      groupPermissions: 'الصلاحيات',
      groupPermissionsNote:
        'منح صلاحيات في وقت التشغيل. التمكين يسري خلال 15 دقيقة؛ الإلغاء يُبطل كل جلسات ذلك الدور فوراً.',
      hintRate: 'كسر بين 0 و 1 — نسبة 7٪ تُكتب 0.07',
      hintPercent: 'رقم من 0 إلى 100',
      hintHourOfDay: 'ساعة من 0 إلى 23 بتوقيت المدينة',
      hintInt: 'رقم صحيح',
      feeFlat: 'ثابت — مبلغ لكل حجز',
      feePercent: 'نسبة — حصة من قيمة الإقامة',
      /** Shown for a schema this form cannot validate, naming the schema. */
      notEditable:
        'هذا الإعداد من نوع {schema}، ولا يستطيع هذا النموذج التحقق منه. تعديله من حقل عام قد يعطّله بصمت، فيبقى تغييره قراراً يُراجع.',
    },

    /**
     * The detail screens and the account-setup flow.
     *
     * These eleven files were written in ENGLISH and had no catalogue import at all, which is why
     * the Arabic-only rule (Bashar, 2026-08-03) was being broken invisibly: a scan for Arabic
     * literals cannot find a screen that contains no Arabic. The `no-hardcoded-text` lint rule
     * found them, which is the reason it exists.
     */
    bookingDetail: {
      /**
       * Interpolated lines, as templates.
       *
       * The English versions built plurals inline — `{n} night{n === 1 ? '' : 's'}` — which is a
       * rule about English grammar written into a component. Arabic has six plural forms and does
       * not use any of them the way that expression assumes, so the pluralisation cannot survive
       * translation. These read the count as a value and phrase the sentence around it, which is
       * what every locale can then do in its own way.
       */
      /*
        «←», not «→». The two dates are digit runs, so an RTL line places the check-in on the RIGHT
        and the check-out on the LEFT — and «→» then pointed from the check-out back at the
        check-in, saying the stay ran backwards. Neither arrow is bidi-mirrored, so the character
        written here is the character shown. Same correction as the الحجوزات table's stay column.
      */
      stay: '{checkIn} ← {checkOut} · {nights} ليلة · {adults} بالغ',
      stayWithChildren:
        '{checkIn} ← {checkOut} · {nights} ليلة · {adults} بالغ، {children} طفل',
      fxSnapshot: '{amount} ل.س بسعر صرف {rate}، مثبَّت لحظة إنشاء الحجز.',
      attemptVia: '{method} عبر {provider} · {status}',
      refunded: 'استُرد {amount} {currency}',
      refundedToWallet: 'استُرد {amount} {currency} ({walletAmount} إلى المحفظة)',
      actorLine: 'بواسطة {who}',
      customer: 'العميل',
      partner: 'الشريك',
      property: 'العقار',
      /**
       * The last line of the customer card, which shipped as the English `Booked as a guest` /
       * `Has an account` written straight into the component.
       *
       * A full clause rather than the registry's one-word «ضيف» / «مسجل»: those sit under a
       * «النوع» column header that supplies the question, and this line has no header above it.
       */
      bookedAsGuest: 'حجز كضيف',
      hasAccount: 'لديه حساب',
      dates: 'التواريخ',
      booked: 'تاريخ الحجز',
      paid: 'تاريخ الدفع',
      confirmationDue: 'مهلة التأكيد',
      confirmed: 'تاريخ التأكيد',
      cancelled: 'تاريخ الإلغاء',
      money: 'المال',
      base: 'قيمة الإقامة',
      serviceFee: 'رسوم الخدمة',
      paidFromWallet: 'مدفوع من المحفظة',
      customerTotal: 'إجمالي العميل',
      partnerCommission: 'عمولة سفرة',
      partnerPayable: 'المستحق للشريك',
      payments: 'عمليات الدفع',
      noPayments: 'لا محاولات دفع.',
      timeline: 'الخط الزمني',
      nothingRecorded: 'لا يوجد شيء مسجَّل بعد.',
      cancellation: 'الإلغاء',
    },

    propertyDetail: {
      listing: 'بيانات العقار',
      address: 'العنوان',
      slug: 'المعرّف',
      submitted: 'تاريخ التقديم',
      coordinates: 'الإحداثيات',
      photos: 'الصور',
      units: 'الوحدات',
      decision: 'القرار',
      tradingAs: 'يعمل تحت اسم {name}',
      partnerVerified: 'تم التحقق من الشريك.',
      /**
       * Ends before the link, deliberately.
       *
       * A `{link}` placeholder cannot carry an `<a>` element — `fill()` returns a string — and
       * passing an empty value left a stray dash and a doubled full stop on screen. The sentence
       * stops where the link begins, and the link's own label is the next key.
       */
      partnerNotVerified: 'حالة الشريك {status}. لا يمكن نشر هذا العقار قبل التحقق منه —',
      photoCount: '{count} صورة مرفوعة، {cover}',
      coverSet: 'وصورة الغلاف محددة',
      coverMissing: 'ولم تُحدَّد صورة غلاف',
      unitLine: 'حتى {guests} ضيوف · {price} / الليلة · الحد الأدنى {minNights} ليلة',
      notAwaitingReview: 'حالة هذا العقار {status} وهو ليس بانتظار المراجعة.',
      reviewThePartner: 'راجع الشريك',
      noDescription: 'لا يوجد وصف.',
      noPhotos:
        'لا صور مرفوعة. يتوقع البند §5.6 معرضاً، وعدد الصور يرفع ترتيب العقار — النشر بلا صور ممكن لكنه نادراً ما يكون صحيحاً.',
      previewsPending: 'المعاينات غير معروضة بعد — البند 159a في خطة العمل.',
      noUnits: 'لا وحدات. عقار بلا وحدة لا يمكن حجزه ولا يجب نشره.',
    },

    partnerDetail: {
      applicant: 'مُقدّم الطلب',
      email: 'البريد الإلكتروني',
      phone: 'الهاتف',
      address: 'العنوان',
      applied: 'تاريخ التقديم',
      documents: 'الوثائق',
      noDocuments:
        'لا وثائق مرفوعة بعد. يشترط البند §8.1 الهوية والسجل التجاري وإثبات حق التأجير قبل التحقق من هذا الشريك.',
      tradingAs: 'يعمل تحت اسم {name}',
      alreadyDecided: 'تم البتّ في هذا الشريك بالفعل — الحالة {status}.',
      alreadyDecidedOn: 'تم البتّ في هذا الشريك بالفعل — الحالة {status} بتاريخ {date}.',
      sanctionsScreening: 'فحص العقوبات',
      theirListings: 'عقاراته',
      noListings: 'لا عقارات مُقدَّمة.',
      decision: 'القرار',
    },

    twoFactor: {
      title: 'تهيئة المصادقة الثنائية',
      requiredNote:
        'مطلوبة قبل استخدام مركز القيادة. تحمي وثائق الشركاء وأرصدة المحافظ وقرارات الموافقة.',
      enabled: 'المصادقة الثنائية مُمكَّنة.',
      saveRecoveryCodes: 'احفظ رموز الاسترداد',
      recoveryCodesNote:
        'كل رمز يُستخدم مرة واحدة بدلاً من تطبيق المصادقة. تُخزَّن مُعمَّاة ولا يمكن عرضها مرة أخرى.',
      savedContinue: 'حفظتها — متابعة',
      step1: '١. افتح تطبيق المصادقة وأضف حساباً يدوياً.',
      step2: '٢. أدخل المفتاح أدناه.',
      step3: '٣. اكتب الرمز المكوّن من ستة أرقام الذي يظهر.',
      setupKey: 'مفتاح التهيئة',
      sixDigitCode: 'الرمز المكوّن من ستة أرقام',
    },

    screening: {
      blockedNote:
        'التحقق من الشريك موقوف حتى تُحل هذه المسألة. الفحص مقابل قائمة لا يمكن إثبات أنها محدَّثة يبدو التزاماً دون أن يكون كذلك.',
      notScreened: 'لم يُفحص. لا يمكن التحقق من شريك قبل إجراء الفحص.',
      confirmOverride: 'تأكيد التجاوز',
      listStale: 'قائمة العقوبات عمرها {days} يوماً ولا يمكن الفحص مقابلها.',
      listMissing: 'لم تُستورد أي قائمة عقوبات.',
      possibleMatch: 'سُجِّلت مطابقة محتملة — لا توافق دون تصعيد.',
      noMatch: 'تم الفحص مقابل قائمة الاتحاد الأوروبي الموحدة، لا مطابقة.',
      recordedOn: 'سُجِّل في {date}',
      recordedOnSearched: 'سُجِّل في {date} · بحث عن {terms}',
      matchLine: '{subject} · تشابه {similarity} · {parts} من أجزاء الاسم مشتركة',
      matchLineProgramme:
        '{subject} · تشابه {similarity} · {parts} من أجزاء الاسم مشتركة · {programme}',
    },

    documentReview: {
      open: 'عرض',
      rejectHint: 'ما الخطأ فيه؟ يرى الشريك هذا النص.',
      fileLine: '{fileName} · رُفِع {when}',
      approve: 'اعتماد',
      reject: 'رفض',
    },

    verifyPartner: {
      screeningRequired:
        'سجّل نتيجة فحص العقوبات قبل الموافقة. التحقق من طرف لم يُفحص مخاطرة قانونية على الكيان الألماني، لا إجراء شكلي.',
      approve: 'الموافقة على الشريك',
      reject: 'رفض الطلب',
    },

    /**
     * إعادة تعيين المصادقة الثنائية للشريك — the lost-phone path.
     *
     * The copy states what the action DOES rather than naming the control after the feature,
     * because the operator reading it is on the phone to somebody who cannot sign in and needs to
     * know what will happen next: the partner is signed out everywhere and must enrol again.
     */
    partnerTwoFactor: {
      title: 'المصادقة الثنائية',
      enrolled: 'مُفعَّلة',
      notEnrolled: 'غير مُفعَّلة',
      explain:
        'المصادقة الثنائية إلزامية لكل الشركاء. إعادة التعيين تُنهي جميع جلسات الشريك وتُلزمه بتسجيل مُصادِق جديد عند الدخول التالي — لا تمنحك رمزًا ولا تفتح الحساب نيابةً عنه.',
      reset: 'إعادة تعيين المصادقة الثنائية',
      reasonLabel:
        'سبب إعادة التعيين. يُسجَّل في سجل التدقيق ويُطلب منه ثلاثة أحرف على الأقل.',
      confirm: 'تأكيد إعادة التعيين',
      working: 'جارٍ التنفيذ…',
      done: 'أُعيد التعيين. أُنهيت {n} جلسة، وعلى الشريك تسجيل مُصادِق جديد عند الدخول التالي.',
      failed: 'تعذّرت إعادة التعيين.',
      unreachable: 'تعذّر الوصول إلى الخادم.',
    },

    reviewProperty: {
      approveAndPublish: 'الموافقة والنشر',
      reject: 'رفض العقار',
    },

    invitation: {
      setPassword: 'عيّن كلمة المرور',
      invitedNote: 'تمت دعوتك إلى مركز قيادة سفرة. اختر كلمة مرور لتنشيط حسابك.',
      unexpectedNote:
        'إذا لم تكن تتوقع هذه الدعوة، أغلق هذه الصفحة وأبلغ فريق سفرة. لا تعيّن كلمة مرور.',
      newPassword: 'كلمة المرور الجديدة',
      confirmPassword: 'تأكيد كلمة المرور',
      passwordSet: 'تم تعيين كلمة المرور.',
      signInNext:
        'سجّل الدخول الآن. سيُطلب منك تهيئة المصادقة الثنائية قبل أي إجراء — وهي إلزامية لكل حساب موظف.',
      goToSignIn: 'الانتقال إلى تسجيل الدخول',
    },

    emergency: {
      title: '⚠ وضع الطوارئ (EC-009) — ظروف قاهرة',
      hint: 'يفعَّل لمدينة أو دولة عند الظروف القاهرة. صلاحية Super Admin فقط، ويُسجَّل في سجل التدقيق.',
      scope: 'النطاق',
      scopeCity: 'مدينة محددة',
      scopeCountry: 'دولة كاملة',
      target: 'المدينة / الدولة',
      reason: 'سبب التفعيل',
      reasonHint: 'مطلوب ويُحفظ في سجل التدقيق — لا يمكن التفعيل دون سبب مكتوب',
      stopBookings: 'إيقاف الحجوزات الجديدة في النطاق',
      waiveFines: 'إلغاء غرامات الشركاء مؤقتاً',
      broadcast: 'إرسال رسالة جماعية للعملاء أصحاب الحجوزات القادمة',
      suspendSla: 'تعليق مهلة تأكيد الساعتين',
      activate: 'تفعيل وضع الطوارئ',
      deactivate: 'إيقاف وضع الطوارئ',
      activeBanner: '⚠ وضع الطوارئ مفعّل — {scope}',
      stateActive: 'مفعّل',
      stateEnded: 'منتهٍ',
      history: 'سجل التفعيلات',
      never: 'لم يُفعَّل وضع الطوارئ من قبل.',
      broadcastPending:
        'الرسالة الجماعية غير مُنفَّذة بعد: قناة واتساب بانتظار قرار المزود — يُسجَّل الاختيار ولا تُرسل رسالة.',
    },
  },

  /** The four sections with no table behind them yet. */
  unbuilt: {
    heading: 'هذا القسم غير مُنفَّذ بعد',
    disputes:
      'النزاعات تحتاج جدولاً خاصاً (DSP) مع أدلة العميل وتجميد مستحقات الشريك. الصلاحيات مُعرَّفة والجدول غير موجود، ولن تُعرض بيانات مُختلقة.',
    messages:
      'الدردشة الثلاثية (العميل ↔ سفرة ↔ الشريك) تحتاج جدولي محادثات ورسائل مع حجب بيانات التواصل.',
    comms:
      'سجل واتساب والبريد يحتاج جدول إشعارات. الإرسال نفسه موقوف على قرار مزود واتساب.',
    ads: 'الإعلانات الموجهة تحتاج جدولي معلنين وحملات مع عدّادات المشاهدات والنقرات.',
    contracts:
      'عقود الشراكة تحتاج جدولاً للعقود (النوع، الملف، تاريخ الانتهاء، من رفعه) — الموجود حالياً تاريخ توقيع واحد على الشريك فقط. نموذج رفع بلا مكان للحفظ يفقد الملف، فلا يُعرض.',
    seeRegister: 'التفاصيل وخطة التنفيذ في docs/design-gap-report.md',
  },

  /**
   * Audit actions, so the activity panel is not a list of English identifiers.
   *
   * Keyed on the value stored in `audit_log.action`, which is a machine identifier and part
   * of the record — it is deliberately NOT translated at the source. Every action present in
   * the database is listed here; an action added later falls back to its raw key, which is
   * ugly but never wrong, and reads as a prompt to add it.
   */
  auditAction: {
    'auth.registered': 'تسجيل حساب جديد',
    'auth.email_verified': 'تأكيد البريد الإلكتروني',
    'auth.login_succeeded': 'تسجيل دخول ناجح',
    'auth.login_failed': 'محاولة دخول فاشلة',
    'auth.password_reset_requested': 'طلب إعادة تعيين كلمة المرور',
    'auth.password_reset_completed': 'إعادة تعيين كلمة المرور',
    'auth.two_factor_enabled': 'تمكين المصادقة الثنائية',
    'booking.sla_expired': 'انتهاء مهلة تأكيد حجز',
    'fx_rate.set': 'تحديث سعر صرف',
    'partner.registered': 'تسجيل شريك',
    'partner.approved': 'الموافقة على شريك',
    'partner.sanctions_screened': 'فحص العقوبات لشريك',
    'partner_document.uploaded': 'رفع وثيقة شريك',
    'partner_document.viewed': 'عرض وثيقة شريك',
    'partner_document.reviewed': 'مراجعة وثيقة شريك',
    'property.approved': 'الموافقة على عقار',
    'setting.updated': 'تعديل إعداد',
    'staff.invited': 'دعوة موظف',
    'staff.invitation_accepted': 'قبول دعوة موظف',
    'staff.role_changed': 'تغيير دور موظف',
    'staff.suspended': 'إيقاف موظف',
    'wallet.adjusted': 'تعديل محفظة',
    // Added 2026-08-04 with the four new sections.
    'dispute.resolved': 'إغلاق نزاع لصالح العميل',
    'dispute.rejected': 'رفض نزاع',
    'emergency_mode.activated': 'تفعيل وضع الطوارئ',
    'emergency_mode.deactivated': 'إيقاف وضع الطوارئ',
    'ad_campaign.paused': 'إيقاف حملة إعلانية',
    'ad_campaign.resumed': 'تشغيل حملة إعلانية',
    'partner_contract.uploaded': 'رفع عقد شراكة',
    'partner_contract.signed': 'تسجيل توقيع عقد شراكة',
  } as Record<string, string>,

  /**
   * Every enum the console renders, in Arabic.
   *
   * Grouped in one place because the alternative — translating at each call site — is how
   * `pending_confirmation` ended up on screen in three different forms. Each map falls back to
   * the raw value rather than to blank: an untranslated key is ugly and obviously a gap, while
   * an empty cell reads as "no value" and is a lie.
   */
  enums: {
    /**
     * The payout lifecycle, in the reader's language.
     *
     * Six words, all distinct — `status-tone.test.ts` checks that per vocabulary, because once
     * each status has its own colour, one word appearing in two colours reads as a rendering
     * fault. «قيد التجميع» and «بانتظار الإفراج» are the pair most at risk of being collapsed
     * into one «قيد المعالجة»; they are different things and an operator acts differently on each.
     */
    payoutStatus: {
      accruing: 'قيد التجميع',
      pending_release: 'بانتظار الإفراج',
      on_hold: 'معلَّق',
      scheduled: 'مجدول',
      paid: 'مدفوع',
      cancelled: 'ملغى',
    } as Record<string, string>,

    propertyStatus: {
      draft: 'مسودة',
      pending_review: 'قيد المراجعة',
      rejected: 'مرفوض',
      approved: 'معتمد',
      published: 'منشور',
      suspended: 'موقوف مؤقتاً',
      archived: 'مؤرشف',
    } as Record<string, string>,

    /**
     * The five documents a partner uploads for verification (§8.1).
     *
     * They were a `Record<string, string>` of English labels inside `document-review.tsx`, so the
     * reviewer's screen named every one of them in English (Bashar, 2026-08-06).
     */
    documentKind: {
      identity: 'وثيقة هوية',
      commercial_register: 'سجل تجاري',
      ownership_proof: 'إثبات ملكية',
      management_contract: 'عقد إدارة',
      bank_confirmation: 'تأكيد مصرفي',
    } as Record<string, string>,

    verification: {
      pending: 'بانتظار التحقق',
      in_review: 'قيد المراجعة',
      approved: 'معتمد',
      rejected: 'مرفوض',
    } as Record<string, string>,

    partnerTier: {
      new: 'جديد',
      needs_improvement: 'يحتاج تحسين',
      silver: 'فضي',
      gold: 'ذهبي',
    } as Record<string, string>,

    paymentMethod: {
      visa: 'Visa',
      mastercard: 'Mastercard',
      sham_cash: 'Sham Cash',
      klarna: 'Klarna',
      gift_card: 'بطاقة هدية',
      wallet: 'محفظة',
      bank_transfer: 'تحويل مصرفي',
    } as Record<string, string>,

    paymentStatus: {
      initiated: 'بدأت',
      requires_action: 'تحتاج إجراء',
      authorized: 'مُصرَّح بها',
      captured: 'ناجحة',
      failed: 'فشلت',
      expired: 'منتهية',
      refunded: 'مستردة',
      partially_refunded: 'مستردة جزئياً',
      /*
        `pending` and `processing` both read «قيد المعالجة» until 2026-08-06, which put two
        DIFFERENT statuses on one screen under one word. Once every status has its own colour that
        is worse than a shared colour: one word in two colours reads as a rendering bug. They are
        also genuinely different — nothing has started yet, versus the provider is working on it.
      */
      pending: 'بالانتظار',
      processing: 'قيد المعالجة',
      completed: 'مكتمل',
      collected: 'محصلة',
      waived: 'ملغاة',
    } as Record<string, string>,

    /**
     * Who processed a payment.
     *
     * Real providers keep their own names — a brand is not translated, and support quoting a
     * reference to Sham Cash needs the word Sham Cash. `simulator` is not a brand: it is this
     * codebase's own stand-in, and it appeared on an Arabic screen as the English word.
     */
    paymentProvider: {
      simulator: 'محاكاة',
      sham_cash: 'Sham Cash',
      stripe: 'Stripe',
      klarna: 'Klarna',
    } as Record<string, string>,

    /**
     * The field names inside a timeline event's `payload`.
     *
     * The payload used to be printed as raw JSON — `{"reason":"EC-001"}` — which is a developer
     * reading their own data structure, not a support agent reading a booking (Bashar,
     * 2026-08-06). Every field is still shown; only the braces and quotes are gone.
     *
     * A field with no entry here falls back to its raw key, so a payload gaining a field stays
     * fully visible rather than silently losing it. That is load-bearing: the point of showing
     * the payload at all is that a dispute can turn on which fine was applied.
     */
    payloadKey: {
      reason: 'السبب',
      reference: 'المرجع',
      notes: 'ملاحظات',
      total: 'الإجمالي',
      currency: 'العملة',
      city: 'المدينة',
      type: 'النوع',
      amount: 'المبلغ',
      toWallet: 'إلى المحفظة',
      toProvider: 'إلى مزود الدفع',
      percent: 'النسبة',
      tier: 'شريحة الاسترداد',
      occurrence: 'رقم التكرار',
      fine: 'الغرامة',
      compensation: 'التعويض',
      creditedAmount: 'المبلغ المضاف',
      creditedCurrency: 'عملة الإضافة',
      walletBalance: 'رصيد المحفظة',
    } as Record<string, string>,

    /**
     * Payload VALUES that are codes rather than data.
     *
     * `EC-001` is the SRS's identifier for an abandoned checkout — the customer closed the page
     * mid-payment, the booking expired and the dates were released. It is meaningful in the
     * requirements document and meaningless on a support screen, so the screen says what happened
     * and the record keeps the code.
     *
     * Only codes belong here. A `reason` a person typed is their own words and falls through
     * unchanged, exactly like a typed cancellation reason.
     */
    payloadValue: {
      'EC-001': 'أُغلقت صفحة الدفع قبل إتمامه، فانتهت مهلة الحجز وأُعيدت التواريخ',
    } as Record<string, string>,

    /**
     * The cancellations the platform decides for itself, keyed on the `system.*` code stored in
     * `bookings.cancellation_reason`.
     *
     * Only these three. A reason a PERSON typed is not in here and never will be — it is shown as
     * written, because it is their statement about a booking. The resolver therefore falls back to
     * the raw value rather than to «—», which also keeps rows written before the codes existed
     * readable in the English they were stored in.
     */
    cancellationReason: {
      'system.payment_expired': 'لم يكتمل الدفع خلال المهلة المسموحة (EC-001).',
      'system.partner_no_response': 'لم يرد الشريك خلال مهلة التأكيد (§6.4).',
      'system.partner_rejected': 'رفض الشريك الحجز.',
    } as Record<string, string>,

    /**
     * Who or what performed a timeline event.
     *
     * `system` is the one that shows most — every SLA expiry and capture is attributed to it —
     * and it read as «بواسطة system» beside Arabic on the booking screen.
     */
    actorType: {
      system: 'النظام',
      staff: 'موظف',
      partner: 'الشريك',
      customer: 'العميل',
    } as Record<string, string>,

    /**
     * A booking's timeline entries, keyed on `timeline_events.event_type`.
     *
     * The key is a machine identifier and part of the append-only record — deliberately NOT
     * translated at the source, exactly like `auditAction` above. It used to reach the screen as
     * `event_type.replace(/[._]/g, ' ')`, which is how «booking payment expired» appeared under
     * «الخط الزمني» (Bashar, 2026-08-06).
     *
     * Every type the API writes is listed. One added later falls back to its spaced-out raw key,
     * which is ugly but never wrong and reads as a prompt to add it here.
     */
    timelineEvent: {
      'booking.payment_started': 'بدء الدفع',
      'booking.payment_captured': 'تحصيل الدفع',
      'booking.payment_expired': 'انتهاء مهلة الدفع',
      'booking.confirmed': 'تأكيد الحجز',
      'booking.rejected_by_partner': 'رفض الشريك للحجز',
      'booking.cancelled': 'إلغاء الحجز',
      'booking.sla_expired': 'انتهاء مهلة التأكيد',
      'booking.refund_issued': 'إصدار استرداد',
      'partner.registered': 'تسجيل شريك',
      'partner.approved': 'الموافقة على الشريك',
      'partner.rejected': 'رفض الشريك',
      'property.submitted_for_review': 'إرسال العقار للمراجعة',
      'property.published': 'نشر العقار',
      'property.rejected': 'رفض العقار',
    } as Record<string, string>,

    violationKind: {
      no_response: 'عدم الرد',
      rejected_after_payment: 'رفض بعد الدفع',
      stale_calendar: 'تقويم غير محدَّث',
      inaccurate_listing: 'وصف غير مطابق',
      no_show: 'عدم استقبال',
    } as Record<string, string>,

    walletReason: {
      sla_compensation: 'تعويض مهلة',
      refund: 'استرداد',
      booking_payment: 'استخدام في حجز',
      admin_adjustment: 'تعديل إداري',
      gift_card_transfer: 'تحويل بطاقة هدية',
      profile_claim: 'ضم حساب ضيف',
    } as Record<string, string>,

    giftCardStatus: {
      active: 'نشطة',
      used: 'مستخدمة',
      expired: 'منتهية',
      cancelled: 'ملغاة',
    } as Record<string, string>,

    couponStatus: {
      active: 'نشط',
      suspended: 'موقوف',
      expired: 'منتهي',
    } as Record<string, string>,

    couponType: {
      first_booking: 'أول حجز',
      seasonal: 'موسمية',
      city: 'مدينة',
      partner: 'شريك',
      campaign: 'حملة تسويقية',
    } as Record<string, string>,

    disputeKind: {
      property_unavailable: 'العقار غير متاح (EC-006)',
      not_as_described: 'غير مطابق للوصف (EC-007)',
      partner_no_response: 'الشريك لم يرد (EC-008)',
      complaint: 'شكوى',
    } as Record<string, string>,

    disputeStatus: {
      open: 'مفتوح',
      investigating: 'قيد المراجعة',
      resolved: 'مغلق — لصالح العميل',
      rejected: 'مغلق — مرفوض',
    } as Record<string, string>,

    notificationStatus: {
      queued: 'قيد الانتظار',
      sent: 'مرسلة',
      delivered: 'وصلت',
      failed: 'فشلت',
    } as Record<string, string>,

    adStatus: {
      draft: 'مسودة',
      active: 'نشط',
      paused: 'متوقف',
      expired: 'منتهٍ',
    } as Record<string, string>,

    advertiserKind: {
      restaurant: 'مطعم',
      activity: 'نشاط',
      shop: 'متجر',
      transport: 'نقل',
      other: 'أخرى',
    } as Record<string, string>,

    cityCategory: {
      coastal: 'ساحلية',
      mountain: 'جبلية',
      desert: 'صحراوية',
      historic: 'تاريخية',
    } as Record<string, string>,
  },

  /**
   * Names for the six notification templates, keyed by `notifications.template_key`.
   *
   * These were `nameAr` fields on the API's template inventory, which put Arabic UI copy in a
   * JSON response and left a second client with nothing to display. The key is the machine
   * identifier and stays in the API; the name is what staff call it and belongs here — the same
   * split as `auditAction` above. Quoted verbatim from design handoff §8.
   */
  notificationTemplate: {
    'booking.confirmed': 'تأكيد الحجز + قسيمة + QR',
    'booking.invoice': 'الفاتورة',
    'booking.cancelled_refund': 'الإلغاء والاسترداد',
    'wallet.compensation': 'تعويض المحفظة',
    'partner.deadline_reminder': 'تذكير الشريك بالمهلة',
    'ad.single_offer': 'عرض إعلاني (رسالة واحدة)',
  } as Record<string, string>,

  /** Booking statuses, so the table does not show raw enum values. */
  bookingStatus: {
    pending_payment: 'بانتظار الدفع',
    pending_confirmation: 'قيد التأكيد',
    confirmed: 'مؤكد',
    checked_in: 'تم الوصول',
    completed: 'مكتمل',
    cancelled: 'ملغى',
    disputed: 'متنازع عليه',
  } as Record<string, string>,

  /** Role names, so `super_admin` does not appear raw next to Arabic text. */
  roles: {
    super_admin: 'مدير عام',
    operations_manager: 'مدير عمليات',
    finance_officer: 'مسؤول مالي',
    support_agent: 'موظف دعم',
  } as Record<string, string>,

  /**
   * Currency symbols, keyed by ISO code.
   *
   * The CODE is a machine identifier and is never translated; the symbol is how a language
   * writes it, and belongs here. A locale with no symbol for a currency falls back to the
   * code, which is correct rather than blank.
   */
  /**
   * The percent sign.
   *
   * Arabic uses ٪ (U+066A), not the Latin %. They are different characters, and the Latin one
   * next to Arabic-Indic-grouped digits looks like a font fallback rather than a choice. It is
   * a symbol whose shape depends on the language, so it is copy.
   */
  percentSign: '٪',

  currencySymbol: {
    USD: '$',
    EUR: '€',
    SYP: 'ل.س',
    JOD: 'د.أ',
    LBP: 'ل.ل',
  } as Record<string, string>,

  errors: {
    credentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    codeFormat: 'تنسيق الرمز غير صحيح. أدخل ستة أرقام أو رمز استرداد.',
    notStaff: 'هذا الحساب لا يملك صلاحية الدخول إلى مركز القيادة.',
    locked: 'هذا الحساب مقفل مؤقتاً. حاول مرة أخرى بعد قليل.',
    tooMany: 'محاولات كثيرة. انتظر دقيقة ثم حاول مرة أخرى.',
    unreachable: 'تعذّر الوصول إلى الخادم. حاول مرة أخرى.',
    unknown: 'حدث خطأ ما. حاول مرة أخرى.',
  },
} as const;
