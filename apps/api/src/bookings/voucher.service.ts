import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { toDataURL } from 'qrcode';

import type { Database } from '@safra/db';
import { ERROR } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { notFound } from '../common/errors/app-error.js';
import { renderContractPdf } from '../admin/contract-pdf.js';

/**
 * The booking voucher and its QR code (SRS §6.3 step 6, §6.5).
 *
 * ## What §6.5 asks for, and what it forbids
 *
 * «QR Code يحتوي على Booking ID، اسم العميل، اسم العقار، التواريخ، عدد الضيوف، وحالة الحجز» — the
 * six fields, and one prohibition: «ولا يجب أن يكشف بيانات دفع حساسة». So the code carries what a
 * front desk needs to check somebody in, and no money at all: no total, no method, no card, no
 * payment reference. `payload()` is the whole list, and nothing is added to it without reading that
 * sentence again.
 *
 * ## Why the QR holds the fields rather than a link
 *
 * A URL would be smaller and would let the data change after printing. It would also be useless in
 * the case the voucher exists FOR — §6.5's own «إذا لم يكن لدى العميل إنترنت، يستطيع الشريك البحث
 * برقم الحجز» is about a desk with no connection, and a QR that must be fetched to mean anything
 * fails exactly there. The reference is in the payload too, so a connected desk can still look it
 * up and see the live status.
 *
 * ## Rendered by the browser we already run
 *
 * `renderContractPdf` — the same headless Chromium the partner contracts use, for the same reason:
 * `pdfkit` does no Arabic shaping and no bidi layout, so the customer's name and the property's
 * would print as disconnected left-to-right letterforms on the one document they carry to a desk.
 */
@Injectable()
export class VoucherService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * One voucher, as a PDF.
   *
   * Reads the booking fresh every time rather than storing a rendered file. A voucher is a VIEW of
   * a booking, and a stored one would say «مؤكد» after a cancellation — the document a customer
   * shows at a desk must not be able to disagree with the record behind it.
   */
  async pdf(reference: string): Promise<{ pdf: Buffer; reference: string }> {
    const booking = await this.load(reference);
    const qr = await toDataURL(voucherQrPayload(booking), {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
    });

    return { pdf: await renderContractPdf(voucherHtml(booking, qr)), reference };
  }

  /** The same six fields as a data URI, for an email or a screen that wants only the code. */
  async qr(reference: string): Promise<string> {
    return toDataURL(voucherQrPayload(await this.load(reference)), {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
    });
  }

  /**
   * What the QR will contain, as text — EXPORTED for the test that holds §6.5's prohibition.
   *
   * Without it that test had to rebuild the payload from the fixture, which asserts the string the
   * TEST built rather than the one the code sends. A circular privacy test is worse than none: it
   * reports coverage of the one rule this document has.
   */
  async qrPayload(reference: string): Promise<string> {
    return voucherQrPayload(await this.load(reference));
  }

  private async load(reference: string): Promise<VoucherRow> {
    /*
      No money column is selected, and that is deliberate rather than incidental.

      §6.5 forbids payment data on this document, and the cheapest way to keep that true is for the
      query never to fetch any — a template cannot print what it was not given, and a future edit
      that wants a total has to come back here and read the rule.
    */
    /*
      ## `confirmed_at IS NOT NULL` — §5.6 and §10.1, not a tidiness check

      This document prints «هاتف الشريك», and both sections forbid exactly that before the booking
      is confirmed: «لا تظهر أي وسيلة تواصل مباشرة مع الشريك قبل تأكيد الحجز», «لا يجوز تبادل أرقام
      هواتف أو بيانات تواصل مباشرة قبل تأكيد الحجز». The relationship runs through SAFRA until the
      partner has accepted, and a customer who has paid but is still waiting could reach this by
      TYPING the URL — the customer screen only links it for three statuses, and a link is a
      courtesy while the endpoint is the control.

      Keyed on `confirmed_at` rather than on a list of statuses because that is what the rule
      actually says: the question is whether confirmation has HAPPENED. It admits `checked_in`,
      `completed` and `disputed` without naming them — a guest mid-dispute still has to check in
      somewhere — and it excludes `draft`, `pending_payment` and `pending_confirmation` for ever,
      including any status added later that has not been through confirmation.

      A booking that fails this answers exactly as one that does not exist, so nobody can learn a
      reference is real by watching which refusal they get.
    */
    const rows = await this.db.execute<VoucherRow>(sql`
      SELECT b.reference, b.status::text AS status,
             b.check_in::text AS check_in, b.check_out::text AS check_out,
             b.nights, b.guests_adults, b.guests_children,
             cp.full_name AS customer_name,
             coalesce(pr.name_ar, pr.name_en) AS property_name,
             coalesce(u.name_ar, u.name_en)   AS unit_name,
             ci.name_ar AS city_name,
             p.display_name AS partner_name, p.phone AS partner_phone
      FROM bookings b
      JOIN customer_profiles cp ON cp.id = b.customer_profile_id
      JOIN partners p           ON p.id = b.partner_id
      JOIN properties pr        ON pr.id = b.property_id
      JOIN units u              ON u.id = b.unit_id
      JOIN cities ci            ON ci.id = b.city_id
      WHERE b.reference = ${reference} AND b.deleted_at IS NULL
        AND b.confirmed_at IS NOT NULL
      LIMIT 1
    `);

    const booking = rows.rows[0];

    if (!booking) throw notFound(ERROR.BOOKING_NOT_FOUND);

    return booking;
  }
}

export interface VoucherRow extends Record<string, unknown> {
  reference: string;
  status: string;
  check_in: string;
  check_out: string;
  nights: number;
  guests_adults: number;
  guests_children: number;
  customer_name: string;
  property_name: string;
  unit_name: string;
  city_name: string;
  partner_name: string;
  partner_phone: string;
}

