-- FORENSIGHT - Step 3: database roles
-- forensight_app    = used by the trainee-facing API. CANNOT read the `truth` schema.
-- forensight_scorer = used only by the scoring engine (later). CAN read `truth`.
-- DEV-ONLY passwords. Change them before any real deployment.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'forensight_app') THEN
    CREATE ROLE forensight_app LOGIN PASSWORD 'app_dev_password';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'forensight_scorer') THEN
    CREATE ROLE forensight_scorer LOGIN PASSWORD 'scorer_dev_password';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE forensight TO forensight_app, forensight_scorer;

-- Public (trainee-visible) tables: both roles can use them
GRANT USAGE ON SCHEMA public TO forensight_app, forensight_scorer;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO forensight_app, forensight_scorer;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO forensight_app, forensight_scorer;

-- Tables created in the future get the same permissions automatically
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO forensight_app, forensight_scorer;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO forensight_app, forensight_scorer;

-- Truth schema: ONLY the scorer. forensight_app gets nothing here on purpose.
GRANT USAGE ON SCHEMA truth TO forensight_scorer;
GRANT SELECT ON ALL TABLES IN SCHEMA truth TO forensight_scorer;