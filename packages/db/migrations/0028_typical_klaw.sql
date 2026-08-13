CREATE TYPE "public"."image_status" AS ENUM('processing', 'ready', 'failed');--> statement-breakpoint
ALTER TABLE "property_images" ADD COLUMN "status" "image_status" DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "property_images" ADD COLUMN "original_key" text;--> statement-breakpoint
ALTER TABLE "property_images" ADD COLUMN "failure_code" text;--> statement-breakpoint
CREATE INDEX "property_images_processing_idx" ON "property_images" USING btree ("updated_at") WHERE status = 'processing';