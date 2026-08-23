CREATE TABLE "staff_roles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"permissions" text[] NOT NULL,
	"admits_as" "user_role" DEFAULT 'support_agent' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "partner_employee_roles_name_unique";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "staff_role_id" uuid;--> statement-breakpoint
-- partner_employee_roles arrived in migration 0039 EARLIER TODAY, when a role was a single global
-- catalogue defined by the super admin. That model was a misreading of the requirement and is being
-- replaced before it ever shipped: nothing is released, no production row exists, and every row in
-- the table is a testing artefact that belongs to no partner.
--
-- So there is no backfill that would be correct — inventing an owner for these rows would be
-- guessing which business each belongs to. They are removed instead, with the employments that
-- point at them, and the column arrives NOT NULL as it should have from the start.
DELETE FROM partner_employees;--> statement-breakpoint
DELETE FROM partner_employee_roles;--> statement-breakpoint
ALTER TABLE "partner_employee_roles" ADD COLUMN "partner_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_roles_name_unique" ON "staff_roles" USING btree (lower("name")) WHERE deleted_at IS NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_staff_role_id_staff_roles_id_fk" FOREIGN KEY ("staff_role_id") REFERENCES "public"."staff_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_employee_roles" ADD CONSTRAINT "partner_employee_roles_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_employee_roles_partner_idx" ON "partner_employee_roles" USING btree ("partner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_employee_roles_name_unique" ON "partner_employee_roles" USING btree ("partner_id",lower("name")) WHERE deleted_at IS NULL;