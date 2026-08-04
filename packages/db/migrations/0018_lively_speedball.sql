CREATE TYPE "public"."outside_scope_access" AS ENUM('none', 'read_only');--> statement-breakpoint
CREATE TYPE "public"."staff_scope_kind" AS ENUM('all_cities', 'cities');--> statement-breakpoint
CREATE TABLE "staff_scope_cities" (
	"user_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_scope_cities_user_id_city_id_pk" PRIMARY KEY("user_id","city_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "scope_kind" "staff_scope_kind" DEFAULT 'all_cities' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "outside_scope_access" "outside_scope_access" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_scope_cities" ADD CONSTRAINT "staff_scope_cities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_scope_cities" ADD CONSTRAINT "staff_scope_cities_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_scope_cities_user_idx" ON "staff_scope_cities" USING btree ("user_id");