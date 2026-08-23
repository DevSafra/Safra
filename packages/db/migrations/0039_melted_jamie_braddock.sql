CREATE TYPE "public"."partner_employee_status" AS ENUM('active', 'suspended');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'partner_employee' BEFORE 'support_agent';--> statement-breakpoint
CREATE TABLE "partner_employee_roles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"permissions" text[] NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "partner_employees" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"partner_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"status" "partner_employee_status" DEFAULT 'active' NOT NULL,
	"invited_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "partner_employee_roles" ADD CONSTRAINT "partner_employee_roles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_employees" ADD CONSTRAINT "partner_employees_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_employees" ADD CONSTRAINT "partner_employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_employees" ADD CONSTRAINT "partner_employees_role_id_partner_employee_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."partner_employee_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_employees" ADD CONSTRAINT "partner_employees_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_employee_roles_name_unique" ON "partner_employee_roles" USING btree (lower("name")) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_employees_user_unique" ON "partner_employees" USING btree ("user_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "partner_employees_partner_idx" ON "partner_employees" USING btree ("partner_id","status");--> statement-breakpoint
CREATE INDEX "partner_employees_role_idx" ON "partner_employees" USING btree ("role_id");