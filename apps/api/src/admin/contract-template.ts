/**
 * The partnership agreement, as a document SAFRA generates rather than a file somebody uploads.
 *
 * ## The wording here is a PLACEHOLDER and is marked as one, on the page
 *
 * Bashar asked for generated contracts on 2026-08-21 and supplies the clauses; this file builds the
 * mechanism around them. Every clause below is written to be replaced, and the rendered document
 * carries a banner saying so in both languages — because the failure mode of a half-finished
 * contract template is that somebody sends it to a partner believing a lawyer wrote it.
 *
 * **Replacing the wording is an edit to `CLAUSES` and nothing else.** The terms that come from the
 * platform — commission, fee, notice period, the parties, the reference — are interpolated, so they
 * cannot drift from what the platform actually charges.
 *
 * ## Why HTML rendered by a browser, and not a PDF library
 *
 * The same reason the receipt gives (`O-fin-2`): `pdfkit` and `pdf-lib` do no contextual glyph
 * shaping and no bidirectional layout, so Arabic comes out as disconnected left-to-right
 * letterforms — perfect to anyone testing in English and unusable for the audience. This document
 * is bilingual and the Arabic half is the operative one for most partners.
 *
 * ## Determinism is a requirement here, not a preference
 *
 * The generated PDF is hashed, and every returned scan records which hash it was signed against —
 * so a partner who signed a superseded revision is a discrepancy the record can show. That is only
 * worth anything if the same terms render to the same bytes, so nothing on the page may vary
 * between two renderings: no generation timestamp, no random id, no locale-dependent number
 * format. Everything is derived from data already fixed by the caller, and there is no `new Date()`
 * in this file.
 *
 * ## Signing is on PAPER
 *
 * Electronic signatures are not accepted in Syria (Bashar, 2026-08-21), so this document is
 * printed, signed by hand and scanned back. The layout leaves room for that — name, signature and
 * date, for each party — and the footnote says what to do with the paper afterwards.
 */

export interface ContractTerms {
  /** §13.2 reference, printed so a paper copy can be matched to a record. */
  readonly partnerReference: string;
  readonly partnerLegalName: string;
  readonly partnerDisplayName: string;
  readonly partnerAddress: string;
  /** The date the document states, supplied by the caller so rendering stays pure. */
  readonly issuedOn: string;
  /** Commission as a PERCENTAGE for display, e.g. 7 — taken from settings, never hardcoded. */
  readonly commissionPercent: number;
  /** The flat customer service fee, formatted by the caller in its own currency. */
  readonly customerFee: string;
  /** Days of notice either party gives to terminate. From settings. */
  readonly noticeDays: number;
}

/**
 * The clauses, in both languages.
 *
 * **This is the block to replace.** Each entry is one numbered clause; `{placeholders}` are filled
 * from `ContractTerms` and must survive any rewrite, or the document will state terms the platform
 * does not apply. The keys are stable so a translation can be checked against its counterpart.
 */
const CLAUSES: readonly { readonly ar: string; readonly en: string }[] = [
  {
    ar: 'يعمل الشريك بصفته مزوّد إقامة مستقلاً، ولا ينشئ هذا العقد علاقة عمل أو وكالة أو شراكة قانونية بين الطرفين.',
    en: 'The Partner operates as an independent accommodation provider. This agreement creates no employment, agency or legal partnership between the parties.',
  },
  {
    ar: 'تتقاضى سفرة عمولة قدرها {commissionPercent}% من قيمة كل حجز مؤكَّد عبر المنصة، وتُخصم من مستحقات الشريك قبل التحويل.',
    en: 'SAFRA charges a commission of {commissionPercent}% of the value of each confirmed booking made through the platform, deducted from the Partner’s payout before transfer.',
  },
  {
    ar: 'تُضاف رسوم خدمة قدرها {customerFee} على العميل عن كل حجز، وهي رسوم سفرة ولا تدخل في مستحقات الشريك.',
    en: 'A service fee of {customerFee} is added to the customer for each booking. It is SAFRA’s fee and forms no part of the Partner’s payout.',
  },
  {
    ar: 'يلتزم الشريك بتأكيد أو رفض طلبات الحجز خلال المهلة المعلنة على المنصة، وبأن تكون بيانات الإقامة والأسعار والتواريخ صحيحة ومحدَّثة.',
    en: 'The Partner shall confirm or decline booking requests within the window published on the platform, and shall keep property details, prices and availability accurate and current.',
  },
  {
    ar: 'تحتفظ سفرة بحق مراجعة الإعلانات قبل نشرها وبحق تعليق أو إزالة أي إعلان يخالف شروط المنصة أو القانون الواجب التطبيق.',
    en: 'SAFRA reserves the right to review listings before publication and to suspend or remove any listing that breaches the platform’s terms or applicable law.',
  },
  {
    ar: 'يجوز لأي من الطرفين إنهاء هذا العقد بإشعار كتابي مدته {noticeDays} يوماً، مع بقاء الحجوزات المؤكَّدة قبل تاريخ الإنهاء سارية.',
    en: 'Either party may terminate this agreement on {noticeDays} days’ written notice. Bookings confirmed before the termination date remain in force.',
  },
];

/** Escapes text for HTML. Every interpolated value goes through it; see the note in `render`. */
function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fill(template: string, terms: ContractTerms): string {
  return template
    .replace(/\{commissionPercent\}/g, String(terms.commissionPercent))
    .replace(/\{customerFee\}/g, escape(terms.customerFee))
    .replace(/\{noticeDays\}/g, String(terms.noticeDays));
}

