-- FORENSIGHT - Step 14: real authentication
-- Safe to run more than once.

-- Emails are treated case-insensitively by the login endpoint.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
  ON users (lower(email));

-- Replace the old non-login demo hash with a real development-only password hash.
-- Demo credentials: demo.trainee@forensight.local / Demo@1234
UPDATE users
SET password_hash = 'scrypt$16384$8$1$yR77svrs45aCnPegKa2WCw$bRBMwaTP57HbTfjW7hmzS89xfRNCzOqzTlRGwRsnt9OspFsz6M9DFj24PBZvraW4lq9p1zRGvujU_pwjCY1cpA'
WHERE id = 'd0000000-0000-0000-0000-000000000001';
