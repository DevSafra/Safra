-- Deliberately NOT backfilled.
--
-- Every partner-side thread that exists today was opened by the owner, so filling this in from
-- `partners.user_id` would be "correct" and is still the wrong move. An employee's scope is
-- `opened_by_user_id = me`, and NULL is excluded by that predicate — so leaving these rows NULL
-- means no employee can read a thread written before employees existed. A backfill changes nothing
-- an employee can see and gives away the property that a row this feature never touched is
-- invisible to it.
ALTER TABLE "conversations" ADD COLUMN "opened_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_partner_opener_idx" ON "conversations" USING btree ("partner_id","opened_by_user_id");