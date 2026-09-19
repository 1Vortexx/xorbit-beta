-- ══════════════════════════════════════════════════════
-- JITTER — replies sent from the X-ORBIT Desktop notification
-- Run this in the Supabase SQL editor
-- ══════════════════════════════════════════════════════

-- Where a DM was sent from. NULL = Jitter app, 'desktop' = the desktop
-- notification toast / notification center reply field.
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS sent_via TEXT;

COMMENT ON COLUMN dm_messages.sent_via IS 'NULL = sent in Jitter; ''desktop'' = replied from the X-ORBIT Desktop notification';
