import { Router } from 'express';
import { pool } from './db.js';
import { wrap, UUID } from './utils.js';
import { scoreSession } from './scoring/score.js';
import { buildDebrief } from './scoring/debrief.js';
import { requireAuth, requireRole } from './auth.js';

const router = Router();

// Step 14: every investigation request is authenticated.
router.use(requireAuth);

// Only trainee accounts can create and operate trainee investigation sessions.
router.use(requireRole('TRAINEE'));

// Guidance mode -> the highest hint level the trainee may ask for
const MODES = { GUIDED: 4, MENTOR: 3, ASSESSMENT: 0 };

// Every action the trainee is allowed to log (matches the database list)
const ACTION_TYPES = [
  'OPEN_ARTIFACT', 'SEARCH', 'FILTER', 'HASH_CHECK', 'MARK_RELEVANT',
  'MARK_SUSPICIOUS', 'CORRELATE', 'CREATE_TIMELINE_EVENT', 'CREATE_HYPOTHESIS',
  'CHALLENGE_EVIDENCE', 'ASK_AI', 'SUBMIT_CONCLUSION',
];

// These actions are recorded ONLY by the server's own routes, so the browser
// cannot invent them. The score will be calculated from this log.
const SERVER_RECORDED = [
  'OPEN_ARTIFACT', 'HASH_CHECK', 'MARK_RELEVANT', 'MARK_SUSPICIOUS', 'CHALLENGE_EVIDENCE',
  'CREATE_TIMELINE_EVENT', 'CORRELATE', 'CREATE_HYPOTHESIS', 'SUBMIT_CONCLUSION',
];

// The conclusion form
const CONFIDENCE_LEVELS = ['LOW', 'MEDIUM', 'HIGH'];
const CONCLUSION_ROLES = ['SUPPORTING', 'CONTRADICTING', 'SUSPICIOUS', 'BACKGROUND'];

// How a piece of evidence relates to a hypothesis (this is the TRAINEE's judgement)
const EVIDENCE_RELATIONSHIPS = ['SUPPORTS', 'CONTRADICTS', 'UNKNOWN'];

// How two pieces of evidence can be linked
const RELATIONSHIP_TYPES = [
  'SUPPORTS', 'CONTRADICTS', 'CORROBORATES', 'PRECEDES',
  'FOLLOWS', 'CAUSED_BY', 'ASSOCIATED_WITH', 'UNRELATED',
];
// These read the same in both directions: "A corroborates B" means "B corroborates A"
const SYMMETRIC_TYPES = ['CORROBORATES', 'CONTRADICTS', 'ASSOCIATED_WITH', 'UNRELATED'];

// Why a trainee may challenge a piece of evidence
const CHALLENGE_REASONS = [
  'TIMESTAMP_INCONSISTENT', 'SOURCE_UNRELIABLE', 'CONTRADICTED_BY_OTHER_EVIDENCE',
  'INCOMPLETE_OR_TRUNCATED', 'POSSIBLY_TAMPERED', 'NOT_RELEVANT',
];

async function getSession(id) {
  const { rows } = await pool.query(
    `SELECT id, case_id, trainee_id, mode, max_hint_level, status, started_at, completed_at
     FROM investigation_sessions
     WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

// Start an investigation:  POST /api/sessions   body: { "caseId": "...", "mode": "GUIDED" }
router.post('/', wrap(async (req, res) => {
  const { caseId, mode } = req.body ?? {};

  if (typeof caseId !== 'string' || !UUID.test(caseId)) {
    return res.status(400).json({ error: 'caseId must be a valid id' });
  }
  if (typeof mode !== 'string' || !Object.hasOwn(MODES, mode)) {
    return res.status(400).json({ error: 'mode must be GUIDED, MENTOR or ASSESSMENT' });
  }

  const caseCheck = await pool.query(
    `SELECT 1 FROM cases WHERE id = $1 AND status = 'PUBLISHED'`,
    [caseId]
  );
  if (caseCheck.rows.length === 0) {
    return res.status(404).json({ error: 'Case not found' });
  }

  const { rows } = await pool.query(
    `INSERT INTO investigation_sessions (case_id, trainee_id, mode, max_hint_level)
     VALUES ($1, $2, $3, $4)
     RETURNING id, case_id, mode, max_hint_level, status, started_at`,
    [caseId, req.user.sub, mode, MODES[mode]]
  );
  res.status(201).json(rows[0]);
}));

// Read one session:  GET /api/sessions/:id
router.get('/:id', wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid session id' });
  }
  const session = await getSession(req.params.id);
  if (!session || session.trainee_id !== req.user.sub) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json(session);
}));

// Log an action:  POST /api/sessions/:id/actions
// body: { "actionType": "OPEN_ARTIFACT", "targetId": "...", "metadata": { } }
router.post('/:id/actions', wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid session id' });
  }
  const session = await getSession(req.params.id);
  if (!session || session.trainee_id !== req.user.sub) {
    return res.status(404).json({ error: 'Session not found' });
  }
  if (session.status !== 'ACTIVE') {
    return res.status(409).json({ error: 'This session is already completed' });
  }

  const { actionType, targetId = null, metadata = {} } = req.body ?? {};

  if (!ACTION_TYPES.includes(actionType)) {
    return res.status(400).json({ error: 'Unknown actionType' });
  }
  if (SERVER_RECORDED.includes(actionType)) {
    return res.status(403).json({ error: `${actionType} is recorded by the server only` });
  }
  if (targetId !== null && (typeof targetId !== 'string' || !UUID.test(targetId))) {
    return res.status(400).json({ error: 'targetId must be a valid id or left out' });
  }
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return res.status(400).json({ error: 'metadata must be an object' });
  }

  // The hint rule: the mode decides how much help the trainee may ask for
  if (actionType === 'ASK_AI') {
    const level = metadata.hint_level;
    if (!Number.isInteger(level) || level < 1 || level > 5) {
      return res.status(400).json({ error: 'metadata.hint_level must be a whole number from 1 to 5' });
    }
    if (level > session.max_hint_level) {
      return res.status(403).json({
        error: `${session.mode} mode allows hints up to level ${session.max_hint_level} only`,
      });
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO trainee_actions (session_id, action_type, target_id, metadata)
     VALUES ($1, $2, $3, $4)
     RETURNING id, ts, action_type, target_id, metadata`,
    [session.id, actionType, targetId, metadata]
  );
  res.status(201).json(rows[0]);
}));

