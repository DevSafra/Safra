CREATE TYPE "public"."contract_signature_party" AS ENUM('safra', 'partner');--> statement-breakpoint
ALTER TYPE "public"."partner_contract_status" ADD VALUE 'draft' BEFORE 'awaiting_partner_signature';--> statement-breakpoint
CREATE TABLE "partner_contract_signatures" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"contract_id" uuid NOT NULL,
	"party" "contract_signature_party" NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"file_hash" text NOT NULL,
	"original_hash" text,
	"ip_address" text,
	"user_agent" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_contract_signatures_one_per_party" UNIQUE("contract_id","party")
);
--> statement-breakpoint
ALTER TABLE "partner_contracts" ADD COLUMN "document_hash" text;--> statement-breakpoint
ALTER TABLE "partner_contracts" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "partner_contract_signatures" ADD CONSTRAINT "partner_contract_signatures_contract_id_partner_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."partner_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_contract_signatures" ADD CONSTRAINT "partner_contract_signatures_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_contract_signatures_contract_idx" ON "partner_contract_signatures" USING btree ("contract_id");