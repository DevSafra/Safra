CREATE TABLE "city_images" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"city_id" uuid NOT NULL,
	"file_key" text NOT NULL,
	"variant_widths" integer[] DEFAULT '{}' NOT NULL,
	"width" integer,
	"height" integer,
	"alt_ar" text,
	"alt_en" text,
	"alt_de" text,
	"credit" text,
	"is_hero" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_recovery_code_hashes" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "city_images" ADD CONSTRAINT "city_images_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "city_images_city_idx" ON "city_images" USING btree ("city_id","sort_order");