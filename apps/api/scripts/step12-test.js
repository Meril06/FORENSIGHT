// Step 12 integration test: run with
//     node --env-file=.env scripts/step12-test.js
// The API must be running in another terminal (npm run dev), and .env must contain
// both DATABASE_URL and DATABASE_URL_SCORER.

import pg from 'pg';
import { scoreSession, getStoredScore, closeScorerPool } from '../src/scoring/score.js';

import { getToken } from './test-auth.js';
const TOKEN = await getToken();

const BASE = 'http://localhost:4000/api';
const CASE_ID = 'c0000000-0000-0000-0000-000000000001';

const ev = (n) => 'a0000000-0000-0000-0000-' + String(n).padStart(12, '0');
const tl = (n) => 'e0000000-0000-0000-0000-' + String(n).padStart(12, '0');

let failed = 0;

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (got ${actual}, expected ${expected})`);
}

// Runs a whole investigation through the real API.
//   thorough = true : a flawless investigation
//   thorough = false: opens everything, then concludes with almost nothing behind it
async function investigate(thorough) {
  const session = await call('POST', '/sessions', { caseId: CASE_ID, mode: 'MENTOR' });
  const sid = session.data.id;

  for (let n = 1; n <= 10; n++) await call('GET', `/sessions/${sid}/artifacts/${ev(n)}`);

  const options = (await call('GET', `/sessions/${sid}/hypothesis-options`)).data;
  const trueOption = options.find((o) => o.title === 'Employee copied the files');
  const otherOption = options.find((o) => o.id !== trueOption.id);
  const h1 = (await call('POST', `/sessions/${sid}/hypotheses`, { optionId: trueOption.id })).data.id;

  let conclusion;
  if (thorough) {
    const key = [2, 3, 4, 7, 9];
    for (const n of key) await call('POST', `/sessions/${sid}/artifacts/${ev(n)}/mark`, { flag: 'RELEVANT', value: true });
    await call('POST', `/sessions/${sid}/artifacts/${ev(10)}/mark`, { flag: 'SUSPICIOUS', value: true });
    await call('POST', `/sessions/${sid}/artifacts/${ev(10)}/challenge`, {
      reason: 'TIMESTAMP_INCONSISTENT',
      explanation: 'It was modified before it was created, and the Security log shows the task was created later.',
      relatedArtifactId: ev(9),
    });
    await call('POST', `/sessions/${sid}/artifacts/${ev(8)}/challenge`, {
      reason: 'INCOMPLETE_OR_TRUNCATED',
      explanation: 'The history stops at 09:16 and the journal file is missing, so it proves nothing after that.',
    });

    for (let n = 1; n <= 5; n++) await call('POST', `/sessions/${sid}/timeline`, { eventId: tl(n) });

    const link = (s, t, type) => call('POST', `/sessions/${sid}/relationships`, {
      sourceArtifactId: ev(s), targetArtifactId: ev(t), relationshipType: type,
      explanation: 'These two records agree with each other.',
    });
    await link(3, 9, 'CORROBORATES');
    await link(3, 7, 'CORROBORATES');
    await link(4, 7, 'CORROBORATES');
    await link(5, 4, 'SUPPORTS');
    await link(2, 4, 'SUPPORTS');
    await link(9, 10, 'CONTRADICTS');

    const h2 = (await call('POST', `/sessions/${sid}/hypotheses`, { optionId: otherOption.id })).data.id;
    for (const n of key) {
      await call('PUT', `/sessions/${sid}/hypotheses/${h1}/evidence/${ev(n)}`, { relationship: 'SUPPORTS', weight: 3 });
    }
    await call('PUT', `/sessions/${sid}/hypotheses/${h2}/evidence/${ev(4)}`, { relationship: 'CONTRADICTS', weight: 2 });

    conclusion = {
      hypothesisId: h1,
      summary: 'The employee copied the acquisition plan to a USB drive.',
      confidence: 'HIGH',
      reasoning: 'Independent records agree on the file being opened and copied; the cleanup task is unreliable.',
      evidence: [
        ...key.map((n) => ({ artifactId: ev(n), role: 'SUPPORTING' })),
        { artifactId: ev(10), role: 'SUSPICIOUS' },
      ],
    };
  } else {
    conclusion = {
      hypothesisId: h1,
      summary: 'I think the employee did it but I have not looked closely.',
      confidence: 'MEDIUM',
      reasoning: 'I opened everything and picked the explanation that sounded right to me.',
      evidence: [{ artifactId: ev(1), role: 'BACKGROUND' }],
    };
  }

  const submitted = await call('POST', `/sessions/${sid}/conclusion`, conclusion);
  return { sid, submitted };
}

// ---------- A flawless investigation ----------
const good = await investigate(true);
check('Flawless run: the conclusion is accepted', good.submitted.status, 201);
check('The reply does not contain the score', 'total' in good.submitted.data, false);

let stored = await getStoredScore(good.sid);
check('A score was stored automatically when the investigation closed', stored !== null, true);
check('Flawless run: total is 100', stored?.total, 100);
for (const [column, max] of [
  ['evidence_discovery', 20], ['evidence_validation', 20], ['timeline_accuracy', 15],
  ['correlation', 15], ['hypothesis_quality', 10], ['reasoning', 10], ['final_conclusion', 10],
]) {
  check(`  ${column} is ${max}`, stored?.[column], max);
}
check('The score records the mode', stored?.details?.mode, 'MENTOR');
check('The score records the rules version', stored?.scorer_version, '1.0.0');
check('The score records hints used', stored?.details?.hintsUsed, 0);

// ---------- Reproducibility ----------
const again = await scoreSession(good.sid);
check('Recalculating from the stored actions gives the same total', again.total, stored?.total);
const storedAgain = await getStoredScore(good.sid);
check('... and the stored score is unchanged', storedAgain?.total, stored?.total);

// ---------- A careless investigation ----------
const idle = await investigate(false);
check('Careless run: the conclusion is accepted', idle.submitted.status, 201);
stored = await getStoredScore(idle.sid);
check('Careless run: total is 24', stored?.total, 24);
check('Careless run: it missed the planted evidence (validation 12.5)', stored?.evidence_validation, 12.5);

// ---------- The database protects the score and the answers ----------
const trainee = new pg.Pool({ connectionString: process.env.DATABASE_URL });
async function sqlError(sql, params = []) {
  try {
    await trainee.query(sql, params);
    return 'no error';
  } catch (e) {
    return e.code; // 42501 means "insufficient privilege"
  }
}
check('The trainee login cannot change a score', await sqlError(`UPDATE scores SET total = 100 WHERE session_id = $1`, [idle.sid]), '42501');
check('The trainee login cannot write a score', await sqlError(
  `INSERT INTO scores (session_id, evidence_discovery, evidence_validation, timeline_accuracy, correlation, hypothesis_quality, reasoning, final_conclusion, total)
   VALUES ($1,0,0,0,0,0,0,0,0)`, ['00000000-0000-0000-0000-000000000000']), '42501');
check('The trainee login cannot edit evidence', await sqlError(`UPDATE artifacts SET name = 'changed'`), '42501');
check('The trainee login cannot read the hidden answers', await sqlError(`SELECT * FROM truth.artifact_truth`), '42501');
await trainee.end();
await closeScorerPool();

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
process.exitCode = failed === 0 ? 0 : 1;
