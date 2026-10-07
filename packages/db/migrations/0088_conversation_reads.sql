-- Who on the partner side has read which thread, one row per person (Bashar, 2026-10-07). See the
-- note on `conversation_reads` in packages/db/src/schema/messaging.ts.
CREATE TABLE IF NOT EXISTS "conversation_reads" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "conversation_reads_user_id_conversation_id_pk" PRIMARY KEY("user_id","conversation_id")
);
--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- The badge counts from today: every thread that exists is read by everyone who can read it now.
-- The owner, for every thread on the business and every thread on a booking at their property.
INSERT INTO "conversation_reads" ("conversation_id", "user_id", "seen_at")
SELECT c.id, pa.user_id, now()
FROM conversations c
LEFT JOIN bookings b ON b.id = c.booking_id
JOIN partners pa ON pa.id = coalesce(c.partner_id, b.partner_id)
WHERE pa.user_id IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- And whoever opened a partner-side thread, which is how an employee reaches one.
INSERT INTO "conversation_reads" ("conversation_id", "user_id", "seen_at")
SELECT c.id, c.opened_by_user_id, now()
FROM conversations c
WHERE c.partner_id IS NOT NULL AND c.opened_by_user_id IS NOT NULL
ON CONFLICT DO NOTHING;
