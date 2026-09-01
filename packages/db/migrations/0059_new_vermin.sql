ALTER TYPE "public"."wallet_txn_reason" ADD VALUE 'withdrawal';--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN "restricted_amount" numeric(15, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "restricted_balance" numeric(15, 3) DEFAULT '0' NOT NULL;