// Read the action log:  GET /api/sessions/:id/actions
router.get('/:id/actions', wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid session id' });
  }
  const session = await getSession(req.params.id);
  if (!session || session.trainee_id !== req.user.sub) {
    return res.status(404).json({ error: 'Session not found' });
  }
  const { rows } = await pool.query(
    `SELECT id, ts, action_type, target_id, metadata
     FROM trainee_actions
     WHERE session_id = $1
     ORDER BY ts, id`,
    [session.id]
  );
  res.json(rows);
}));

// Open one piece of evidence:  GET /api/sessions/:id/artifacts/:artifactId
// Returns the full "Evidence DNA". The SERVER records the OPEN_ARTIFACT action,
// so the browser cannot fake or skip it. Hidden truth is never selected here.
router.get('/:id/artifacts/:artifactId', wrap(async (req, res) => {
  const { id, artifactId } = req.params;
  if (!UUID.test(id) || !UUID.test(artifactId)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  const session = await getSession(id);
  if (!session || session.trainee_id !== req.user.sub) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // The artifact must belong to the case this session is investigating
  const { rows } = await pool.query(
    `SELECT id, artifact_code, name, type, source, path, description, content,
            sha256, size, mime_type, created_at_ts, modified_at_ts,
            accessed_at_ts, acquired_at_ts, provenance, display_status
     FROM artifacts
     WHERE id = $1 AND case_id = $2`,
    [artifactId, session.case_id]
  );
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Artifact not found in this case' });
  }

  // Only record the action while the investigation is still active
  if (session.status === 'ACTIVE') {
    await pool.query(
      `INSERT INTO trainee_actions (session_id, action_type, target_id, metadata)
       VALUES ($1, 'OPEN_ARTIFACT', $2, '{}'::jsonb)`,
      [session.id, artifactId]
    );
  }

  res.json(rows[0]);
}));

// ---------------------------------------------------------------------------
// Step 7: validation
// ---------------------------------------------------------------------------

// Shared checks for the routes below. If something is wrong it sends the error
// reply itself and returns null; otherwise it returns the session.
async function loadSessionAndArtifact(req, res) {
  const { id, artifactId } = req.params;
  if (!UUID.test(id) || !UUID.test(artifactId)) {
    res.status(400).json({ error: 'Invalid id' });
    return null;
  }
  const session = await getSession(id);
  if (!session || session.trainee_id !== req.user.sub) {
    res.status(404).json({ error: 'Session not found' });
    return null;
  }
  if (session.status !== 'ACTIVE') {
    res.status(409).json({ error: 'This session is already completed' });
    return null;
  }
  const found = await pool.query(
    `SELECT 1 FROM artifacts WHERE id = $1 AND case_id = $2`,
    [artifactId, session.case_id]
  );
  if (found.rows.length === 0) {
    res.status(404).json({ error: 'Artifact not found in this case' });
    return null;
  }
  return session;
}

// Verify the hash:  POST /api/sessions/:id/artifacts/:artifactId/verify-hash
// The server recalculates the SHA-256 of the stored content and compares it with the
// recorded hash. A match only proves the copy is unchanged since it was collected.
router.post('/:id/artifacts/:artifactId/verify-hash', wrap(async (req, res) => {
  const session = await loadSessionAndArtifact(req, res);
  if (!session) return;

  const { rows } = await pool.query(
    `SELECT sha256 AS stored,
            encode(sha256(convert_to(content::text, 'UTF8')), 'hex') AS computed
     FROM artifacts
     WHERE id = $1`,
    [req.params.artifactId]
  );
  const { stored, computed } = rows[0];
  const matches = stored === computed;

  await pool.query(
    `INSERT INTO trainee_actions (session_id, action_type, target_id, metadata)
     VALUES ($1, 'HASH_CHECK', $2, $3)`,
    [session.id, req.params.artifactId, { matches }]
  );
  res.json({ matches, stored, computed });
}));

