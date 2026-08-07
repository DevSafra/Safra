CREATE TYPE "public"."job_run_status" AS ENUM('running', 'completed', 'skipped', 'failed');--> statement-breakpoint
CREATE TABLE "scheduled_job_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job" text NOT NULL,
	"status" "job_run_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" text,
	"detail" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE INDEX "scheduled_job_runs_job_idx" ON "scheduled_job_runs" USING btree ("job","started_at");