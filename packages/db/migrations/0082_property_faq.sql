-- Two FAQs under تقييمات الضيوف on every property page (Bashar, 2026-09-28).
--
-- They look like one feature and are two, and the thing that separates them is WHO KNOWS THE
-- ANSWER. «هل الإفطار مشمول؟» is asked once by SAFRA and has 2,998 different answers, none of
-- them SAFRA's to give. «كيف أُلغي حجزًا؟» has one answer, it is about the platform rather than
-- the property, and a partner must not be able to write it.
--
-- Modelling both as one table with a nullable property_id was the obvious shortcut and is wrong:
-- the two differ in author, in authorization, in lifecycle and in whether anything is required.
-- The join would then have to carry «who may write this row» as data, which is exactly what §1
-- says belongs in a WHERE clause.
--
-- Arabic is NOT NULL and the other two are nullable — the pattern properties, property_types and
-- amenities already follow. Arabic is the source language, `localisedText` falls back to it, and
-- a partner who answers only in Arabic produces a page that works in three languages rather than
-- a German reader meeting an empty accordion.
--
-- Nothing is seeded. An empty question set renders no section at all, which is the correct empty
-- state: a heading over nothing is worse than no heading. Fixtures live in seed-testbed.ts.

CREATE TABLE "property_faq_questions" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "question_ar" text NOT NULL,
  "question_en" text,
  "question_de" text,
  "is_required" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);--> statement-breakpoint

-- The reader's order is the operator's editorial decision, and the page reads active-then-position.
CREATE INDEX "property_faq_questions_order_idx"
  ON "property_faq_questions" USING btree ("is_active", "position");--> statement-breakpoint

CREATE TABLE "property_faq_answers" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "property_id" uuid NOT NULL,
  "question_id" uuid NOT NULL,
  "answer_ar" text NOT NULL,
  "answer_en" text,
  "answer_de" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);--> statement-breakpoint

ALTER TABLE "property_faq_answers" ADD CONSTRAINT "property_faq_answers_property_id_properties_id_fk"
  FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "property_faq_answers" ADD CONSTRAINT "property_faq_answers_question_id_property_faq_questions_id_fk"
  FOREIGN KEY ("question_id") REFERENCES "public"."property_faq_questions"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Partial on deleted_at for the reason _shared.ts gives: P-003 forbids hard deletes, so a
-- soft-deleted answer holding the slot would mean a partner who withdrew an answer could never
-- give another one. "Forever" is literal here.
CREATE UNIQUE INDEX "property_faq_answers_unique"
  ON "property_faq_answers" USING btree ("property_id", "question_id")
  WHERE deleted_at IS NULL;--> statement-breakpoint

-- The page's read: every answer for one listing, joined to its question.
CREATE INDEX "property_faq_answers_property_idx"
  ON "property_faq_answers" USING btree ("property_id");--> statement-breakpoint

CREATE TABLE "general_faq_entries" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "question_ar" text NOT NULL,
  "question_en" text,
  "question_de" text,
  "answer_ar" text NOT NULL,
  "answer_en" text,
  "answer_de" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);--> statement-breakpoint

CREATE INDEX "general_faq_entries_order_idx"
  ON "general_faq_entries" USING btree ("is_active", "position");
