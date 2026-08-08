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
  staffInvitation: {
    subject: 'دعوة للانضمام إلى فريق سفرة',
    body: 'تمت دعوتك للانضمام إلى لوحة تحكم سفرة بصفة: {roleLabel}.\n\nافتح الرابط التالي لتعيين كلمة المرور الخاصة بك:\n{url}\n\nتنتهي صلاحية الرابط خلال {expiresInHours} ساعة ويمكن استخدامه مرة واحدة فقط.\n\nبعد تعيين كلمة المرور سيُطلب منك تفعيل المصادقة الثنائية قبل استخدام الحساب.\n\nإذا لم تكن تتوقع هذه الدعوة، لا تفتح الرابط وأبلغ فريق سفرة.\n\nفريق سفرة',
  },

  reviewReceived: {
    subject: 'تقييم جديد على {property} — سفرة',
    body: 'وصل تقييم جديد من ضيف أقام في {property}.\n\nالتقييم: {rating} من ٥\n\nيمكنك قراءته والرد عليه من لوحة الشريك:\n{url}\n\nردّك يظهر للزوار أسفل التقييم. لا يمكن حذف التقييم ولا تعديله — لا من الضيف ولا من سفرة (المبدأ P-006) — والرد هو الطريقة الوحيدة لعرض وجهة نظرك.\n\nفريق سفرة',
  },
  reviewReplied: {
    subject: 'ردّ المضيف على تقييمك لـ{property} — سفرة',
    body: 'ردّ المضيف على التقييم الذي كتبته عن {property}.\n\nيمكنك قراءة الرد على صفحة الإقامة:\n{url}\n\nفريق سفرة',
  },
  bookingNeedsAction: {
    subject: 'حجز بانتظار ردّك — {reference}',
    body: 'لديك طلب حجز جديد بانتظار قرارك.\n\nالمرجع: {reference}\nالعقار: {property}\nالوصول: {checkIn}\nالمغادرة: {checkOut}\n\nأمامك حتى {deadline} للرد. الطلب الذي لا يُردّ عليه قبل هذا الموعد يُلغى تلقائيًا وتُسجَّل مخالفة «عدم الرد» على حسابك.\n\nافتح الطلب من هنا:\n{url}\n\nفريق سفرة',
  },
} as const;
