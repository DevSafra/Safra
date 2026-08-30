/**
 * لوحة الشريك — every word a partner reads, in Arabic.
 *
 * Structured and named like `messages/admin/ar.ts`, because the two are read the same way and a
 * second shape would be a second thing to learn. The copy itself is the design handoff's (§7),
 * verbatim where the handoff quotes it.
 *
 * Arabic only, like the console, and for the same reason: the partners this serves are in Syria
 * and the surrounding region. When a second language arrives it is one file plus one line in
 * `partner.ts`, and the compiler checks it key by key.
 */
export const ar = {
  /** The document title and the wordmark line. */
  /* A PIPE, never a dash — see the admin catalogue's `meta.title` for the reason. */
  brand: 'سفرة | لوحة الشريك',

  /** الدعم — a partner asking SAFRA for help (Bashar, 2026-08-12). */
  /**
   * العقود والمستندات — what SAFRA sent, and what SAFRA needs back (Bashar, 2026-08-19).
   *
   * Two halves of one obligation, on one screen, because they are the two things standing between
   * an accepted application and a verified account: read and sign the contract, send the documents.
   */
  /** `PARTNER_DOCUMENT_KINDS` in @safra/contracts, named for the person uploading them. */
  documentKinds: {
    identity: 'هوية أو جواز سفر',
    commercial_register: 'سجل تجاري',
    ownership_proof: 'إثبات ملكية',
    management_contract: 'عقد إدارة',
    /*
      «تأكيد مصرفي», matching the console (Bashar, 2026-08-21).

      The partner app said «تأكيد بنكي» and the reviewer's screen said «تأكيد مصرفي» — the same
      document under two names, which is a problem the moment a partner and a reviewer discuss it
      on الدعم. Neither is wrong; having both is.
    */
    bank_confirmation: 'تأكيد مصرفي',
  } as Record<string, string>,

  /** `partner_contract_kind` in the schema. */
  contractKinds: {
    base: 'عقد شراكة أساسي',
    commission_annex: 'ملحق تعديل عمولة',
    renewal: 'تجديد سنوي',
  } as Record<string, string>,

  /**
   * `verification_status`, as the PARTNER reads it about their own account.
   *
   * «موثّق» rather than the console's «معتمد»: a partner is being told their account is trusted,
   * not that a reviewer approved a form. Four values, four words — the same rule the console holds
   * itself to, checked there per vocabulary.
   */
  verificationStatus: {
    pending: 'قيد الانتظار',
    in_review: 'قيد المراجعة',
    approved: 'موثّق',
    rejected: 'مرفوض',
  } as Record<string, string>,

  /** `partner_contract_status`. «بانتظار توقيعك» names who has to act, which is the whole point. */
  contractStatus: {
    awaiting_partner_signature: 'بانتظار توقيعك',
    active: 'ساري',
    superseded: 'مُستبدل',
    terminated: 'منتهٍ',
  } as Record<string, string>,

  contracts: {
    title: 'العقود والمستندات',
    intro: 'هنا عقد الشراكة الذي أرسلته سفرة، والمستندات المطلوبة للتحقق من حسابك.',

    contractsTitle: 'عقود الشراكة',
    contractsEmpty: 'لم يصلك عقد بعد. يُرفع العقد بعد قبول طلب الشراكة.',
    contractKind: 'نوع العقد',
    contractUploaded: 'تاريخ الرفع',
    contractSigned: 'تاريخ التوقيع',
    contractExpires: 'ينتهي في',
    download: 'تنزيل العقد',
    /**
     * The download refused, said in the partner's own language on their own screen.
     *
     * Until 2026-08-25 this route answered `{"code":"contract.not_found"}` and the browser rendered
     * it: a partner clicking «تنزيل العقد» met a JSON document. An error CODE is the right thing for
     * the API to return and the wrong thing for a person to READ — the code exists so that a screen
     * can say this sentence.
     */
    downloadUnavailable:
      'تعذّر تنزيل العقد. حدِّث الصفحة وحاول مرة أخرى، أو راسل الدعم إن تكرر ذلك.',
    /*
      Names WHICH copy, because after 2026-08-21 it is not always the same document: before SAFRA
      signs there is nothing for the partner to fetch, and afterwards the link serves the copy
      carrying SAFRA's signature — which is the one they must add theirs to.
    */
    downloadSigned: 'تنزيل العقد الموقّع من سفرة',
    signHint:
      'وقّع النسخة وأعدها إلى فريق سفرة. يسجّل الفريق التوقيع فيصبح العقد ساريًا — لا يمكنك تسجيله من هنا.',

    /*
      ── Returning the signed contract (Bashar, 2026-08-21) ──────────────────────────────────
      Signing is on PAPER: electronic signatures are not accepted in Syria. So the partner's task
      is three physical verbs — download, sign, upload — and the copy says them in that order,
      because a partner reading this on a phone needs to know a printer is involved before they
      start.
    */
    signTitle: 'وقّع العقد وأعده',
    signSteps:
      'نزّل النسخة الموقّعة من سفرة، اطبعها ووقّعها بخط اليد، ثم ارفعها هنا لتعود إلى سفرة. يصبح العقد سارياً فور وصولها.',
    signUpload: 'ارفع النسخة الموقّعة',
    signUploading: 'جارٍ الإرسال…',
    signFile: 'النسخة الموقّعة (PDF)',
    signFailed: 'تعذّر رفع النسخة الموقّعة. تأكد أنها ملف PDF وحاول مرة أخرى.',
    signTooLarge: 'الملف أكبر من الحد المسموح (10 ميغابايت). اختر ملفاً أصغر.',
    signDone: 'وصلت نسختك الموقّعة، والعقد ساري المفعول.',

    /*
      ── سجل العقد (Bashar, 2026-08-23) ───────────────────────────────────────────────────────
      SAFRA can replace their signed copy on a contract that already exists. When they replace one
      the partner has SIGNED, that signature is superseded and the contract goes back to the
      partner's step — and until this, the partner saw none of it: the same card, quietly back to
      «بانتظار توقيعك».

      So the history says what happened, in the partner's own words: who sent what, when, and which
      copy is the one that counts now. «مُستبدلة» is the same word the status pill uses for a
      superseded contract, because it is the same idea and a second word for it would read as a
      second thing.
    */
    historyTitle: 'سجل العقد',
    historySafra: 'أرسلت سفرة نسخة موقّعة',
    historyPartner: 'أرسلتَ نسختك الموقّعة',
    historyCurrent: 'الحالية',
    historySuperseded: 'مُستبدلة',
    /*
      Shown only when the partner's OWN signature was superseded and it is their turn again — the
      one case where something they did was undone by somebody else. It says why the form is back
      rather than leaving them to conclude their upload failed.
    */
    historyReplaced:
      'أرسلت سفرة نسخة جديدة من العقد، لذلك لم يعد توقيعك السابق سارياً. نزّل النسخة الجديدة، وقّعها بخط اليد، ثم ارفعها من جديد.',
    signWaitingSafra:
      'بانتظار توقيع سفرة. سيصلك إشعار على بريدك حين يصبح جاهزاً لتوقيعك.',
    documentsTitle: 'مستندات التحقق',
    documentsIntro: 'ارفع المستندات التي يحتاجها فريق سفرة للتحقق من نشاطك.',
    documentsEmpty: 'لم ترفع أي مستند بعد.',
    documentStatus: 'الحالة',
    documentUploaded: 'تاريخ الرفع',
    documentNotes: 'ملاحظات المراجع',
    upload: 'إرسال المستندات',
    uploading: 'جارٍ الرفع…',
    file: 'الملف',
    uploadFailed: 'تعذّر رفع المستند. حاول مرة أخرى.',

    /*
      ── One field per document, all required (Bashar, 2026-08-21) ────────────────────────────
      «نوع المستند» is gone. It was a SELECT beside a single file input, so the partner had to
      know the list, pick from it, upload, and repeat — and nothing on the screen said how many
      times. A field per kind makes the list the form: what is asked for, what has arrived, and
      what is still missing are all one thing to read.
    */
    uploadAllIntro: 'كل المستندات التالية مطلوبة. اختر ملفًا لكل واحد ثم أرسلها معًا.',
    uploadRemaining: 'ما زال مطلوبًا: {n}',
    uploadAllSent: 'أرسلت كل المستندات المطلوبة.',
    /** Beside a kind whose document has already arrived, so the row is not an empty demand. */
    uploadDone: 'أُرسل',
    uploadReplace: 'إرسال بديل',
    /** A rejected document is the one case where a field reappears with something already in it. */
    uploadAgain: 'أعد الإرسال',
    /** Names the document that failed, because five uploads with one error message is a guess. */
    uploadFailedOne: 'تعذّر رفع «{kind}». حاول مرة أخرى.',
    loadFailed: 'تعذّر تحميل الصفحة.',

    /** What the reader is waiting for, said where they are waiting. */
    pendingTitle: 'حسابك قيد المراجعة',
    pendingBody:
      'يراجع فريق سفرة مستنداتك وعقدك. قبل التحقق يمكنك تجهيز بيانات عقاراتك — العنوان والوصف — ولا يمكنك إضافة الوحدات أو الأسعار أو التواريخ أو الصور.',
    verifiedTitle: 'تم التحقق من حسابك',
    verifiedBody: 'يمكنك الآن ضبط الأسعار والتواريخ ورفع الصور.',
    rejectedTitle: 'لم يكتمل التحقق',
    rejectedBody: 'تواصل مع فريق سفرة من صفحة الدعم لمعرفة ما ينقص.',

    /*
      ── The onboarding screen (Bashar, 2026-08-21) ──────────────────────────────────────────
      Until verification this page IS the portal, so it has to carry the whole story: what is
      needed, what has arrived, what is being waited on, and what happens next. The three step
      labels are a progress line, not decoration — a partner who cannot see where they are in a
      process assumes it has stalled, and asks الدعم.
    */
    onboardingTitle: 'إكمال حسابك',
    /*
      The FORM's heading, distinct from «مستندات التحقق» over the list below it. Both said the
      same words at first, which put one heading twice on one screen — a reader scanning for the
      list finds the form, and neither heading tells them which is which.
    */
    uploadTitle: 'إرسال مستند',
    onboardingLead:
      'خطوة واحدة تفصلك عن استخدام لوحة الشريك: أرسل مستنداتك ووقّع العقد. تظهر بقية اللوحة بعد أن يعتمدها فريق سفرة.',

    stepUpload: 'إرسال المستندات',
    stepReview: 'مراجعة سفرة',
    stepReady: 'لوحة الشريك',

    /** Stage one: nothing has arrived yet. */
    stageEmptyTitle: 'ابدأ بإرسال مستنداتك',
    stageEmptyBody:
      'أرسل المستندات الخمسة المطلوبة أدناه. تبدأ المراجعة بعد وصولها كلها، ويُراجَع كل مستند على حدة.',

    /*
      Stage between one and two, since all five documents became required (Bashar, 2026-08-21).

      Without it a partner who had sent two of five was shown «وصلت مستنداتك · لا حاجة لأي إجراء
      منك الآن» — false, and false in the direction that stops them. The panel is the "what to do
      now" line on this page, so it has to distinguish a set that is complete from one that is not.
    */
    stagePartialTitle: 'بقيت مستندات',
    stagePartialBody:
      'أرسل ما تبقّى من المستندات المطلوبة. تبدأ المراجعة بعد وصولها كلها.',

    /** Stage two: everything sent, nothing decided. */
    stageWaitingTitle: 'وصلت مستنداتك',
    stageWaitingBody:
      'لا حاجة لأي إجراء منك الآن. يراجع فريق سفرة ما أرسلته ويصلك إشعار بالنتيجة على بريدك.',

    /** Stage three: at least one document came back rejected. */
    stageFixTitle: 'مستند يحتاج إعادة إرسال',
    stageFixBody:
      'راجع الملاحظة تحت كل مستند مرفوض وأرسل بديلاً عنه. البقية لا تحتاج إعادة إرسال.',

    /** Stage four: done. */
    stageDoneTitle: 'اكتمل التحقق',
    stageDoneBody: 'حسابك جاهز. لوحة الشريك متاحة الآن بكل أقسامها.',

    /** What SAFRA asks for, listed where it is asked for rather than in an email. */
    neededTitle: 'ما نحتاجه منك',
    /*
      Five lines, matching the five fields exactly — and unconditional, because the form is.

      They used to read «سجل تجاري … إن وجد» and «سند ملكية أو عقد إدارة», describing a
      conditional set while the form beside them demands all five. A page that asks for more than
      it says it needs is read as a mistake, and the partner stops at الدعم to ask which is true.
      See the note in `document-upload.tsx` on what that conditionality would cost to restore.
    */
    neededIdentity: 'هوية أو جواز سفر للشخص الموقّع.',
    neededRegister: 'سجل تجاري للكيان القانوني.',
    neededOwnership: 'سند ملكية يثبت حق التأجير.',
    neededManagement: 'عقد إدارة الإقامة.',
    neededBank: 'تأكيد مصرفي بحساب التحويلات.',
    neededNote: 'صور واضحة أو ملفات PDF. الحد الأقصى {max} ميغابايت للملف.',

    /** The counter above the list — a number a person can check against what they sent. */
    /*
      Counted in KINDS, not rows. `partner_documents` is append-only, so a replaced rejection
      leaves its old row behind — a line counting rows says «1 يحتاج إعادة إرسال» about a document
      that was replaced and approved days ago (Bashar, 2026-08-21).
    */
    countSent:
      'أرسلت {sent} من {total} مستندات · {approved} معتمد · {rejected} يحتاج إعادة إرسال',
    lockedNote: 'تظهر بقية أقسام اللوحة بعد اعتماد حسابك.',
  },

  support: {
    title: 'الدعم',
    intro: 'اطرح مشكلتك وسيتابعها فريق سفرة معك هنا.',
    openTitle: 'طلب دعم جديد',
    bodyLabel: 'اشرح المشكلة',
    bodyHint: 'عشرة أحرف على الأقل. لا تكتب رقم هاتف أو بريداً — تُحجب تلقائياً ولن تصل.',
    submit: 'إرسال الطلب',
    submitting: 'جارٍ الإرسال…',
    failed: 'تعذّر إرسال الطلب الآن. يرجى المحاولة مرة أخرى.',
    mineTitle: 'طلباتي',
    none: 'لا توجد طلبات دعم بعد.',
    openLabel: 'مفتوح',
    closedLabel: 'مغلق',
    messages: 'الرسائل: {count}',
    replyLabel: 'ردّك',
    replySubmit: 'إرسال',
    closedNote: 'هذا الطلب مغلق. افتح طلباً جديداً إذا احتجت المساعدة مرة أخرى.',
    redacted: 'حُجبت {count} من بيانات الاتصال في هذه الرسالة.',
    senderPartner: 'أنت',
    senderStaff: 'فريق سفرة',
    senderSystem: 'النظام',
    back: 'رجوع',
    closeLabel: 'لم أعد بحاجة إلى المساعدة',
    closeHint: 'سيُغلق هذا الطلب. يمكنك فتح طلب جديد في أي وقت.',
    closeSubmitting: 'جارٍ الإغلاق…',
    closeFailed: 'تعذّر إغلاق الطلب. يرجى المحاولة مرة أخرى.',
  },

  /**
   * The 404. Next's English default rendered here until 2026-08-20 — see the console's own
   * `notFound` for the report and why a wrong reference is ordinary rather than exceptional.
   *
   * A partner reaching this has usually followed a link to a listing that was archived, or a payout
   * reference from an old email.
   */
  /** See the console's `errorPage` — same reasoning, same restraint about the detail. */
  errorPage: {
    title: 'حدث خطأ غير متوقع',
    body: 'تعذّر إتمام هذا الطلب. قد تكون المشكلة مؤقتة — أعد المحاولة، وإن تكررت تواصل مع الدعم بالرقم أدناه.',
    retry: 'إعادة المحاولة',
    home: 'العودة إلى لوحة التحكم',
  },

  notFound: {
    title: 'هذه الصفحة غير موجودة',
    body: 'قد يكون الرابط قديماً، أو أن العقار أو المستند لم يعد متاحاً. ابدأ من لوحة التحكم.',
    home: 'العودة إلى لوحة التحكم',
  },

  nav: {
    heading: 'لوحة الشريك',
    dashboard: 'لوحة التحكم',
    properties: 'عقاراتي',
    calendars: 'التقويمات',
    reviews: 'التقييمات',
    payouts: 'مستحقاتي',
    contracts: 'العقود والمستندات',
    arrivals: 'الوصول اليوم',
    violations: 'المخالفات',
    employees: 'الموظفون',
    employeeRoles: 'أدوار الموظفين',
    supportPage: 'الدعم',
    showSidebar: 'إظهار قائمة التنقل',
    hideSidebar: 'إخفاء قائمة التنقل',
    signOut: 'تسجيل الخروج',
    /**
     * The theme toggle names the DESTINATION, not the current state.
     *
     * «الوضع الداكن» while dark is active is ambiguous read aloud — it could be reporting a state
     * or offering an action. These say which way the button goes. Worded identically to the
     * console's, because a partner and a staff member pressing the same control should hear the
     * same sentence.
     */
    themeToLight: 'التبديل إلى الوضع الفاتح',
    themeToDark: 'التبديل إلى الوضع الداكن',
  },

  login: {
    title: 'لوحة الشريك',
    subtitle: 'الدخول مخصص لشركاء سفرة.',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    /* The eye toggle's accessible names. `PasswordField` requires them rather than defaulting,
       so a default that is wrong in two of three languages cannot slip through. */
    showPassword: 'إظهار كلمة المرور',
    hidePassword: 'إخفاء كلمة المرور',
    submit: 'تسجيل الدخول',
    signingIn: 'جارٍ الدخول…',
    /**
     * One message for a wrong email and a wrong password alike.
     *
     * Telling somebody which half was wrong turns the form into an account-existence oracle:
     * a different answer for a real address is how a list of partners gets enumerated.
     */
    failed: 'بيانات الدخول غير صحيحة.',
    notAPartner: 'هذا الحساب ليس حساب شريك.',
    unreachable: 'تعذّر الوصول إلى الخادم. حاول مرة أخرى.',

    /**
     * The second step, for a partner who has already enrolled.
     *
     * `codeLabel` covers both kinds of secret on purpose. Six digits is an authenticator code and
     * anything else is a recovery code; asking somebody which one they are holding is a question
     * they should not have to answer while locked out.
     */
    codeTitle: 'رمز التحقق',
    /*
      Whose account is being signed into, shown above the code field.

      The same sentence the console uses, because the two sign-in screens are one design (Bashar,
      2026-08-13): after the password is accepted the page shows only a code box, and without this the
      person cannot tell whether it accepted the address they meant to type.
    */
    signingInAs: 'تسجيل الدخول باسم',
    codeLabel: 'رمز المُصادِق المكوَّن من 6 أرقام، أو أحد رموز الاسترداد.',
    codeSubmit: 'تأكيد',
    codeChecking: 'جارٍ التحقق…',
    codeBack: 'رجوع',

    /*
      Step two when the code came by EMAIL — the ordinary case since 2026-08-20 (Bashar).

      Its own wording because the reader has to be sent to the right place. «افتح تطبيق المصادقة»
      to somebody whose code is sitting in their inbox is a person searching their phone for an app
      they never installed.
    */
    codeTitleEmail: 'رمز الدخول',
    codeLabelEmail: 'أرسلنا رمزًا من 6 أرقام إلى بريدك الإلكتروني. ينتهي خلال 10 دقائق.',
    codeResend: 'إعادة إرسال الرمز',
    codeResending: 'جارٍ الإرسال…',
    codeResent: 'أرسلنا رمزًا جديدًا. تحقّق من بريدك.',
    codeResendFailed: 'تعذّر إرسال رمز جديد. حاول بعد قليل.',

    codeFailed: 'الرمز غير مقبول. تحقّق من تطبيق المُصادِق وحاول مرة أخرى.',

    /**
     * A locked account and a throttled one are NOT «بيانات الدخول غير صحيحة».
     *
     * Telling somebody their password is wrong when the real answer is "too many attempts" sends
     * them to try again, which spends another attempt and locks the account faster. Both messages
     * name the wait, because a person who knows to come back in a quarter of an hour stops
     * hammering the form.
     */
    locked: 'أُقفل الحساب مؤقتًا بعد عدة محاولات فاشلة. حاول بعد 15 دقيقة.',
    tooMany: 'محاولات كثيرة خلال وقت قصير. انتظر دقيقة ثم حاول مرة أخرى.',
    codeFormat:
      'صيغة الرمز غير صحيحة. أدخل 6 أرقام أو رمز استرداد بالشكل XXXX-XXXX-XXXX.',
  },

  /**
   * «أنشئ حساب الشريك» — the page the invitation email links to (Bashar, 2026-08-20).
   *
   * It did not exist until then. The mail had always pointed at `/invitation/{token}`, the route
   * was never built, and the partner portal answered it with a redirect to a sign-in they could not
   * pass — their account is still a customer account until this page is submitted. So an accepted
   * partner had nowhere to go, and the joining process could not be completed by anybody.
   */
  invitation: {
    title: 'أنشئ حساب الشريك',
    intro: 'قُبل طلب الشراكة. اختر كلمة مرور لحسابك لتتمكّن من الدخول إلى لوحة الشريك.',
    password: 'كلمة المرور',
    confirm: 'تأكيد كلمة المرور',
    submit: 'إنشاء الحساب',
    submitting: 'جارٍ الإنشاء…',
    mismatch: 'كلمتا المرور غير متطابقتين.',
    weak: 'كلمة المرور لا تحقّق الشروط أعلاه.',
    /* The token is single-use and time-limited, so this is an ordinary outcome, not a fault. */
    invalidLink:
      'هذا الرابط غير صالح أو انتهت صلاحيته. اطلب من فريق سفرة إعادة إرسال الدعوة.',
    failed: 'تعذّر إنشاء الحساب. حاول مرة أخرى.',
    done: 'تم إنشاء الحساب. سجّل الدخول للمتابعة.',
    signIn: 'الذهاب إلى تسجيل الدخول',
    /* One line per rule of `passwordSchema`, shown live by the strength meter. */
    ruleLength: '12 حرفًا على الأقل',
    ruleUppercase: 'حرف كبير واحد على الأقل',
    ruleLowercase: 'حرف صغير واحد على الأقل',
    ruleDigit: 'رقم واحد على الأقل',
    ruleSymbol: 'رمز واحد على الأقل',
    strengthLabel: 'قوة كلمة المرور',
    /* What happens next, so nobody waits for an email that is not coming. */
    afterNote:
      'بعد الدخول نرسل لك رمزًا من 6 أرقام على بريدك في كل مرة تسجّل فيها الدخول. لا حاجة لتطبيق مصادقة.',
  },

  /**
   * المصادقة الثنائية — mandatory for every partner (Bashar, 2026-08-07).
   *
   * The copy leads with WHY rather than with the instruction, because a partner meeting this
   * screen did not ask for it: they tried to open their dashboard and were sent here instead.
   * A screen that only says "enter a code" reads as a fault in the product.
   */
  twoFactor: {
    title: 'تفعيل المصادقة الثنائية',
    why: 'حسابك يتحكّم بإعلاناتك وأسعارك وتقويم إشغالك، ويعرض مستحقاتك المالية. لذلك المصادقة الثنائية إلزامية لكل الشركاء — ولا يمكن استخدام لوحة الشريك قبل تفعيلها.',
    step1:
      'افتح تطبيق مُصادِق (Google Authenticator أو Microsoft Authenticator أو ما شابه).',
    step2: 'أضف حسابًا جديدًا يدويًا وألصق المفتاح أدناه.',
    step3: 'أدخل الرمز المكوَّن من 6 أرقام الذي يعرضه التطبيق.',
    setupKey: 'مفتاح الإعداد',
    loading: 'جارٍ التحميل…',
    sixDigitCode: 'الرمز المكوَّن من 6 أرقام',
    submit: 'تفعيل المصادقة الثنائية',
    checking: 'جارٍ التحقق…',
    enabled: 'تم تفعيل المصادقة الثنائية على حسابك.',
    saveRecoveryCodes: 'احفظ رموز الاسترداد هذه الآن.',
    /* Stated plainly because it is true and irreversible: the API stores only Argon2id hashes. */
    recoveryCodesNote:
      'تُعرض مرة واحدة فقط ولا يمكن استرجاعها. كل رمز يصلح لمرة واحدة، ويُغنيك عن تطبيق المُصادِق إذا فقدت هاتفك. إذا فقدتها جميعًا فطريق العودة الوحيد هو مراسلة سفرة لإعادة التعيين.',
    savedContinue: 'حفظتها — متابعة',
    startFailed: 'تعذّر بدء التفعيل. أعد تحميل الصفحة للمحاولة مرة أخرى.',
    codeRejected: 'الرمز غير مقبول. تحقّق من تطبيق المُصادِق وحاول مرة أخرى.',
    failed: 'حدث خطأ. حاول مرة أخرى.',
    unreachable: 'تعذّر الوصول إلى الخادم.',
    signOut: 'تسجيل الخروج',
  },

  dashboard: {
    title: 'لوحة التحكم',
    loadFailed: 'تعذّر تحميل البيانات.',
    sessionExpired: 'انتهت الجلسة. سجّل الدخول مرة أخرى.',

    /**
     * The four §7.1 KPI cards.
     *
     * `noData` is «—» and not «0». A partner with no units has not achieved zero occupancy, they
     * have no occupancy — and a confident zero on a card about somebody's business reads as a
     * verdict. The API returns null for exactly these cases; this is what null looks like.
     */
    kpiEarnings: 'أرباح هذا الشهر (بعد العمولة)',
    kpiEarningsUp: '↑ {percent}٪ عن الشهر الماضي',
    kpiEarningsDown: '↓ {percent}٪ عن الشهر الماضي',
    kpiEarningsFlat: 'كالشهر الماضي',
    kpiEarningsNoCompare: 'لا مقارنة — لا حجوزات الشهر الماضي',
    kpiBookings: 'حجوزات مؤكدة نشطة',

    /* ── The المخالفات card (Bashar, 2026-08-24) ─────────────────────────── */
    /*
      A card rather than a line in the alerts list, because a count is a different kind of fact
      from a bullet: the list is `LIMIT 5` and says nothing about a sixth, and a partner with nine
      open violations was reading five and drawing the wrong conclusion.
    */
    /* ── الإشعارات: what SAFRA has told this partner (Bashar, 2026-08-24) ── */
    noticesTitle: 'إشعارات حسابك',
    noticesEmpty: 'لا إشعارات على حسابك.',
    /*
      One sentence per event, and each is a LINK to the page that holds the detail.

      The notice says what happened and when; it does not restate the reason. That lives on the
      record — مخالفات shows the description, the نص الإنذار, the غرامة and قرار الإلغاء — and a
      second copy here would be free to drift from the one an appeal is decided on.
    */
    notice: {
      'partner.warned': 'صدر إنذار على حسابك',
      'partner.fined': 'فُرضت غرامة على حسابك',
      'partner.suspended': 'عُلّق حساب الشراكة مؤقتاً',
      'partner.unsuspended': 'رُفع التعليق عن حسابك',
      'partner.fine_waived': 'أُلغيت غرامة على حسابك',
    } as Record<string, string>,
    noticeDetail: 'التفاصيل',

    kpiViolations: 'مخالفات مفتوحة',
    /* «لا مخالفات» and not «٠» — the same distinction the earnings card makes with «—». */
    kpiViolationsNone: 'لا مخالفات مفتوحة',
    kpiViolationsSub: 'اضغط لعرض التفاصيل',
    /* The furthest rung reached, so the card says what KIND of attention this needs. */
    kpiViolationsStage: 'أبعد مرحلة: {stage}',
    kpiBookingsArriving: '{n} وصول هذا الأسبوع',
    kpiBookingsNoneArriving: 'لا وصول هذا الأسبوع',
    kpiOccupancy: 'نسبة الإشغال',
    kpiOccupancyDetail: '{booked} من {available} ليلة',
    kpiResponse: 'متوسط سرعة الرد',
    kpiResponseMinutes: '{n} دقيقة',
    kpiResponseSample: 'عن {n} حجزًا خلال 90 يومًا',
    noData: '—',
    noDataYet: 'لا بيانات بعد',

    /** طلبات حجز بانتظار ردك — the queue with the clock and the fine attached. */
    requestsTitle: 'طلبات حجز بانتظار ردك',
    requestsRule: 'مهلة ساعتين — الغرامة 10$ عند عدم الرد',
    requestsEmpty: 'لا طلبات بانتظار ردك.',
    requestsNights: '{n} ليلة',
    requestsGuests: '{n} ضيف',
    requestsLeft: 'متبقٍ {time}',
    requestsOverdue: 'انتهت المهلة',
    requestsNoDeadline: 'بلا مهلة مسجّلة',
    accept: 'قبول',
    reject: 'رفض',
    rejectReason: 'سبب الرفض — يُرسل إلى سفرة ويُبلَّغ به الضيف.',
    rejectConfirm: 'تأكيد الرفض',
    cancel: 'إلغاء',
    working: 'جارٍ التنفيذ…',
    decisionFailed: 'تعذّر تسجيل القرار.',
    unreachable: 'تعذّر الوصول إلى الخادم.',
    /** The handoff's footnote, verbatim. */
    requestsNote: 'لا تظهر لك أي بيانات دفع للعميل. التواصل مع الضيف يتم عبر سفرة فقط.',

    /** التقويم — one unit, this month. */
    calendarTitle: 'تقويم {month} — كل وحداتك',
    calendarDefaultPrice: '{count} وحدة · تبدأ من {price}',
    /* One square per day, describing the portfolio rather than a single room. */
    calendarDayDetail: '{date} · محجوز {booked} · مغلق {blocked} · متاح {available}',
    /*
      A discoverability line, not decoration. The squares became LINKS so a partner can act on a day,
      and a link that looks exactly like the read-only square it replaced is a feature nobody finds.
      One sentence is cheaper than teaching it.
    */
    calendarClickHint: 'اضغط أي يوم لإدارة إتاحة الوحدات فيه.',
    legendPortfolioFree: 'كل الوحدات متاحة',
    legendPortfolioSome: 'متاح جزئيًا',
    legendPortfolioFull: 'لا شيء متاح',
    calendarNoUnits: 'لا وحدات بعد، فلا تقويم لعرضه.',
    /** The handoff's reminder, verbatim. */
    calendarReminder:
      'تذكير: أجّرت الوحدة خارج سفرة؟ أغلق التاريخ فوراً. عدم تحديث التقويم يخفّض تقييمك الداخلي.',

    /** المخالفات والتنبيهات. */
    alertsTitle: 'المخالفات والتنبيهات',
    alertsEmpty: 'لا مخالفات ولا تنبيهات.',
    /*
      «سُجّلت», not «خُصمت».

      The handoff's line reads "غرامة 10$ خُصمت من المستحقات", and that is the intended behaviour —
      but nothing deducts it yet: `partner_violations` records the fine and `partner_payouts.
      fine_amount` is still zero on every payout. Saying "deducted" would tell a partner their
      transfer is smaller than it is, and they would reconcile against a figure that never moved.
      The wording goes back to the handoff's the moment the deduction is wired (see O-partner-2).
    */
    alertFine: 'غرامة {amount} مسجَّلة',
    alertOnBooking: 'على الحجز {reference}',

    /**
     * The payout line — and the reason there are two of them.
     *
     * «مجدول» is a transfer with a date. «قيد التجميع» is an open accrual period. Both are real
     * rows in `partner_payouts`; neither is a sum of what bookings owe. Two separate strings
     * because one string with a variable status is exactly how an accrual comes to be described
     * as a scheduled transfer.
     */
    payoutScheduled: 'تحويل مستحقات {amount} مجدول يوم {date}',
    payoutAccruing: 'مستحقات قيد التجميع: {amount} — لم يُجدوَل تحويلها بعد',
    payoutNone: 'لا تحويلات مجدولة حاليًا.',
  },

  /** Violation kinds, keyed on the `violation_kind` enum. */
  violationKind: {
    no_response: 'تأخر الرد على طلب حجز',
    rejected_after_payment: 'رفض الحجز بعد الدفع',
    stale_calendar: 'تقويم غير محدَّث',
    inaccurate_listing: 'بيانات إعلان غير دقيقة',
    no_show: 'عدم استقبال الضيف',
  } as Record<string, string>,

  /**
   * Month names for the calendar heading.
   *
   * Written out rather than taken from `Intl`, and this is a deliberate exception to the project
   * rule that says use `Intl` for months: `Intl` with an `ar` locale returns the Gregorian months
   * under their Levantine OR their Egyptian names depending on the runtime's data, and the handoff
   * uses the Levantine set («آب», not «أغسطس»). A partner reading «أغسطس» on one machine and
   * «آب» on another would reasonably think they were different products.
   */
  months: [
    'كانون الثاني',
    'شباط',
    'آذار',
    'نيسان',
    'أيار',
    'حزيران',
    'تموز',
    'آب',
    'أيلول',
    'تشرين الأول',
    'تشرين الثاني',
    'كانون الأول',
  ],

  /**
   * تعديل العقار — the edit form, and the honest screen when there is nothing to edit.
   *
   * A published listing CANNOT be structurally edited: SAFRA verified the address, the
   * photographs and the documents against each other (§8.1), and letting the address change
   * afterwards would leave the «موثّق» badge standing over a claim nobody checked. The screen says
   * that, and names what IS editable, rather than showing a form whose submit is refused.
   */
  editProperty: {
    title: 'تعديل العقار',
    back: 'رجوع إلى العقارات',
    section: 'بيانات العقار',
    /* Why the form is not shown, and what to do instead. */
    lockedTitle: 'هذا العقار منشور، ولا يمكن تعديل بياناته الأساسية',
    lockedWhy:
      'راجعت سفرة العنوان والوثائق والصور معًا قبل النشر. تغيير العنوان أو المدينة بعد ذلك يُبطل تلك المراجعة بينما تبقى علامة التوثيق ظاهرة.',
    lockedWhatYouCan:
      'ما زال بإمكانك تعديل الأسعار والإتاحة من التقويم، وإدارة الصور، في أي وقت.',
    lockedContact: 'لتغيير العنوان أو المدينة، راسل سفرة من صفحة الرسائل.',
    goCalendar: 'فتح التقويم',
    goImages: 'إدارة الصور',
    rejectedTitle: 'سبب رفض العقار',
    /* Fields. Arabic is required; the other two are optional and labelled as such. */
    nameAr: 'اسم العقار بالعربية',
    nameEn: 'الاسم بالإنجليزية (اختياري)',
    nameDe: 'الاسم بالألمانية (اختياري)',
    descriptionAr: 'الوصف بالعربية',
    descriptionEn: 'الوصف بالإنجليزية (اختياري)',
    descriptionDe: 'الوصف بالألمانية (اختياري)',
    address: 'العنوان',
    city: 'المدينة',
    type: 'النوع',
    policy: 'سياسة الإلغاء',
    latitude: 'خط العرض (اختياري)',
    longitude: 'خط الطول (اختياري)',
    coordinatesHint: 'بالدرجات العشرية، مثل 33.5138',
    save: 'حفظ التعديلات',
    saving: 'جارٍ الحفظ…',
    saved: 'حُفظت التعديلات.',
    failed: 'تعذّر حفظ التعديلات. راجع الحقول وحاول مرة أخرى.',
    unreachable: 'تعذّر الوصول إلى الخادم.',
    units: 'الوحدات',
    unitsEmpty: 'لا وحدات بعد.',
    unitGuests: '{n} ضيف',
    unitInactive: 'موقوفة',
    openUnitCalendar: 'تقويم هذه الوحدة',
    /* The unit editor. Every unit on one screen, each saved on its own. */
    unitName: 'اسم الوحدة',
    unitLabel: 'رقم الوحدة',
    unitGuestsField: 'عدد الضيوف',
    unitBedrooms: 'غرف النوم',
    unitBeds: 'الأسرّة',
    unitBathrooms: 'الحمّامات',
    unitPrice: 'السعر الأساسي لليلة',
    unitMinNights: 'أقل عدد ليالٍ',
    unitMaxNights: 'أكثر عدد ليالٍ (اختياري)',
    unitActive: 'معروضة للحجز',
    unitInactiveNote:
      'الوحدة الموقوفة تختفي من البحث ولا تُحجز، وتبقى حجوزاتها القائمة كما هي. لإغلاق تواريخ محددة استخدم التقويم بدل إيقاف الوحدة.',
    unitSave: 'حفظ الوحدة',
    unitSaving: 'جارٍ الحفظ…',
    unitSaved: 'حُفظت الوحدة.',
    unitFailed: 'تعذّر حفظ الوحدة. راجع الحقول وحاول مرة أخرى.',
    unitsNote:
      'الأسعار والإتاحة تبقى قابلة للتعديل في كل الحالات، حتى بعد نشر العقار — فهي مسؤوليتك المستمرة (P-006).',
  },

  /**
   * تقويم الإتاحة — one unit's month, and the range editor that changes it.
   *
   * ## «محجوز» is not in the editor
   *
   * A partner may set «متاح», «مغلق» or «صيانة». `booked` is DERIVED from real bookings, and a
   * partner able to write it by hand could mark a unit booked with no booking behind it — hiding
   * inventory from سفرة while appearing compliant (§8.4). To take dates off sale they close them,
   * which is what the endpoint accepts and what this form offers.
   */
  unitCalendar: {
    title: 'تقويم الإتاحة',
    back: 'رجوع إلى العقارات',
    unit: 'الوحدة',
    noUnits: 'لا وحدات في هذا العقار بعد، فلا تقويم لعرضه.',
    month: 'الشهر',
    previousMonth: 'الشهر السابق',
    nextMonth: 'الشهر التالي',
    legend: 'الدليل',
    perNight: '/ ليلة',
    basePrice: 'السعر الأساسي',
    minNightsShort: 'أقل مدة',
    /* The range editor. */
    editorTitle: 'تعديل مدة',
    from: 'من تاريخ',
    to: 'إلى تاريخ',
    status: 'الحالة',
    statusUnchanged: 'دون تغيير',
    price: 'سعر الليلة',
    priceUnchanged: 'دون تغيير',
    priceClear: 'العودة إلى السعر الأساسي',
    minNights: 'أقل عدد ليالٍ',
    note: 'ملاحظة (لك وحدك)',
    apply: 'تطبيق على المدة',
    applying: 'جارٍ التطبيق…',
    applied: 'طُبِّق التغيير على المدة المحددة.',
    failed: 'تعذّر تطبيق التغيير. راجع التواريخ وحاول مرة أخرى.',
    unreachable: 'تعذّر الوصول إلى الخادم.',
    bookedWarning:
      'الليالي المحجوزة لا تتغير. الحجز واقعٌ قائم، والتقويم لا يلغيه — ألغِ الحجز نفسه إن لزم.',
    noteHint: 'لا تظهر الملاحظة للضيوف.',
  },

  /**
   * التقويمات — every unit's month on one screen, grouped by property (Bashar, 2026-08-10).
   *
   * The editor's own labels are NOT repeated here: this screen renders the same range editor as
   * تقويم الإتاحة, so it reads `unitCalendar` for every field. Two copies of «تطبيق على المدة» would
   * drift the first time somebody reworded one of them.
   */
  calendars: {
    title: 'التقويمات',
    intro: 'كل وحدة وتقويمها. أغلق التواريخ التي لم تعد متاحة، أو غيّر سعر ليلة.',
    /** `{month}` is a month name and `{year}` a year — never joined in code, see docs/i18n.md. */
    monthOf: '{month} {year}',
    noProperties: 'لا عقارات بعد، فلا تقويم لعرضه.',
    noUnits: 'لا وحدات في هذا العقار بعد.',
    /* An off-sale unit is listed rather than hidden, so it needs to say why it is greyed. */
    inactive: 'موقوفة عن البيع',
    loadMore: 'عرض عقارات أخرى',
    /*
      A cursor only moves forward, so without this the reader who pressed «عرض عقارات أخرى» has no way
      back except the browser's own button — and the month arrows carry the cursor with them, so they
      do not escape it either.
    */
    firstPage: 'العودة إلى أول العقارات',
    /** The `<caption>` every month grid needs — «تقويم {unit} لشهر {month}». */
    gridCaption: 'تقويم {unit} لشهر {month}',
    today: 'اليوم',
    unitCount: 'وحدة',
    /* «بحث برقم الوحدة» — the search runs in SQL over the whole portfolio, not over this page. */
    searchLabel: 'ابحث برقم الوحدة',
    searchPlaceholder: 'مثل 101',
    searchAction: 'بحث',
    searchClear: 'إزالة البحث',
    /** Shown INSTEAD of the list when a search matched nothing — never an empty page. */
    searchNothing: 'لا توجد وحدة رقمها «{query}».',
    searchSummary: 'الوحدات التي رقمها يطابق «{query}»',
    /* The range editor is folded away per unit: the calendar is what a partner came to read. */
    editRange: 'تعديل مدة',
    /* A property is a folder here, so it says how much is inside before it is opened. */
    unitsInside: '{n} وحدة',
  },

  properties: {
    /** The handoff's §7.2 header, verbatim. */
    title: 'عروضي المنشورة على سفرة',
    note: 'التعديلات تمر بمراجعة سفرة قبل النشر',
    count: '{n} عقار',
    empty: 'لا عقارات بعد.',
    perNight: '/ ليلة',
    units: '{n} وحدة',
    reviews: 'من {n} تقييماً',
    /** Shown where a listing has no photo yet, in place of the 140px image. */
    noPhoto: 'لا صورة بعد',
    from: 'من',
    edit: 'تعديل',
    calendar: 'التقويم',

    /** The §7.2 add-property form, with the handoff's own labels and note. */
    addOpen: '+ إضافة عقار',
    addClose: '× إغلاق النموذج',
    fName: 'اسم العقار',
    fType: 'النوع',
    fCity: 'المدينة',
    fPrice: 'السعر لليلة ($)',
    fUnits: 'عدد الوحدات',
    fGuests: 'عدد الضيوف لكل وحدة',
    fPolicy: 'سياسة الإلغاء',
    roomNumberBadge: 'وحدة',
    fRoomNumber: 'رقم الغرفة/الوحدة',
    fRoomNumberHint: 'اختياري — مثل 101 أو A-12',
    fAddress: 'العنوان',
    fDescription: 'الوصف',
    attributesLabel:
      'صفات الرحلة — نفس صفات صفحة الإقامات؛ اختر حتى 4 لتظهر للزوار وتُستخدم في الفلترة',
    attributesTooMany: 'اخترت أكثر من 4 صفات. أزل واحدة قبل الإرسال.',
    /*
      The CITY's categories, which SAFRA sets and a partner reads. Named on the card so the two
      chip rows cannot be mistaken for one another: the gold chips are the partner's own choice
      from a fixed list, these grey ones are the destination's classification.
    */
    cityCategoriesLabel: 'فئة الوجهة',
    cityCategoriesNote:
      'تحدّدها سفرة للمدينة وتظهر للزوار — لا يمكن تعديلها من هنا، وصفات الرحلة تُختار من القائمة الموحّدة أعلاه.',
    submit: 'إرسال للمراجعة',
    submitting: 'جارٍ الإرسال…',
    cancelForm: 'إلغاء',
    /** P-002, quoted by the handoff. */
    reviewNote: 'تراجعه سفرة خلال 48 ساعة (P-002) قبل ظهوره للزوار.',
    created: 'أُرسل العقار للمراجعة. يظهر أدناه كمسودة حتى تعتمده سفرة.',
    createFailed: 'تعذّر إنشاء العقار. راجع الحقول وحاول مرة أخرى.',

    /*
      Said where the fields would have been, not on a page the reader has to go and find.

      Before verification the price, the unit count and the guest count are not shown at all —
      they are what step 7 holds back — so without a sentence in their place the form simply
      looks incomplete, and «حسابك قيد المراجعة» is on a different screen.
    */
    unitsAfterVerification:
      'يمكنك إضافة الوحدات والأسعار بعد التحقق من حسابك. أنشئ العقار الآن بعنوانه ووصفه.',
    unreachable: 'تعذّر الوصول إلى الخادم.',
    /*
      The three image slots §7.2 draws are absent, and the note says why rather than showing
      dead boxes: an image is uploaded against a property that already exists.
    */
    imagesLater:
      'تُضاف الصور بعد إنشاء العقار، من شاشة الصور. لا يمكن رفع صورة لعقار لم يُنشأ بعد.',
    manageImages: 'الصور',
  },

  /**
   * صور العقار — the media manager (§5.6 gallery, §7.2).
   *
   * The copy is explicit that nothing is ever deleted: an image is ARCHIVED, and the reason is
   * that a photograph is evidence of what a listing claimed on the day somebody booked it. A
   * dispute about "the room looked nothing like the photo" is unanswerable if the photo is gone.
   */
  /* The one image previewer's words — see the console's `slider` block and the project rule. */
  /*
    The system's popup — «تأكيد» / «إلغاء» (Bashar, 2026-08-30).

    Section-neutral, because the popup is: five surfaces asked the same question through the
    BROWSER's `confirm()`, which shows the origin and answers in English. The words belong to a
    catalogue for the same reason every other word does; a default inside `@safra/ui` would be
    invisible to the task of adding a language.
  */
  dialog: {
    confirm: 'تأكيد',
    cancel: 'إلغاء',
    close: 'حسناً',
  },

  slider: {
    title: 'معاينة الصور',
    open: 'معاينة الصورة',
    previous: 'الصورة السابقة',
    next: 'الصورة التالية',
    close: 'إغلاق المعاينة',
  },

  images: {
    title: 'صور العقار',
    /*
      The cover is the FLAGGED image, not the first one.

      This sentence used to say the first image in the order was the cover. It never was: the
      order and the cover are separate columns, and «اجعلها صورة الغلاف» is what sets the cover.
      A partner who reordered their gallery to change what search results show would have watched
      nothing happen and had no way to find out why — the screen had told them the wrong mechanism.
    */
    note: 'صورة الغلاف هي التي تظهر في نتائج البحث، وتُختار بزر «اجعلها صورة الغلاف» لا بالترتيب. تُعالَج كل صورة وتُزال منها بيانات الموقع قبل النشر.',
    empty: 'لا صور بعد. ارفع أول صورة لهذا العقار.',
    count: '{n} من {max} صورة',
    upload: 'رفع صور',
    uploading: 'جارٍ الرفع…',
    cover: 'صورة الغلاف',
    makeCover: 'اجعلها صورة الغلاف',
    /**
     * The two states an upload can be in before it is a photograph on a listing.
     *
     * Encoding moved to a worker (BullMQ phase 3), so the tile appears immediately and its picture
     * arrives a moment later. Saying so is not decoration: a blank tile that fills itself in reads
     * as a broken upload, and a partner who reloads or re-uploads because of it makes the queue
     * longer for the same photograph.
     */
    processing: 'جارٍ التحضير…',
    processingNote: 'تظهر الصورة خلال لحظات. يمكنك متابعة العمل.',
    failedState: 'تعذّرت المعالجة',
    failedHint: 'ارفع الصورة مرة أخرى.',
    moveUp: 'تقديم',
    moveDown: 'تأخير',
    archive: 'أرشفة',
    /* A dialog TITLE, not the button label: «حذف» alone is not a heading. */
    archiveTitle: 'أرشفة صورة',
    archiveConfirm: 'تُؤرشَف الصورة ولا تُحذف — تبقى سجلاً لما عرضه الإعلان. متابعة؟',
    /**
     * Alt text, per language.
     *
     * All three, not just Arabic. The customer site serves ar/en/de and the alt attribute is
     * chosen by the READER's locale — an English visitor to a listing described only in Arabic
     * gets `alt=""`, which is the same as no description at all. Editing one language and storing
     * three was a UI that quietly discarded two thirds of the field.
     *
     * Every one is optional. A partner writing Arabic should not be blocked on also writing
     * German, and an empty alt is honest for a photograph the surrounding copy already names.
     */
    altLabel: 'وصف الصورة لقارئ الشاشة (اختياري)',
    altAr: 'بالعربية',
    altEn: 'بالإنجليزية',
    altDe: 'بالألمانية',
    altSave: 'حفظ الوصف',
    altSaved: 'حُفظ',
    backToProperties: 'رجوع إلى عقاراتي',
    /* Each failure says which one it was: a partner who cannot tell them apart retries the wrong thing. */
    /* Several at once: what landed, and what the limit refused. */
    uploadedSome: 'رُفعت {done} من {total} صور. تحقق من الصور المتبقية وأعد المحاولة.',
    limitReached: 'بلغت الحد الأقصى وهو {max} صورة لهذا العقار.',
    lastImage: 'لا يمكن أرشفة الصورة الأخيرة لعقار منشور. ارفع صورة بديلة أولاً.',
    failed: 'تعذّر تنفيذ الطلب.',
    unreachable: 'تعذّر الوصول إلى الخادم.',
  },

  /** Property state, as the handoff's §7.2 pills name it. */
  /**
   * Availability day states, keyed on `availability_days.status`.
   *
   * «محجوز» is present because a day can BE booked, and absent from the editor's select because a
   * partner may not SET it — the two are different questions and the catalogue answers only the
   * first. See the note on `unitCalendar`.
   */
  dayStatus: {
    available: 'متاح',
    booked: 'محجوز',
    closed: 'مغلق',
    maintenance: 'صيانة',
  } as Record<string, string>,

  propertyStatus: {
    published: 'منشور',
    pending_review: 'قيد المراجعة',
    approved: 'معتمد',
    draft: 'مسودة',
    rejected: 'مرفوض',
    suspended: 'موقوف',
    archived: 'مؤرشف',
  } as Record<string, string>,

  /**
   * صفات الرحلة — the ONE shared vocabulary (§5.6 and the acceptance checklist).
   *
   * The keys are `TRIP_ATTRIBUTES` from `@safra/contracts`, the same list the public search, the
   * filters and the property page use. The handoff is explicit that it must not be forked, so
   * this is a translation of that list and never a second one.
   */
  tripAttribute: {
    sea: 'بحر',
    mountain: 'جبل',
    history: 'تاريخ',
    nature: 'طبيعة',
    families: 'عائلات',
    honeymoon: 'شهر عسل',
    pool: 'مسبح',
    parking: 'موقف',
    internet: 'إنترنت',
    business: 'أعمال',
  } as Record<string, string>,

  /**
   * Property types, keyed on `property_types.code`.
   *
   * The card's meta line printed «دمشق · hotel · 2 وحدة» — the code, raw, on an Arabic screen.
   * The table has `name_ar`, so the alternative was to select it; a catalogue is used instead
   * because these are a closed vocabulary the UI names, like every other enum in the project.
   */
  propertyType: {
    hotel: 'فندق',
    apartment: 'شقة',
    chalet: 'شاليه',
    villa: 'فيلا',
    farm: 'مزرعة',
    camp: 'مخيم',
    rural_house: 'بيت ريفي',
  } as Record<string, string>,

  /**
   * مستحقاتي — the partner's own view of their transfers.
   *
   * The copy distinguishes «مستحق» (what SAFRA owes) from «تحويل» (money that moved) throughout,
   * because this is the screen where a partner decides whether to expect a payment. A word used
   * loosely here becomes somebody planning around money that has not been sent.
   */
  payouts: {
    title: 'مستحقاتي',
    note: 'يُضاف الحجز إلى مستحقاتك بعد اكتمال الإقامة وتحصيل الدفع. أي حجز عليه نزاع مفتوح يبقى مجمّدًا حتى يُغلق النزاع.',
    empty: 'لا مستحقات مسجّلة بعد.',
    colReference: 'المرجع',
    colPeriod: 'الفترة',
    colBookings: 'الحجوزات',
    colNet: 'الصافي',
    colStatus: 'الحالة',
    colDate: 'التاريخ',
    gross: 'الإجمالي',
    fine: 'الغرامات',
    net: 'الصافي المستحق',
    scheduledFor: 'موعد التحويل',
    paidAt: 'تاريخ الدفع',
    paidReference: 'مرجع الحوالة',
    holdReason: 'سبب التعليق',
    coveredBookings: 'الحجوزات المشمولة',
    noBookings: 'لا حجوزات على هذه الفترة بعد.',
    colBooking: 'الحجز',
    colProperty: 'العقار',
    colStay: 'الإقامة',
    colAmount: 'المبلغ',
    back: 'رجوع',
    /* Read-only, and the screen says why rather than leaving a partner hunting for a button. */
    readOnly:
      'هذه الصفحة للاطّلاع فقط. جدولة التحويلات وتنفيذها يتمّان من سفرة؛ لأي استفسار راسل partners@safra.com.',
  },

  /** Payout state, in the partner's language. Same values and same colours as the console. */
  payoutStatus: {
    accruing: 'قيد التجميع',
    pending_release: 'بانتظار الإفراج',
    on_hold: 'معلَّق',
    scheduled: 'مجدول',
    paid: 'مدفوع',
    cancelled: 'ملغى',
  } as Record<string, string>,

  reviews: {
    title: 'تقييمات ضيوفي',
    /** P-006, quoted by the handoff verbatim. */
    rule: 'لا يمكن حذف تقييم — يمكنك الرد عليه أو الإبلاغ عنه (P-006)',
    /** The §7.3 header figure. Shown only when there is an average to show. */
    summary: 'المعدل العام ★ {average} من {n} تقييماً',
    summaryEmpty: 'لا تقييمات بعد.',
    empty: 'لا تقييمات بعد. تظهر هنا بعد أن يقيّم ضيوفك إقاماتهم المكتملة.',

    reply: 'الرد',
    report: 'إبلاغ',
    replyLabel: 'ردّك — يظهر للجميع تحت التقييم، ولا يمكن تعديله بعد النشر.',
    replySubmit: 'نشر الرد',
    replied: 'ردّك',
    reportLabel:
      'لماذا تُبلغ عن هذا التقييم؟ يصل النص إلى سفرة ولا يظهر للضيف. عشرة أحرف على الأقل.',
    reportSubmit: 'إرسال البلاغ',
    /* Stated plainly: reporting is not removal, and a partner should not expect it to be. */
    reportPending: 'بلاغك قيد المراجعة لدى سفرة. التقييم يبقى ظاهراً حتى يصدر القرار.',
    reportUpheld: 'قبلت سفرة بلاغك وأُخفي التقييم.',
    reportDismissed: 'راجعت سفرة بلاغك وأبقت التقييم ظاهراً.',
    hidden: 'مُخفى',
    hiddenNote: 'أخفت سفرة هذا التقييم. يبقى في سجلّك ولا يُحتسب في معدّلك.',

    cancel: 'إلغاء',
    working: 'جارٍ الإرسال…',
    failed: 'تعذّر تنفيذ الطلب.',
    unreachable: 'تعذّر الوصول إلى الخادم.',
  },
  /**
   * «تفعيل حساب الموظّف» — where an invited employee sets their first password.
   *
   * A near-twin of `invitation` above, and deliberately NOT a reuse of it. The two journeys differ
   * in what the reader is being told they have become: one is the partner themselves, the other is
   * a member of that partner's staff, and «أنشئ حساب الشريك» on an employee's screen would tell a
   * receptionist she now owns the business.
   *
   * The password rules are repeated rather than shared because they belong to a form, and a
   * catalogue that hoists them into a common section makes the next screen that needs four of the
   * five reach for a fifth it does not want.
   */
  employeeInvitation: {
    title: 'تفعيل حساب الموظّف',
    /*
      It does NOT name the employer, and that is a security decision rather than an omission.

      Naming the business would mean resolving the token before anything is submitted, and this
      page must never say whether a token is real — the partner invitation page records the same
      reasoning. A token IS a credential here: whoever holds a live one sets the password on that
      account. A page that answered «دعتك فندق كذا» for a valid token and something else for an
      invalid one would confirm which guesses were close, and leak the customer list while doing it.

      The invitation EMAIL names the employer, which is where that belongs: it reaches only the
      address the partner typed.
    */
    intro: 'دُعيت للانضمام إلى فريق على سفرة. اختر كلمة مرور لحسابك.',
    password: 'كلمة المرور',
    confirm: 'تأكيد كلمة المرور',
    submit: 'تفعيل الحساب',
    submitting: 'جارٍ التفعيل…',
    mismatch: 'كلمتا المرور غير متطابقتين.',
    weak: 'كلمة المرور لا تحقّق الشروط أعلاه.',
    /*
      One sentence for every refusal the API can give: expired, spent, never existed, employment
      withdrawn. The endpoint deliberately answers them all with one code, and this does not invent
      a distinction it was denied — telling somebody which guess was close is the whole risk.
    */
    invalidLink:
      'هذا الرابط غير صالح أو انتهت صلاحيته. اطلب من صاحب العمل إعادة إرسال الدعوة.',
    failed: 'تعذّر تفعيل الحساب. حاول مرة أخرى.',
    done: 'تم تفعيل الحساب. سجّل الدخول للمتابعة.',
    signIn: 'الذهاب إلى تسجيل الدخول',
    ruleLength: '12 حرفًا على الأقل',
    ruleUppercase: 'حرف كبير واحد على الأقل',
    ruleLowercase: 'حرف صغير واحد على الأقل',
    ruleDigit: 'رقم واحد على الأقل',
    ruleSymbol: 'رمز واحد على الأقل',
    strengthLabel: 'قوة كلمة المرور',
    afterNote:
      'صلاحياتك يحدّدها صاحب العمل، وقد تختلف عن صلاحيات زملائك. بعد الدخول تظهر لك الأقسام المتاحة لك فقط.',
  },
  /**
   * الموظفون — a partner's own staff, and the roles the PARTNER has named for them.
   *
   * ## Two words for two different facts
   *
   * `notActivated` and `invitationExpired` are separate on purpose. "Invited but not yet signed
   * in" and "invited, the link died, nobody can use it" call for different actions from the
   * reader, and collapsing them into one «لم يفعّل بعد» is how somebody waits a week for a person
   * who never had a working link. The in-person onboarding flow showed five green steps while the
   * person could not sign in; this is the same mistake one screen along.
   *
   * ## The refusals name the CAUSE, not the field
   *
   * «هذا البريد لموظّف يعمل بالفعل» rather than «البريد غير صالح». The address is fine; the
   * situation is the problem, and a message about the field sends somebody to retype what they
   * typed correctly.
   */
  employees: {
    title: 'الموظفون',
    intro:
      'ادعُ موظّفيك وحدّد ما يمكن لكلٍّ منهم فعله. الصلاحيات تأتي من الدور الذي تختاره، ولا يمكن لأي موظّف أن يتجاوز صلاحياتك.',
    empty: 'لا يوجد موظّفون بعد. ابدأ بدعوة أول واحد.',
    loadMore: 'عرض المزيد',
    loadFailed: 'تعذّر تحميل قائمة الموظفين.',

    /* The invite form. */
    inviteTitle: 'دعوة موظّف',
    fullName: 'الاسم الكامل',
    email: 'البريد الإلكتروني',
    role: 'الدور',
    rolePlaceholder: 'اختر دورًا',
    inviteSubmit: 'إرسال الدعوة',
    inviting: 'جارٍ الإرسال…',
    inviteSent: 'أُرسلت الدعوة.',
    /*
      Rewritten 2026-08-23, when roles became the PARTNER's to define.

      It used to say «تواصل مع فريق سفرة» — wait for somebody else — which was true while a super
      admin owned the catalogue and is now the opposite of true: the person who can fix this is the
      person reading it. A sentence that sends somebody to wait for help they do not need is worse
      than no sentence, because they will wait.
    */
    noRoles: 'لا يمكنك دعوة موظّف قبل تعريف دور واحد على الأقل.',
    defineRoles: 'تعريف الأدوار',

    /* What the row says about where somebody has got to. */
    statusActive: 'نشِط',
    statusSuspended: 'موقوف',
    notActivated: 'لم يفعّل حسابه بعد',
    invitationPending: 'الدعوة سارية',
    invitationExpired: 'انتهت صلاحية الدعوة',

    /* Row controls. */
    changeRole: 'تغيير الدور',
    suspend: 'إيقاف',
    restore: 'إعادة التفعيل',
    remove: 'إزالة',
    /* A dialog TITLE, not the button label: «حذف» alone is not a heading. */
    removeTitle: 'إزالة موظف',
    /* Named, because four identical «إزالة» buttons in a list are indistinguishable to a reader
       using a screen reader, and to anybody who has scrolled. */
    removeLabel: 'إزالة {name}',
    suspendLabel: 'إيقاف {name}',
    restoreLabel: 'إعادة تفعيل {name}',
    roleLabel: 'دور {name}',
    removeConfirm: 'إزالة {name} من الموظفين؟ سيفقد الوصول فورًا.',
    working: 'جارٍ التنفيذ…',

    /*
      What an EMPLOYEE sees where the owner sees their own account surfaces.

      Not a refusal and not «انتهت الجلسة» — their session is fine. The agreement and the
      verification documents belong to whoever signed them, and an employee account is not that
      person. Saying so is shorter than a permission error and does not send anybody to sign in
      again over something signing in cannot fix.
    */
    ownerOnly: 'هذا القسم يخص صاحب الحساب. تواصل معه إن كنت بحاجة إلى شيء منه.',
    /*
      A DIFFERENT sentence from `ownerOnly`, and the difference is what the reader can do about it.

      «يخص صاحب الحساب» is true of مستحقاتي and العقود — no role can ever carry them, so asking is
      pointless and the sentence closes the subject. This one is for a section an employee COULD
      hold and does not: عقاراتي, التقويمات, التقييمات. There the answer is «اطلب من صاحب العمل»,
      because the person who can change it is one conversation away and the reader should know that.

      Telling somebody a thing is impossible when it is merely not granted is the same failure as
      «انتهت الجلسة» on a refusal: a true-sounding sentence pointing the wrong way.
    */
    notInYourRole:
      'دورك الحالي لا يشمل هذا القسم. اطلب من صاحب العمل تعديله إن كنت بحاجة إليه.',
    /* Shown when a role opens no section at all — see `openableSections` returning empty. */
    noSectionsTitle: 'دورك لا يفتح أي قسم بعد',
    noSectionsBody:
      'الصلاحيات التي منحها لك صاحب العمل لا تفتح أي شاشة حتى الآن. تواصل معه لتعديل دورك، أو افتح طلب دعم من القائمة.',
    /*
      The same reader, when the BUSINESS has not been verified yet.

      They are sent here by the onboarding gate, and «قيد المراجعة» is the whole of what they can
      usefully know: there is no step for them to complete, and the person who can complete one is
      their employer.
    */
    employerUnderReview:
      'حساب صاحب العمل قيد المراجعة لدى سفرة. ستظهر لك أقسامك فور اعتماده.',

    /* One sentence per refusal the API can give, each naming the cause. */
    alreadyEmployed: 'هذا البريد لموظّف يعمل بالفعل لدى شريك.',
    emailIsOwner: 'هذا البريد لحساب شريك، ولا يمكن أن يكون موظّفًا.',
    emailIsStaff: 'هذا البريد لحساب من فريق سفرة.',
    roleNotFound: 'هذا الدور لم يعد متاحًا. حدّث الصفحة واختر دورًا آخر.',
    notFound: 'لم يعد هذا الموظّف موجودًا. حدّث الصفحة.',
    failed: 'تعذّر تنفيذ الطلب. حاول مرة أخرى.',
  },
  /**
   * أدوار الموظفين — the roles a PARTNER defines for their own staff (Bashar, 2026-08-23).
   *
   * ## Its own catalogue, not a copy of the console's
   *
   * `admin/ar.ts` has a capability map with the same KEYS, and this is deliberately not a re-export
   * of it. The console's copy addresses a super admin looking at somebody else's business —
   * «قراءة حجوزات الشريك» — and here the reader IS the business, so it is «قراءة الحجوزات». Same
   * permission, different possessive, and sharing one string would make one of the two screens
   * read as if it were written for the other.
   *
   * ## The empty state does the teaching
   *
   * A partner arriving here has never met the concept: they have one login today and are being
   * asked to name a category of person. «أنشئ دورًا» on a blank page explains nothing, so the empty
   * state says what a role IS and what it is FOR before asking for a name. No roles are seeded —
   * suggesting «استقبال» and «محاسب» would put SAFRA's guess about somebody's staffing into their
   * account as real rows they then have to audit and delete.
   */
  employeeRoles: {
    title: 'أدوار الموظفين',
    intro:
      'الدور مجموعة من القدرات تمنحها لموظّف. عرّف الأدوار التي تناسب عملك، ثم اختر دورًا لكل موظّف عند دعوته.',

    /* Shown instead of the list when the partner has defined nothing yet. */
    emptyTitle: 'لم تعرّف أي دور بعد',
    emptyBody:
      'قبل دعوة موظّف تحتاج إلى دور واحد على الأقل. فكّر في وظيفة لا في شخص: «من يستقبل الضيوف» أو «من يتابع الحسابات». يمكنك تعديل الدور لاحقًا، ويسري التعديل على كل من يحمله.',

    /* The form. */
    createTitle: 'دور جديد',
    editTitle: 'تعديل الدور',
    nameLabel: 'اسم الدور',
    nameHint: 'ما تراه عند اختيار دور لموظّف. حرفان على الأقل.',
    capabilitiesLabel: 'ما يستطيع حامل هذا الدور فعله',
    capabilitiesRequired: 'اختر قدرة واحدة على الأقل.',
    create: 'إنشاء الدور',
    creating: 'جارٍ الإنشاء…',
    save: 'حفظ التعديل',
    saving: 'جارٍ الحفظ…',
    cancel: 'إلغاء',
    created: 'أُنشئ الدور.',
    saved: 'حُفظ التعديل.',

    /*
      Warned at CREATION, not discovered a week later.

      A role can carry real capabilities and still open no screen: «قبول الحجوزات» and «الرد على
      التقييمات» are both actions INSIDE sections that other capabilities open, and both are boxes
      somebody would tick while thinking about what a person does all day. The employee then signs
      in to a portal with nothing in it.

      The partner is standing here when the mistake is made and is the only person who can fix it.
      It is a warning rather than a refusal: a role that only grants in-page actions is legitimate
      once another role opens the screen, so the API allows it and this makes sure it is deliberate.
    */
    opensNothing:
      'هذه القدرات لا تفتح أي شاشة بمفردها. الموظّف الذي يحمل هذا الدور سيسجّل الدخول ولن يرى أي قسم.',

    /* The list. */
    edit: 'تعديل',
    remove: 'حذف',
    /* A dialog TITLE, not the button label: «حذف» alone is not a heading. */
    removeTitle: 'حذف دور موظفين',
    /* Named, because a list of roles offers one «حذف» per row and they are otherwise identical. */
    editLabel: 'تعديل الدور {name}',
    removeLabel: 'حذف الدور {name}',
    held: 'يحمله {n}',
    heldNobody: 'لا يحمله أحد',
    confirmRemove: 'حذف الدور «{name}»؟ لا يمكن التراجع.',
    loadFailed: 'تعذّر تحميل الأدوار.',
    working: 'جارٍ التنفيذ…',

    /*
      Said BEFORE the button is offered, not after the API refuses. `employeeCount` rides on every
      row precisely so the screen can explain the constraint instead of reporting a failure.
    */
    inUse: 'لا يمكن حذف دور يحمله موظّفون. انقلهم إلى دور آخر أولاً.',
    nameTaken: 'لديك دور بهذا الاسم بالفعل.',
    notFound: 'لم يعد هذا الدور موجودًا. حدّث الصفحة.',
    failed: 'تعذّر تنفيذ الطلب. حاول مرة أخرى.',

    /*
      The GROUP headings, keyed by `PermissionGroup` from `@safra/contracts`.

      The grouping LOGIC is shared with the console — `groupPermissions()`, one taxonomy, so a new
      capability cannot be categorised two ways — but the words are this reader's. «الشركاء» is a
      domain of the platform to a super admin surveying it, and nonsense to a partner, who does not
      look at partners: they ARE one. So the same group reads «العقارات» here. Same argument as the
      capability map below.

      An unmapped group renders its raw key, and `PERMISSION_GROUPS` keeps «أخرى» last and visible
      on purpose — a capability nobody categorised must still be offered, because an absent checkbox
      looks like a shorter list rather than a bug.
    */
    capabilityGroup: {
      bookings: 'الحجوزات والتقويم',
      money: 'الأسعار',
      partners: 'العقارات',
      customers: 'الضيوف والتقييمات',
      platform: 'المنصّة',
      other: 'أخرى',
    } as Record<string, string>,

    /*
      The capabilities in words, keyed by the permission string the API validates against — so an
      unlabelled one renders as its raw identifier and announces itself, rather than appearing as a
      blank checkbox somebody ticks without knowing what they granted.
    */
    capability: {
      'booking.read_own': 'قراءة الحجوزات',
      'booking.respond_as_partner': 'قبول الحجوزات ورفضها',
      'booking.check_in': 'تسجيل وصول الضيف',
      'calendar.manage_own': 'إدارة التقويم والتوفّر',
      'property.manage_own': 'إدارة العقارات والوحدات',
      'price.update': 'تعديل الأسعار',
      'message.read': 'قراءة الرسائل',
      'message.send': 'إرسال الرسائل',
      'review.read_own': 'قراءة التقييمات',
      'review.respond_own': 'الرد على التقييمات',
      'violation.read': 'قراءة المخالفات',
    } as Record<string, string>,
  },
  /**
   * الوصول اليوم — the desk screen a receptionist works from (Bashar, 2026-08-23).
   *
   * ## The archetypal employee screen
   *
   * «reseption employees working for booking for clients» is the use the whole employees feature was
   * described from. A guest is standing at the counter; the person serving them needs to find the
   * booking and admit it, and nothing else.
   *
   * ## No money, and the copy must not imply any
   *
   * `booking.check_in` does not carry `payout.read_own`. A rate on this list would hand the
   * business's earnings to whoever works the desk, so there is no price, no total and no wording
   * that gestures at one. If the screen reads thin, that is the correct thinness.
   *
   * ## «اليوم» is the city's today
   *
   * The list carries bookings dated today AND earlier — a guest arriving at 01:00 for yesterday's
   * date is exactly who is at the desk, and a strict "today" loses them. The title says «اليوم»
   * because that is what the reader is doing; `overdue` is what names the rest honestly.
   */
  arrivals: {
    title: 'الوصول اليوم',
    /*
      The old wording promised «ابحث بالاسم أو برقم الحجز» while the screen had no search at all —
      a true-sounding sentence describing a capability nobody had built. It now says what the page
      does: the day's list, plus a lookup by REFERENCE, which is the one §6.5 names.
    */
    intro: 'الحجوزات المؤكّدة التي وصل موعدها. أو ابحث برقم الحجز عن أي حجز في منشأتك.',
    empty: 'لا وصول متوقّع الآن.',
    loadFailed: 'تعذّر تحميل قائمة الوصول.',
    loadMore: 'عرض المزيد',

    nights: '{n} ليالٍ',
    guests: '{n} ضيوف',
    /* Said on the row, not in a tooltip: a date that has passed is the reader's cue to check. */
    overdue: 'موعده سابق',

    checkIn: 'تسجيل الوصول',
    checkedIn: 'تم تسجيل الوصول',
    undo: 'تراجع',
    /* A dialog TITLE, not the button label: «حذف» alone is not a heading. */
    undoTitle: 'التراجع عن تسجيل الوصول',
    working: 'جارٍ التنفيذ…',
    /* Named, because a list of arrivals offers one identical button per row. */
    checkInLabel: 'تسجيل وصول {name}',
    undoLabel: 'التراجع عن وصول {name}',
    /*
      Undo asks first — not because it is dangerous, but because it is the second press on the same
      row and a person who has just checked somebody in is not expecting the button to have changed
      meaning underneath their finger.
    */
    undoConfirm: 'التراجع عن تسجيل وصول {name}؟',
    /*
      §6.5's lookup — the guest with a paper voucher and a flat phone.

      `notFound` is one sentence for every kind of miss: a reference that never existed, one that
      belongs to another business, and one typed wrong all answer the same, because the API answers
      them the same and a screen that split them would teach a caller which was which.
    */
    lookup: {
      label: 'رقم الحجز أو اسم الضيف',
      submit: 'بحث',
      result: 'نتيجة البحث',
      clear: 'عودة إلى قائمة اليوم',
      notFound: 'لا حجز بهذا الرقم أو الاسم في منشأتك.',
      failed: 'تعذّر البحث. حاول مرة أخرى.',
    },

    /* The API refuses a second press with 404 rather than writing twice; this is what that reads as. */
    gone: 'تغيّرت حالة هذا الحجز. حدّث الصفحة.',
    failed: 'تعذّر تنفيذ الطلب. حاول مرة أخرى.',
  },

  /**
   * المخالفات — what SAFRA has charged against this partner, read-only.
   *
   * ## A partner can never act on their own fine
   *
   * Waiving is `violation.manage`, which is staff. There is no button on this screen and there must
   * never be one; the list exists so a business can see what it is being charged for and why, not
   * so it can argue with the record in place.
   *
   * ## `moneyHidden` is a STATEMENT, not three dashes
   *
   * An employee without `payout.read_own` gets the three money fields as null — the same withholding
   * as the dashboard. Rendering «—» in a money column would say the fine was ZERO, which is a
   * different and false claim. So the columns are dropped and one line says they are hidden. What
   * remains is everything the screen is FOR: what happened, when, how many times, and the score it
   * cost. A manager can fix the operational problem without being shown the invoice.
   */
  /**
   * إيقاف الحساب — the notice a suspended partner reads on every screen.
   *
   * ## Why this is a whole block and not one sentence
   *
   * A suspended partner is a LIVE, authenticated session that is refused on every write (Bashar,
   * 2026-08-24). That is a state the portal never had: suspension used to strip the token's
   * `partnerId`, so the business simply vanished and the screen said «انتهت الجلسة». They can now
   * sign in, read their account, and see exactly why — so there has to be enough copy to say what
   * stopped, what did not, and what they can still do.
   *
   * ## `guestsSafe` is the load-bearing line
   *
   * The first fear of a suspended owner is that their guests have been cancelled on. Bashar's rule
   * is explicit that existing confirmed bookings continue and guests are not disrupted — so the
   * notice SAYS so, in the second line, before the list of what is blocked. Without it this is not
   * a notice, it is a panic, and the support ticket it produces is one nobody needed to handle.
   *
   * ## `refused` is the other half
   *
   * A blocked write must read as suspension. `partnerFetch` reports the API's 403 as
   * `'unauthenticated'`, so a refusal that falls through renders «انتهت الجلسة» and sends somebody
   * to sign in again over a state signing in cannot change — the same trap the console's section
   * gate was built to close.
   */
  suspension: {
    title: 'حسابك موقوف مؤقتًا',
    /* On المحفظة, ABOVE the list — a frozen transfer is not a missing one. */
    payoutsFrozen:
      'التحويلات موقوفة بسبب إيقاف الحساب. المستحقات محفوظة ولم تُلغَ، وتُستأنف عند رفع الإيقاف.',
    reason: 'السبب: {reason}',
    since: 'الإيقاف بتاريخ {date}',

    /* The sentence this notice exists for. Second, so it is read before the list of what stopped. */
    guestsSafe:
      'حجوزاتك المؤكدة مستمرة كما هي ولم يتأثر ضيوفك. استقبلهم في مواعيدهم المتفق عليها كالمعتاد.',

    blockedTitle: 'ما هو متوقف',
    blockedListings: 'إعلاناتك مخفيّة من البحث ولا تُقبل حجوزات جديدة.',
    blockedProperties: 'لا يمكن إضافة عقار جديد ولا تعديل أو نشر عقار قائم.',
    blockedPayouts: 'التحويلات موقوفة حتى رفع الإيقاف.',

    allowedTitle: 'ما زال متاحًا',
    allowedRead:
      'يمكنك الدخول ومراجعة حسابك وحجوزاتك وقراءة الإشعارات والتواصل مع الدعم.',
  },

  violations: {
    title: 'المخالفات',
    intro:
      'ما سجّلته سفرة على حسابك ولماذا. لا يمكن الاعتراض من هنا — تواصل مع الدعم إن كان هناك خطأ.',
    empty: 'لا مخالفات على حسابك.',
    loadFailed: 'تعذّر تحميل المخالفات.',
    loadMore: 'عرض المزيد',

    /* Shown once, above the list, when the reader may not see amounts. */
    moneyHidden: 'الغرامات مخفيّة عن دورك. صاحب الحساب يراها.',

    /* Which offence this is — the ladder escalates, so the number is the point. */
    occurrence: 'المخالفة رقم {n}',
    booking: 'الحجز {reference}',
    fine: 'غرامة {amount}',
    /*
      Why the fine, beneath the figure.

      A label rather than bare prose, so the sentence cannot be mistaken for the description of the
      violation itself two lines above it — the two answer different questions and an operator often
      writes both.
    */
    fineReason: 'سبب الغرامة: {reason}',
    compensation: 'منها {amount} تعويض للضيف',
    waived: 'أُلغيت',
    /* A waived row STAYS, with its reason — one that vanished would look like it never existed. */
    waivedFor: 'أُلغيت: {reason}',
    collected: 'حُصّلت',
    outstanding: 'غير محصّلة',

    /**
     * A waived fine is shown as the PAIR, never as absent and never as the net alone.
     *
     * Bashar's rule (2026-08-24): a waiver never deletes or rewrites history — the original fine
     * stays permanently visible and the waiver is a BALANCING entry, −50 then +50, net zero. A row
     * that showed «—» or «٠» alone would have deleted that history one layer above the ledger,
     * which is the same failure the ledger design exists to prevent.
     *
     * Three separate keys rather than one sentence, so the order of the three figures is the
     * catalogue's to decide and not a template literal's.
     */
    waivedAmount: 'أُلغيت {amount}',
    net: 'الصافي {amount}',
    waivedOn: 'أُلغيت بتاريخ {date}',

    /* The formal ladder. A stage is a fact about the record, not a description of the offence. */
    stage: {
      recorded: 'مسجّلة',
      warned: 'تحذير',
      fined: 'غرامة',
      suspension: 'إيقاف',
    } as Record<string, string>,

    /* What the partner was TOLD, and when. Absent unless somebody actually warned them. */
    /* ── The detail screen (Bashar, 2026-08-24) ──────────────────────────── */
    /*
      A page per violation, because a row in a list cannot hold what a partner needs when they are
      deciding whether to accept a fine: what happened, when, which booking, what was said to them,
      what it cost, and whether it was forgiven. The list is for scanning; this is for reading.
    */
    detailTitle: 'تفاصيل المخالفة',
    open: 'التفاصيل',
    back: 'رجوع إلى المخالفات',
    notFound: 'لم يُعثر على هذه المخالفة على حسابك.',
    whatHappened: 'ما حدث',
    recordedOn: 'تاريخ التسجيل',
    theStage: 'المرحلة',
    theKind: 'نوع المخالفة',
    theBooking: 'الحجز المرتبط',
    theOccurrence: 'التكرار',
    noBooking: 'غير مرتبطة بحجز',
    theWarning: 'الإنذار',
    theFine: 'الغرامة',
    theWaiver: 'قرار الإلغاء',
    /* «لم تُحصَّل» is a state, not an absence — a fine that exists and has not been taken yet. */
    notCollected: 'لم تُحصَّل بعد',
    collectedOnLabel: 'حُصّلت بتاريخ {date}',
    /*
      Said on the detail screen as well as in the email, because this is where somebody reads
      carefully. A partner's first assumption about any enforcement mark is that it has cost them
      their place in search results.
    */
    noRankingEffect: 'لا تؤثر هذه المخالفة على ترتيب إعلاناتك في نتائج البحث.',
    appeal: 'إن كان هناك خطأ، تواصل مع الدعم — لا يمكن الاعتراض من هذه الصفحة.',

    warnedOn: 'حُذّرت بتاريخ {date}',
    warningNote: 'نص التحذير: {note}',

    kind: {
      no_response: 'عدم الرد على طلب حجز',
      rejected_after_payment: 'رفض حجز بعد الدفع',
      stale_calendar: 'تقويم غير محدّث',
      inaccurate_listing: 'وصف غير مطابق',
      no_show: 'عدم استقبال الضيف',
    } as Record<string, string>,

    /*
      WHAT HAPPENED, for a violation nobody typed a description for.
      ────────────────────────────────────────────────────────────────────────
      Bashar, 2026-08-24: the descriptions were still missing, and this is why. A violation raised by
      hand on the console carries the operator's own words. The violations a partner actually
      RECEIVES in production are written by the platform — `sla.service.ts` levies `no_response` and
      fines for it, `booking-actions.service.ts` records `rejected_after_payment` — and neither
      writes a word. So a partner was fined by an automatic sweep and told only a category.

      ## Why these live in the CATALOGUE and are not stored on the row

      A generated sentence written into `partner_violations.description` would be frozen in whatever
      language the sweep happened to pick, on a row that outlives every re-translation — the exact
      thing «No user-facing text is written inside code» exists to prevent, one layer down in the
      database. Rendered from here, a German partner reads German, and adding a language stays a task
      somebody can finish.

      ## They are specific, not a gloss on the label

      Each names the condition the writer actually fires on — the two-hour window, the payment
      already taken — so it is verifiable rather than decorative. `{reference}` is filled where the
      violation has a booking and the sentence without it is used where it does not, because
      «الحجز —» is worse than a sentence that does not mention one.
    */
    defaultDescription: {
      no_response:
        'لم يصل ردّ على طلب الحجز {reference} خلال مهلة الساعتين المتاحة للرد، فأُلغي الطلب تلقائياً وسُجّلت المخالفة.',
      rejected_after_payment:
        'رُفض الحجز {reference} بعد أن أتمّ الضيف الدفع، فاستُرد المبلغ له وسُجّلت المخالفة.',
      stale_calendar:
        'بقي تقويم الإتاحة دون تحديث لمدة تجاوزت الحد المسموح، فظهرت تواريخ غير متاحة كأنها متاحة للحجز.',
      inaccurate_listing:
        'لم تُطابق تفاصيل العقار المعروضة ما وجده الضيف على أرض الواقع.',
      no_show: 'وصل الضيف في موعده ولم يجد من يستقبله.',
    } as Record<string, string>,
    /* Used where the same kind has no booking to name — no «الحجز —» on a screen. */
    defaultDescriptionNoBooking: {
      no_response:
        'لم يصل ردّ على طلب الحجز خلال مهلة الساعتين المتاحة للرد، فأُلغي الطلب تلقائياً وسُجّلت المخالفة.',
      rejected_after_payment:
        'رُفض الحجز بعد أن أتمّ الضيف الدفع، فاستُرد المبلغ له وسُجّلت المخالفة.',
    } as Record<string, string>,
  },

  /**
   * How each currency's symbol is WRITTEN — «ل.س», «$».
   *
   * Here rather than in a `const` in `apps/partner/src/lib/format.ts`, where it was: the symbol is
   * copy — `docs/i18n.md` says «the symbol (ل.س) is copy and is in the catalogue; the code is not»
   * — and a table in a component file is invisible to the task of adding a language. It was also
   * the console's table typed a second time, five codes deep, and both stopped at the five the
   * platform traded in before المدن could add a currency: a unit priced in dirhams rendered
   * «100.00 AED», the raw code, because the map had no entry and fell back to it.
   *
   * A locale with no symbol for a currency still falls back to the CODE, which is correct rather
   * than blank. The POSITION is not here — it follows from the symbol's script and is
   * `symbolTrails` in `@safra/contracts`, so it cannot be a list that goes stale.
   */
  currencySymbol: {
    USD: '$',
    EUR: '€',
    SYP: 'ل.س',
    JOD: 'د.أ',
    LBP: 'ل.ل',
    TRY: '₺',
    AED: 'د.إ',
    SAR: 'ر.س',
    EGP: 'ج.م',
    IQD: 'د.ع',
    GBP: '£',
  } as Record<string, string>,
} as const;
