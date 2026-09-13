-- The listing's own one-line headline, above its description on the property page.
--
-- Three nullable columns, mirroring `description_*`: Arabic is the launch language and English and
-- German may follow, so any of the three may be absent. Every one of the 2,700 existing listings is
-- legitimately null — a headline is something a partner writes, not something we can invent for them.
--
-- TEXT rather than VARCHAR(120): the 120 is a PRODUCT rule about what reads well on one line, and it
-- lives in `@safra/contracts` where the three forms that send this all read it. A column-level cap
-- would be a second place to change it, and the two would drift.
ALTER TABLE "properties" ADD COLUMN "headline_ar" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "headline_en" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "headline_de" text;
