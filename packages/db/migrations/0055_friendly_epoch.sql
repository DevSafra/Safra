CREATE TABLE "city_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"name_de" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "city_categories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "city_category_links" (
	"city_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "city_category_links_city_id_category_id_pk" PRIMARY KEY("city_id","category_id")
);
--> statement-breakpoint
--> `post/0015` and `post/0016` already added these by hand, so drizzle is catching up rather
--> than introducing them. `IF NOT EXISTS` keeps this file correct on a database that has them
--> and on a fresh one; without it every existing environment fails on "column already exists".
ALTER TABLE "dispute_evidence" ADD COLUMN IF NOT EXISTS "variant_widths" integer[];--> statement-breakpoint
ALTER TABLE "dispute_evidence" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "city_category_links" ADD CONSTRAINT "city_category_links_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "city_category_links" ADD CONSTRAINT "city_category_links_category_id_city_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."city_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "city_category_links_category_idx" ON "city_category_links" USING btree ("category_id");