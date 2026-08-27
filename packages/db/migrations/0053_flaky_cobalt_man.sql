ALTER TABLE "ad_campaigns" ADD COLUMN "image_file_key" text;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "image_width" integer;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "image_height" integer;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "image_variant_widths" integer[];--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "image_status" "image_status";--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "image_original_key" text;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "image_failure_code" text;