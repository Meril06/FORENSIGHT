-- FORENSIGHT - Step 8: let the trainee's timeline point at the event it came from.
-- Needed so the scorer can later compare the trainee's choices with the expected timeline.

ALTER TABLE trainee_timeline
  ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES timeline_events(id);

-- The same event cannot be added to one session's timeline twice
ALTER TABLE trainee_timeline
  DROP CONSTRAINT IF EXISTS trainee_timeline_session_event_unique;
ALTER TABLE trainee_timeline
  ADD CONSTRAINT trainee_timeline_session_event_unique UNIQUE (session_id, event_id);