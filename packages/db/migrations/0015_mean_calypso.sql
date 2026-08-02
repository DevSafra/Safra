CREATE TABLE "sanctions_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"designation_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"name" text NOT NULL,
	"normalised_name" text NOT NULL,
	"programme" text,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sanctions_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"source" text NOT NULL,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" text NOT NULL,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sanctions_entries" ADD CONSTRAINT "sanctions_entries_snapshot_id_sanctions_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."sanctions_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sanctions_entries_snapshot_idx" ON "sanctions_entries" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "sanctions_snapshots_source_idx" ON "sanctions_snapshots" USING btree ("source","completed_at");--> statement-breakpoint
CREATE INDEX "sanctions_snapshots_hash_idx" ON "sanctions_snapshots" USING btree ("source","content_hash");