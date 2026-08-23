/**
 * Transactional email copy in Arabic — the source of truth the other two translate from.
 *
 * ## Why each body is one string with `\n` escapes
 *
 * They were concatenated template literals in `mail.templates.ts`, split across source lines to
 * stay inside the line-length limit. That made every paragraph break a decision of the SOURCE
 * FORMATTING rather than of the copy, and a translator adjusting a sentence had to reflow the
 * concatenation. One string per body is what the recipient actually receives.
 *
 * Plain text only, deliberately — see `mail.templates.ts`. An email carrying a single link has
 * nothing for HTML to add that would justify a second copy of the wording per language.
 */
export const ar = {
  passwordReset: {
    subject: 'إعادة تعيين كلمة المرور — سفرة',
    body: 'لقد طلبت إعادة تعيين كلمة المرور لحسابك في سفرة.\n\nافتح الرابط التالي لاختيار كلمة مرور جديدة:\n{url}\n\nتنتهي صلاحية الرابط خلال {expiresInMinutes} دقيقة ويمكن استخدامه مرة واحدة فقط.\n\nإذا لم تطلب ذلك، تجاهل هذه الرسالة — لم يتغير أي شيء في حسابك.\n\nفريق سفرة',
  },
  emailVerification: {
    subject: 'أكّد بريدك الإلكتروني — سفرة',
    body: 'مرحبًا بك في سفرة.\n\nأكّد بريدك الإلكتروني عبر الرابط التالي:\n{url}\n\nتنتهي صلاحية الرابط خلال {expiresInHours} ساعة.\n\nالتأكيد يتيح لنا ربط أي حجوزات سابقة قمت بها كضيف بالبريد نفسه.\n\nفريق سفرة',
  },
  accountExists: {
    subject: 'محاولة إنشاء حساب — سفرة',
    body: 'تلقّينا طلب إنشاء حساب في سفرة بهذا البريد الإلكتروني، ولديك حساب بالفعل.\n\nإذا كنت أنت من حاول التسجيل، سجّل الدخول من هنا:\n{signInUrl}\n\nنسيت كلمة المرور؟ أعد تعيينها من هنا:\n{resetUrl}\n\nإذا لم تكن أنت، فلا حاجة لأي إجراء — لم يتغيّر شيء في حسابك ولم يطّلع أحد على بياناتك.\n\nفريق سفرة',
  },
  /**
   * The staff roles, for the invitation.
   *
   * The invitation used to interpolate `role.replace(/_/g, ' ')`, so an Arabic email said
   * «بصفة: operations manager» and a German one «als: support agent» (found 2026-08-14). The
   * template now takes the ROLE CODE and resolves it here — the same rule the rest of the platform
   * follows, applied to the one surface where the reader cannot ask what it meant.
   *
   * Keyed by `user_role`, staff values only. `customer` and `partner` are not invited to a console.
   */
  roles: {
    super_admin: 'مدير عام',
    operations_manager: 'مدير عمليات',
    finance_officer: 'مسؤول مالي',
    support_agent: 'موظف دعم',
  } as Record<string, string>,

  staffInvitation: {
    subject: 'دعوة للانضمام إلى فريق سفرة',
    body: 'تمت دعوتك للانضمام إلى لوحة تحكم سفرة بصفة: {roleLabel}.\n\nافتح الرابط التالي لتعيين كلمة المرور الخاصة بك:\n{url}\n\nتنتهي صلاحية الرابط خلال {expiresInHours} ساعة ويمكن استخدامه مرة واحدة فقط.\n\nبعد تعيين كلمة المرور سيُطلب منك تفعيل المصادقة الثنائية قبل استخدام الحساب.\n\nإذا لم تكن تتوقع هذه الدعوة، لا تفتح الرابط وأبلغ فريق سفرة.\n\nفريق سفرة',
  },

  /* ── انضم كشريك (Bashar, 2026-08-19) ── */

  partnerApplicationReceived: {
    subject: 'استلمنا طلب الشراكة — {reference}',
    body: 'شكرًا لاهتمامك بالانضمام إلى سفرة.\n\nرقم طلبك: {reference}\n\nسيتواصل معك فريق سفرة هاتفيًا على الرقم الذي أدخلته للتحقق من بيانات النشاط. بعد المكالمة يُراجع الطلب، وإن قُبل سنرسل لك عقد الشراكة ورابطًا لإنشاء حساب الشريك.\n\nاحتفظ برقم الطلب — إنه ما نبحث به عن طلبك إذا تواصلت معنا.\n\nخطوات الانضمام والمستندات المطلوبة موضحة هنا:\n{url}\n\nفريق سفرة',
  },
  partnerApplicationRejected: {
    subject: 'بخصوص طلب الشراكة — {reference}',
    body: 'شكرًا لوقتك ولاهتمامك بالانضمام إلى سفرة.\n\nبعد مراجعة الطلب {reference} لن نتمكن من المتابعة في الوقت الحالي.\n\nالسبب:\n{reason}\n\nإذا تغيّر أي من ذلك، يمكنك التقدّم بطلب جديد من هنا:\n{url}\n\nفريق سفرة',
  },
  partnerLoginCode: {
    subject: 'رمز الدخول — سفرة',
    body: 'رمز الدخول إلى لوحة الشريك:\n\n{code}\n\nينتهي الرمز خلال {expiresInMinutes} دقائق ويُستخدم مرة واحدة.\n\nإذا لم تحاول تسجيل الدخول، تجاهل هذه الرسالة وغيّر كلمة مرورك — فمن أرسل الطلب يعرف كلمة مرورك الحالية.\n\nلن يطلب منك فريق سفرة هذا الرمز أبدًا، لا عبر الهاتف ولا عبر الرسائل.\n\nفريق سفرة',
  },

  partnerInvitation: {
    subject: 'قُبل طلب الشراكة — أنشئ حساب الشريك',
    body: 'قُبل طلب الشراكة {reference}. أهلًا بك في سفرة.\n\nافتح الرابط التالي لتعيين كلمة مرور حسابك:\n{url}\n\nتنتهي صلاحية الرابط خلال {expiresInHours} ساعة ويمكن استخدامه مرة واحدة فقط. بعد تعيين كلمة المرور يمكنك الدخول مباشرة. في كل مرة تسجّل فيها الدخول نرسل لك رمزًا من ستة أرقام على هذا البريد، وتُدخله لإتمام الدخول.\n\nلن نرسل لك كلمة مرور في رسالة أبدًا. إذا وصلتك رسالة تحتوي كلمة مرور فهي ليست منّا.\n\nيبقى الحساب قيد المراجعة حتى يتحقق فريق سفرة من مستنداتك وعقد الشراكة. قبل ذلك يمكنك تجهيز بيانات عقاراتك، ولا يمكنك إضافة الأسعار أو التواريخ أو الصور.\n\nإذا لم تتقدّم بطلب شراكة، لا تفتح الرابط وأبلغنا.\n\nفريق سفرة',
  },

  /** The contract KINDS, in the reader's language — `partner_contract_kind` in the schema. */
  contractKinds: {
    base: 'عقد شراكة أساسي',
    commission_annex: 'ملحق تعديل عمولة',
    renewal: 'تجديد سنوي',
  } as Record<string, string>,

  /*
    A partner has sent everything, and somebody has to look (Bashar, 2026-08-21).

    Sent ONCE, when the last outstanding document arrives — not per file. Five uploads in a minute
    is one thing to act on, and five emails about it is how a team learns to filter the sender.
  */
  /*
    الطرف الآخر أرسل نسخته الموقّعة (Bashar, 2026-08-21). رسالتان لخطوتين، ولكل منهما قارئ مختلف:
    الأولى تصل الشريك حين توقّع سفرة، والثانية تصل الإدارة حين يعيدها الشريك موقّعة.
  */
  /*
    اكتمل التحقق (Bashar, 2026-08-21). آخر رسالة في رحلة الانضمام، وأول رسالة يقرأها الشريك بصفته
    شريكاً معتمداً — فهي تقول ما صار متاحاً وما الخطوة التالية، لا مجرد «تهانينا».
  */
  partnerApproved: {
    subject: 'تم اعتماد حسابك على سفرة — {reference}',
    body: 'تهانينا، اكتمل التحقق من حسابك وأصبحت شريكاً معتمداً على سفرة.\n\nلوحة الشريك متاحة الآن بكل أقسامها: يمكنك إضافة الوحدات والأسعار والتواريخ والصور، وإرسال إعلاناتك للمراجعة قبل النشر.\n\nافتح لوحة الشريك:\n{url}\n\nفريق سفرة',
  },

  partnerContractAwaitingSignature: {
    subject: 'عقد الشراكة جاهز لتوقيعك — {reference}',
    body: 'وقّعت سفرة عقد الشراكة وأرسلته إليك.\n\nافتح صفحة «العقود والمستندات» في لوحة الشريك، نزّل العقد، وقّعه بخط اليد، ثم ارفع النسخة الموقّعة من الصفحة نفسها.\n\n{url}\n\nيصبح العقد سارياً بعد وصول نسختك الموقّعة.\n\nفريق سفرة',
  },

  partnerContractCountersigned: {
    subject: 'نسختك من عقد الشراكة الموقّع — {reference}',
    body: 'وقّع الطرفان عقد الشراكة، والعقد الآن ساري المفعول.\n\nنسختك محفوظة في صفحة «العقود والمستندات» في لوحة الشريك، ويمكنك تنزيلها في أي وقت:\n{url}\n\nفريق سفرة',
  },

  partnerContractReturned: {
    subject: 'الشريك أعاد العقد موقّعاً — {reference}',
    body: 'أعاد الشريك {displayName} ({reference}) عقد الشراكة موقّعاً بخط اليد، والعقد الآن ساري المفعول.\n\nافتح ملف الشريك لمراجعة النسخة الموقّعة والمتابعة:\n{url}\n\nلوحة تحكم سفرة',
  },

  partnerDocumentsComplete: {
    subject: 'مستندات شريك بانتظار المراجعة — {reference}',
    body: 'أرسل الشريك {displayName} ({reference}) كل المستندات المطلوبة، وهي بانتظار المراجعة.\n\nعدد المستندات المرسلة: {documentCount}\n\nافتح ملف الشريك لمراجعتها:\n{url}\n\nلوحة تحكم سفرة',
  },

  partnerContractReady: {
    subject: 'عقد الشراكة جاهز للتوقيع — {partner}',
    body: 'رفع فريق سفرة عقد الشراكة الخاص بك ({kind}).\n\nيمكنك قراءته وتنزيله من لوحة الشريك:\n{url}\n\nبعد التوقيع أعد إرسال النسخة الموقّعة إلى فريق سفرة ليُسجّل التوقيع ويصبح العقد ساريًا.\n\nفريق سفرة',
  },

  reviewReceived: {
    subject: 'تقييم جديد على {property} — سفرة',
    body: 'وصل تقييم جديد من ضيف أقام في {property}.\n\nالتقييم: {rating} من 5\n\nيمكنك قراءته والرد عليه من لوحة الشريك:\n{url}\n\nردّك يظهر للزوار أسفل التقييم. لا يمكن حذف التقييم ولا تعديله — لا من الضيف ولا من سفرة (المبدأ P-006) — والرد هو الطريقة الوحيدة لعرض وجهة نظرك.\n\nفريق سفرة',
  },
  reviewReplied: {
    subject: 'ردّ المضيف على تقييمك لـ{property} — سفرة',
    body: 'ردّ المضيف على التقييم الذي كتبته عن {property}.\n\nيمكنك قراءة الرد على صفحة الإقامة:\n{url}\n\nفريق سفرة',
  },
  bookingNeedsAction: {
    subject: 'حجز بانتظار ردّك — {reference}',
    body: 'لديك طلب حجز جديد بانتظار قرارك.\n\nالمرجع: {reference}\nالعقار: {property}\nالوصول: {checkIn}\nالمغادرة: {checkOut}\n\nأمامك حتى {deadline} للرد. الطلب الذي لا يُردّ عليه قبل هذا الموعد يُلغى تلقائيًا وتُسجَّل مخالفة «عدم الرد» على حسابك.\n\nافتح الطلب من هنا:\n{url}\n\nفريق سفرة',
  },
  /*
    The reply itself is NOT in this email, and the copy says so.

    Message bodies are stored redacted and the original is not kept (`db/schema/messaging.ts`);
    repeating the text in an inbox would put back exactly what the redaction removed. The sentence
    about it is not an apology — an email that looks truncated reads as a fault, and somebody who
    thinks they have already read the answer does not open the thread.
  */
  giftCardPurchased: {
    subject: 'بطاقة هديتك {reference} — سفرة',
    body: 'تم إصدار بطاقة هدية بقيمة {amount}.\n\nرمز البطاقة:\n{code}\n\nرقم البطاقة: {reference}\n\nاحفظ هذا الرمز في مكان آمن. من يحمل الرمز يستطيع إضافة الرصيد إلى محفظته، ولا نستطيع إرساله مرة أخرى — لا نحتفظ بنسخة منه.\n\nلإضافة الرصيد: افتح «بطاقات الهدايا» في حسابك وأدخل الرمز:\n{url}\n\nفريق سفرة',
  },
  giftCardReceived: {
    subject: 'وصلتك بطاقة هدية من سفرة',
    body: 'أهلاً،\n\nاشترى لك أحدهم بطاقة هدية من سفرة بقيمة {amount}.\n\nرمز البطاقة:\n{code}\n\nرقم البطاقة: {reference}\n\nاحفظ هذا الرمز في مكان آمن. من يحمل الرمز يستطيع إضافة الرصيد إلى محفظته، ولا نستطيع إرساله مرة أخرى — لا نحتفظ بنسخة منه.\n\nلإضافة الرصيد إلى محفظتك:\n{url}\n\nفريق سفرة',
  },
  supportReplied: {
    subject: 'ردّ فريق الدعم على طلبك — {reference}',
    body: 'ردّ فريق سفرة على طلب الدعم الخاص بك.\n\nالمرجع: {reference}\n\nافتح المحادثة لقراءة الرد ومتابعتها:\n{url}\n\nلا نرسل نص الرسائل في البريد الإلكتروني؛ المحادثة كاملة في حسابك.\n\nفريق سفرة',
  },
  /** إشعار إعادة الإرسال — انظر النسخة الإنجليزية للسبب. */
  waiting: {
    subject: 'لديك تحديث في حسابك على سفرة',
    body: 'حدث تحديث في حسابك على سفرة ولم نتمكّن من إرسال البريد في حينه.\n\nافتح هذه الصفحة لعرضه:\n{url}\n\nلا نكرّر التفاصيل في البريد — تجدها في حسابك.\n\nفريق سفرة',
  },
} as const;
