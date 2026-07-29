ALTER TABLE "bookings" ALTER COLUMN "customer_fee_rate" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "attributes" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "customer_fee_mode" text DEFAULT 'flat' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "customer_fee_value" numeric(12, 4);--> statement-breakpoint
CREATE INDEX "properties_attributes_idx" ON "properties" USING gin ("attributes");