// Mark evidence:  POST /api/sessions/:id/artifacts/:artifactId/mark
// body: { "flag": "RELEVANT" or "SUSPICIOUS", "value": true or false }
// The log is never edited. Un-marking is a NEW entry with value false.
router.post('/:id/artifacts/:artifactId/mark', wrap(async (req, res) => {
  const session = await loadSessionAndArtifact(req, res);
  if (!session) return;

  const { flag, value } = req.body ?? {};
  if (flag !== 'RELEVANT' && flag !== 'SUSPICIOUS') {
    return res.status(400).json({ error: 'flag must be RELEVANT or SUSPICIOUS' });
  }
  if (typeof value !== 'boolean') {
    return res.status(400).json({ error: 'value must be true or false' });
  }

  await pool.query(
    `INSERT INTO trainee_actions (session_id, action_type, target_id, metadata)
     VALUES ($1, $2::action_type, $3, $4)`,
    [session.id, `MARK_${flag}`, req.params.artifactId, { value }]
  );
  res.status(201).json({ recorded: true });
}));

// Challenge evidence:  POST /api/sessions/:id/artifacts/:artifactId/challenge
// body: { "reason": "...", "explanation": "...", "relatedArtifactId": "..." (optional) }
// The server records the challenge but does NOT say whether it was right.
// That is revealed in the debrief, after the conclusion.
router.post('/:id/artifacts/:artifactId/challenge', wrap(async (req, res) => {
  const session = await loadSessionAndArtifact(req, res);
  if (!session) return;

  const { reason, explanation, relatedArtifactId = null } = req.body ?? {};
  if (!CHALLENGE_REASONS.includes(reason)) {
    return res.status(400).json({ error: 'Unknown challenge reason' });
  }
  if (typeof explanation !== 'string' || explanation.trim().length < 10 || explanation.length > 1000) {
    return res.status(400).json({ error: 'Explain your challenge in 10 to 1000 characters' });
  }

  if (relatedArtifactId !== null) {
    if (typeof relatedArtifactId !== 'string' || !UUID.test(relatedArtifactId)) {
      return res.status(400).json({ error: 'relatedArtifactId must be a valid id' });
    }
    if (relatedArtifactId === req.params.artifactId) {
      return res.status(400).json({ error: 'Related evidence must be a different item' });
    }
    const related = await pool.query(
      `SELECT 1 FROM artifacts WHERE id = $1 AND case_id = $2`,
      [relatedArtifactId, session.case_id]
    );
    if (related.rows.length === 0) {
      return res.status(400).json({ error: 'Related evidence is not part of this case' });
    }
  }

  await pool.query(
    `INSERT INTO trainee_actions (session_id, action_type, target_id, metadata)
     VALUES ($1, 'CHALLENGE_EVIDENCE', $2, $3)`,
    [
      session.id,
      req.params.artifactId,
      { reason, explanation: explanation.trim(), related_artifact_id: relatedArtifactId },
    ]
  );
  res.status(201).json({
    recorded: true,
    message: 'Challenge recorded. Whether it was justified is revealed in the debrief.',
  });
}));

