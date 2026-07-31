-- Balance carried from a guest profile to the account that claimed it (§4).
--
-- §6.4 credits SLA compensation to whichever profile made the booking, including a
-- guest one. When that guest later registers and verifies their address, the money
-- has to travel with the bookings — otherwise real compensation is stranded on a
-- profile the customer can no longer reach.
--
-- Its own reason rather than `admin_adjustment`, because nobody adjusted anything
-- and the customer's statement has to explain the movement.
ALTER TYPE "public"."wallet_txn_reason" ADD VALUE 'profile_claim';
