CREATE TABLE "dead_letter_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"queue" text NOT NULL,
	"name" text NOT NULL,
	"job_id" text NOT NULL,
	"payload" jsonb,
	"error" text,
	"attempts" text NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "dead_letter_jobs_outstanding_idx" ON "dead_letter_jobs" USING btree ("failed_at") WHERE resolved_at IS NULL;--> statement-breakpoint
CREATE INDEX "dead_letter_jobs_queue_idx" ON "dead_letter_jobs" USING btree ("queue","failed_at");