CREATE TABLE "login_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "login_codes" ADD CONSTRAINT "login_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_codes_user_idx" ON "login_codes" USING btree ("user_id","created_at");--> statement-breakpoint
--
-- HAND-WRITTEN: move every partner off the authenticator (Bashar, 2026-08-20).
--
-- Partners stop enrolling a TOTP app and prove a code emailed to them instead. Their existing
-- enrolments are cleared here rather than left in place, because two live mechanisms means two
-- code paths, two failure modes, and a partner asking why a colleague gets an email and they do
-- not. A partner who WANTS an authenticator can enrol one again — it is now an upgrade they
-- choose rather than a gate they pass.
--
-- Nobody is locked out by this. The next sign-in finds no enrolment and emails a code.
--
-- Recovery codes go with the secret. They exist to rescue a lost authenticator, and holding
-- hashes that unlock an account by a route no longer offered is a credential kept for nothing.
--
-- STAFF ARE UNTOUCHED. The predicate names the partner role only, deliberately: the console holds
-- every registry, the ledger, payouts and emergency mode, and a mailbox is a weaker thing to put
-- in front of that.
--
-- `totp_recovery_code_hashes` goes to an EMPTY ARRAY, not NULL — the column is NOT NULL with a
-- `{}` default, and "this account has no recovery codes" is what an empty list already means here.
--
UPDATE "users"
SET "totp_secret_encrypted" = NULL,
    "totp_enabled_at" = NULL,
    "totp_recovery_code_hashes" = '{}',
    "updated_at" = now()
WHERE "role" = 'partner'
  AND ("totp_enabled_at" IS NOT NULL OR "totp_secret_encrypted" IS NOT NULL);
