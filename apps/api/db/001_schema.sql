-- FORENSIGHT - Step 1: core schema
-- Design rule: anything the trainee must never see lives in the `truth` schema.
-- The trainee-facing API connects with a role that has NO access to `truth`.

CREATE SCHEMA IF NOT EXISTS truth;

-- ---------- ENUMS ----------
CREATE TYPE user_role AS ENUM ('TRAINEE', 'INSTRUCTOR', 'ADMIN');
CREATE TYPE difficulty AS ENUM ('EASY', 'MEDIUM', 'HARD', 'EXPERT');
CREATE TYPE evidence_status AS ENUM (
  'GENUINE','LIKELY_GENUINE','UNVERIFIED','INCOMPLETE',
  'CONTRADICTORY','SUSPICIOUS','POISONED','IRRELEVANT'
);
CREATE TYPE relationship_type AS ENUM (
  'SUPPORTS','CONTRADICTS','CORROBORATES','PRECEDES',
  'FOLLOWS','CAUSED_BY','ASSOCIATED_WITH','UNRELATED'
);
CREATE TYPE action_type AS ENUM (
  'OPEN_ARTIFACT','SEARCH','FILTER','HASH_CHECK','MARK_RELEVANT',
  'MARK_SUSPICIOUS','CORRELATE','CREATE_TIMELINE_EVENT','CREATE_HYPOTHESIS',
  'CHALLENGE_EVIDENCE','ASK_AI','SUBMIT_CONCLUSION'
);
CREATE TYPE session_status AS ENUM ('ACTIVE', 'COMPLETED');
-- GUIDED = beginner hand-holding, MENTOR = hints on request, ASSESSMENT = no help.
-- ADVERSARIAL and BLIND (spec section 22) can be added later with ALTER TYPE.
CREATE TYPE session_mode AS ENUM ('GUIDED', 'MENTOR', 'ASSESSMENT');
CREATE TYPE conclusion_role AS ENUM ('SUPPORTING','CONTRADICTING','SUSPICIOUS','BACKGROUND');

-- ---------- PUBLIC (trainee-visible) ----------
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          user_role NOT NULL DEFAULT 'TRAINEE',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cases (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_code        TEXT NOT NULL UNIQUE,            -- e.g. CASE-001
  title            TEXT NOT NULL,
  description      TEXT NOT NULL,
  difficulty       difficulty NOT NULL,
  category         TEXT NOT NULL,
  platform         TEXT NOT NULL,
  source_type      TEXT NOT NULL,                   -- SYNTHETIC | PUBLIC_DATASET | ...
  source_name      TEXT NOT NULL,
  source_reference TEXT,
  license          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'PUBLISHED',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Evidence DNA (trainee-safe fields only)
CREATE TABLE artifacts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id          UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  artifact_code    TEXT NOT NULL,                   -- EV-001
  name             TEXT NOT NULL,
  type             TEXT NOT NULL,
  source           TEXT NOT NULL,
  path             TEXT,
  description      TEXT NOT NULL,
  content          JSONB,                           -- the inspectable body (log lines, metadata)
  sha256           CHAR(64),
  size             BIGINT,
  mime_type        TEXT,
  created_at_ts    TIMESTAMPTZ,                     -- artifact creation time
  modified_at_ts   TIMESTAMPTZ,
  accessed_at_ts   TIMESTAMPTZ,
  acquired_at_ts   TIMESTAMPTZ,
  provenance       TEXT,
  display_status   evidence_status NOT NULL DEFAULT 'UNVERIFIED', -- what trainee sees, never the truth
  UNIQUE (case_id, artifact_code)
);

CREATE TABLE timeline_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  artifact_id UUID REFERENCES artifacts(id),
  event_code  TEXT NOT NULL,                        -- TL-001
  ts          TIMESTAMPTZ NOT NULL,
  event_type  TEXT NOT NULL,
  description TEXT NOT NULL,
  UNIQUE (case_id, event_code)
);

-- ---------- TRUTH (never exposed to trainee role) ----------
CREATE TABLE truth.artifact_truth (
  artifact_id        UUID PRIMARY KEY REFERENCES artifacts(id) ON DELETE CASCADE,
  true_status        evidence_status NOT NULL,
  relevance          NUMERIC(3,2) NOT NULL DEFAULT 0,  -- 0..1
  manipulation_risk  NUMERIC(3,2) NOT NULL DEFAULT 0,
  manipulation_type  TEXT,                             -- e.g. TIMESTAMP_TAMPERING
  reason             TEXT
);

CREATE TABLE truth.case_truth (
  case_id             UUID PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
  primary_hypothesis  TEXT NOT NULL,                   -- code like H1
  incident_occurred   BOOLEAN NOT NULL,
  required_evidence   UUID[] NOT NULL,                 -- artifact ids
  expected_timeline   UUID[] NOT NULL                  -- timeline_events ids, in order
);