/**
 * §6.5's six fields, and nothing else.
 *
 * Line-per-field text rather than JSON: a desk clerk whose scanner shows raw text can read it, and
 * a JSON blob on a phone screen is a wall of braces. The labels are English keys because a scanner
 * is a machine and the humans reading this raw are the ones debugging it — the VOUCHER carries the
 * Arabic.
 *
 * **No payment data.** Not the total, not the method, not a payment reference. §6.5 says so, and
 * anybody adding a field here should be able to say why it is not money.
 */
export function voucherQrPayload(booking: VoucherRow): string {
  return [
    `SAFRA BOOKING`,
    `ref:${booking.reference}`,
    `guest:${booking.customer_name}`,
    `property:${booking.property_name}`,
    `unit:${booking.unit_name}`,
    `in:${booking.check_in}`,
    `out:${booking.check_out}`,
    `guests:${booking.guests_adults + booking.guests_children}`,
    `status:${booking.status}`,
  ].join('\n');
}

/** HTML-escaped, because every value here is somebody's typed name. */
const esc = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ] ?? character,
  );

/**
 * The voucher itself — Arabic first, English underneath, on one page.
 *
 * The same ordering the transactional emails use and for the same reason: this is the one document
 * where SAFRA does not get to ask which language the reader wants. A voucher is shown to a desk
 * clerk who may read either, forwarded to a travelling companion, and opened on a phone that
 * renders one font badly.
 *
 * `@page` sizing and the fonts are inline because the renderer is given HTML with no network — see
 * `renderContractPdf`. A missing stylesheet would not fail, it would print unstyled, which is the
 * failure mode that reaches a customer rather than a log.
 */
function voucherHtml(booking: VoucherRow, qrDataUri: string): string {
  const guests = booking.guests_adults + booking.guests_children;

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><title>${esc(booking.reference)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { font-family: "Noto Naskh Arabic", "Amiri", "Times New Roman", serif; color: #111; margin: 0; }
  .brand { font-size: 26px; font-weight: 700; letter-spacing: .5px; }
  .ref { font-family: "Courier New", monospace; font-size: 20px; direction: ltr; unicode-bidi: isolate; }
  .rule { border: 0; border-top: 2px solid #111; margin: 14px 0; }
  .grid { display: flex; gap: 24px; align-items: flex-start; }
  .fields { flex: 1; }
  .row { display: flex; gap: 10px; padding: 5px 0; border-bottom: 1px solid #ddd; font-size: 13px; }
  .label { min-width: 120px; color: #555; }
  .value { font-weight: 600; }
  .ltr { direction: ltr; unicode-bidi: isolate; }
  .qr img { width: 150px; height: 150px; }
  .qr p { text-align: center; font-size: 10px; color: #555; margin: 4px 0 0; }
  .en { direction: ltr; text-align: left; margin-top: 22px; }
  .note { font-size: 11px; color: #555; margin-top: 16px; line-height: 1.7; }
</style></head>
<body>
  <div class="brand">سفرة · SAFRA</div>
  <div class="ref">${esc(booking.reference)}</div>
  <hr class="rule">

  <div class="grid">
    <div class="fields">
      <div class="row"><span class="label">العميل</span><span class="value">${esc(booking.customer_name)}</span></div>
      <div class="row"><span class="label">العقار</span><span class="value">${esc(booking.property_name)}</span></div>
      <div class="row"><span class="label">الوحدة</span><span class="value">${esc(booking.unit_name)}</span></div>
      <div class="row"><span class="label">المدينة</span><span class="value">${esc(booking.city_name)}</span></div>
      <div class="row"><span class="label">الوصول</span><span class="value ltr">${esc(booking.check_in)}</span></div>
      <div class="row"><span class="label">المغادرة</span><span class="value ltr">${esc(booking.check_out)}</span></div>
      <div class="row"><span class="label">الليالي</span><span class="value ltr">${booking.nights}</span></div>
      <div class="row"><span class="label">عدد الضيوف</span><span class="value ltr">${guests}</span></div>
      <div class="row"><span class="label">الشريك</span><span class="value">${esc(booking.partner_name)}</span></div>
      <div class="row"><span class="label">هاتف الشريك</span><span class="value ltr">${esc(booking.partner_phone)}</span></div>
    </div>
    <div class="qr">
      <img src="${qrDataUri}" alt="">
      <p>QR</p>
    </div>
  </div>

  <div class="en">
    <div class="row"><span class="label">Guest</span><span class="value">${esc(booking.customer_name)}</span></div>
    <div class="row"><span class="label">Property</span><span class="value">${esc(booking.property_name)}</span></div>
    <div class="row"><span class="label">Unit</span><span class="value">${esc(booking.unit_name)}</span></div>
    <div class="row"><span class="label">City</span><span class="value">${esc(booking.city_name)}</span></div>
    <div class="row"><span class="label">Check-in</span><span class="value">${esc(booking.check_in)}</span></div>
    <div class="row"><span class="label">Check-out</span><span class="value">${esc(booking.check_out)}</span></div>
    <div class="row"><span class="label">Nights</span><span class="value">${booking.nights}</span></div>
    <div class="row"><span class="label">Guests</span><span class="value">${guests}</span></div>
    <div class="row"><span class="label">Partner</span><span class="value">${esc(booking.partner_name)}</span></div>
  </div>

  <p class="note">
    اعرض هذه القسيمة أو رقم الحجز عند الوصول. لا تحتوي على أي بيانات دفع.<br>
    Show this voucher or the booking number on arrival. It carries no payment details.
  </p>
</body></html>`;
}
