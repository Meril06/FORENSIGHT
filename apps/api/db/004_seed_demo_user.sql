-- FORENSIGHT - Step 4: a temporary demo trainee
-- DEV ONLY. Real registration and login come in a later step.
-- The password_hash below is NOT a real hash, so nobody can log in as this user.

INSERT INTO users (id, name, email, password_hash, role)
VALUES (
  'd0000000-0000-0000-0000-000000000001',
  'Demo Trainee',
  'demo.trainee@forensight.local',
  'NOT_A_REAL_HASH_DEV_ONLY',
  'TRAINEE'
)
ON CONFLICT (id) DO NOTHING;
