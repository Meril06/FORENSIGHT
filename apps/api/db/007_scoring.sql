-- FORENSIGHT - Step 12: scoring
-- Safe to run more than once.

-- 1. The score explains itself: notes per category, the mode, hints used, and the
--    version of the scoring rules that produced it.
ALTER TABLE scores ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS scorer_version TEXT NOT NULL DEFAULT '';

-- 2. Only the scorer role may WRITE scores. The trainee API may only read them.
REVOKE INSERT, UPDATE, DELETE ON scores FROM forensight_app;

-- 3. The trainee API only ever READS case content, so it should not be able to change it.
--    (If a bug let someone run their own SQL, they still could not edit the evidence.)
REVOKE INSERT, UPDATE, DELETE ON cases, artifacts, timeline_events FROM forensight_app;