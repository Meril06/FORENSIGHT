import pg from 'pg';
import { calculateScore } from './calculate.js';

// The scoring code uses its OWN database login (forensight_scorer).
// That login can read the hidden answers. The login used by the trainee-facing routes cannot.
let pool = null;

function getPool() {
  if (!process.env.DATABASE_URL_SCORER) {
    throw new Error('DATABASE_URL_SCORER is not set in apps/api/.env');
  }
  if (!pool) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_SCORER });
    pool.on('error', (err) => console.error('Scorer database connection problem:', err.message));
  }
  return pool;
}

// Scripts call this when they are finished so that Node can exit
export async function closeScorerPool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// Gather everything the scoring function needs: the hidden answers plus what the trainee did.
export async function loadScoringInput(sessionId) {
  const db = getPool();

  const sessionResult = await db.query(
    `SELECT s.id, s.case_id, s.mode, s.status, s.completed_at, c.case_code, c.title
     FROM investigation_sessions s
     JOIN cases c ON c.id = s.case_id
     WHERE s.id = $1`,
    [sessionId]
  );
  const session = sessionResult.rows[0];
  if (!session) throw new Error('Session not found');
  if (session.status !== 'COMPLETED') throw new Error('Only completed sessions can be scored');
  const caseId = session.case_id;

  // ----- the hidden answers (readable only with the scorer login) -----
  const artifacts = await db.query(
    `SELECT a.id, a.artifact_code AS code, a.name, a.type, t.reason, t.true_status::text AS "trueStatus",
            t.relevance::float8 AS relevance, t.manipulation_risk::float8 AS "manipulationRisk",
            t.manipulation_type AS "manipulationType"
     FROM artifacts a
     JOIN truth.artifact_truth t ON t.artifact_id = a.id
     WHERE a.case_id = $1
     ORDER BY a.artifact_code`,
    [caseId]
  );
  const caseTruth = await db.query(
    `SELECT required_evidence::text[] AS "requiredEvidence",
            expected_timeline::text[] AS "expectedTimeline"
     FROM truth.case_truth
     WHERE case_id = $1`,
    [caseId]
  );
  if (caseTruth.rows.length === 0) throw new Error('This case has no ground truth');
  const events = await db.query(
    `SELECT id, event_code AS code, ts, description, artifact_id AS "artifactId"
     FROM timeline_events
     WHERE case_id = $1`,
    [caseId]
  );
  const trueLinks = await db.query(
    `SELECT source_artifact_id AS source, target_artifact_id AS target,
            relationship_type::text AS type, explanation
     FROM truth.true_relationships
     WHERE case_id = $1`,
    [caseId]
  );
  const hypotheses = await db.query(
    `SELECT id, code, title, description, is_true AS "isTrue" FROM truth.case_hypotheses WHERE case_id = $1`,
    [caseId]
  );

  // ----- what the trainee did (worked out from the action log) -----
  const log = await db.query(
    `SELECT action_type::text AS type, target_id, metadata
     FROM trainee_actions
     WHERE session_id = $1
     ORDER BY id`,
    [sessionId]
  );
  const opened = new Set();
  const relevant = new Set();
  const suspicious = new Set();
  const challenges = [];
  let hintsUsed = 0;
  for (const a of log.rows) {
    const on = a.metadata?.value !== false; // "value: false" means the mark was removed
    if (a.type === 'OPEN_ARTIFACT') opened.add(a.target_id);
    else if (a.type === 'MARK_RELEVANT') (on ? relevant.add(a.target_id) : relevant.delete(a.target_id));
    else if (a.type === 'MARK_SUSPICIOUS') (on ? suspicious.add(a.target_id) : suspicious.delete(a.target_id));
    else if (a.type === 'CHALLENGE_EVIDENCE') challenges.push({ artifactId: a.target_id, reason: a.metadata?.reason ?? null });
    else if (a.type === 'ASK_AI') hintsUsed += 1;
  }

  // ----- what the trainee built (the final state) -----
  const timeline = await db.query(
    `SELECT event_id FROM trainee_timeline WHERE session_id = $1 AND event_id IS NOT NULL`,
    [sessionId]
  );
  const links = await db.query(
    `SELECT source_artifact_id AS source, target_artifact_id AS target,
            relationship_type::text AS type
     FROM trainee_relationships
     WHERE session_id = $1`,
    [sessionId]
  );
  const traineeHyps = await db.query(
    `SELECT id, option_id AS "optionId" FROM trainee_hypotheses WHERE session_id = $1`,
    [sessionId]
  );
  const hypEvidence = await db.query(
    `SELECT he.hypothesis_id, he.artifact_id AS "artifactId", he.relationship, he.weight
     FROM trainee_hypothesis_evidence he
     JOIN trainee_hypotheses th ON th.id = he.hypothesis_id
     WHERE th.session_id = $1`,
    [sessionId]
  );
  const conclusionResult = await db.query(
    `SELECT c.id, c.confidence, c.summary, c.reasoning, th.option_id AS "hypothesisOptionId"
     FROM conclusions c
     LEFT JOIN trainee_hypotheses th ON th.id = c.primary_hypothesis_id
     WHERE c.session_id = $1`,
    [sessionId]
  );
  let conclusion = null;
  if (conclusionResult.rows[0]) {
    const c = conclusionResult.rows[0];
    const ce = await db.query(
      `SELECT artifact_id AS "artifactId", role::text AS role FROM conclusion_evidence WHERE conclusion_id = $1`,
      [c.id]
    );
    conclusion = {
      hypothesisOptionId: c.hypothesisOptionId,
      confidence: c.confidence,
      summary: c.summary,
      reasoning: c.reasoning,
      evidence: ce.rows,
    };
  }

  return {
    mode: session.mode,
    session: { id: session.id, completedAt: session.completed_at },
    caseInfo: { code: session.case_code, title: session.title },
    artifacts: artifacts.rows,
    events: events.rows,
    truth: {
      requiredEvidence: caseTruth.rows[0].requiredEvidence,
      expectedTimeline: caseTruth.rows[0].expectedTimeline,
      relationships: trueLinks.rows,
      hypotheses: hypotheses.rows,
    },
    trainee: {
      opened: [...opened],
      markedRelevant: [...relevant],
      markedSuspicious: [...suspicious],
      challenges,
      hintsUsed,
      timelineEventIds: timeline.rows.map((r) => r.event_id),
      relationships: links.rows,
      hypotheses: traineeHyps.rows.map((h) => ({
        optionId: h.optionId,
        evidence: hypEvidence.rows.filter((e) => e.hypothesis_id === h.id),
      })),
      conclusion,
    },
  };
}

