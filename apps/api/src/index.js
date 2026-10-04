import express from 'express';
import cors from 'cors';
import { pool } from './db.js';
import { wrap, UUID } from './utils.js';
import sessionsRouter from './sessions.js';
import authRouter, { requireAuth } from './auth.js';

const app = express();
app.use(cors());          // lets the website (a different port) call this API
app.use(express.json());  // lets the API read JSON sent by the website

// Authentication (Step 14)
app.use('/api/auth', authRouter);

// Investigation sessions and the action log
app.use('/api/sessions', sessionsRouter);

// 1) Health check: is the API alive and can it reach the database?
app.get('/api/health', wrap(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', database: 'connected' });
}));

// 2) Case library: list all published cases
// NOTE: we list the columns by name on purpose. Never use SELECT * for trainee data.
app.get('/api/cases', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, case_code, title, description, difficulty, category,
            platform, source_type, source_name
     FROM cases
     WHERE status = 'PUBLISHED'
     ORDER BY case_code`
  );
  res.json(rows);
}));

// 3) One case, plus a summary list of its evidence (no hidden truth, no full content yet)
app.get('/api/cases/:id', requireAuth, wrap(async (req, res) => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    return res.status(400).json({ error: 'Invalid case id' });
  }

  const caseResult = await pool.query(
    `SELECT id, case_code, title, description, difficulty, category,
            platform, source_type, source_name, license
     FROM cases
     WHERE id = $1 AND status = 'PUBLISHED'`,
    [id]
  );
  if (caseResult.rows.length === 0) {
    return res.status(404).json({ error: 'Case not found' });
  }

  const artifactResult = await pool.query(
    `SELECT id, artifact_code, name, type, source, description, display_status
     FROM artifacts
     WHERE case_id = $1
     ORDER BY artifact_code`,
    [id]
  );

  res.json({ ...caseResult.rows[0], artifacts: artifactResult.rows });
}));

// Error handler: log details on the server, send a safe message to the browser
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

const port = process.env.PORT || 4000;
app.listen(port, (err) => {
  if (err) {
    console.error(`Could not start the server on port ${port}: ${err.message}`);
    process.exit(1);
  }
  console.log(`FORENSIGHT API running at http://localhost:${port}`);
});