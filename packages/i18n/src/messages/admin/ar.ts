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
    /*
      A PIPE, never a dash. Bashar's instruction (2026-08-13), for both consoles.

      A dash reads as a subtitle — "سفرة, the command centre" — and a browser tab truncates from the
      end, so the half that survives is the half that says which product it is rather than which app.
      The pipe separates two names of equal weight, which is what these are.
    */
    title: 'سفرة | مركز القيادة',
  },

  /**
   * The 404, which was Next's English default until 2026-08-20.
   *
   * Reported by Bashar: the page "is written on the left, while the current language is Arabic".
   * Both halves of that were true — the copy was `404 / This page could not be found.`, and under
   * the document's `dir="rtl"` the full stop rendered at the START of the sentence, which is what a
   * mis-ordered line looks like.
   *
   * It is not only a typo'd URL that lands here. `/partners/PAR-999999` does too: a reference from
   * a stale bookmark, a deleted record, or a reference somebody pasted one digit wrong. That is an
   * ORDINARY thing for a staff member to do, and the answer to it should say what happened and
   * offer a way back rather than look like the console has broken.
   */
  /**
   * The error boundary's copy, added 2026-08-20 with `error.tsx`.
   *
   * Says what happened, offers the two things a person can do, and names NOTHING about the error
   * itself — rule 1 keeps the detail in the server log. The digest the page prints is Next's own
   * correlation id, which is what makes a report findable without carrying any of its content.
   */
  errorPage: {
    title: 'حدث خطأ غير متوقع',
    body: 'تعذّر إتمام هذا الطلب. قد تكون المشكلة مؤقتة — أعد المحاولة، وإن تكررت أبلغ الفريق التقني بالرقم أدناه.',
    retry: 'إعادة المحاولة',
    home: 'العودة إلى لوحة الإدارة',
  },

  notFound: {
    title: 'هذه الصفحة غير موجودة',
    body: 'قد يكون الرابط قديماً، أو أن السجل حُذف، أو أن المرجع مكتوب بشكل خاطئ. تحقّق من الرابط أو ابدأ من لوحة الإدارة.',
    home: 'العودة إلى لوحة الإدارة',
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
    partnerApplications: 'طلبات الشراكة',
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
    staffRoles: 'أدوار الموظفين',
    audit: 'سجل التدقيق',
    /*
      وضع الطوارئ reached the nav on 2026-08-24, and the ⚠ is deliberate.

      It was reachable ONLY from the dashboard header. Gating مركز القيادة on `booking.read_all` and
      redirecting readers who lack it meant a role carrying `emergency_mode.activate` and not
      `booking.read_all` could no longer reach the emergency control at all — exactly the role most
      likely to need it, and only in the situation where it matters. The gate created the gap; this
      closes it.

      The glyph is the same one the header uses, so the two entry points read as one control rather
      than as two features. Both are kept: two ways to reach the control that matters under pressure
      is the correct number.
    */
    emergency: '⚠ وضع الطوارئ',
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
    /*
      EC-011 — «الشريك نسي Check-in». Says what to DO, not only what is wrong: the row links to the
      same predicate the counter used, and the operator's next move is to ring the property.
    */
    attentionArrivals: 'حجز مؤكد مضى موعد وصوله ولم يُسجَّل — راجع الشريك',
    /*
      EC-004. Phrased as a fault rather than a queue, because it should be zero: the partner's
      answer and the status move are one transaction, so a row here means something is broken.
    */
    attentionUnconfirmed: 'حجز ردّ عليه الشريك ولم تتغيّر حالته — خلل يحتاج مراجعة',
    /*
      §6.4. «لم يبدأ» rather than «لم يُسترد»: the sweep issues the refund automatically and the
      outbound transfer is a human step afterwards, so a row here means nothing has STARTED — which
      is the state that needs somebody, not a refund merely still in flight.
    */
    attentionRefundsOwed: 'حجز ألغته سفرة ولم يبدأ استرداد مبلغه — يحتاج متابعة',
    attentionSla: 'حجز تنتهي مهلة تأكيده خلال 30 دقيقة',
    attentionPartners: 'شريك بانتظار التحقق من الوثائق',
    attentionProperties: 'عقار بانتظار المراجعة قبل النشر',
    /*
      Documents SENT, waiting to be looked at (Bashar, 2026-08-21).

      Distinct from «شريك بانتظار التحقق»: a partner sits in that queue from the day their account
      is made, whether or not they have sent anything. This row appears only when there is
      something to read, which is what makes it a signal rather than a standing number.
    */
    attentionDocuments: 'مستند شراكة بانتظار المراجعة',
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
    /*
      A boolean in a payload. `String(value)` printed `true`/`false` under «قبل» and «بعد» on سجل
      التدقيق — English, and the kind a reader has to translate in their head (Bashar, 2026-08-20).
    */
    yes: 'نعم',
    no: 'لا',
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
    /** The submit and the busy label on an inline action form, shared across sections. */
    confirm: 'تأكيد',
    working: 'جارٍ التنفيذ…',
    search: 'بحث',
    pageSizeLabel: 'عدد الصفوف في الصفحة',
    /** Submits the pagination bar's form — see the note in `table-pagination.tsx`. */
    apply: 'تطبيق',
    exportCsv: 'تصدير CSV',
    exportsLink: 'الملفات المصدَّرة',

    /*
      The bar under every table: صفحة ‹ [1] › من 102 — اعرض [25] صفًا — 2531 نتيجة.

      Split into fragments rather than one interpolated sentence because the page number is an
      INPUT sitting inside the sentence, and a placeholder cannot hold a form control. The
      fragments are ordered by the JSX, which is the one place the visual order is decided.
    */
    page: 'صفحة',
    /** Follows the page input: "من 102". */
    pageOf: 'من {n}',
    pageLabel: 'رقم الصفحة',
    /** Precedes the rows-per-page select. */
    show: 'اعرض',
    /** Follows it, naming what is being counted. */
    rows: 'صفًا',
    /** The total the query matched, printed at the end of the bar. */
    found:
      '{n, plural, zero {لا نتائج} one {نتيجة واحدة} two {نتيجتان} few {# نتائج} many {# نتيجة} other {# نتيجة}}',
    /**
     * Shown instead of `found` when the count was capped.
     *
     * A total over the cap is not counted exactly, because `count(*)` over a table the size of
     * the audit log is a full scan on every page view. "أكثر من 10000" is honest about that;
     * a precise-looking number nobody paid for would not be.
     */
    foundCapped:
      'أكثر من {n, plural, one {نتيجة واحدة} two {نتيجتين} few {# نتائج} many {# نتيجة} other {# نتيجة}}',
    /**
     * Why the paging controls are inert: everything is already on one page.
     *
     * Added 2026-08-25, with the disabled state it explains (Bashar, from a table with two rows).
     * It says where the reader IS — one page holds all of it — rather than what they cannot do, so
     * a small table reads as complete rather than as a screen with four broken controls on it.
     *
     * Deliberately WITHOUT the word «نتائج»: the total sits beside it and is found by matching on
     * that root, so «كل النتائج في صفحة واحدة» made two elements answer to one locator and broke an
     * assertion about the total. The note is about PAGES, so naming results was never its job.
     */
    singlePage: 'الكل في صفحة واحدة',
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
     * A stay, with the month and year the two dates share written once — «04 ← 08-09-2026».
     *
     * A template rather than a formatter's own literal, because the arrow's SIDE is language:
     * this reads right-to-left, so «←» leads from the check-in on the right to the check-out on
     * the left. A locale that reads the other way needs «→» and the two values swapped, which is
     * an edit here rather than in `dateRange()`.
     */
    dateRange: '{from} ← {to}',
    colTime: 'الوقت',
    colFilter: 'المرشِّح',
    colFile: 'الملف',
  },

  /**
   * Per-section copy, verbatim from the design handoff.
   *
   * Every `note` is a business rule an operator has to know — that a partner is never
   * hard-deleted, that a ledger row is immutable, that a dispute freezes a payout. They are
   * quoted exactly and must not be paraphrased.
   */
  sections: {
    /**
     * طلبات الشراكة — who has asked to join, and what was done about it.
     *
     * The seven steps Bashar specified on 2026-08-19 are the structure of this screen: a request
     * arrives, somebody telephones the applicant, somebody accepts, and the account is handed over
     * by an invitation. Every word here exists to make the NEXT action obvious on a queue that one
     * person works through.
     */
    partnerApplications: {
      title: 'طلبات الشراكة',
      note: 'طلبات الانضمام من صفحة «انضم كشريك». اتصل بمقدّم الطلب أولاً، ثم اقبل الطلب أو ارفضه.',
      searchPlaceholder: 'ابحث برقم الطلب أو اسم النشاط أو البريد',
      allStatuses: 'كل الحالات',
      empty: 'لا توجد طلبات.',
      /* The row */
      colBusiness: 'النشاط',
      colContact: 'مقدّم الطلب',
      colCity: 'المدينة',
      colType: 'النوع',
      colSubmitted: 'تاريخ الطلب',
      /* The detail screen */
      back: 'رجوع إلى طلبات الشراكة',
      applicant: 'بيانات مقدّم الطلب',
      business: 'بيانات النشاط',
      legalName: 'الاسم القانوني',
      displayName: 'الاسم التجاري',
      partnerType: 'نوع النشاط',
      city: 'المدينة',
      address: 'العنوان',
      propertyCount: 'عدد العقارات المعلَنة',
      website: 'الموقع الإلكتروني',
      message: 'رسالة مقدّم الطلب',
      contactName: 'الاسم',
      email: 'البريد الإلكتروني',
      phone: 'الهاتف',
      locale: 'لغة التواصل',
      /* What we did */
      history: 'سجل الطلب',
      submittedAt: 'وصل الطلب',
      contactedAt: 'تم الاتصال',
      contactedBy: 'بواسطة',
      decidedAt: 'صدر القرار',
      decidedBy: 'بواسطة',
      notes: 'الملاحظات',
      becamePartner: 'أصبح الشريك',
      partnerVerification: 'حالة التحقق',
      /* The actions */
      contactAction: 'تسجيل الاتصال',
      contactHint: 'اكتب ما جرى في المكالمة. يظهر لفريق سفرة فقط.',
      acceptAction: 'قبول الطلب وإنشاء الحساب',
      acceptHint:
        'يُنشئ سجل شريك بحالة «قيد الانتظار» ويُرسل رابط دعوة لتعيين كلمة المرور. لا نرسل كلمة مرور في رسالة أبدًا.',
      rejectAction: 'رفض الطلب',
      rejectHint:
        'السبب يُرسل إلى مقدّم الطلب بالبريد الإلكتروني، فاكتبه كما تريد أن يقرأه.',
      resendAction: 'إعادة إرسال الدعوة',
      resendHint: 'للدعوة التي انتهت صلاحيتها أو لم تصل.',
      actionFailed: 'تعذّر تنفيذ الإجراء. حاول مرة أخرى.',
      notesRequired: 'اكتب ملاحظة أولاً.',
      /* The one thing an operator must understand about this screen */
      afterAccept:
        'بعد القبول: ارفع عقد الشراكة من صفحة الشريك، وتبقى حالة الحساب «بانتظار التحقق» حتى تتحقق من المستندات. لا يمكن للشريك إضافة الأسعار أو التواريخ أو الصور قبل التحقق.',
    },
    /**
     * الملفات المصدَّرة — where a requested CSV is collected.
     *
     * A screen rather than a download because the file is built by a worker (BullMQ phase 5): the
     * operator asks, and comes back. Every word here exists to answer "where is my file" without
     * anybody having to ask support.
     */
    exports: {
      title: 'الملفات المصدَّرة',
      note: 'يُجهَّز الملف في الخلفية، وتتحدّث حالته تلقائياً. نزّله من هنا عندما يصبح جاهزاً.',
      expiry: 'تُحذف الملفات بعد سبعة أيام. اطلب تصديراً جديداً بعدها.',
      requested: 'طُلب',
      rows: 'الصفوف',
      expires: 'ينتهي',
      by: 'الطالب',
      download: 'تنزيل',
      filtersNone: 'كل الحجوزات',
      failed: 'تعذّر إنشاء الملف.',
      requestFailed: 'تعذّر إرسال الطلب. حاول مرة أخرى.',
      /**
       * The DOWNLOAD failed, which is a different sentence from `failed` above.
       *
       * `failed` is a status on a row: the worker could not build the file. This is the collection
       * refusing — the file expired, or the reader's permission does not carry it. Distinct copy
       * because the actions differ: one is «اطلب تصديراً جديداً», the other is «اسأل من يملك
       * الصلاحية». Before 2026-08-25 the second answered `Export unavailable.` as a bare English
       * body, which the browser rendered as a document.
       */
      downloadUnavailable:
        'تعذّر تنزيل الملف. قد تكون صلاحيته انتهت أو لا تملك صلاحية تنزيله.',
      back: 'رجوع إلى الحجوزات',
    },
    bookings: {
      searchPlaceholder: 'بحث برقم الحجز، العقار، العميل…',
      allStatuses: 'كل الحالات',
      /*
        The dashboard's EC-008 alert, as a filter on this table. A CHECKBOX rather than a hidden
        field: arriving from the alert has to be leavable, and a filter with no off switch is a
        table an operator concludes is broken.
      */
      expiringOnly: 'تنتهي مهلتها قريباً',
      count: '{n} حجز · كل حجز له خط زمني وسجل تدقيق ورقم مرجعي (P-004)',
      /**
       * Shown instead of `count` when the per-status counts hit `COUNT_CAP`.
       *
       * The figure is a sum of capped counts, so it is a floor and not a total. Printing it as an
       * exact number would be the thing `foundCapped` exists to prevent, one line higher up the
       * same screen — and next to a pagination bar already saying «أكثر من ١٠٠٠٠ نتيجة» it would
       * read as two answers to one question.
       */
      countAtLeast: 'أكثر من {n} حجز · كل حجز له خط زمني وسجل تدقيق ورقم مرجعي (P-004)',
      note: 'فتح أي حجز يعرض: بيانات العميل والشريك والعقار والدفع والرسائل والواتساب والبريد والخط الزمني، مع ملاحظات داخلية لا يراها العميل أو الشريك. تغيير الحالة بصلاحيات محددة فقط ويسجَّل في سجل التدقيق.',
    },

    /*
      ── أدوار الموظفين (Bashar, 2026-08-23) ──────────────────────────────────────────────────
      المدير العام يسمّي أدوار موظفي سفرة ويحدّد ما يحمله كل دور — والصفحة اسمها «أدوار الموظفين»،
      دون «سفرة»، لأن كل من في مركز القيادة موظف سفرة. أدوار موظفي الشركاء شاشة أخرى على لوحة
      الشريك، لأن كل جهة تعرّف أدوار موظفيها هي.

      أسماء القدرات هنا لا في الكود: من يسمّي دوراً «مشرف حجوزات» يحتاج أن يقرأ ما يمنحه بالكلمات،
      لا أن يقرأ `booking.read_all`. مصفوفة الصلاحيات على /staff تعرض المعرّف الخام عن قصد، لأن
      قارئها يوازن الأدوار ببعضها؛ قارئ هذه الشاشة يبني دوراً واحداً لوظيفة.
    */
    staffRoles: {
      /*
        The PANEL's heading, and deliberately not the same words as the page's.

        `ConsoleShell` already prints «أدوار موظفي الشركاء» as the h1 from `nav.employeeRoles`, so
        repeating it on the h2 directly beneath said the same thing twice — the same stutter as the
        contract step's state line. Every other section does this properly: الشركاء / سجل الشركاء.
      */
      title: 'الأدوار المُعرَّفة',
      subtitle: 'يسمّيها المدير العام ويحدّد ما يحمله كل دور',
      intro:
        'الدور يحدّد ما يستطيع موظف سفرة فعله في مركز القيادة. أنشئ دوراً، سمِّه، وحدِّد قدراته — ثم أسنِده إلى موظف من صفحة «الموظفون».',
      /*
        Said on the screen, not left to be discovered. The list of capabilities comes from the API,
        and it is deliberately narrower than what a partner itself can do — a role can never carry
        payouts or settings. An operator who does not know that reads the short list as a bug.
      */
      scopeNote:
        'صلاحية إدارة الأدوار نفسها ليست ضمن القدرات المعروضة، ولا يمكن لأي دور أن يحملها: دورٌ يمنح نفسه لكان الحدُّ بلا معنى. الخادم يرفض أي قدرة خارج هذه القائمة.',

      colName: 'الدور',
      colCapabilities: 'القدرات',
      colEmployees: 'موظفون',
      /* A seeded role — «مدير عام» and the other three. Neither editable nor removable. */
      systemRole: 'دور أساسي',
      systemRoleNote:
        'دور أساسي في المنصة: لا يُعدَّل ولا يُحذف. يمكن إسناده إلى موظف كالمعتاد.',
      colCreated: 'أُنشئ',
      none: 'لم يُعرَّف أي دور بعد.',
      empty: 'لا أدوار مطابقة.',

      create: 'دور جديد',
      creating: 'جارٍ الإنشاء…',
      edit: 'تعديل',
      save: 'حفظ',
      saving: 'جارٍ الحفظ…',
      cancel: 'إلغاء',
      remove: 'حذف الدور',
      /*
        The confirm step says something DIFFERENT from the button that opened it.

        Both read «حذف الدور» at first, so after pressing it the operator saw the same label again
        beside a warning and could reasonably think the first press had not registered. Every other
        two-step control in this console names the second step separately — «تأكيد الموافقة»,
        «تأكيد الرفض» — and it is also what lets a test tell the two apart.
      */
      confirmRemove2: 'تأكيد الحذف',
      removing: 'جارٍ الحذف…',

      nameLabel: 'اسم الدور',
      nameHint: 'ما يراه الشريك في قائمة الأدوار. حرفان على الأقل، ولا يتكرّر.',
      capabilitiesLabel: 'ما يحمله هذا الدور',
      /* A role with no capability is a role that does nothing; the API refuses it too. */
      capabilitiesRequired: 'اختر قدرة واحدة على الأقل.',

      /*
        Said BEFORE the delete is attempted, because the API refuses it and the operator should not
        learn that from a refusal. `employeeCount` is on every row for exactly this.
      */
      inUse: 'لا يمكن حذف دور يحمله موظفون. انقل الموظفين إلى دور آخر أولاً.',
      /* The five domains the 63 capabilities are split across — see `permission-groups.ts`. */
      group: {
        bookings: 'الحجوزات والتقويم',
        money: 'المال والفواتير',
        partners: 'الشركاء والعقارات',
        customers: 'العملاء والدعم',
        platform: 'المنصة والإعدادات',
        other: 'أخرى',
      } as Record<string, string>,
      confirmRemove:
        'يُحذف الدور «{name}» نهائياً من قائمة الأدوار المتاحة للشركاء. تأكيد؟',
      failed: 'تعذّر تنفيذ الطلب. حاول مرة أخرى.',
      unreachable: 'تعذّر الوصول إلى الخادم.',

      /*
        The capabilities, in words. The keys are the permission strings the API validates against,
        so this map is keyed by machine value and read through `label()` — an unlabelled capability
        renders as its raw identifier, which is how a newly added one announces itself instead of
        appearing as a blank checkbox.
      */
      capability: {
        /*
          Sixty-three capabilities, named. The screen exists so somebody naming «مشرف
          حجوزات» can read what the role will carry; `booking.update_status` is not a
          sentence anybody weighs a job against.

          Read through `label()`, so a capability added to the allow-list before it is
          translated renders as its raw identifier — visibly missing rather than a blank
          checkbox. `/staff`'s matrix still shows raw identifiers on purpose: its reader is
          comparing roles, not building one.
        */
        'booking.read_own': 'قراءة حجوزاته',
        'booking.read_all': 'قراءة كل الحجوزات',
        'booking.create': 'إنشاء حجز',
        'booking.update_status': 'تغيير حالة الحجز',
        'booking.cancel': 'إلغاء حجز',
        'booking.add_internal_note': 'إضافة ملاحظة داخلية',
        'booking.respond_as_partner': 'الرد على الحجز نيابة عن الشريك',
        'booking.check_in': 'تسجيل وصول الضيف',
        'calendar.manage_own': 'إدارة التقويم والتوفّر',
        'payment.read': 'قراءة المدفوعات',
        'refund.read': 'قراءة المستردات',
        'refund.create': 'إصدار استرداد',
        'ledger.read': 'قراءة دفتر الحسابات',
        'payout.read': 'قراءة مستحقات الشركاء',
        'payout.read_own': 'قراءة مستحقاته',
        'payout.execute': 'تنفيذ التحويلات',
        'payout_account.read': 'قراءة البيانات المصرفية',
        'wallet.read': 'قراءة المحافظ',
        'wallet.adjust': 'تعديل رصيد محفظة',
        'gift_card.read': 'قراءة بطاقات الهدايا',
        'gift_card.manage': 'إدارة بطاقات الهدايا',
        'coupon.read': 'قراءة الكوبونات',
        'coupon.manage': 'إدارة الكوبونات',
        'price.update': 'تعديل الأسعار',
        'fx_rate.manage': 'إدارة أسعار الصرف',
        'partner.read': 'قراءة بيانات الشركاء',
        'partner.approve': 'الموافقة على الشركاء',
        'partner.suspend': 'إيقاف شريك',
        'partner.document_review': 'مراجعة مستندات الشركاء',
        'partner_application.read': 'قراءة طلبات الشراكة',
        'partner_application.manage': 'البتّ في طلبات الشراكة',
        'partner.onboard': 'تسجيل شريك مباشرةً',
        'partner_employee.manage': 'إدارة موظفي الشريك',
        'partner_contract.sign_own': 'توقيع عقده',
        'partner_document.manage_own': 'إدارة مستنداته',
        'partner_contract.read': 'قراءة عقود الشراكة',
        'partner_contract.manage': 'إدارة عقود الشراكة',
        'partner.two_factor_reset': 'إعادة تعيين المصادقة الثنائية لشريك',
        'property.read': 'قراءة العقارات',
        'property.manage_own': 'إدارة عقاراته',
        'property.approve': 'الموافقة على العقارات',
        'violation.read': 'قراءة المخالفات',
        'violation.manage': 'إدارة المخالفات',
        'violation.waive': 'إسقاط غرامة',
        'review.create': 'كتابة تقييم',
        'review.read_own': 'قراءة تقييماته',
        'review.respond_own': 'الرد على تقييماته',
        'review.moderate': 'إخفاء التقييمات المُبلَّغ عنها',
        'customer.read': 'قراءة بيانات العملاء',
        'message.read': 'قراءة الرسائل',
        'message.send': 'إرسال الرسائل',
        'dispute.read': 'قراءة النزاعات',
        'dispute.manage': 'إدارة النزاعات',
        'notification.read': 'قراءة سجل الإشعارات',
        'settings.read': 'قراءة الإعدادات',
        'settings.update': 'تعديل الإعدادات',
        'geo.manage': 'إدارة المدن والدول والعملات',
        'ad.read': 'قراءة الإعلانات',
        'ad.manage': 'إدارة الإعلانات',
        'report.read': 'قراءة التقارير',
        'audit_log.read': 'قراءة سجل التدقيق',
        'emergency_mode.activate': 'تفعيل وضع الطوارئ',
        'staff.manage': 'إدارة الموظفين',
      } as Record<string, string>,
    },

    partners: {
      title: 'سجل الشركاء',
      suspended: 'موقوف مؤقتاً',
      searchPlaceholder: 'بحث عن شريك…',
      /**
       * A document or a contract PDF the reader clicked and could not have.
       *
       * ONE sentence for every reason — expired, missing, or a permission this reader does not
       * hold — deliberately. `/api/documents/[id]/file` answers the same way whether a document
       * exists or not, so that an id cannot be probed for existence; copy that distinguished the
       * cases would hand back exactly what the flat answer withholds.
       *
       * It reads on سجل الشركاء rather than on the record the link was on, because the file routes
       * redirect to the registry — see the routes for why they cannot name the record. The same
       * trade `TABLE_SECTION_PATHS` already accepts for `partnerViolations`.
       */
      fileUnavailable:
        'تعذّر فتح الملف المطلوب. قد يكون غير متاح أو لا تملك صلاحية الوصول إليه.',
      colPartner: 'الشريك',
      colScore: 'Score',
      colTier: 'التصنيف',
      note: 'Score يبدأ من 100: الرد السريع والتقييم المرتفع يرفعانه؛ التأخر والإلغاء وعدم تحديث التوفر يخفضونه — ويؤثر على ترتيب «موصى به من سفرة». لا حذف نهائي لأي شريك (P-003): Suspend / Deactivate فقط.',
      contracts: 'عقود الشراكة',
      pendingTitle: 'بانتظار الموافقة — التحقق قبل النشر (P-002)',
      /* The entry point to تسجيل شريك جديد, on the registry card (Bashar, 2026-08-23). */
      onboard: 'تسجيل شريك جديد',
    },

    /*
      ── تسجيل شريك جديد ─────────────────────────────────────────────────────────────────────
      المدير العام والشريك في الغرفة نفسها (Bashar, 2026-08-23). النصوص تخاطب المدير العام وهو
      جالس مع الشريك، فتقول ما سيحدث للطرف الآخر بصيغة يستطيع أن يقرأها بصوت عالٍ: «سيصل الشريك
      رابط…» لا «تم إنشاء الحساب».
    */
    /* §8.1's «الموقع على الخريطة» — collected on the onboarding screen, shown on the record. */
    partnerLocation: {
      title: 'الموقع على الخريطة',
      intro: 'أدخل إحداثيات موقع النشاط. تظهر على سجل الشريك ويستخدمها فريق التحقق.',
      latitude: 'خط العرض',
      longitude: 'خط الطول',
      save: 'حفظ الموقع',
      saving: 'جارٍ الحفظ…',
      saved: 'حُفظ الموقع.',
    },
    partnerOnboarding: {
      title: 'تسجيل شريك جديد',
      subtitle:
        'للشريك الحاضر شخصياً — البيانات والمستندات والعقد والموافقة في جلسة واحدة',
      intro:
        'استخدم هذه الشاشة عندما يكون الشريك معك. تُنشئ السجل والحساب، ثم تُكمل المستندات والعقد والموافقة من الشاشة التالية دون انتظار أي بريد.',
      /*
        Said on the form, before anything is written, because it is the sentence the super admin
        has to be able to say out loud to the person opposite them — and because an operator who
        expects to type a password needs to learn otherwise here rather than at the end.
      */
      passwordNote:
        'لن تُنشئ كلمة مرور للشريك ولن تراها. يصل الشريك رابط دعوة إلى بريده يضبط منه كلمة مروره بنفسه، وصلاحية الرابط 72 ساعة. يمكن إكمال بقية الخطوات الآن دون انتظاره.',

      /* ── The form ── */
      businessSection: 'بيانات النشاط',
      contactSection: 'بيانات التواصل',
      contactName: 'اسم الشخص المسؤول',
      contactNameHint: 'الشخص الجالس معك. الكيان القانوني لا يجيب على الهاتف.',
      email: 'البريد الإلكتروني للشريك',
      emailHint:
        'إليه تُرسل الدعوة، ومنه يدخل الشريك بعد ذلك. تحقّق من الحرف الأخير قبل الحفظ.',
      phone: 'رقم الهاتف',
      legalName: 'الاسم القانوني',
      legalNameHint: 'كما هو في السجل التجاري.',
      displayName: 'الاسم المعروض',
      displayNameHint: 'ما يراه العملاء. قد يختلف عن الاسم القانوني.',
      partnerType: 'نوع النشاط',
      city: 'المدينة',
      address: 'العنوان',
      website: 'الموقع الإلكتروني (اختياري)',
      locale: 'لغة المخاطبة',
      localeHint: 'بها تُكتب الدعوة وكل رسالة بعدها.',
      notes: 'سبب التسجيل المباشر',
      notesHint:
        'مطلوب، ويُسجَّل في سجل التدقيق. هذا المسار يتجاوز طابور «طلبات الشراكة»، فهذه الملاحظة هي كل ما يشرح لاحقاً من كان في الغرفة ولماذا.',
      submit: 'إنشاء السجل ومتابعة التسجيل',
      submitting: 'جارٍ الإنشاء…',
      cancel: 'إلغاء',

      /* ── Errors ── */
      failed: 'تعذّر إنشاء السجل. حاول مرة أخرى.',
      unreachable: 'تعذّر الوصول إلى الخادم.',
      fixFields: 'راجع الحقول المُعلَّمة بالأحمر.',

      /* ── The stepped screen ── */
      stepsTitle: 'خطوات التسجيل',
      /*
        Said once, at the top: the reader needs to know the record already exists before they read
        a list of things that are still outstanding, or the screen reads as a failure.
      */
      created: 'أُنشئ السجل {reference}. أُرسلت الدعوة إلى {email}.',
      createdExistingAccount:
        'أُنشئ السجل {reference}. لهذا البريد حساب على سفرة بالفعل، والرابط المُرسل إلى {email} يرقّيه إلى حساب شريك.',
      mailMayLag: 'إن لم يصل الرابط، يمكن إعادة إرساله من صفحة الشريك.',
      stepDone: 'تم',
      stepOutstanding: 'مطلوب',
      stepOptional: 'اختياري',
      openPartner: 'فتح صفحة الشريك',
      /*
        The accessible name, which says what the visible label cannot (Bashar, 2026-08-23).

        The link opens a NEW TAB, and a control that moves somebody somewhere they did not expect
        is worse for a screen-reader user than for a sighted one: the sighted reader sees the tab
        strip change, and the screen-reader user is simply somewhere else with no announcement.
        WCAG 3.2.5 — say it in the name rather than leave it to be discovered.
      */
      openPartnerAria: 'فتح صفحة الشريك في تبويب جديد',

      /*
        ── حساب الشريك ────────────────────────────────────────────────────────────────────────
        الخطوة التي كانت ناقصة (Bashar, 2026-08-23). أُنشئ شريك واعتُمد، ثم لم يستطع الدخول: الدعوة
        لم تُستخدم بعد، والدور ما زال «عميل». الشاشة كانت تقول «تم» في كل خطوة، فبدا أن العمل انتهى.

        الحساب ليس خطوة يؤدّيها الموظف، بل حالة ينتظرها — لذلك يظهر كسطر تحت الخطوة الأولى لا كخطوة
        سادسة: لا شيء في الغرفة يُنهيها، والشريك وحده يملك البريد.
      */
      accountActivated: 'قبل الشريك الدعوة ويستطيع الدخول.',
      accountPending:
        'لم يقبل الشريك الدعوة بعد، ولا يستطيع الدخول حتى يفتح الرابط المُرسل إلى {email} ويضبط كلمة مروره. بقية الخطوات لا تنتظره.',
      accountPendingNoLink:
        'لم يقبل الشريك الدعوة، ولم يعد الرابط المُرسل إلى {email} صالحاً. أعد إرساله ليتمكّن من الدخول.',
      resendInvitation: 'إعادة إرسال الدعوة',
      resending: 'جارٍ الإرسال…',
      resent: 'أُرسلت الدعوة من جديد إلى {email}. صلاحيتها 72 ساعة.',
      resendFailed: 'تعذّرت إعادة إرسال الدعوة.',

      step1: 'بيانات الشريك',
      step2: 'المستندات',
      step3: 'العقد',
      step4: 'فحص العقوبات',
      step5: 'الموافقة',

      /* ── Documents ── */
      documentsIntro:
        'ارفع مستندات الشريك من الأصل الذي بين يديك. المستندات تُفحص كما لو رفعها الشريك بنفسه، ويُسجَّل في سجل التدقيق أنك من رفعها.',
      documentsRequired: 'المطلوب قبل الموافقة: {kinds}',
      documentsComplete: 'وصلت كل المستندات المطلوبة.',
      documentKind: 'نوع المستند',
      documentFile: 'الملف',
      documentFileHint: 'صورة أو PDF، حتى 8 ميغابايت.',
      upload: 'رفع المستند',
      uploading: 'جارٍ الرفع…',
      uploaded: 'رُفع {kind}.',
      uploadFailed: 'تعذّر رفع المستند.',
      uploadTooLarge: 'الملف أكبر من الحد المسموح (8 ميغابايت). اختر ملفاً أصغر.',
      noDocumentsYet: 'لم يُرفع أي مستند بعد.',
      /* The pseudo-kind `missingOnboardingDocuments` returns when neither alternative is present. */
      rightToLet: 'إثبات الملكية أو عقد الإدارة',

      /* ── The contract and the approval, both of which live on the partner page ── */
      /*
        The ORDER, and only the order.

        The «رفع نسخة جديدة يُلغي توقيع الشريك» warning deliberately is NOT here. It lives on
        `partnerContract.replaceWarning`, which the contract panel shows only when there is a
        signature to invalidate — and the panel renders directly beneath this line. Stating it
        unconditionally here would put a permanent warning next to a conditional one on the same
        screen, and two warnings that disagree about whether something is a risk teach an operator
        to read neither.
      */
      contractIntro:
        'أنشئ العقد واطبعه. إن كان الشريك معك فوقّعا نسخة واحدة وارفعها بزر «ارفع النسخة الموقّعة من سفرة والشريك» — يصبح العقد سارياً فوراً. وإن لم يكن حاضراً فارفع نسخة سفرة الموقّعة أولاً، ثم ينتظر العقد نسخته الموقّعة.',
      contractStateNone: 'لم يُنشأ عقد بعد.',
      contractStateDraft: 'أُنشئ العقد وينتظر توقيع سفرة.',
      contractStateAwaitingPartner: 'وُقّع من سفرة وينتظر توقيع الشريك.',
      /*
        A STEP summary, not the contract's own state line.

        It read «وقّع الطرفان والعقد ساري المفعول.» — word for word what the contract panel prints
        directly beneath it, so the screen said the same sentence twice in a row. The checklist's
        job is to say whether the step is finished; the panel's is to say what the contract's state
        is. Where the two are identical the reader assumes a rendering fault.
      */
      contractStateActive: 'اكتملت خطوة العقد.',
      approvalIntro:
        'الموافقة هي الخطوة الأخيرة، وهي وحدها ما يتيح نشر عقارات هذا الشريك (P-002). تُنفَّذ من صفحة الشريك بصلاحية الموافقة على الشركاء.',
      approvalDone: 'تمت الموافقة على الشريك.',
      approvalPending: 'لم تصدر الموافقة بعد.',
      screeningDone: 'سُجِّل فحص العقوبات.',
      screeningPending: 'لم يُسجَّل فحص العقوبات بعد.',
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
      /*
        When accrual last ran, stated on the screen an operator opens to answer a partner's
        question. A job that stopped firing is invisible otherwise — the failure that matters is
        silence, not an error.
      */
      lastAccrual: 'آخر تجميع تلقائي: {when} — ضُمّ {n} حجزاً',
      lastAccrualFailed:
        'آخر تجميع تلقائي فشل ({when}). راجع docs/runbook-scheduled-jobs.md',
      lastAccrualNever: 'لم يُسجَّل تجميع تلقائي بعد.',
      note: 'الحساب التلقائي يضم الحجوزات المكتملة والمدفوعة فقط، ويستثني أي حجز عليه نزاع مفتوح أو قيد الفحص — تجميد المستحقات قاعدة مشتقة من النزاعات وليست علامة على الحجز.',

      /* One payout's page. */
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
      activeCities:
        '{n, plural, zero {لا مدن نشطة} one {مدينة نشطة واحدة} two {مدينتان نشطتان} few {# مدن نشطة} many {# مدينة نشطة} other {# مدينة نشطة}}',
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

    /*
      What a page renders INSTEAD of itself when the reader's role does not open it
      (Bashar, 2026-08-24: "fix it").

      The console showed every reader all twenty-three sections and let the API refuse the ones they
      could not read — and `staffFetch` reports a 403 as `'unauthenticated'`, so the screen said
      «انتهت الجلسة» and sent somebody to sign in again over a permission. Signing in again lands
      them in exactly the same place, so every link was a loop.
    */
    gate: {
      /*
        A section a named role COULD carry and theirs does not.

        The sentence names the person who can change it, because they are one conversation away.
        Telling somebody a thing is impossible when it is merely not granted sends them away from
        the only conversation that would fix it.
      */
      role: 'دورك الحالي لا يشمل هذا القسم. اطلب من المدير العام تعديله إن كنت بحاجة إليه.',
      /*
        A section NO named role may carry — today only «أدوار الموظفين», because a role that can
        define roles can grant itself everything, so `STAFF_ASSIGNABLE_PERMISSIONS` withholds it.

        A different sentence because the answer is different: asking would not help, so this one
        closes the subject rather than pointing at somebody who cannot act either.
      */
      closed: 'هذا القسم لا يفتحه أي دور مُسمّى — يخص المدير العام وحده.',
      /*
        A role that opens NOTHING. `sections.test.ts` pins that this is reachable, so somebody will
        reach it.

        Not a blank page and not a redirect to a dashboard they cannot read: an empty console is
        indistinguishable from a broken one, and the person who needs to know is the super admin who
        built the role.
      */
      noSectionsTitle: 'دورك لا يفتح أي قسم بعد',
      noSectionsBody:
        'القدرات الممنوحة لدورك لا تفتح أي شاشة في مركز القيادة حتى الآن. اطلب من المدير العام تعديل الدور.',
    },

    /*
      الإيقاف والمخالفات — enforcement against a partner (Bashar, 2026-08-24).

      His rules, and every one of them shapes a word below:

      - Suspension stops NEW trade. Confirmed bookings continue and existing guests are not
        disrupted, so the copy says what is blocked rather than «موقوف» alone — an operator reading
        this record is usually deciding whether to lift it, and «the business is stopped» would be
        false.
      - The partner may still sign in and read this. So the REASON is written for them, not about
        them, and the staff-only notes are a separate field that never leaves the console.
      - A violation progresses: مخالفة ← إنذار ← غرامة ← إيقاف. A fine is a STAGE a violation
        reaches, not a separate object.
      - Never delete history. A waived fine keeps both entries and nets to zero; «—» is forbidden.
      - A violation must NOT affect ranking, so nothing here mentions التقييم.
    */
    enforcement: {
      /* ── The suspension banner on the partner record ─────────────────────── */
      suspendedTitle: 'هذا الشريك موقوف',
      /*
        What suspension DOES, in the four clauses Bashar specified, on the screen where somebody
        decides whether to lift it. Without this the reader has to remember the policy.
      */
      suspendedEffect:
        'إعلاناته مخفية من البحث ولا تُقبل حجوزات جديدة، ومستحقاته مجمّدة. الحجوزات المؤكدة تستمر كالمعتاد ولا يُمسّ نزلاؤه الحاليون. يستطيع الدخول إلى حسابه وقراءة سبب الإيقاف.',
      suspendedSince: 'منذ {when}',
      suspendedBy: 'بقرار من {who}',
      suspendedReason: 'السبب',
      /* Staff-only. The API omits it from the partner's own payload — see the component. */
      suspendedNotes: 'ملاحظات داخلية',
      suspendedNotesHint: 'لا تظهر للشريك',

      /* ── Suspending and lifting ──────────────────────────────────────────── */
      suspend: 'إيقاف الشريك',
      unsuspend: 'رفع الإيقاف',
      suspendReasonLabel: 'سبب الإيقاف (يقرأه الشريك)',
      unsuspendReasonLabel: 'سبب رفع الإيقاف',
      notesLabel: 'ملاحظات داخلية (اختياري)',
      /*
        The API refuses under twenty characters, so the form says so before the refusal.

        Not a quality bar: a bar against «مخالفة» arriving at a real business owner as the entire
        explanation for why they cannot trade.
      */
      reasonHint: 'عشرون حرفًا على الأقل — يقرأه الشريك.',
      suspending: 'جارٍ الإيقاف…',
      unsuspending: 'جارٍ رفع الإيقاف…',
      suspended: 'أُوقف الشريك وأُبلغ بالسبب.',
      unsuspended: 'رُفع الإيقاف وأُبلغ الشريك.',

      /* ── Violations ──────────────────────────────────────────────────────── */
      violations: 'المخالفات',
      violationsOf: 'مخالفات {partner}',
      openViolations: 'عرض المخالفات',
      /*
        Paged on its own screen, not embedded in the record.

        A partner with forty violations after two years is ordinary, and an unpaged list on a record
        is the failure «Tables and pagination» exists to prevent.
      */
      noViolations: 'لا مخالفات مسجّلة على هذا الشريك.',
      colKind: 'النوع',
      colStage: 'المرحلة',
      colOccurrence: 'التكرار',
      colBooking: 'الحجز',
      colFine: 'الغرامة',
      colRaised: 'سُجّلت',
      occurrenceNumber: 'التكرار رقم {n}',

      raise: 'تسجيل مخالفة',
      raising: 'جارٍ التسجيل…',
      raised: 'سُجّلت المخالفة.',
      kindLabel: 'نوع المخالفة',
      /*
        The select's own placeholder, not `staff.pickRole`.

        It borrowed the staff invitation's «اختر الدور…», so the field that decides what a real
        business is recorded as having done asked the reader to pick a ROLE. The select has no
        default on purpose — see the component — which is exactly what makes its placeholder the
        only word there while the choice is being made.
      */
      pickViolationKind: 'اختر نوع المخالفة…',
      violationReasonLabel: 'الوصف (يقرأه الشريك)',
      bookingLabel: 'مرجع الحجز (اختياري)',

      warn: 'إصدار إنذار',
      warning: 'جارٍ الإصدار…',
      warned: 'صدر الإنذار وأُبلغ الشريك.',
      warnNoteLabel: 'نص الإنذار',

      fine: 'فرض غرامة',
      fining: 'جارٍ الفرض…',
      fined: 'فُرضت الغرامة وأُبلغ الشريك.',
      /* Shown inside the money box on the violations screen, above the figure it explains. */
      fineReasonLabel: 'سبب الغرامة',
      fineAmountLabel: 'المبلغ',
      /*
        LATIN digits, and that is not an oversight on an Arabic screen.

        The field's own pattern is `\d{1,10}(\.\d{1,2})?`, which matches Latin digits only — a
        placeholder written «٥٠٫٠٠» would show the operator a value the input then refuses, and the
        refusal is the browser's own so no error would appear to explain it. A placeholder has to be
        something you could actually type into the field it sits in.
      */
      fineAmountPlaceholder: '50.00',
      fineCurrencyLabel: 'العملة',
      compensationLabel: 'تعويض العميل (اختياري)',

      /* ── The fourth rung: suspending BECAUSE of this violation ───────────── */
      /*
        Deliberately not «إيقاف الشريك», which is the control on the partner record.

        Two controls that read identically and do different things is how somebody suspends a
        partner while believing they are filing a violation. This one names the violation it is
        acting on, and the hint states the consequence in the same words the record's banner uses,
        because this is the screen where somebody has a violation in front of them and no banner.
      */
      escalate: 'تعليق الحساب على هذه المخالفة',
      escalating: 'جارٍ التعليق…',
      escalated: 'عُلّق الحساب وسُجّلت المخالفة كسببه.',
      escalateHint:
        'يوقف التداول الجديد ويجمّد المستحقات، وتستمر الحجوزات المؤكدة. تُسجَّل هذه المخالفة كسبب الإيقاف.',
      escalateReasonLabel: 'سبب الإيقاف (يقرأه الشريك)',

      /* ── Waiving, and the rule that shapes the whole display ─────────────── */
      waive: 'إلغاء الغرامة',
      waiving: 'جارٍ الإلغاء…',
      waived: 'أُلغيت الغرامة وأُبلغ الشريك.',
      waiveReasonLabel: 'سبب الإلغاء (يقرأه الشريك)',
      /*
        BOTH entries, netting to zero — never «—» and never the net alone.

        Bashar: never delete or rewrite history. A screen showing only the net has deleted the
        record one layer above the ledger, which is the same act the ledger refuses to perform.
      */
      waivedMark: 'أُلغيت',
      waivedOn: 'أُلغيت في {when}',
      waivedBy: 'بقرار من {who}',
      waivedNet: 'الصافي',
      fineOriginal: 'الغرامة الأصلية',
      fineWaiver: 'قيد الإلغاء',
      collectedOn: 'حُصّلت في {when}',
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
      /*
        آخر نشاط, searchable and paged (Bashar, 2026-08-24).

        He offered "lazy loading or pagination" and it is paged, because his own standing rule is
        that every console list carries a page NUMBER the reader picks and a rows-per-page they
        pick. An infinite list has neither. The max height he asked for is a separate thing and
        compatible: the panel scrolls INSIDE its own box, which the responsive rule requires anyway.
      */
      activitySearch: 'بحث بالاسم أو البريد…',
      activitySearchLabel: 'بحث في نشاط الموظفين',
      activitySearchGo: 'بحث',
      activityClear: 'مسح البحث',
      /*
        The empty state says the SEARCH found nothing, not that nothing happened.

        A term matching nobody is the failure that matters in a search box, and it is silent: the
        reader types a colleague's name, and a screen that answered with «لا نشاط بعد» would have
        them believe that person has done nothing.
      */
      activityNoMatch: 'لا نشاط مطابق لهذا البحث.',
      activityOpen: 'عرض تفاصيل هذا النشاط',
      /* The single-activity screen — Bashar's optional half, and it is generic by design. */
      activityEntry: 'تفاصيل النشاط',
      activityNotFound: 'لا يوجد نشاط بهذا المعرّف.',
      activityWhat: 'ما الذي حدث',
      activityWho: 'من نفّذه',
      activityWhen: 'متى',
      activitySubject: 'الكيان',
      activityReason: 'السبب',
      activityIp: 'عنوان IP',
      activityChanges: 'ما تغيّر',
      activityNoChanges: 'لا تفاصيل مسجّلة لهذا النشاط.',
      note: 'لا يُحذف حساب موظف نهائياً — يُعطّل فقط مع الاحتفاظ بأثره في سجل التدقيق. كل تغيير صلاحية يُوثّق باسم من نفّذه.',

      /** The invite form (§8.2). */
      invite: 'دعوة موظف جديد',
      inviteHint:
        'تُرسل دعوة برابط لمرة واحدة يضبط بها كلمة مروره — لا تراها أنت، ولا يعمل الحساب قبل قبول الدعوة وتمكين المصادقة الثنائية.',
      inviteEmail: 'البريد المهني',
      /*
        Required, because the API requires it (Bashar, 2026-08-23).

        A form that lets somebody submit an invitation the server will reject teaches them that the
        screen is unreliable. The field is asked for here because it is asked for there.
      */
      inviteName: 'الاسم الكامل',
      inviteNamePlaceholder: 'محمد الأحمد',
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
      /*
        An account seeded before named roles existed. It still works — its permissions resolve
        through the enum — but it holds no role ROW, and the select must say so rather than
        appear to have «مدير العمليات» selected when nothing is.
      */
      noNamedRole: '— بلا دور مُسمّى',
      /*
        The invite select has no safe default, so it starts empty and required.

        It defaulted to «وكيل الدعم» while invites carried an enum. With named roles a wrong
        default is worse than none: the operator invites somebody into whatever happened to be
        first, and the account holds that role's capabilities until anybody notices.
      */
      pickRole: 'اختر الدور…',
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

      /*
        تحديد النطاق — the editor (2026-08-24).

        نطاق العمل used to be a paged table of everybody's scopes on الموظفون, and it carried the
        editor with it. Removing the table was right — a scope is a property of a person — but the
        editor went too and nothing replaced it, so the record stated that scope is enforced and
        offered no way to change it. A screen that states a guarantee it cannot act on is the same
        defect as a capability with nothing behind it.
      */
      scopeEdit: 'تحديد النطاق',
      scopeKindLabel: 'المدى',
      scopeKindAll: 'كل المدن',
      scopeKindCities: 'مدن محددة',
      scopeCitiesLabel: 'المدن',
      scopeOutsideLabel: 'خارج النطاق',
      /*
        Optional, and it lands in the audit log beside the change.

        Narrowing a scope signs somebody out mid-shift. Six months later "why can this person no
        longer see Aleppo" is answerable from the trail or it is not answerable at all.
      */
      scopeReason: 'السبب (اختياري)',
      scopeSave: 'حفظ النطاق',
      scopeSaving: 'جارٍ الحفظ…',
      scopeSaved: 'حُدّث نطاق العمل.',
      scopeCitiesFailed: 'تعذّر تحميل قائمة المدن، فلا يمكن تحديد مدن الآن.',

      /*
        صفحة الموظف — the member's own record (Bashar, 2026-08-23).

        الموظفون carried six things on one screen and Bashar said it was too much. What moved here is
        everything that describes ONE person: their role and what it can do, where they may work, and
        the controls that used to crowd every row of the list. The list keeps the counters, the invite
        and the table, because that is the question «من يعمل هنا» and nothing else.
      */
      member: {
        open: 'فتح سجل {email}',
        heading: 'الموظف',
        notFound: 'لا يوجد موظف بهذا المعرّف.',
        account: 'الحساب',
        colName: 'الاسم',
        /*
          For an account nobody has named yet — 165 of them exist. It reads as a STATE, not as a
          person's name, so nobody mistakes it for one and nobody is left wondering whether the
          field failed to load.
        */
        unnamed: '— بلا اسم',
        rename: 'تغيير الاسم',
        renameSave: 'حفظ الاسم',
        renameSaving: 'جارٍ الحفظ…',
        renamed: 'أصبح الاسم {name}.',
        colEmail: 'البريد',
        colRole: 'الدور',
        colStatus: 'الحالة',
        colAdded: 'أُضيف',
        colLastSignIn: 'آخر دخول',
        /*
          Shown as its own field rather than only as the list's warning pill.

          An account with a password and no authenticator is a live hole in the console's own
          defence — الموظفون raises it to a KPI card when there is one. On the record it is a fact
          about the person, so it reads «مفعّلة» / «غير مفعّلة» rather than «بلا مصادقة ثنائية»,
          which is a warning phrased for a pill and answers a different question under a label.
        */
        colTwoFactor: 'المصادقة الثنائية',
        twoFactorOn: 'مفعّلة',
        twoFactorOff: 'غير مفعّلة',
        statusActive: 'نشط',
        /*
          What the role CAN do, resolved by the server.

          Not intersected in the console against a roles list: that would make this screen a second
          answer to «ما الذي يستطيعه هذا الدور», and a second answer is one that can disagree with the
          guard. If the two ever differ, the screen would be the thing telling somebody they are safe.
        */
        capabilities: 'قدرات الدور',
        capabilitiesHint: 'ما يسمح به الدور على الخادم، لا ما تعرضه الواجهة',
        noCapabilities: 'هذا الدور لا يحمل أي قدرة.',
        noNamedRoleNote:
          'حساب أُنشئ قبل الأدوار المُسمّاة: صلاحياته تُحلّ من دوره الأساسي ولا يقابله صف دور. أسنِد له دوراً مُسمّى.',
        invitation: 'الدعوة',
        invitationSentAt: 'أُرسلت {when}',
        invitationExpires: 'تنتهي {when}',
        actions: 'الإجراءات',
        actionsSelf: 'لا يمكنك تغيير دور حسابك أو تعطيله.',
      },
    },

    audit: {
      immutable: 'غير قابل للحذف',
      hint: 'كل عملية إدارية أو مالية أو حساسة تُسجَّل مع IP والجهاز والموظف والوقت',
      searchPlaceholder: 'بحث بالموظف أو العملية أو الكيان…',
      colStaff: 'الموظف',
      colAction: 'العملية',
      colEntity: 'الكيان',
      colIp: 'IP',
      /*
        The `before`/`after` payload, shown as WHAT CHANGED rather than as JSON.

        It used to be `JSON.stringify({ before, after })` on one line inside a narrow scrolling
        box, so the reader met `e":{"status":"contacted"},"after":…` — a machine format, cut off
        mid-key, in the column that is supposed to answer "what exactly changed" (Bashar,
        2026-08-20).
      */
      changeField: 'الحقل',
      changeBefore: 'قبل',
      changeAfter: 'بعد',
      /** No value on that side — a field that was added, or one that was cleared. */
      changeAbsent: '—',
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
      evidence:
        '{n, plural, zero {لا صور مرفوعة} one {صورة واحدة مرفوعة} two {صورتان مرفوعتان} few {# صور مرفوعة} many {# صورة مرفوعة} other {# صورة مرفوعة}}',
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
      confirmClose: 'تأكيد الإغلاق',
    },

    messages: {
      searchPlaceholder: 'بحث في المحادثات…',
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
      attempts:
        '{n, plural, zero {لا محاولات} one {محاولة واحدة} two {محاولتان} few {# محاولات} many {# محاولة} other {# محاولة}}',
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
      /*
        A generated contract nobody has signed or sent yet (Bashar, 2026-08-23).

        `draft` joined the contract enum on 2026-08-21 and this card was never taught it, so a
        draft fell through to «ساري حتى —» — the console stating that an unsigned, unsent document
        was in force. It surfaced only once draft contracts started outliving a test run.
      */
      draft: 'مسودة — لم تُرسل',
      superseded: 'مُستبدَل',
      terminated: 'مُنهى',
      none: 'لا عقود مرفوعة لهذا الشريك.',
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

      /*
        The sanctions policy, named for a reader rather than by its code.

        The descriptions are deliberately blunt about the consequence: this is the one setting on
        the page that decides whether a compliance control runs, and «استرشادي» on its own does not
        tell somebody that approvals will go through unscreened.
      */
      policy: 'السياسة',
      sanctionsPolicy: {
        required: 'مُلزِم — لا اعتماد ولا تحويل بدون فحص',
        advisory: 'استرشادي — يُسجَّل الفحص ولا يمنع شيئاً',
        off: 'معطّل — لا يُعرض الفحص إطلاقاً',
      },
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
    /* EC-010 tier 2 — التحقق من هوية متصل فقد رقم حجزه. */
    bookingVerify: {
      title: 'التحقق من هوية العميل',
      /*
        Says what the screen is FOR and what it refuses to do. An agent reaching here has a caller
        who cannot prove who they are, and the rule that matters is: do not read anything out first.
      */
      intro:
        'للمتصل الذي فقد رقم حجزه. أرسل رمزاً إلى بيانات التواصل المسجَّلة على الحجز واطلب منه قراءته — ولا تذكر أي تفصيل عن الحجز قبل نجاح التحقق.',
      referenceLabel: 'رقم الحجز',
      referenceHint: 'إن لم يكن لدى المتصل رقم الحجز، وجّهه إلى صفحة «نسيت رقم الحجز».',
      send: 'إرسال رمز التحقق',
      sending: 'جارٍ الإرسال…',
      /* A MASKED destination — enough to recognise, not enough to learn. */
      sentTo: 'أُرسل رمز إلى {destination}. ينتهي خلال {minutes} دقائق.',
      codeLabel: 'الرمز كما قرأه المتصل',
      confirm: 'تحقّق',
      confirming: 'جارٍ التحقق…',
      verified: 'تم التحقق. يمكنك الآن فتح الحجز ومناقشته مع المتصل.',
      openBooking: 'فتح الحجز ←',
      /*
        The seal, said plainly. Nothing about the booking is on this screen until the code passes —
        not the property, not the dates, not the customer's name.
      */
      sealed: 'لا تظهر أي بيانات عن الحجز قبل نجاح التحقق.',
    },

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
      stay: '{checkIn} ← {checkOut} · {nights, plural, one {ليلة واحدة} two {ليلتان} few {# ليالٍ} many {# ليلة} other {# ليلة}} · {adults, plural, one {بالغ واحد} two {بالغان} few {# بالغين} many {# بالغًا} other {# بالغ}}',
      stayWithChildren:
        '{checkIn} ← {checkOut} · {nights, plural, one {ليلة واحدة} two {ليلتان} few {# ليالٍ} many {# ليلة} other {# ليلة}} · {adults, plural, one {بالغ واحد} two {بالغان} few {# بالغين} many {# بالغًا} other {# بالغ}}، {children, plural, one {طفل واحد} two {طفلان} few {# أطفال} many {# طفلًا} other {# طفل}}',
      fxSnapshot: '{amount} ل.س بسعر صرف {rate}، مثبَّت لحظة إنشاء الحجز.',
      attemptVia: '{method} عبر {provider} · {status}',
      refunded: 'استُرد {amount} {currency}',
      refundedToWallet:
        'استُرد {amount} {currency} ({walletAmount} {currency} إلى المحفظة)',
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

      /* ── Internal notes (§9.4) ─────────────────────────────────────────── */
      notes: 'ملاحظات داخلية',
      /*
        Says who does NOT see it, because that is the only thing a reader needs to know before
        typing. «داخلية» alone is a word people read past.
      */
      notesHint: 'لا يراها العميل ولا الشريك.',
      noNotes: 'لا ملاحظات على هذا الحجز.',
      noteLabel: 'ملاحظة جديدة',
      /*
        The floor the API enforces, stated before the refusal — the same courtesy the enforcement
        screens give their reason fields.
      */
      noteHint: 'حرفان على الأقل. تُضاف ولا تُعدَّل: لتصحيح ملاحظة اكتب واحدة جديدة.',
      addNote: 'إضافة ملاحظة',
      addingNote: 'جارٍ الإضافة…',
      noteAdded: 'أُضيفت الملاحظة.',
      /** The author line under a note. `{who}` is a staff address or a role, never a customer. */
      noteBy: '{who} · {when}',

      /* ── Actions (§9.4) ────────────────────────────────────────────────── */
      actions: 'إجراءات',
      /*
        The consequence stated before the field, as on «تعليق الحساب»: this one stops a stay from
        happening and the customer reads the reason.
      */
      cancelHint:
        'يُلغى الحجز نهائياً ويُبلَّغ العميل والشريك. السبب المكتوب هنا يقرأه العميل.',
      cancelBooking: 'إلغاء الحجز',
      cancelling: 'جارٍ الإلغاء…',
      cancelReasonLabel: 'سبب الإلغاء (يقرأه العميل)',
      cancelReasonHint: 'ثلاثة أحرف على الأقل.',
      bookingCancelled: 'أُلغي الحجز.',
      /*
        «حوالة», not «دفعة». The control exists for ONE rail — an offline bank transfer, which sends
        no webhook — and naming the rail is what stops it reading as a general "mark this paid".
        A card is captured by its provider and no operator is involved (Bashar's question,
        2026-08-25); the screen only offers this where there is a transfer to match.
      */
      capturePayment: 'تأكيد استلام الحوالة',
      capturing: 'جارٍ التأكيد…',
      /*
        What it DOES and what it ASSUMES, in that order. Confirming starts the partner's window,
        and the assumption — that finance has seen the credit — is the one an operator must not
        make casually.
      */
      captureHint:
        'للحوالات المصرفية فقط: أكّد بعد ظهور المبلغ في كشف الحساب. يُسجَّل الحجز مدفوعاً وتبدأ مهلة تأكيد الشريك.',
      paymentCaptured: 'سُجِّلت الحوالة وبدأت مهلة الشريك.',

      /* ── The rest of the staff lifecycle (§6.3) ────────────────────────── */
      /*
        «نيابة عن الشريك» is in the label, not only in the hint. It is a different act from the
        partner confirming, it is recorded as one, and the operator should read that before
        pressing rather than after.
      */
      confirmBooking: 'تأكيد الحجز نيابة عن الشريك',
      confirming: 'جارٍ التأكيد…',
      confirmHint:
        'يُستخدم حين يؤكّد الشريك عبر الهاتف أو تعذّر عليه الدخول. يُسجَّل باسمك في سجل التدقيق.',
      confirmReasonLabel: 'سبب التأكيد نيابة عنه',
      confirmReasonHint: 'عشرون حرفًا على الأقل — يقرأه زميل يراجع القرار لاحقاً.',
      bookingConfirmed: 'أُكّد الحجز وأُبلغ العميل.',
      checkIn: 'تسجيل وصول الضيف',
      checkingIn: 'جارٍ التسجيل…',
      checkedIn: 'سُجّل وصول الضيف.',
      undoCheckIn: 'التراجع عن تسجيل الوصول',
      undoingCheckIn: 'جارٍ التراجع…',
      checkInUndone: 'أُلغي تسجيل الوصول.',
      completeStay: 'إنهاء الإقامة',
      completing: 'جارٍ الإنهاء…',
      /*
        Says what it UNLOCKS. «إنهاء الإقامة» sounds administrative; the consequence is that the
        partner becomes payable and the guest may review — and an operator ending a stay early
        should know both.
      */
      completeHint: 'تُحتسب مستحقات الشريك بعد الإنهاء، ويصبح بإمكان النزيل كتابة تقييم.',
      stayCompleted: 'أُنهيت الإقامة.',

      /* ── §9.4: فتح نزاع، استرداد، تعويض ────────────────────────────────── */
      openDispute: 'فتح نزاع',
      openingDispute: 'جارٍ الفتح…',
      /*
        Both consequences, because both surprise people. A dispute freezes the partner's money and
        marks the booking — and an operator recording a telephone complaint should know that before
        they press, not when the partner calls to ask why they were not paid.
      */
      disputeHint:
        'يُجمّد استحقاق الشريك لهذا الحجز حتى الإغلاق، وتتغيّر حالة الحجز إلى «متنازع عليه».',
      disputeKindLabel: 'نوع النزاع',
      pickDisputeKind: 'اختر نوع النزاع…',
      disputeTitleLabel: 'عنوان النزاع',
      disputeTitleHint: 'سطر واحد يظهر في قائمة النزاعات.',
      disputeDescriptionLabel: 'ما الذي حدث',
      disputeDescriptionHint: 'عشرون حرفًا على الأقل — رواية العميل كما وصفها.',
      disputeOpened: 'فُتح النزاع وجُمّد استحقاق الشريك.',

      refund: 'استرداد',
      refunding: 'جارٍ الاسترداد…',
      /*
        The FIGURE is not ours to choose and the screen says so. `RefundService` computes it from
        the cancellation policy snapshotted on the booking, so an operator cannot type an amount —
        and knowing that before opening the form stops them looking for the field.
      */
      refundHint: 'المبلغ يُحسب من سياسة الإلغاء المثبَّتة على الحجز، ولا يمكن تعديله.',
      refundQuoteLine: '{amount} {currency} · {percent}% حسب سياسة «{tier}»',
      refundToWallet: 'منها {amount} {currency} إلى محفظة العميل',
      refundReasonLabel: 'سبب الاسترداد',
      refundReasonHint: 'ثلاثة أحرف على الأقل، ويُحفظ مع الحركة المالية.',
      /*
        `refundIssued`, not `refunded` — that key was already taken, thirteen lines up, by the
        template the payments section renders per refund row («استُرد {amount} {currency}»). A
        second `refunded` silently WON, and the older one then took two placeholders it no longer
        had. The typechecker caught it; the reader would have caught «استُرد {amount} {currency}»
        printed literally on screen.
      */
      refundIssued: 'صدر الاسترداد.',
      refundNothing: 'لا مبلغ قابلاً للاسترداد على هذا الحجز.',

      compensate: 'تعويض العميل',
      compensating: 'جارٍ التعويض…',
      /*
        Where the money goes and where it does NOT. A wallet credit is not a refund and the two get
        confused: this one is SAFRA's own goodwill (§7 «تعويض محفظة»), not a return of the payment.
      */
      compensateHint:
        'يُضاف رصيد إلى محفظة العميل من سفرة. ليس استرداداً للمبلغ المدفوع.',
      compensateAmountLabel: 'المبلغ',
      compensateCurrencyLabel: 'العملة',
      compensateNoteLabel: 'سبب التعويض',
      compensateNoteHint: 'عشرة أحرف على الأقل — يظهر في سجل محفظة العميل.',
      compensated: 'أُضيف التعويض إلى محفظة العميل.',

      /* ── Where the rest of this booking lives ──────────────────────────── */
      /*
        Links, not an embedded inbox (Bashar, 2026-08-25). Each goes to the section that already
        owns that record, with this booking's reference as the search term — so the reader lands
        on the existing screen, filtered, rather than on a second half-built copy of it.
      */
      elsewhere: 'مرتبط بهذا الحجز',
      relatedDisputes:
        '{n, plural, zero {لا نزاعات} one {نزاع واحد} two {نزاعان} few {# نزاعات} many {# نزاعاً} other {# نزاع}}',
      relatedConversations:
        '{n, plural, zero {لا محادثات} one {محادثة واحدة} two {محادثتان} few {# محادثات} many {# محادثة} other {# محادثة}}',
      relatedNotifications:
        '{n, plural, zero {لا رسائل} one {رسالة واحدة} two {رسالتان} few {# رسائل} many {# رسالة} other {# رسالة}}',
      /*
        §6.4's «يتصل موظف سفرة بالعميل ويعرض عقارات مشابهة» — offering the customer alternatives
        after a cancellation.

        A LINK, not a form (Bashar, 2026-08-25). The conversation already has a home in الرسائل
        with a thread, a reply box and the redaction every stored message goes through; a second
        composer here would be a parallel messaging surface to keep in step with it. The link
        carries this booking as the filter, so it lands on the conversation about this stay.
      */
      sendAlternatives: 'اقتراح بدائل للعميل',
    },

    /* §8.2 — «أنواع أخرى قابلة للإضافة من الإدارة». */
    propertyTypes: {
      title: 'أنواع الإقامة',
      intro: 'الأنواع التي يختار منها الشريك عند تسجيل عقار.',
      code: 'المعرّف',
      nameAr: 'الاسم بالعربية',
      nameEn: 'الاسم بالإنجليزية',
      nameDe: 'الاسم بالألمانية',
      hasMultipleUnits: 'يحتوي على أكثر من وحدة (فندق مثلًا)',
      inUse: '{n} عقار',
      add: 'إضافة نوع',
      save: 'حفظ',
      saving: 'جارٍ الحفظ…',
      cancel: 'إلغاء',
      retire: 'إيقاف',
      restore: 'إعادة تفعيل',
      retired: 'موقوف',
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
      photoCount:
        '{count, plural, zero {لا صور مرفوعة} one {صورة واحدة مرفوعة} two {صورتان مرفوعتان} few {# صور مرفوعة} many {# صورة مرفوعة} other {# صورة مرفوعة}}، {cover}',
      coverSet: 'وصورة الغلاف محددة',
      coverMissing: 'ولم تُحدَّد صورة غلاف',
      unitLine:
        'حتى {guests, plural, one {ضيف واحد} two {ضيفين} few {# ضيوف} many {# ضيفًا} other {# ضيف}} · {price} / الليلة · الحد الأدنى {minNights, plural, one {ليلة واحدة} two {ليلتان} few {# ليالٍ} many {# ليلة} other {# ليلة}}',
      notAwaitingReview: 'حالة هذا العقار {status} وهو ليس بانتظار المراجعة.',
      reviewThePartner: 'راجع الشريك',
      noDescription: 'لا يوجد وصف.',
      noPhotos:
        'لا صور مرفوعة. يتوقع البند §5.6 معرضاً، وعدد الصور يرفع ترتيب العقار — النشر بلا صور ممكن لكنه نادراً ما يكون صحيحاً.',
      /* The previews are shown now (2026-08-26); this marks which image leads the listing. */
      coverBadge: 'الغلاف',
      /* Said plainly — a truncated gallery that says nothing reads as the whole gallery. */
      morePhotos: 'و{n} صورة أخرى غير معروضة هنا.',
      noUnits: 'لا وحدات. عقار بلا وحدة لا يمكن حجزه ولا يجب نشره.',
    },

    partnerDetail: {
      /*
        The way from a partner's RECORD to their unfinished checklist (Bashar, 2026-08-24).

        «متابعة» rather than «إكمال»: the staff member is carrying on a sitting that may have been
        started by somebody else on another day, not finishing something of their own. The word has
        to work for both, because the common case is picking up a partner who came in weeks ago.
      */
      continueOnboarding: 'متابعة مستندات الشريك',
      applicant: 'مُقدّم الطلب',
      email: 'البريد الإلكتروني',
      phone: 'الهاتف',
      address: 'العنوان',
      /* §8.1 — both are registration data a verifier checks before activating the account. */
      mapLocation: 'الموقع على الخريطة',
      noMapLocation: 'لم يُحدَّد',
      payoutDetails: 'بيانات التحويل المالي',
      noPayoutDetails: 'لا بيانات تحويل مسجّلة',
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
      step1: '1. افتح تطبيق المصادقة وأضف حساباً يدوياً.',
      step2: '2. أدخل المفتاح أدناه.',
      step3: '3. اكتب الرمز المكوّن من ستة أرقام الذي يظهر.',
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

      /*
        The two sentences that depend on the POLICY (Bashar, 2026-08-21).

        `blockedNote` above is true only while the policy is «مُلزِم». Under «استرشادي» the
        reviewer may approve this partner now, and telling them otherwise sends them off to chase
        a feed registration instead of doing the work in front of them. Under «معطّل» there is
        nothing to say about the list at all.
      */
      advisoryNote:
        'يمكنك المتابعة والتحقق من الشريك رغم ذلك — الفحص استرشادي حالياً. سيُسجَّل أن الاعتماد تم دون فحص.',
      policyOff:
        'فحص العقوبات معطّل حالياً بقرار من الإدارة. يمكن تفعيله من الإعدادات متى لزم.',
      listFixture:
        'المُستورَد قائمة اختبار للتطوير، وليس قائمة عقوبات. الفحص لا يستخدمها، ولا يجوز أن يُبنى عليها تحقق.',
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

    /*
      ── عقد الشراكة على صفحة الشريك (Bashar, 2026-08-21) ────────────────────────────────────
      التوقيع بخط اليد: التوقيع الإلكتروني غير معتمد في سوريا. فالخطوات ثلاث ومادية — أنشئ،
      نزّل ووقّع، ثم ارفع — والنصوص تسمّيها بالترتيب الذي تحدث به.
    */
    partnerContract: {
      title: 'عقد الشراكة',
      none: 'لم يُنشأ عقد لهذا الشريك بعد.',
      intro:
        'أنشئ العقد من نموذج سفرة، نزّله ووقّعه بخط اليد، ثم ارفع النسخة الموقّعة ليصل الشريك إشعار بتوقيعه.',
      generate: 'إنشاء العقد',
      generating: 'جارٍ الإنشاء…',
      regenerate: 'إنشاء نسخة جديدة',
      download: 'تنزيل العقد',
      downloadSafra: 'نسخة سفرة الموقّعة',
      downloadPartner: 'نسخة الشريك الموقّعة',
      uploadSigned: 'ارفع النسخة الموقّعة وأرسلها للشريك',
      /*
        ── النسخة الموقّعة من الطرفين (Bashar, 2026-08-23) ──────────────────────────────────────
        الحالة التي وقّع فيها الطرفان ورقة واحدة على الطاولة نفسها. المسح الضوئي واحد يحمل
        التوقيعين، فلا معنى لرفعه مرّتين ولا لانتظار الشريك ليرفع ما وقّعه أمامك.

        الزر الثاني بجانب الأول لا بديلاً عنه: المسار المعتاد — سفرة توقّع ثم ينتظر الشريك — ما زال
        هو الغالب، وهذا لِمَن كان الشريك حاضراً.
      */
      uploadJoint: 'ارفع النسخة الموقّعة من سفرة والشريك',
      uploadJointHint:
        'للنسخة الواحدة التي وقّعها الطرفان معاً. يصبح العقد سارياً فوراً دون انتظار رفع الشريك، وتصل إليه نسخته بالبريد.',
      uploadJointReplaceWarning:
        'رفع نسخة موقّعة من الطرفين الآن يُلغي التوقيعات المحفوظة ويستبدلها بهذه النسخة. تبقى النسخ السابقة في السجل.',
      uploading: 'جارٍ الإرسال…',
      file: 'النسخة الموقّعة (PDF)',
      failed: 'تعذّر تنفيذ الطلب. حاول مرة أخرى.',
      tooLarge: 'الملف أكبر من الحد المسموح (10 ميغابايت). اختر ملفاً أصغر.',
      /* One line per state, so the panel never leaves the reader guessing whose turn it is. */
      stateDraft:
        'أُنشئ العقد ولم يوقّعه أحد بعد. نزّله، وقّعه بخط اليد، ثم ارفعه — وبذلك يُرسل إلى الشريك.',
      stateAwaitingPartner:
        'وُقّع من سفرة وأُرسل إلى الشريك، ووصله إشعار بالبريد. بانتظار نسخته الموقّعة.',
      stateActive: 'وقّع الطرفان والعقد ساري المفعول.',
      /*
        Handing the step back (Bashar, 2026-08-21). The label says what it DOES to the partner
        rather than naming the state — «إعادة فتح» on its own tells an operator nothing about who
        ends up waiting for whom.
      */
      /*
        Said before the file is chosen, and only when there is a signature to invalidate: replacing
        SAFRA's copy after the partner has signed puts their signature on a page that is no longer
        the contract, so it is superseded with it.
      */
      replaceWarning:
        'رفع نسخة جديدة الآن يُلغي توقيع الشريك ويعيد العقد إلى انتظار توقيعه، ويصله إشعار بذلك.',
      /*
        ── سجل العقد (Bashar, 2026-08-23) ─────────────────────────────────────────────────────
        The same list the partner sees, under the same upload form, so the two sides read the same
        record of who sent what. «الحالية» is teal rather than green on both screens: this panel
        already paints «ساري المفعول» in the green of an active contract, and two meanings in one
        colour on one screen is what §«One status, one word, one colour» forbids.
      */
      historyTitle: 'سجل العقد',
      historySafra: 'أرسلت سفرة نسخة موقّعة',
      historyPartner: 'أرسل الشريك نسخته الموقّعة',
      historyCurrent: 'الحالية',
      historySuperseded: 'مُستبدلة',
      reopen: 'السماح للشريك برفع نسخة جديدة',
      reopening: 'جارٍ الفتح…',
      reopenHint:
        'يعيد الخطوة إلى الشريك ليرفع نسخة موقّعة جديدة، ويصله إشعار بذلك. تبقى نسخته السابقة محفوظة في السجل.',
      /* Said next to the approval control, because that is where it changes what somebody does. */
      notSignedYet: 'لا يوجد عقد ساري لهذا الشريك بعد.',
    },

    verifyPartner: {
      screeningRequired:
        'سجّل نتيجة فحص العقوبات قبل الموافقة. التحقق من طرف لم يُفحص مخاطرة قانونية على الكيان الألماني، لا إجراء شكلي.',
      /*
        The same warning when screening does NOT block (Bashar, 2026-08-21). It still says what
        the risk is — that part did not stop being true when the gate came off — but it stops
        instructing the reviewer to do something the platform is no longer going to require.
      */
      screeningAdvisory:
        'لم يُسجَّل فحص عقوبات لهذا الشريك. الفحص استرشادي حالياً فلن يمنع الاعتماد، وسيُسجَّل أن الاعتماد تم دون فحص.',
      approve: 'الموافقة على الشريك',
      reject: 'رفض الطلب',
      /* Moved out of `verify-partner.tsx` (O-i18n-4). */
      confirmApproval: 'تأكيد الموافقة',
      confirmRejection: 'تأكيد الرفض',
      notesOptional: 'ملاحظات (اختياري). الموافقة تتيح نشر عقارات هذا الشريك المُقدَّمة.',
      rejectionReason: 'لماذا يُرفض الطلب؟ مطلوب، ويطّلع عليه الشريك.',
      screeningRequiredTitle: 'فحص العقوبات مطلوب أولاً.',
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

    /**
     * التقييمات المُبلَّغ عنها — the staff moderation queue (§7.3, P-006).
     *
     * The two decisions are «إخفاء» and «إبقاء», not «حذف» and «إبقاء». The vocabulary matters:
     * the database refuses to delete a review, so a control named «حذف» would be a promise the
     * system cannot keep, and an operator would go looking for why it failed.
     */
    reviewModeration: {
      title: 'التقييمات المُبلَّغ عنها',
      note: 'لا يُحذف أي تقييم (P-006). القرار هنا بين إخفائه عن الزوار أو إبقائه ظاهراً؛ في الحالتين يبقى السجل ويُسجَّل من قرّر ولماذا.',
      empty: 'لا بلاغات بانتظار القرار.',
      colProperty: 'العقار',
      reportedBy: 'بلاغ الشريك',
      body: 'نص التقييم',
      uphold: 'قبول البلاغ وإخفاء التقييم',
      dismiss: 'رفض البلاغ وإبقاء التقييم',
      noteLabel: 'سبب القرار. يُسجَّل في سجل التدقيق ويُطلب في الحالتين.',
      confirm: 'تأكيد القرار',
      cancel: 'إلغاء',
      working: 'جارٍ التنفيذ…',
      failed: 'تعذّر تسجيل القرار.',
      unreachable: 'تعذّر الوصول إلى الخادم.',
      hiddenEffect:
        'الإخفاء يُخرج التقييم من صفحة العقار ومن معدّله فوراً، ويبقى ظاهراً للشريك في سجلّه.',
    },

    reviewProperty: {
      approveAndPublish: 'الموافقة والنشر',
      reject: 'رفض العقار',
      /* The decision panel's own copy, moved out of the component (O-i18n-4). */
      publishNow: 'النشر الآن',
      confirmRejection: 'تأكيد الرفض',
      saving: 'جارٍ الحفظ…',
      notesOptional: 'ملاحظات (اختياري). النشر يجعل العقار قابلاً للبحث فوراً.',
      rejectionReason: 'ما الذي يجب على الشريك تغييره؟ مطلوب، ويطّلع عليه.',
      partnerNotVerified: 'يجب التحقق من الشريك قبل نشر هذا العقار.',
      noUnits: 'لا وحدات في هذا العقار، فلا شيء يمكن حجزه.',
      failed: 'تعذّر تسجيل القرار.',
    },

    /**
     * Copy that used to live inside the console's client components (O-i18n-4).
     *
     * Roughly forty strings across ten files — button labels, client-side error messages and a few
     * value lookups — none of which the `safra/no-hardcoded-text` rule can see, because each is a
     * string literal in an EXPRESSION rather than JSX text: a ternary inside `{…}`, a
     * `Record<string, string>` lookup, a `setError(…)` argument. The rule's own header explains why
     * widening it would mean flagging every literal in the repo.
     *
     * They were being found one screenshot at a time. Grouped here rather than scattered per
     * component so the next language is one file, which is the whole point of the copy rule.
     */
    panels: {
      /* Shared by every client panel — one wording for "the request never arrived". */
      unreachable: 'تعذّر الوصول إلى الخادم.',
      saving: 'جارٍ الحفظ…',
      failed: 'تعذّر تسجيل القرار.',
      notSet: 'غير محدَّد',

      screeningRun: 'تشغيل الفحص',
      screeningAgain: 'إعادة الفحص',
      screeningSearching: 'جارٍ البحث…',
      screeningFailed: 'تعذّر تشغيل الفحص.',
      screeningMarkNoMatch: 'تسجيل عدم التطابق',
      screeningMarkMatch: 'تسجيل تطابق رغم النتيجة',
      screeningMatchWarning: 'سيُسجَّل تطابق يخالف النتيجة الآلية، ويمنع ذلك الموافقة.',
      screeningClearWarning:
        'سيُلغى التطابق المسجَّل خلافاً للنتيجة الآلية. لا تفعل هذا إلا بعد التأكد من أن الطرف مختلف.',

      documentReject: 'رفض الوثيقة',

      twoFactorStartFailed: 'تعذّر بدء التفعيل. أعد تحميل الصفحة للمحاولة مرة أخرى.',
      twoFactorCodeRejected: 'الرمز غير مقبول. تحقّق من تطبيق المُصادِق وحاول مرة أخرى.',
      twoFactorFailed: 'حدث خطأ. حاول مرة أخرى.',
      twoFactorLoading: 'جارٍ التحميل…',
      twoFactorChecking: 'جارٍ التحقق…',
      twoFactorSubmit: 'تفعيل المصادقة الثنائية',

      invitationMismatch: 'كلمتا المرور غير متطابقتين.',
      invitationFailed: 'تعذّر ضبط كلمة المرور.',
      invitationSubmitting: 'جارٍ ضبط كلمة المرور…',
      invitationSubmit: 'ضبط كلمة المرور',
    },

    invitation: {
      setPassword: 'عيّن كلمة المرور',
      invitedNote: 'تمت دعوتك إلى مركز قيادة سفرة. اختر كلمة مرور لتنشيط حسابك.',
      unexpectedNote:
        'إذا لم تكن تتوقع هذه الدعوة، أغلق هذه الصفحة وأبلغ فريق سفرة. لا تعيّن كلمة مرور.',
      newPassword: 'كلمة المرور الجديدة',
      passwordHint: '12 حرفًا على الأقل.',
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
   * What an audit entry was ABOUT — `audit_log.subject_type`.
   *
   * The action was translated in 2026-08-04 and the subject beside it was not, so السجل and
   * الموظفون printed «booking_export» and «customer_profile» in Latin under an Arabic action
   * (found 2026-08-14 by the console's own sweep, after Bashar reported the same class of defect
   * on العقارات). Fourteen values, matching every `subject_type` present in the database.
   *
   * Same contract as `auditAction`: the stored value is a machine identifier and part of the
   * evidence, so it is translated HERE and never at the source.
   */
  auditSubject: {
    partner_application: 'طلب شراكة',
    booking: 'حجز',
    booking_export: 'تصدير حجوزات',
    customer_profile: 'ملف عميل',
    fx_rate: 'سعر صرف',
    gift_card: 'بطاقة هدية',
    partner: 'شريك',
    partner_contract: 'عقد شراكة',
    /*
      A subject type that has existed since disputes were built and had never reached this
      catalogue, because `audit-catalogue.integration.test.ts` reads the TABLE and no dispute had
      ever been closed in a committed run. Found 2026-08-25 the first time one was.
    */
    dispute: 'نزاع',
    /* The role definition itself, not an employee — `EmployeeRolesService` audits against it. */
    partner_employee_role: 'دور موظف شريك',
    /* A role definition for SAFRA's OWN staff — «مدير عام», «مشرف حجوزات». */
    staff_role: 'دور موظف سفرة',
    /* The employment itself — invited, role changed, suspended. Not the role definition above. */
    partner_employee: 'موظف شريك',
    partner_payout: 'مستحقات شريك',
    property: 'عقار',
    property_image: 'صورة عقار',
    review: 'تقييم',
    setting: 'إعداد',
    unit: 'وحدة',
    user: 'مستخدم',
    wallet: 'محفظة',
  } as Record<string, string>,

  /**
   * Audit actions, so the activity panel is not a list of English identifiers.
   *
   * Keyed on the value stored in `audit_log.action`, which is a machine identifier and part
   * of the record — it is deliberately NOT translated at the source.
   *
   * ## This list used to claim it was complete, and was not
   *
   * It said "every action present in the database is listed here; an action added later falls back
   * to its raw key, which is ugly but never wrong, and reads as a prompt to add it". By 2026-08-20
   * it covered THIRTY of the seventy-three actions the code can emit — and neither half of the
   * safety net was true. `label()` fell back to `value.replace(/_/g, ' ')`, not to the raw key, so
   * «booking.export_requested» reached السجل as "booking export requested": English prose, on an
   * Arabic-only console, that reads as a deliberate label rather than a prompt. That is why
   * forty-three of them survived the sweep which greps for snake_case — there was no underscore
   * left to find.
   *
   * Both halves are fixed: the list is now the UNION of what the code emits and what the database
   * holds, and `label()` marks a miss instead of dressing it up. `audit-catalogue.integration.test.ts`
   * fails when the database holds an action this map does not cover, so the claim is enforced rather
   * than repeated.
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
    /* ── أدوار الموظفين، يُعرِّفها المدير العام (Bashar, 2026-08-23) ── */
    'staff_role.created': 'إنشاء دور لموظفي سفرة',
    'staff_role.updated': 'تعديل دور موظفي سفرة',
    'staff_role.deleted': 'سحب دور موظفي سفرة',
    /* ── موظفو الشركاء وأدوارهم (Bashar, 2026-08-23) ── */
    'partner_employee_role.created': 'إنشاء دور لموظفي الشركاء',
    'partner_employee_role.updated': 'تعديل دور موظفي الشركاء',
    'partner_employee_role.deleted': 'سحب دور موظفي الشركاء',
    'partner_employee.invited': 'دعوة موظف للعمل لدى شريك',
    'partner_employee.updated': 'تعديل دور موظف أو حالته',
    'partner_employee.removed': 'إنهاء عمل موظف لدى شريك',
    'partner_employee.activated': 'تفعيل حساب موظف بعد قبول الدعوة',
    'partner_contract.generated': 'إنشاء عقد شراكة من النموذج',
    'partner_contract.countersigned': 'رفع نسخة موقّعة من عقد شراكة',
    'partner_contract.reopened': 'إعادة فتح عقد لتوقيع الشريك',
    'partner_contract.signed': 'تسجيل توقيع عقد شراكة',
    // ── Added 2026-08-20, closing the gap described above ──────────────────
    /*
      The two REJECTION halves, which were missing while their approvals were present.

      Both are built with a template literal — `partner.${nextStatus}` and
      `property.${decision === 'approve' ? 'approved' : 'rejected'}` — so a reader of the source sees
      one action where there are two, and only the happy half got translated. They are the outcome of
      the two verification queues this console exists to work, so a rejected listing wrote an
      untranslatable row into an append-only table.
    */
    'partner.rejected': 'رفض شريك',
    'property.rejected': 'رفض عقار',
    'auth.password_changed': 'تغيير كلمة المرور',
    'auth.password_change_refused': 'محاولة تغيير كلمة مرور مرفوضة',
    'auth.recovery_code_used': 'استخدام رمز استرداد',
    'auth.register_existing_email': 'تسجيل ببريد مسجَّل مسبقاً',
    'auth.two_factor_disabled': 'تعطيل المصادقة الثنائية',
    'booking.created': 'إنشاء حجز',
    'booking.cancelled': 'إلغاء حجز',
    'booking.payment_captured': 'تحصيل دفعة حجز',
    'booking.checked_in': 'تسجيل وصول الضيف',
    'booking.check_in_undone': 'التراجع عن تسجيل الوصول',
    /* The ACT, not its content: the note itself never reaches the audit log — see the action. */
    'booking.internal_note_added': 'إضافة ملاحظة داخلية على حجز',
    'booking.staff_confirmed': 'تأكيد حجز نيابة عن الشريك',
    'booking.completed': 'إنهاء الإقامة',
    'booking.dispute_closed': 'رفع حالة النزاع عن الحجز',
    'booking.verification_sent': 'إرسال رمز تحقق للعميل',
    'booking.verification_passed': 'نجاح تحقق العميل',
    'dispute.opened_by_staff': 'فتح نزاع نيابة عن العميل',
    'booking.exported': 'تصدير حجوزات',
    'booking.export_requested': 'طلب تصدير حجوزات',
    'calendar.range_updated': 'تعديل مدى في التقويم',
    'city_image.uploaded': 'رفع صورة مدينة',
    'city_image.archived': 'أرشفة صورة مدينة',
    'customer.profile_updated': 'تعديل ملف عميل',
    'gift_card.purchase': 'شراء بطاقة هدية',
    'gift_card.redeem': 'استخدام بطاقة هدية',
    'partner.invitation_accepted': 'قبول دعوة شريك',
    'partner.two_factor_reset': 'إعادة تعيين المصادقة الثنائية لشريك',
    'partner_application.submitted': 'تقديم طلب شراكة',
    'partner_application.contacted': 'تسجيل مكالمة طلب شراكة',
    'partner_application.accepted': 'قبول طلب شراكة',
    'partner_application.rejected': 'رفض طلب شراكة',
    'partner_application.invitation_resent': 'إعادة إرسال دعوة شريك',
    /*
      Named after the ACTION rather than its result. «تسجيل شريك» alone would read the same as
      `partner.registered`, and the whole point of a separate action is that somebody reading
      السجل can tell a partner a super admin created from one who asked to join.
    */
    'partner.onboarded_in_person': 'تسجيل شريك مباشرةً من المدير العام',
    'partner.location_set': 'تحديد موقع الشريك على الخريطة',
    'partner.invitation_resent': 'إعادة إرسال دعوة شريك مُسجَّل مباشرةً',
    'partner_contract.viewed': 'عرض عقد شراكة',
    'partner_payout.released': 'الإفراج عن مستحقات شريك',
    'partner_payout.paid': 'دفع مستحقات شريك',
    'partner_payout.cancelled': 'إلغاء مستحقات شريك',
    'partner_payout.closed': 'إغلاق دورة مستحقات',
    'payment.started': 'بدء عملية دفع',
    'payment.failed': 'فشل عملية دفع',
    'refund.created': 'إنشاء استرداد',
    'property.created': 'إنشاء عقار',
    'property.updated': 'تعديل عقار',
    'property.submitted_for_review': 'إرسال عقار للمراجعة',
    'property_image.uploaded': 'رفع صورة عقار',
    'property_image.archived': 'أرشفة صورة عقار',
    'property_image.cover_set': 'تعيين صورة غلاف',
    'property_image.reordered': 'إعادة ترتيب صور عقار',
    'rbac.grant_toggled': 'تعديل منح صلاحية',
    'review.created': 'إضافة تقييم',
    'review.replied': 'رد على تقييم',
    'review.reported': 'الإبلاغ عن تقييم',
    'review.hidden': 'إخفاء تقييم',
    'review.report_dismissed': 'رفض بلاغ تقييم',
    'staff.invitation_resent': 'إعادة إرسال دعوة موظف',
    'staff.reinstated': 'إعادة تنشيط موظف',
    'staff.renamed': 'تغيير اسم موظف',
    'partner.suspended': 'تعليق حساب شريك',
    'partner.unsuspended': 'رفع التعليق عن شريك',
    'violation.recorded': 'تسجيل مخالفة',
    'violation.warned': 'إنذار على مخالفة',
    'violation.fined': 'فرض غرامة على مخالفة',
    'violation.escalated': 'تصعيد مخالفة إلى تعليق الحساب',
    'partner.notified': 'إبلاغ الشريك بإجراء',
    'fine.waived': 'إلغاء غرامة',
    'staff.scope_changed': 'تعديل نطاق موظف',
    'unit.created': 'إنشاء وحدة',
    'unit.updated': 'تعديل وحدة',
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
     * `property_types.code`. The seven kinds of listing SAFRA takes.
     *
     * The registry's النوع column and the detail screen's subtitle both printed the CODE —
     * «rural_house», «chalet» — down an otherwise Arabic table (Bashar, 2026-08-14). The same
     * seven words are in `partner/ar.ts`; they are here rather than shared because a console
     * vocabulary and a partner-facing one are free to diverge in register, and because the two
     * packages' catalogues have never imported from one another.
     *
     * `property_types` also carries `name_ar` in the database, and the API could have sent that
     * instead. It sends the CODE on purpose: a code is stable, a name is copy, and the project's
     * rule is that the API answers with the former and the reader's own surface resolves it.
     */
    propertyType: {
      hotel: 'فندق',
      apartment: 'شقة مفروشة',
      villa: 'فيلا',
      farm: 'مزرعة',
      chalet: 'شاليه',
      rural_house: 'بيت ريفي',
      camp: 'مخيم',
    },

    /**
     * `TRIP_ATTRIBUTES` from `@safra/contracts` — what a listing is good for.
     *
     * Rendered on the detail screen as chips, and until 2026-08-14 rendered as
     * `attribute.replace(/_/g, ' ')`, which is the exact expression the status rule names as
     * forbidden. It produced «internet», «business», «history» in Latin on an Arabic screen.
     *
     * Ten entries, matching the contract exactly. The customer app has had the same ten in
     * `web/*.json` under `attributes` since search shipped — this is the console catching up, not
     * new copy.
     */
    tripAttribute: {
      sea: 'بحر',
      mountain: 'جبل',
      history: 'تاريخ',
      nature: 'طبيعة',
      families: 'عائلات',
      honeymoon: 'شهر عسل',
      pool: 'مسبح',
      parking: 'موقف سيارات',
      internet: 'إنترنت',
      business: 'أعمال',
    },

    /** `export_status`. Four words, four colours — the rule that no two share either. */
    exportStatus: {
      queued: 'في الانتظار',
      running: 'قيد الإنشاء',
      ready: 'جاهز',
      failed: 'فشل',
    },

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

    /**
     * The three languages, named in ARABIC rather than as endonyms.
     *
     * The console is Arabic-only and this is a FACT about an applicant — "write to them in
     * German" — read by an Arabic-speaking operator. Endonyms («Deutsch») belong on the language
     * picker, where the reader is choosing their own language and has to recognise their own
     * name for it.
     */
    locales: {
      ar: 'العربية',
      en: 'الإنجليزية',
      de: 'الألمانية',
    },

    /** «طلبات الشراكة». Four values, four colours — see `VOCABULARIES` in @safra/ui. */
    partnerApplicationStatus: {
      submitted: 'جديد',
      contacted: 'تم الاتصال',
      accepted: 'مقبول',
      rejected: 'مرفوض',
    },
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
      /* §8.1's map location, recorded by `partner.location_set`. */
      latitude: 'خط العرض',
      longitude: 'خط الطول',
      reference: 'المرجع',
      /* Written by `dispute.resolved` / `dispute.rejected` when a closure agrees compensation. */
      compensationAmount: 'مبلغ التعويض',
      compensationCurrency: 'عملة التعويض',
      /*
        `refund.created`'s four, uncatalogued until the console gained a refund control and one was
        actually issued (2026-08-25). `audit-catalogue.integration.test.ts` reads the TABLE, so a
        payload nothing could write was a payload nothing could flag.
      */
      /* `booking.verification_sent` records WHERE a code went — the channel, never the address. */
      channel: 'القناة',
      refundId: 'معرّف الاسترداد',
      provider: 'مزوّد الدفع',
      providerAmount: 'إلى مزود الدفع',
      walletAmount: 'إلى المحفظة',
      /*
        Written by `staff.invited` and `staff.role_changed` since roles became rows a super admin
        defines. The catalogue test found it against the real `audit_log`, not by review — the
        payload key is assembled nowhere and greppable everywhere, and it still went uncatalogued
        because nobody looks at a payload until they need it.
      */
      staffRoleId: 'الدور',
      /*
        Written by the enforcement actions (2026-08-24). Added as a SET rather than one at a time,
        for the reason the note on `payloadValue` gives — and found by the catalogue test against the
        real `audit_log` rather than by reading the code that writes them.
      */
      stage: 'المرحلة',
      /*
        The delivery result of an enforcement notice (`partner.notified`, 2026-08-24).

        `email` already had a name; these two did not, and `audit-catalogue.integration.test.ts`
        found them the moment the first real notice was sent — reading the TABLE rather than the
        code, which is why it catches a key the author forgot rather than one they declared.
      */
      templateKey: 'الإشعار',
      inApp: 'داخل التطبيق',
      suspended: 'التعليق',
      /*
        Generic enough to be shared, and both arrive from `partner_employee_role.*`: a role's audit
        row carries its name and its capability set on both sides of an edit, which is what makes
        "what changed" answerable later.
      */
      name: 'الاسم',
      permissions: 'القدرات',
      /* Which role an employee was put on. The id, because the NAME can since have changed. */
      roleId: 'معرّف الدور',
      /*
        Whether an in-person onboarding ADOPTED an existing account or made a new one
        (`partner.onboarded_in_person`). Named as a question about the account rather than as a
        boolean, because that is what a reader of السجل is asking when they reach this row: did a
        super admin attach a partner to somebody who already had a SAFRA account?
      */
      accountExisted: 'حساب قائم',
      /*
        Set on `partner_contract.countersigned` when SAFRA's new copy took the partner's signature
        down with it. The status change alone does not say it — `active` →
        `awaiting_partner_signature` reads the same whether a signature was undone or the state was
        merely corrected — and which of those happened is the question asked when a contract is
        disputed.
      */
      invalidatedPartnerSignature: 'أُلغي توقيع الشريك',
      /*
        Set on `partner_contract.countersigned` when ONE scan carried both signatures and staff
        filed it — the in-person path. Without it the log shows a `partner` signature uploaded by a
        staff account, which is indistinguishable from a mistake.
      */
      joint: 'نسخة موقّعة من الطرفين',
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

      /*
        ── The audit log's own vocabulary (Bashar, 2026-08-20) ──────────────────────────────────
        سجل التدقيق draws its before/after payload through this map, and everything below was
        printing in English under «الحقل» because only the timeline's eighteen keys were here.
        Taken from the DISTINCT keys the platform has actually written, not from a reading of the
        code — five call sites build a payload from a spread, so the source under-reports what
        reaches the column. `audit-catalogue.integration.test.ts` holds it to the database.
      */
      status: 'الحالة',
      value: 'القيمة',
      key: 'المفتاح',
      note: 'ملاحظة',
      role: 'الدور',
      kind: 'النوع',
      /*
        نطاق العمل's audit payload — `staff.scope_changed` (2026-08-24).

        Added as a SET, not one at a time. The comment on `payloadValue` below says why: values get
        catalogued when somebody exercises a path rather than when the enum gains a member, so the
        list is always one browser session behind. All four of this payload's fields go in together,
        and only `all_cities` would have been caught by the browser sweep — it looks for Latin
        snake_case, and `outside`, `cityCount` and `citySlugs` are single words or camelCase, so they
        would have printed in English with nothing failing.
      */
      outside: 'خارج النطاق',
      cityCount: 'عدد المدن',
      citySlugs: 'المدن',
      /*
        The enforcement payloads — written by `fine` and `waive` (2026-08-24).

        Found by `audit-catalogue.integration.test.ts` against the real `audit_log` the moment the
        flow was actually DRIVEN, not by reading the code that writes them. Three keys nobody had
        thought of, in a payload written by an endpoint that had been green for an hour: the rows do
        not exist until somebody exercises the path, and until they exist the check has nothing to
        fail on. That is the same reason the subject map was five types short.
      */
      fineAmount: 'مبلغ الغرامة',
      /* The ledger group the balancing pair was posted under — the handle on the money movement. */
      ledgerGroupId: 'مجموعة القيد',
      waived: 'أُلغيت',
      source: 'المصدر',
      format: 'الصيغة',
      direction: 'الاتجاه',
      order: 'الترتيب',
      rating: 'التقييم',
      slug: 'المعرّف',
      email: 'البريد الإلكتروني',
      recipientEmail: 'بريد المستلم',
      fullName: 'الاسم الكامل',
      legalName: 'الاسم القانوني',
      address: 'العنوان',
      partner: 'الشريك',
      partnerType: 'نوع النشاط',
      partnerReference: 'مرجع الشريك',
      bookingReference: 'مرجع الحجز',
      paidReference: 'مرجع الدفعة',
      unitLabel: 'الوحدة',
      nights: 'عدد الليالي',
      basePrice: 'السعر الأساسي',
      price: 'السعر',
      net: 'الصافي',
      balance: 'الرصيد',
      rate: 'سعر الصرف',
      currencyCode: 'رمز العملة',
      quoteCurrency: 'عملة التسعير',
      requestedAmount: 'المبلغ المطلوب',
      requestedCurrency: 'عملة الطلب',
      appliedAmount: 'المبلغ المطبَّق',
      remainingAmount: 'المبلغ المتبقي',
      remainingCodes: 'الرموز المتبقية',
      recoveryCodesIssued: 'رموز الاسترداد الصادرة',
      sessionsRevoked: 'الجلسات المُلغاة',
      claimedBookings: 'الحجوزات المنقولة',
      matchedCount: 'عدد التطابقات',
      rowCount: 'عدد الصفوف',
      daysAffected: 'الأيام المتأثرة',
      confirmationWindowMinutes: 'مهلة التأكيد (دقائق)',
      scheduledFor: 'موعد التنفيذ',
      effectiveFrom: 'ساري من',
      from: 'من',
      to: 'إلى',
      filters: 'عوامل التصفية',
      scoped: 'مقيَّد بنطاق',
      truncated: 'مقتطَع',
      attributes: 'الخصائص',
      documentId: 'معرّف المستند',
      imageId: 'معرّف الصورة',
      fileKey: 'مسار الملف',
      uploadedAs: 'اسم الملف المرفوع',
      contentType: 'نوع الملف',
      bytes: 'الحجم (بايت)',
      width: 'العرض',
      height: 'الارتفاع',
      wasCover: 'كانت صورة الغلاف',
      wasEnrolled: 'كان مفعّلاً',
      ledgerEntryGroup: 'مجموعة القيد المحاسبي',

      /*
        A sanctions screening (ADR 0002). Missing until 2026-08-21, because until then no screening
        had ever been RUN on a database this test reads — the record only appears once somebody
        presses the button, and the audit row is written inside the screening transaction.

        `automatedMatch` and `matched` are deliberately two fields and not one. The matcher's own
        reading is kept whatever a reviewer decides, so an override is visible AS an override
        rather than replacing what the platform found.
      */
      automatedMatch: 'ما وجده الفحص الآلي',
      matched: 'النتيجة المسجَّلة',
      candidateCount: 'عدد المرشحين',
      screenedAt: 'وقت الفحص',
      snapshotId: 'معرّف نسخة القائمة',

      /*
        A partner contract (Bashar, 2026-08-21). Generation and each hand-signed upload write an
        audit row, so سجل التدقيق would otherwise print these five in English.

        `documentHash` and `fileHash` are two different documents: the first is the version SAFRA
        generated, the second is the scan somebody signed and sent back. Naming them the same
        would hide exactly the discrepancy they exist to expose.
      */
      documentHash: 'بصمة النسخة الأصلية',
      fileHash: 'بصمة الملف المرفوع',
      party: 'الطرف',
      sizeBytes: 'الحجم (بايت)',
      verification: 'حالة التحقق',
      /* `source` is already named «المصدر» above and is shared with other payloads. */
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

      /*
        A violation KIND, reaching a payload because `violation.recorded` records which offence.
        The same words as `violationKind` above and deliberately duplicated rather than referenced:
        this catalogue is looked up by VALUE across every payload in the log, and pointing it at
        another map would mean a reader of either could not tell what the other one covers.
      */
      stale_calendar: 'تقويم غير محدَّث',
      /*
        ALL FIVE kinds, not only the one the log happened to contain.

        `stale_calendar` was here alone because it was the only kind any committed run had recorded,
        and `audit-catalogue.integration.test.ts` reads the TABLE — so each remaining kind failed
        that test the first time somebody recorded one. `no_response` did exactly that on
        2026-08-24, hours after the same shape of gap took الدفع down: a catalogue completed to the
        data rather than to the enum, which reads as coverage until the sixth row arrives.
      */
      no_response: 'عدم الرد',
      rejected_after_payment: 'رفض بعد الدفع',
      inaccurate_listing: 'وصف غير مطابق',
      no_show: 'عدم استقبال',

      /*
        The sanctions list a screening was run against. `local_fixture` is here for the same reason
        it exists at all: if a fixture ever reached this column, the reader has to be told what it
        was rather than shown a plausible-looking English identifier.
      */
      eu_consolidated: 'قائمة الاتحاد الأوروبي الموحدة',
      local_fixture: 'قائمة اختبار للتطوير — ليست قائمة عقوبات',

      /*
        Contract states as they appear in an audit payload. Only this one is new — `active` and
        `draft` are already named above, and repeating either is a compile error rather than a
        silent second opinion.
      */
      awaiting_partner_signature: 'بانتظار توقيع الشريك',

      /*
        ── Statuses and codes as they appear in an audit payload (Bashar, 2026-08-20) ───────────
        These are written out here rather than resolved through the status vocabularies above, and
        the reason is that those DISAGREE with each other on purpose: `active` is «نشطة» for a gift
        card and «نشط» for a coupon, `rejected` is «مرفوض» in three maps and «مغلق — مرفوض» in
        disputes. A merged lookup would pick whichever map came first and print the wrong
        agreement. The audit log is one column with one voice, so it gets one deliberate list.
      */
      pending_payment: 'بانتظار الدفع',
      pending_confirmation: 'قيد التأكيد',
      /*
        The three the lifecycle work of 2026-08-25 made reachable.

        `checked_in` failed `audit-catalogue.integration.test.ts` the first time a staff check-in
        was recorded — the catalogue was complete to the DATA and the data had never contained one,
        because no route could produce it. Exactly the shape the note above `no_response` describes,
        and the reason all three are added together rather than one at a time.

        `confirmed` and `completed` are here for the same reason and were one run behind.
      */
      confirmed: 'مؤكد',
      checked_in: 'تم الوصول',
      completed: 'مكتمل',
      /*
        The dispute KINDS, reaching a payload because `dispute.opened_by_staff` records which
        complaint was raised. All four, not only the one a run happened to produce — the same
        lesson the violation kinds above record, learnt the same way on the same day.
      */
      property_unavailable: 'العقار غير متاح',
      not_as_described: 'غير مطابق للوصف',
      partner_no_response: 'الشريك لم يرد',
      complaint: 'شكوى',
      contacted: 'تم الاتصال',
      accepted: 'مقبول',
      rejected: 'مرفوض',
      approved: 'معتمد',
      active: 'نشط',
      suspended: 'موقوف',
      draft: 'مسودة',
      closed: 'مغلق',
      available: 'متاح',
      used: 'مستخدم',
      credit: 'دائن',
      debit: 'مدين',
      manual: 'يدوي',
      central_bank: 'المصرف المركزي',
      /*
        Both scope enums in full — `STAFF_SCOPE_KINDS` and `OUTSIDE_SCOPE_ACCESS`.

        «كل المدن» / «مدن محددة» rather than the display strings from `sections.staff`: this column
        answers "what changed", so the value has to read as a value, and «لا وصول خارج النطاق» is a
        sentence written for a form label.
      */
      all_cities: 'كل المدن',
      cities: 'مدن محددة',
      none: 'لا وصول',
      read_only: 'قراءة فقط',
      /*
        Every partner document KIND, not the two that happened to appear in an audit payload first.

        `identity` and `commercial_register` were here because a reviewer had approved one of each
        on this database; the other three were missing and سجل التدقيق printed them raw. That is
        the shape this list keeps producing — a value is added when somebody exercises the path,
        rather than when the enum gains a member — so all five are written out together and
        `PARTNER_DOCUMENT_KINDS` is where a sixth would come from.
      */
      identity: 'وثيقة هوية',
      commercial_register: 'سجل تجاري',
      ownership_proof: 'إثبات ملكية',
      management_contract: 'عقد إدارة',
      bank_confirmation: 'تأكيد مصرفي',
      accommodation: 'إقامة',
      finance_officer: 'مسؤول مالي',
      support_agent: 'موظف دعم',
      csv: 'CSV',
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
      'booking.checked_in': 'تسجيل وصول الضيف',
      'booking.check_in_undone': 'التراجع عن تسجيل الوصول',
      'booking.completed': 'انتهاء الإقامة',
      'booking.disputed': 'فتح نزاع على الحجز',
      'booking.dispute_closed': 'إغلاق النزاع',
      'booking.sla_expired': 'انتهاء مهلة التأكيد',
      'booking.refund_issued': 'إصدار استرداد',
      'partner.registered': 'تسجيل شريك',
      'partner.approved': 'الموافقة على الشريك',
      'partner.rejected': 'رفض الشريك',
      'property.submitted_for_review': 'إرسال العقار للمراجعة',
      'property.published': 'نشر العقار',
      'property.rejected': 'رفض العقار',
    } as Record<string, string>,

    /*
      WHAT HAPPENED, for a violation the PLATFORM wrote rather than a person.

      The same gap the partner portal had (Bashar, 2026-08-24): `sla.service.ts` levies `no_response`
      and fines for it, `booking-actions.service.ts` records `rejected_after_payment`, and neither
      types a word. So an operator deciding whether to WAIVE a fine saw a category and a figure and
      had to know the enforcement vocabulary to reconstruct the rest.

      Kept in step with the portal's `defaultDescription` by `violation-default-description.test.ts`,
      which fails if one side gains a kind the other lacks — two catalogues describing one set of
      events is exactly where they drift.
    */
    violationDefaultDescription: {
      no_response:
        'لم يرد الشريك على طلب الحجز {reference} خلال مهلة الساعتين، فأُلغي الطلب تلقائياً وسُجّلت المخالفة.',
      rejected_after_payment:
        'رفض الشريك الحجز {reference} بعد أن أتمّ الضيف الدفع، فاستُرد المبلغ للضيف.',
      stale_calendar:
        'بقي تقويم الإتاحة دون تحديث لمدة تجاوزت الحد المسموح، فظهرت تواريخ غير متاحة كأنها متاحة.',
      inaccurate_listing: 'لم تطابق تفاصيل العقار المعروضة ما وجده الضيف على أرض الواقع.',
      no_show: 'وصل الضيف في موعده ولم يجد من يستقبله.',
    } as Record<string, string>,
    violationDefaultDescriptionNoBooking: {
      no_response:
        'لم يرد الشريك على طلب حجز خلال مهلة الساعتين، فأُلغي الطلب تلقائياً وسُجّلت المخالفة.',
      rejected_after_payment:
        'رفض الشريك حجزاً بعد أن أتمّ الضيف الدفع، فاستُرد المبلغ للضيف.',
    } as Record<string, string>,

    violationKind: {
      no_response: 'عدم الرد',
      rejected_after_payment: 'رفض بعد الدفع',
      stale_calendar: 'تقويم غير محدَّث',
      inaccurate_listing: 'وصف غير مطابق',
      no_show: 'عدم استقبال',
    } as Record<string, string>,

    /*
      How far a violation has been TAKEN — `VIOLATION_STAGES`, forward only.

      «سُجّلت» and «صدر إنذار» are deliberately different words for different facts: recorded means
      it happened, warned means somebody TOLD the partner, and an appeal turns on the second. A
      screen that collapsed them would let an operator believe a partner had been warned when
      nobody had written to them.

      «رُفع إلى الإيقاف» rather than «موقوف»: the stage records that the violation reached the point
      of recommending suspension, which is not the same as the partner currently being suspended —
      that is `suspension` on the partner record, and it can be lifted while this stage stands.
    */
    violationStage: {
      recorded: 'سُجّلت',
      warned: 'صدر إنذار',
      fined: 'غرامة',
      suspension: 'رُفع إلى الإيقاف',
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
    /* Sent by RefundService on EVERY refund — the staff button and §6.4's sweep alike. */
    'booking.refunded': 'بدء الاسترداد',
    'wallet.compensation': 'تعويض المحفظة',
    'partner.deadline_reminder': 'تذكير الشريك بالمهلة',
    'ad.single_offer': 'عرض إعلاني (رسالة واحدة)',
    /*
      The three the platform actually SENDS, added 2026-08-20.

      The six above come from design handoff §8 and describe what is planned. The delivery log
      contains none of them: what `notify()` writes is these three, and all three were missing — so
      every row of سجل واتساب والبريد printed a raw `booking.needs_action`. The planned six are kept
      because the template INVENTORY on the same screen lists them.
    */
    'booking.needs_action': 'حجز بانتظار رد الشريك',
    'review.received': 'تقييم جديد على عقار',
    'review.replied': 'رد على تقييم',
    /*
      Found by the guard rather than by reading the code, which is the point of having it.

      `support.replied` appeared in the delivery log during a browser run the same afternoon the
      other three were added — one row, written by the support spec — and
      `audit-catalogue.integration.test.ts` failed on it. Four templates is now the complete set the
      platform sends, confirmed against every `templateKey` literal in the API.
    */
    'support.replied': 'رد على طلب دعم',
    /*
      The five enforcement notices (Bashar, 2026-08-24).

      Before that date only two of the five events told the partner ANYTHING — suspension and the
      fine waiver — while the console said «وأُبلغ الشريك» for a warning, a fine and a lift as well.
      Each of these is now sent on both channels, so each appears in سجل واتساب والبريد and needs a
      name here or the log prints the raw key.
    */
    'partner.warned': 'إنذار على الشريك',
    'partner.fined': 'غرامة على الشريك',
    'partner.suspended': 'تعليق حساب شريك',
    'partner.unsuspended': 'رفع تعليق حساب شريك',
    'partner.fine_waived': 'إلغاء غرامة عن شريك',
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
    /*
      The three NON-STAFF roles, added 2026-08-23 after a browser walk caught one of them.

      This map held only the four console roles, and `roleName` falls back to the raw key — which
      is right, because a missing translation must look like one. So the moment a `partner_employee`
      activated their account, سجل التدقيق printed «partner_employee» in Latin snake_case on an
      Arabic screen, and `navigation.spec.ts` failed exactly as it is meant to.

      `partner` and `customer` were missing for the same reason and had simply not been on a
      visible page yet: a partner uploading a signed contract writes an audit row too. The sweep
      only sees what is on screen, so the absent label survived until the right row was near the
      top. All three are here now rather than the one that happened to be caught.
    */
    partner: 'شريك',
    partner_employee: 'موظف شريك',
    customer: 'عميل',
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
