CREATE TYPE "public"."coupon_partner_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "coupon_partners" (
	"coupon_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"status" "coupon_partner_status" DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "coupon_partners_coupon_id_partner_id_pk" PRIMARY KEY("coupon_id","partner_id")
);
--> statement-breakpoint
ALTER TABLE "coupon_partners" ADD CONSTRAINT "coupon_partners_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_partners" ADD CONSTRAINT "coupon_partners_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_partners" ADD CONSTRAINT "coupon_partners_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coupon_partners_partner_idx" ON "coupon_partners" USING btree ("partner_id","status");