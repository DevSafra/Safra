CREATE TABLE "favourites" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"customer_profile_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_customer_profile_id_customer_profiles_id_fk" FOREIGN KEY ("customer_profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "favourites_customer_property_unique" ON "favourites" USING btree ("customer_profile_id","property_id");--> statement-breakpoint
CREATE INDEX "favourites_customer_idx" ON "favourites" USING btree ("customer_profile_id","created_at");