// Current marks, worked out from the log:  GET /api/sessions/:id/marks
// For each evidence item: is it marked relevant / suspicious, challenged, hash-checked?
router.get('/:id/marks', wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid session id' });
  }
  const session = await getSession(req.params.id);
  if (!session || session.trainee_id !== req.user.sub) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // For each (evidence, action type) keep only the most recent log entry
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (target_id, action_type)
            target_id, action_type,
            COALESCE((metadata->>'value')::boolean, true) AS value
     FROM trainee_actions
     WHERE session_id = $1
       AND target_id IS NOT NULL
       AND action_type IN ('MARK_RELEVANT', 'MARK_SUSPICIOUS', 'CHALLENGE_EVIDENCE', 'HASH_CHECK')
     ORDER BY target_id, action_type, id DESC`,
    [session.id]
  );

  const marks = {};
  for (const r of rows) {
    marks[r.target_id] ??= { relevant: false, suspicious: false, challenged: false, hashChecked: false };
    if (r.action_type === 'MARK_RELEVANT') marks[r.target_id].relevant = r.value;
    if (r.action_type === 'MARK_SUSPICIOUS') marks[r.target_id].suspicious = r.value;
    if (r.action_type === 'CHALLENGE_EVIDENCE') marks[r.target_id].challenged = true;
    if (r.action_type === 'HASH_CHECK') marks[r.target_id].hashChecked = true;
  }
  res.json(marks);
}));

// ---------------------------------------------------------------------------
// Step 8: timeline
// ---------------------------------------------------------------------------

// Finds the session for this request. If something is wrong it sends the error
// reply itself and returns null.
async function loadOwnedSession(req, res, { requireActive }) {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: 'Invalid session id' });
    return null;
  }
  const session = await getSession(req.params.id);
  if (!session || session.trainee_id !== req.user.sub) {
    res.status(404).json({ error: 'Session not found' });
    return null;
  }
  if (requireActive && session.status !== 'ACTIVE') {
    res.status(409).json({ error: 'This session is already completed' });
    return null;
  }
  return session;
}

// The trainee's timeline is always shown in time order: position 1 = earliest.
async function renumberTimeline(sessionId) {
  await pool.query(
    `UPDATE trainee_timeline t
     SET position = r.rn
     FROM (SELECT id, row_number() OVER (ORDER BY ts, id) AS rn
           FROM trainee_timeline
           WHERE session_id = $1) r
     WHERE t.id = r.id`,
    [sessionId]
  );
}

// All events found in the evidence (real ones AND misleading ones, unlabelled):
//   GET /api/sessions/:id/timeline-events
// We deliberately do NOT send event codes: the real events happen to have the
// lowest numbers, so the numbers would give the answer away.
router.get('/:id/timeline-events', wrap(async (req, res) => {
  const session = await loadOwnedSession(req, res, { requireActive: false });
  if (!session) return;

  const { rows } = await pool.query(
    `SELECT e.id, e.ts, e.event_type, e.description, e.artifact_id, a.artifact_code
     FROM timeline_events e
     LEFT JOIN artifacts a ON a.id = e.artifact_id
     WHERE e.case_id = $1
     ORDER BY e.ts, e.id`,
    [session.case_id]
  );
  res.json(rows);
}));

// The trainee's own timeline:  GET /api/sessions/:id/timeline
router.get('/:id/timeline', wrap(async (req, res) => {
  const session = await loadOwnedSession(req, res, { requireActive: false });
  if (!session) return;

  const { rows } = await pool.query(
    `SELECT t.event_id, t.ts, t.description, t.artifact_id, a.artifact_code, t.position
     FROM trainee_timeline t
     LEFT JOIN artifacts a ON a.id = t.artifact_id
     WHERE t.session_id = $1
     ORDER BY t.position`,
    [session.id]
  );
  res.json(rows);
}));

// Add an event to the timeline:  POST /api/sessions/:id/timeline   body: { "eventId": "..." }
router.post('/:id/timeline', wrap(async (req, res) => {
  const session = await loadOwnedSession(req, res, { requireActive: true });
  if (!session) return;

  const { eventId } = req.body ?? {};
  if (typeof eventId !== 'string' || !UUID.test(eventId)) {
    return res.status(400).json({ error: 'eventId must be a valid id' });
  }

  // The event must belong to the case being investigated
  const found = await pool.query(
    `SELECT id, artifact_id, ts, description
     FROM timeline_events
     WHERE id = $1 AND case_id = $2`,
    [eventId, session.case_id]
  );
  if (found.rows.length === 0) {
    return res.status(404).json({ error: 'Event not found in this case' });
  }
  const ev = found.rows[0];

  const inserted = await pool.query(
    `INSERT INTO trainee_timeline (session_id, artifact_id, event_id, ts, description, position)
     VALUES ($1, $2, $3, $4, $5, 0)
     ON CONFLICT (session_id, event_id) DO NOTHING
     RETURNING id`,
    [session.id, ev.artifact_id, ev.id, ev.ts, ev.description]
  );
  if (inserted.rows.length === 0) {
    return res.status(409).json({ error: 'That event is already on your timeline' });
  }

  await renumberTimeline(session.id);
  await pool.query(
    `INSERT INTO trainee_actions (session_id, action_type, target_id, metadata)
     VALUES ($1, 'CREATE_TIMELINE_EVENT', $2, $3)`,
    [session.id, ev.id, { value: true }]
  );
  res.status(201).json({ recorded: true });
}));

// Remove an event:  DELETE /api/sessions/:id/timeline/:eventId
// The row disappears from the timeline, but the log keeps a "value: false" entry.
router.delete('/:id/timeline/:eventId', wrap(async (req, res) => {
  const session = await loadOwnedSession(req, res, { requireActive: true });
  if (!session) return;

  const { eventId } = req.params;
  if (!UUID.test(eventId)) {
    return res.status(400).json({ error: 'Invalid event id' });
  }

  const removed = await pool.query(
    `DELETE FROM trainee_timeline
     WHERE session_id = $1 AND event_id = $2
     RETURNING id`,
    [session.id, eventId]
  );
  if (removed.rows.length === 0) {
    return res.status(404).json({ error: 'That event is not on your timeline' });
  }

  await renumberTimeline(session.id);
  await pool.query(
    `INSERT INTO trainee_actions (session_id, action_type, target_id, metadata)
     VALUES ($1, 'CREATE_TIMELINE_EVENT', $2, $3)`,
    [session.id, eventId, { value: false }]
  );
  res.json({ recorded: true });
}));

// ---------------------------------------------------------------------------
// Step 9: correlation (links between pieces of evidence)
// ---------------------------------------------------------------------------

// The trainee's links:  GET /api/sessions/:id/relationships
router.get('/:id/relationships', wrap(async (req, res) => {
  const session = await loadOwnedSession(req, res, { requireActive: false });
  if (!session) return;

  const { rows } = await pool.query(
    `SELECT r.id,
            r.source_artifact_id, s.artifact_code AS source_code,
            r.target_artifact_id, t.artifact_code AS target_code,
            r.relationship_type, r.explanation
     FROM trainee_relationships r
     JOIN artifacts s ON s.id = r.source_artifact_id
     JOIN artifacts t ON t.id = r.target_artifact_id
     WHERE r.session_id = $1
     ORDER BY s.artifact_code, t.artifact_code, r.relationship_type`,
    [session.id]
  );
  res.json(rows);
}));

// Add a link:  POST /api/sessions/:id/relationships
// body: { sourceArtifactId, targetArtifactId, relationshipType, explanation }
// The server records the link but does NOT say whether it is correct.
router.post('/:id/relationships', wrap(async (req, res) => {
  const session = await loadOwnedSession(req, res, { requireActive: true });
  if (!session) return;

  const { sourceArtifactId, targetArtifactId, relationshipType, explanation } = req.body ?? {};

  for (const value of [sourceArtifactId, targetArtifactId]) {
    if (typeof value !== 'string' || !UUID.test(value)) {
      return res.status(400).json({ error: 'sourceArtifactId and targetArtifactId must be valid ids' });
    }
  }
  if (sourceArtifactId === targetArtifactId) {
    return res.status(400).json({ error: 'Pick two different pieces of evidence' });
  }
  if (!RELATIONSHIP_TYPES.includes(relationshipType)) {
    return res.status(400).json({ error: 'Unknown relationshipType' });
  }
  if (typeof explanation !== 'string' || explanation.trim().length < 10 || explanation.length > 500) {
    return res.status(400).json({ error: 'Explain the link in 10 to 500 characters' });
  }

  // Both pieces of evidence must belong to this session's case
  const both = await pool.query(
    `SELECT id FROM artifacts WHERE case_id = $1 AND id = ANY($2::uuid[])`,
    [session.case_id, [sourceArtifactId, targetArtifactId]]
  );
  if (both.rows.length !== 2) {
    return res.status(404).json({ error: 'Evidence not found in this case' });
  }

  // No duplicates. For two-way types, A->B and B->A count as the same link.
  const symmetric = SYMMETRIC_TYPES.includes(relationshipType);
  const duplicate = await pool.query(
    `SELECT 1 FROM trainee_relationships
     WHERE session_id = $1
       AND relationship_type = $2::relationship_type
       AND ((source_artifact_id = $3 AND target_artifact_id = $4)
            OR ($5::boolean AND source_artifact_id = $4 AND target_artifact_id = $3))`,
    [session.id, relationshipType, sourceArtifactId, targetArtifactId, symmetric]
  );
  if (duplicate.rows.length > 0) {
    return res.status(409).json({ error: 'You already made that link' });
  }

  const inserted = await pool.query(
    `INSERT INTO trainee_relationships
       (session_id, source_artifact_id, target_artifact_id, relationship_type, explanation)
     VALUES ($1, $2, $3, $4::relationship_type, $5)
     RETURNING id`,
    [session.id, sourceArtifactId, targetArtifactId, relationshipType, explanation.trim()]
  );
  const linkId = inserted.rows[0].id;

  await pool.query(
    `INSERT INTO trainee_actions (session_id, action_type, target_id, metadata)
     VALUES ($1, 'CORRELATE', $2, $3)`,
    [
      session.id,
      linkId,
      {
        value: true,
        source_artifact_id: sourceArtifactId,
        target_artifact_id: targetArtifactId,
        relationship_type: relationshipType,
      },
    ]
  );
  res.status(201).json({ recorded: true, id: linkId });
}));

// Remove a link:  DELETE /api/sessions/:id/relationships/:relId
// The link disappears, but the log keeps a "value: false" entry.
router.delete('/:id/relationships/:relId', wrap(async (req, res) => {
  const session = await loadOwnedSession(req, res, { requireActive: true });
  if (!session) return;

  const { relId } = req.params;
  if (!UUID.test(relId)) {
    return res.status(400).json({ error: 'Invalid link id' });
  }

  const removed = await pool.query(
    `DELETE FROM trainee_relationships
     WHERE id = $1 AND session_id = $2
     RETURNING source_artifact_id, target_artifact_id, relationship_type`,
    [relId, session.id]
  );
  if (removed.rows.length === 0) {
    return res.status(404).json({ error: 'Link not found' });
  }
  const link = removed.rows[0];

  await pool.query(
    `INSERT INTO trainee_actions (session_id, action_type, target_id, metadata)
     VALUES ($1, 'CORRELATE', $2, $3)`,
    [
      session.id,
      relId,
      {
        value: false,
        source_artifact_id: link.source_artifact_id,
        target_artifact_id: link.target_artifact_id,
        relationship_type: link.relationship_type,
      },
    ]
  );
  res.json({ recorded: true });
}));

// ---------------------------------------------------------------------------
// Step 10: hypotheses
// ---------------------------------------------------------------------------

// The menu of possible explanations:  GET /api/sessions/:id/hypothesis-options
// Only id, title and description. The order is shuffled differently for every
// session, so the position of the true explanation never gives it away.
router.get('/:id/hypothesis-options', wrap(async (req, res) => {
  const session = await loadOwnedSession(req, res, { requireActive: false });
  if (!session) return;

  const { rows } = await pool.query(
    `SELECT id, title, description
     FROM hypothesis_options
     WHERE case_id = $1
     ORDER BY md5(id::text || $2::text)`,
    [session.case_id, session.id]
  );
  res.json(rows);
}));

// The explanations the trainee is considering, each with its attached evidence:
//   GET /api/sessions/:id/hypotheses
router.get('/:id/hypotheses', wrap(async (req, res) => {
  const session = await loadOwnedSession(req, res, { requireActive: false });
  if (!session) return;

  const hypotheses = await pool.query(
    `SELECT id, option_id, title, description
     FROM trainee_hypotheses
     WHERE session_id = $1
     ORDER BY title`,
    [session.id]
  );
  const evidence = await pool.query(
    `SELECT he.hypothesis_id, he.artifact_id, a.artifact_code, a.name,
            he.relationship, he.weight
     FROM trainee_hypothesis_evidence he
     JOIN trainee_hypotheses th ON th.id = he.hypothesis_id
     JOIN artifacts a ON a.id = he.artifact_id
     WHERE th.session_id = $1
     ORDER BY a.artifact_code`,
    [session.id]
  );

  res.json(
    hypotheses.rows.map((h) => ({
      ...h,
      evidence: evidence.rows.filter((e) => e.hypothesis_id === h.id),
    }))
  );
}));

// Start considering an explanation:  POST /api/sessions/:id/hypotheses   body: { "optionId": "..." }
router.post('/:id/hypotheses', wrap(async (req, res) => {
  const session = await loadOwnedSession(req, res, { requireActive: true });
  if (!session) return;

  const { optionId } = req.body ?? {};
  if (typeof optionId !== 'string' || !UUID.test(optionId)) {
    return res.status(400).json({ error: 'optionId must be a valid id' });
  }

  const option = await pool.query(
    `SELECT id, title, description
     FROM hypothesis_options
     WHERE id = $1 AND case_id = $2`,
    [optionId, session.case_id]
  );
  if (option.rows.length === 0) {
    return res.status(404).json({ error: 'Explanation not found in this case' });
  }
  const o = option.rows[0];

  const inserted = await pool.query(
    `INSERT INTO trainee_hypotheses (session_id, option_id, title, description)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (session_id, option_id) DO NOTHING
     RETURNING id`,
    [session.id, o.id, o.title, o.description]
  );
  if (inserted.rows.length === 0) {
    return res.status(409).json({ error: 'You are already considering that explanation' });
  }

  await pool.query(
    `INSERT INTO trainee_actions (session_id, action_type, target_id, metadata)
     VALUES ($1, 'CREATE_HYPOTHESIS', $2, $3)`,
    [session.id, inserted.rows[0].id, { kind: 'hypothesis', value: true, option_id: o.id }]
  );
  res.status(201).json({ recorded: true, id: inserted.rows[0].id });
}));

// Stop considering it:  DELETE /api/sessions/:id/hypotheses/:hid
// (its attached evidence goes with it; the log keeps a "value: false" entry)
router.delete('/:id/hypotheses/:hid', wrap(async (req, res) => {
  const session = await loadOwnedSession(req, res, { requireActive: true });
  if (!session) return;

  const { hid } = req.params;
  if (!UUID.test(hid)) {
    return res.status(400).json({ error: 'Invalid hypothesis id' });
  }

  const removed = await pool.query(
    `DELETE FROM trainee_hypotheses
     WHERE id = $1 AND session_id = $2
     RETURNING option_id`,
    [hid, session.id]
  );
  if (removed.rows.length === 0) {
    return res.status(404).json({ error: 'Hypothesis not found' });
  }

  await pool.query(
    `INSERT INTO trainee_actions (session_id, action_type, target_id, metadata)
     VALUES ($1, 'CREATE_HYPOTHESIS', $2, $3)`,
    [session.id, hid, { kind: 'hypothesis', value: false, option_id: removed.rows[0].option_id }]
  );
  res.json({ recorded: true });
}));

// Attach (or change) evidence on a hypothesis:
//   PUT /api/sessions/:id/hypotheses/:hid/evidence/:artifactId
//   body: { "relationship": "SUPPORTS" | "CONTRADICTS" | "UNKNOWN", "weight": 1 to 3 }
router.put('/:id/hypotheses/:hid/evidence/:artifactId', wrap(async (req, res) => {
  const session = await loadOwnedSession(req, res, { requireActive: true });
  if (!session) return;

  const { hid, artifactId } = req.params;
  if (!UUID.test(hid) || !UUID.test(artifactId)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  const { relationship, weight } = req.body ?? {};
  if (!EVIDENCE_RELATIONSHIPS.includes(relationship)) {
    return res.status(400).json({ error: 'relationship must be SUPPORTS, CONTRADICTS or UNKNOWN' });
  }
  if (!Number.isInteger(weight) || weight < 1 || weight > 3) {
    return res.status(400).json({ error: 'weight must be a whole number from 1 to 3' });
  }

  const hypothesis = await pool.query(
    `SELECT 1 FROM trainee_hypotheses WHERE id = $1 AND session_id = $2`,
    [hid, session.id]
  );
  if (hypothesis.rows.length === 0) {
    return res.status(404).json({ error: 'Hypothesis not found' });
  }
  const artifact = await pool.query(
    `SELECT 1 FROM artifacts WHERE id = $1 AND case_id = $2`,
    [artifactId, session.case_id]
  );
  if (artifact.rows.length === 0) {
    return res.status(404).json({ error: 'Artifact not found in this case' });
  }

  await pool.query(
    `INSERT INTO trainee_hypothesis_evidence (hypothesis_id, artifact_id, relationship, weight)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (hypothesis_id, artifact_id)
     DO UPDATE SET relationship = EXCLUDED.relationship, weight = EXCLUDED.weight`,
    [hid, artifactId, relationship, weight]
  );
  await pool.query(
    `INSERT INTO trainee_actions (session_id, action_type, target_id, metadata)
     VALUES ($1, 'CREATE_HYPOTHESIS', $2, $3)`,
    [
      session.id,
      hid,
      { kind: 'evidence', value: true, artifact_id: artifactId, relationship, weight },
    ]
  );
  res.json({ recorded: true });
}));

// Detach evidence:  DELETE /api/sessions/:id/hypotheses/:hid/evidence/:artifactId
router.delete('/:id/hypotheses/:hid/evidence/:artifactId', wrap(async (req, res) => {
  const session = await loadOwnedSession(req, res, { requireActive: true });
  if (!session) return;

  const { hid, artifactId } = req.params;
  if (!UUID.test(hid) || !UUID.test(artifactId)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  const hypothesis = await pool.query(
    `SELECT 1 FROM trainee_hypotheses WHERE id = $1 AND session_id = $2`,
    [hid, session.id]
  );
  if (hypothesis.rows.length === 0) {
    return res.status(404).json({ error: 'Hypothesis not found' });
  }

  const removed = await pool.query(
    `DELETE FROM trainee_hypothesis_evidence
     WHERE hypothesis_id = $1 AND artifact_id = $2
     RETURNING relationship, weight`,
    [hid, artifactId]
  );
  if (removed.rows.length === 0) {
    return res.status(404).json({ error: 'That evidence is not attached' });
  }

  await pool.query(
    `INSERT INTO trainee_actions (session_id, action_type, target_id, metadata)
     VALUES ($1, 'CREATE_HYPOTHESIS', $2, $3)`,
    [session.id, hid, { kind: 'evidence', value: false, artifact_id: artifactId }]
  );
  res.json({ recorded: true });
}));

// ---------------------------------------------------------------------------
// Step 11: the conclusion
// ---------------------------------------------------------------------------

// Read the submitted conclusion (or null if there is none yet):
//   GET /api/sessions/:id/conclusion
router.get('/:id/conclusion', wrap(async (req, res) => {
  const session = await loadOwnedSession(req, res, { requireActive: false });
  if (!session) return;

  const conclusion = await pool.query(
    `SELECT c.id, c.summary, c.confidence, c.reasoning, c.submitted_at,
            th.title AS hypothesis_title
     FROM conclusions c
     LEFT JOIN trainee_hypotheses th ON th.id = c.primary_hypothesis_id
     WHERE c.session_id = $1`,
    [session.id]
  );
  if (conclusion.rows.length === 0) {
    return res.json(null);
  }

  const evidence = await pool.query(
    `SELECT ce.artifact_id, a.artifact_code, a.name, ce.role
     FROM conclusion_evidence ce
     JOIN artifacts a ON a.id = ce.artifact_id
     WHERE ce.conclusion_id = $1
     ORDER BY a.artifact_code`,
    [conclusion.rows[0].id]
  );
  res.json({ ...conclusion.rows[0], evidence: evidence.rows });
}));

// Submit the conclusion and END the investigation:  POST /api/sessions/:id/conclusion
// body: { hypothesisId, summary, confidence, reasoning, evidence: [{ artifactId, role }] }
// Nothing is saved unless everything is saved (one transaction), and it can only happen once.
router.post('/:id/conclusion', wrap(async (req, res) => {
  const session = await loadOwnedSession(req, res, { requireActive: true });
  if (!session) return;

  const { hypothesisId, summary, confidence, reasoning, evidence } = req.body ?? {};

  if (typeof hypothesisId !== 'string' || !UUID.test(hypothesisId)) {
    return res.status(400).json({ error: 'Choose one of your hypotheses' });
  }
  if (typeof summary !== 'string' || summary.trim().length < 20 || summary.length > 1000) {
    return res.status(400).json({ error: 'The summary must be 20 to 1000 characters' });
  }
  if (!CONFIDENCE_LEVELS.includes(confidence)) {
    return res.status(400).json({ error: 'confidence must be LOW, MEDIUM or HIGH' });
  }
  if (typeof reasoning !== 'string' || reasoning.trim().length < 30 || reasoning.length > 2000) {
    return res.status(400).json({ error: 'The reasoning must be 30 to 2000 characters' });
  }
  if (!Array.isArray(evidence) || evidence.length < 1 || evidence.length > 10) {
    return res.status(400).json({ error: 'List 1 to 10 pieces of key evidence' });
  }

  const seen = new Set();
  for (const item of evidence) {
    if (!item || typeof item.artifactId !== 'string' || !UUID.test(item.artifactId)) {
      return res.status(400).json({ error: 'Each evidence item needs a valid artifactId' });
    }
    if (!CONCLUSION_ROLES.includes(item.role)) {
      return res.status(400).json({ error: 'Each evidence item needs a valid role' });
    }
    if (seen.has(item.artifactId)) {
      return res.status(400).json({ error: 'Each piece of evidence can be listed only once' });
    }
    seen.add(item.artifactId);
  }

  // The chosen hypothesis must be one this trainee is considering
  const hypothesis = await pool.query(
    `SELECT 1 FROM trainee_hypotheses WHERE id = $1 AND session_id = $2`,
    [hypothesisId, session.id]
  );
  if (hypothesis.rows.length === 0) {
    return res.status(404).json({ error: 'Choose one of the explanations you are considering' });
  }

  // Every piece of evidence must belong to this case
  const ids = [...seen];
  const found = await pool.query(
    `SELECT id FROM artifacts WHERE case_id = $1 AND id = ANY($2::uuid[])`,
    [session.case_id, ids]
  );
  if (found.rows.length !== ids.length) {
    return res.status(404).json({ error: 'Evidence not found in this case' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Close the session first. If it is no longer ACTIVE, someone else got here first.
    const closed = await client.query(
      `UPDATE investigation_sessions
       SET status = 'COMPLETED', completed_at = now()
       WHERE id = $1 AND status = 'ACTIVE'
       RETURNING id`,
      [session.id]
    );
    if (closed.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This session is already completed' });
    }

    const saved = await client.query(
      `INSERT INTO conclusions
         (session_id, primary_hypothesis_id, summary, confidence, reasoning)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [session.id, hypothesisId, summary.trim(), confidence, reasoning.trim()]
    );
    for (const item of evidence) {
      await client.query(
        `INSERT INTO conclusion_evidence (conclusion_id, artifact_id, role)
         VALUES ($1, $2, $3::conclusion_role)`,
        [saved.rows[0].id, item.artifactId, item.role]
      );
    }
    await client.query(
      `INSERT INTO trainee_actions (session_id, action_type, target_id, metadata)
       VALUES ($1, 'SUBMIT_CONCLUSION', $2, $3)`,
      [session.id, hypothesisId, { confidence, evidence_count: evidence.length }]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // The investigation is closed, so score it now. If scoring fails, the conclusion is
  // still saved and the score can be recalculated later (scripts/score-report.js).
  try {
    await scoreSession(session.id);
  } catch (err) {
    console.error('Scoring failed (the conclusion is saved):', err.message);
  }

  // Deliberately no score and no hint about the truth in the reply. That comes in the debrief.
  res.status(201).json({
    recorded: true,
    status: 'COMPLETED',
    message: 'Conclusion submitted. The investigation is now closed.',
  });
}));

// ---------------------------------------------------------------------------
// Step 13: the debrief
// ---------------------------------------------------------------------------

// The reveal:  GET /api/sessions/:id/debrief
// Shows the score AND the hidden answers, so it is refused until the investigation is
// closed. This is the only trainee-facing route that shows ground truth.
router.get('/:id/debrief', wrap(async (req, res) => {
  const session = await loadOwnedSession(req, res, { requireActive: false });
  if (!session) return;

  if (session.status !== 'COMPLETED') {
    return res.status(409).json({
      error: 'The debrief is available after you submit your conclusion.',
    });
  }
  res.json(await buildDebrief(session.id));
}));

export default router;