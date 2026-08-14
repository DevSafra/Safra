CREATE TYPE "public"."gender" AS ENUM('male', 'female', 'undisclosed');--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "gender" "gender" DEFAULT 'undisclosed' NOT NULL;