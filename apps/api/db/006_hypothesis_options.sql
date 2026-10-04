-- FORENSIGHT - Step 10: the menu of possible explanations
--
-- truth.case_hypotheses holds the explanations AND which one is true. The trainee API
-- cannot read it. So we copy only the titles and descriptions (never "is_true")
-- into a public table. The ids are the same, so the scorer can join them later.
--
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS hypothesis_options (
  id          UUID PRIMARY KEY,
  case_id     UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL
);

INSERT INTO hypothesis_options (id, case_id, title, description)
SELECT id, case_id, title, description
FROM truth.case_hypotheses
ON CONFLICT (id) DO UPDATE
  SET title = EXCLUDED.title, description = EXCLUDED.description;

-- The trainee API may only READ the menu, never change it
GRANT SELECT ON hypothesis_options TO forensight_app, forensight_scorer;
REVOKE INSERT, UPDATE, DELETE ON hypothesis_options FROM forensight_app;

-- Each trainee hypothesis points at the menu entry it came from, once per session
ALTER TABLE trainee_hypotheses
  ADD COLUMN IF NOT EXISTS option_id UUID REFERENCES hypothesis_options(id);

ALTER TABLE trainee_hypotheses
  DROP CONSTRAINT IF EXISTS trainee_hypotheses_session_option_unique;
ALTER TABLE trainee_hypotheses
  ADD CONSTRAINT trainee_hypotheses_session_option_unique UNIQUE (session_id, option_id);