/**
 * The contract as a self-contained HTML document, ready to be printed to PDF.
 *
 * ## Everything a caller supplies is escaped
 *
 * `partnerLegalName` and `partnerAddress` are partner-controlled: they arrive from the
 * application form the partner filled in themselves. Interpolating them raw would let a partner
 * put markup — or a `<style>` that hides a clause — into a document SAFRA then signs. Escaped at
 * every insertion, without exception, and the clause text is escaped before its placeholders are
 * filled so a partner-supplied value cannot smuggle a placeholder either.
 *
 * ## No external resources
 *
 * No stylesheet, no font, no image loaded over the network. A contract whose appearance depends on
 * a CDN being up is a contract that renders differently depending on when you open it, and the
 * bytes are what both parties sign.
 */
export function renderContractHtml(terms: ContractTerms): string {
  const clauses = CLAUSES.map(
    (clause, index) => `
      <li>
        <p class="ar" dir="rtl" lang="ar">${fill(escape(clause.ar), terms)}</p>
        <p class="en" dir="ltr" lang="en">${index + 1}. ${fill(escape(clause.en), terms)}</p>
      </li>`,
  ).join('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>${escape(terms.partnerReference)}</title>
<style>
  @page { size: A4; margin: 20mm; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; line-height: 1.7; }
  h1 { font-size: 20pt; margin: 0 0 2mm; }
  h2 { font-size: 11pt; margin: 8mm 0 2mm; text-transform: uppercase; letter-spacing: .04em; }
  .sub { color: #555; font-size: 10pt; margin: 0 0 6mm; }
  .draft { border: 2px solid #b00; color: #b00; padding: 3mm 4mm; margin: 0 0 6mm; font-size: 10pt; }
  table.parties { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
  table.parties th { text-align: start; width: 32%; font-weight: 600; color: #444; padding: 1.5mm 0; vertical-align: top; }
  table.parties td { padding: 1.5mm 0; }
  ol { padding-inline-start: 6mm; font-size: 10.5pt; }
  ol li { margin-bottom: 4mm; }
  p.ar { margin: 0; }
  p.en { margin: 1mm 0 0; color: #444; font-size: 9.5pt; }
  .sign { display: flex; gap: 10mm; margin-top: 10mm; page-break-inside: avoid; }
  .sign div { flex: 1; border-top: 1px solid #111; padding-top: 2mm; font-size: 10pt; }
  .foot { margin-top: 8mm; font-size: 8.5pt; color: #666; }
</style>
</head>
<body>
  <h1>عقد شراكة — SAFRA Partnership Agreement</h1>
  <p class="sub">${escape(terms.partnerReference)} · ${escape(terms.issuedOn)}</p>

  <!--
    The banner is not decoration. A template whose clauses have not been through legal review can
    reach a partner by ordinary use of the console, and the only thing standing between that and a
    signed document nobody meant to offer is this paragraph. It is removed by whoever replaces the
    clauses, which makes removing it the last step of finishing them.
  -->
  <p class="draft">
    نموذج أوّلي — لم تُراجَع بنوده قانونياً بعد ولا يصلح للتوقيع.
    <br>
    DRAFT TEMPLATE — the clauses below have not been reviewed by counsel and are not fit for signature.
  </p>

  <h2>الطرفان · The parties</h2>
  <table class="parties">
    <tr><th>سفرة · SAFRA</th><td>SAFRA GmbH</td></tr>
    <tr><th>الشريك · Partner</th><td>${escape(terms.partnerLegalName)}</td></tr>
    <tr><th>الاسم التجاري · Trading as</th><td>${escape(terms.partnerDisplayName)}</td></tr>
    <tr><th>العنوان · Address</th><td>${escape(terms.partnerAddress)}</td></tr>
    <tr><th>المرجع · Reference</th><td>${escape(terms.partnerReference)}</td></tr>
  </table>

  <h2>البنود · Terms</h2>
  <ol>${clauses}</ol>

  <!--
    Signed BY HAND, so the page has to leave room for a pen (Bashar, 2026-08-21).

    An earlier draft of this template ended with "signed electronically through the SAFRA platform",
    which was true of the design it was written for and is not true of this one: electronic
    signatures are not accepted in Syria. The blocks below are what somebody actually writes in,
    and the footnote says what to do with the paper afterwards.
  -->
  <div class="sign">
    <div>
      عن سفرة · For SAFRA<br><br>
      الاسم · Name: ______________________<br><br>
      التوقيع · Signature: ______________________<br><br>
      التاريخ · Date: ______________________
    </div>
    <div>
      عن الشريك · For the Partner<br><br>
      الاسم · Name: ______________________<br><br>
      التوقيع · Signature: ______________________<br><br>
      التاريخ · Date: ______________________
    </div>
  </div>

  <p class="foot">
    يُوقَّع هذا العقد بخط اليد: اطبعه، ووقّعه، ثم ارفع نسخة ممسوحة ضوئياً عبر منصة سفرة. تُسجّل المنصة من رفع كل نسخة ومتى.
    <br>
    Signed by hand: print this document, sign it, then upload a scanned copy through the SAFRA platform. The platform records who uploaded each copy and when.
  </p>
</body>
</html>`;
}
