DROP INDEX "gift_cards_purchaser_idx";--> statement-breakpoint
CREATE INDEX "gift_cards_purchaser_idx" ON "gift_cards" USING btree ("purchased_by_customer_id","created_at");