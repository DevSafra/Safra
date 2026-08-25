CREATE TABLE "booking_verifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"booking_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"channel" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"requested_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_verifications" ADD CONSTRAINT "booking_verifications_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_verifications" ADD CONSTRAINT "booking_verifications_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_verifications_booking_idx" ON "booking_verifications" USING btree ("booking_id","created_at");