CREATE TABLE truth.true_relationships (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id            UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  source_artifact_id UUID NOT NULL REFERENCES artifacts(id),
  target_artifact_id UUID NOT NULL REFERENCES artifacts(id),
  relationship_type  relationship_type NOT NULL,
  explanation        TEXT
);

CREATE TABLE truth.case_hypotheses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,                           -- H1..H4
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  is_true     BOOLEAN NOT NULL,
  UNIQUE (case_id, code)
);

-- ---------- SESSIONS & TRAINEE WORK ----------
CREATE TABLE investigation_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      UUID NOT NULL REFERENCES cases(id),
  trainee_id   UUID NOT NULL REFERENCES users(id),
  mode         session_mode NOT NULL DEFAULT 'MENTOR',
  max_hint_level INT NOT NULL DEFAULT 3 CHECK (max_hint_level BETWEEN 0 AND 5), -- GUIDED=4, MENTOR=3, ASSESSMENT=0
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status       session_status NOT NULL DEFAULT 'ACTIVE'
);

-- Append-only log: the score must be reproducible from this table alone.
CREATE TABLE trainee_actions (
  id          BIGSERIAL PRIMARY KEY,
  session_id  UUID NOT NULL REFERENCES investigation_sessions(id) ON DELETE CASCADE,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  action_type action_type NOT NULL,
  target_id   UUID,
  metadata    JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_actions_session ON trainee_actions(session_id, ts);

CREATE TABLE trainee_relationships (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         UUID NOT NULL REFERENCES investigation_sessions(id) ON DELETE CASCADE,
  source_artifact_id UUID NOT NULL REFERENCES artifacts(id),
  target_artifact_id UUID NOT NULL REFERENCES artifacts(id),
  relationship_type  relationship_type NOT NULL,
  explanation        TEXT
);

CREATE TABLE trainee_timeline (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES investigation_sessions(id) ON DELETE CASCADE,
  artifact_id UUID REFERENCES artifacts(id),
  ts          TIMESTAMPTZ NOT NULL,
  description TEXT NOT NULL,
  position    INT NOT NULL
);

CREATE TABLE trainee_hypotheses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES investigation_sessions(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE trainee_hypothesis_evidence (
  hypothesis_id UUID NOT NULL REFERENCES trainee_hypotheses(id) ON DELETE CASCADE,
  artifact_id   UUID NOT NULL REFERENCES artifacts(id),
  relationship  TEXT NOT NULL CHECK (relationship IN ('SUPPORTS','CONTRADICTS','UNKNOWN')),
  weight        INT NOT NULL DEFAULT 1,
  PRIMARY KEY (hypothesis_id, artifact_id)
);

CREATE TABLE conclusions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            UUID NOT NULL UNIQUE REFERENCES investigation_sessions(id) ON DELETE CASCADE,
  primary_hypothesis_id UUID REFERENCES trainee_hypotheses(id),
  summary               TEXT NOT NULL,
  confidence            TEXT NOT NULL CHECK (confidence IN ('LOW','MEDIUM','HIGH')),
  reasoning             TEXT NOT NULL,
  submitted_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conclusion_evidence (
  conclusion_id UUID NOT NULL REFERENCES conclusions(id) ON DELETE CASCADE,
  artifact_id   UUID NOT NULL REFERENCES artifacts(id),
  role          conclusion_role NOT NULL,
  PRIMARY KEY (conclusion_id, artifact_id)
);

CREATE TABLE scores (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID NOT NULL UNIQUE REFERENCES investigation_sessions(id) ON DELETE CASCADE,
  evidence_discovery  NUMERIC(5,2) NOT NULL,   -- max 20
  evidence_validation NUMERIC(5,2) NOT NULL,   -- max 20
  timeline_accuracy   NUMERIC(5,2) NOT NULL,   -- max 15
  correlation         NUMERIC(5,2) NOT NULL,   -- max 15
  hypothesis_quality  NUMERIC(5,2) NOT NULL,   -- max 10
  reasoning           NUMERIC(5,2) NOT NULL,   -- max 10
  final_conclusion    NUMERIC(5,2) NOT NULL,   -- max 10
  total               NUMERIC(5,2) NOT NULL,
  calculated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- DATABASE ROLES (enforces ground-truth protection) ----------
-- Run once as superuser. The trainee API uses forensight_app; scoring uses forensight_scorer.
-- CREATE ROLE forensight_app    LOGIN PASSWORD 'change_me_app';
-- CREATE ROLE forensight_scorer LOGIN PASSWORD 'change_me_scorer';
-- GRANT USAGE ON SCHEMA public TO forensight_app, forensight_scorer;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO forensight_app, forensight_scorer;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO forensight_app, forensight_scorer;
-- GRANT USAGE ON SCHEMA truth TO forensight_scorer;
-- GRANT SELECT ON ALL TABLES IN SCHEMA truth TO forensight_scorer;
-- (forensight_app gets nothing on `truth`.)