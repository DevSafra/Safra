ALTER TABLE "bookings" ALTER COLUMN "customer_fee_value" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" DROP COLUMN "customer_fee_rate";