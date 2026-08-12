ALTER TABLE "customer_profiles" ALTER COLUMN "reference" SET DEFAULT 'CUS-' || reference_number(nextval('customer_reference_seq'));--> statement-breakpoint
ALTER TABLE "partner_payouts" ALTER COLUMN "reference" SET DEFAULT 'PYT-' || reference_number(nextval('payout_reference_seq'));--> statement-breakpoint
ALTER TABLE "partners" ALTER COLUMN "reference" SET DEFAULT 'PAR-' || reference_number(nextval('partner_reference_seq'));--> statement-breakpoint
ALTER TABLE "properties" ALTER COLUMN "reference" SET DEFAULT 'PRO-' || reference_number(nextval('property_reference_seq'));--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "reference" SET DEFAULT 'BKG-' || to_char(now(), 'YYYY') || '-' || reference_number(nextval('booking_reference_seq'));--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "reference" SET DEFAULT 'PAY-' || reference_number(nextval('payment_reference_seq'));--> statement-breakpoint
ALTER TABLE "gift_cards" ALTER COLUMN "reference" SET DEFAULT 'GIF-' || reference_number(nextval('gift_card_reference_seq'));--> statement-breakpoint
ALTER TABLE "disputes" ALTER COLUMN "reference" SET DEFAULT 'DSP-' || reference_number(nextval('dispute_reference_seq'));--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "reference" SET DEFAULT 'REV-' || reference_number(nextval('review_reference_seq'));--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "reference" SET DEFAULT 'CNV-' || reference_number(nextval('conversation_reference_seq'));--> statement-breakpoint
ALTER TABLE "ad_campaigns" ALTER COLUMN "reference" SET DEFAULT 'ADS-' || reference_number(nextval('ad_reference_seq'));--> statement-breakpoint
ALTER TABLE "advertisers" ALTER COLUMN "reference" SET DEFAULT 'ADV-' || reference_number(nextval('advertiser_reference_seq'));