// Calculate the score for a completed session and store it (replacing any earlier score).
export async function scoreSession(sessionId) {
  const input = await loadScoringInput(sessionId);
  const result = calculateScore(input);
  const s = result.scores;

  await getPool().query(
    `INSERT INTO scores
       (session_id, evidence_discovery, evidence_validation, timeline_accuracy, correlation,
        hypothesis_quality, reasoning, final_conclusion, total, details, scorer_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (session_id) DO UPDATE SET
       evidence_discovery  = EXCLUDED.evidence_discovery,
       evidence_validation = EXCLUDED.evidence_validation,
       timeline_accuracy   = EXCLUDED.timeline_accuracy,
       correlation         = EXCLUDED.correlation,
       hypothesis_quality  = EXCLUDED.hypothesis_quality,
       reasoning           = EXCLUDED.reasoning,
       final_conclusion    = EXCLUDED.final_conclusion,
       total               = EXCLUDED.total,
       details             = EXCLUDED.details,
       scorer_version      = EXCLUDED.scorer_version,
       calculated_at       = now()`,
    [
      sessionId,
      s.evidence_discovery, s.evidence_validation, s.timeline_accuracy, s.correlation,
      s.hypothesis_quality, s.reasoning, s.final_conclusion,
      result.total,
      result.details,
      result.details.scorerVersion,
    ]
  );
  return result;
}

// The stored score for a session (or null)
export async function getStoredScore(sessionId) {
  const { rows } = await getPool().query(
    `SELECT evidence_discovery::float8 AS evidence_discovery,
            evidence_validation::float8 AS evidence_validation,
            timeline_accuracy::float8 AS timeline_accuracy,
            correlation::float8 AS correlation,
            hypothesis_quality::float8 AS hypothesis_quality,
            reasoning::float8 AS reasoning,
            final_conclusion::float8 AS final_conclusion,
            total::float8 AS total, details, scorer_version
     FROM scores
     WHERE session_id = $1`,
    [sessionId]
  );
  return rows[0] ?? null;
}

// For the report script: the most recently completed session
export async function latestCompletedSessionId() {
  const { rows } = await getPool().query(
    `SELECT id FROM investigation_sessions WHERE status = 'COMPLETED' ORDER BY completed_at DESC LIMIT 1`
  );
  return rows[0]?.id ?? null;
}