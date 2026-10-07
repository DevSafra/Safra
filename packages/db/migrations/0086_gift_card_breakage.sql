-- An expired gift card someone BOUGHT stops being owed and becomes SAFRA's income (Bashar,
-- 2026-10-07). Its own account, so «what did unused gift cards earn us» is one query; see the note on
-- `gift_card_breakage` in packages/db/src/schema/enums.ts.
ALTER TYPE "public"."ledger_account" ADD VALUE IF NOT EXISTS 'gift_card_breakage' AFTER 'gift_card_issued';
