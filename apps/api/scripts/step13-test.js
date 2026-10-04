// Step 13 test: run with
//     node --env-file=.env scripts/step13-test.js
// The API must be running in another terminal (npm run dev).

import { getToken } from './test-auth.js';
const TOKEN = await getToken();

const BASE = 'http://localhost:4000/api';
const CASE_ID = 'c0000000-0000-0000-0000-000000000001';
const NOT_REAL = 'f0000000-0000-0000-0000-0000000000ff';

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

// Runs a whole investigation through the real API (same as the Step 12 test).
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
      evidence: [...key.map((n) => ({ artifactId: ev(n), role: 'SUPPORTING' })), { artifactId: ev(10), role: 'SUSPICIOUS' }],
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
  await call('POST', `/sessions/${sid}/conclusion`, conclusion);
  return sid;
}

const entry = (debrief, code) => debrief.evidence.find((e) => e.code === code);
const count = (list, predicate) => list.filter(predicate).length;

// ---------- The debrief is locked while the investigation is open ----------
const open = await call('POST', '/sessions', { caseId: CASE_ID, mode: 'MENTOR' });
let r = await call('GET', `/sessions/${open.data.id}/debrief`);
check('The debrief is refused before the conclusion is submitted', r.status, 409);
check('... and the refusal reveals nothing but an error message', Object.keys(r.data).join(','), 'error');

r = await call('GET', `/sessions/${NOT_REAL}/debrief`);
check('A session that does not exist gives 404', r.status, 404);

// ---------- A flawless investigation ----------
const goodId = await investigate(true);
r = await call('GET', `/sessions/${goodId}/debrief`);
check('Flawless run: the debrief opens', r.status, 200);
let d = r.data;
check('Total score is 100', d.score.total, 100);
check('Seven score categories', d.score.categories.length, 7);
check('All 10 evidence items are explained', d.evidence.length, 10);
check('EV-010 is revealed as POISONED', entry(d, 'EV-010').trueStatus, 'POISONED');
check('EV-010 is flagged as planted', entry(d, 'EV-010').planted, true);
check('The debrief shows that you challenged EV-010', entry(d, 'EV-010').you.challenged, true);
check('EV-010 comes with an explanation of why it is fake', entry(d, 'EV-010').explanation.length > 20, true);
check('EV-006 is revealed as IRRELEVANT', entry(d, 'EV-006').trueStatus, 'IRRELEVANT');
check('Irrelevant evidence has no validation credit', entry(d, 'EV-006').credit, null);
check('9 candidate timeline events', d.timeline.length, 9);
check('5 of them are real', count(d.timeline, (e) => e.real), 5);
check('You included all 5 real events', count(d.timeline, (e) => e.real && e.youIncluded), 5);
check('You included none of the misleading events', count(d.timeline, (e) => !e.real && e.youIncluded), 0);
check('6 key connections', d.connections.length, 6);
check('You made all 6 of them', d.connections.reduce((s, c) => s + c.credit, 0), 6);
check('4 possible explanations', d.hypotheses.length, 4);
check('Exactly one explanation is true', count(d.hypotheses, (h) => h.isTrue), 1);
check('You concluded the true one', d.hypotheses.find((h) => h.isTrue).youConcluded, true);
check('The conclusion is marked correct', d.conclusion.correct, true);
check('No key evidence was missed', d.missedEvidence.length, 0);
check('Mode is recorded', d.session.mode, 'MENTOR');
check('Hints used is recorded', d.session.hintsUsed, 0);

// ---------- A careless investigation ----------
const idleId = await investigate(false);
r = await call('GET', `/sessions/${idleId}/debrief`);
check('Careless run: the debrief opens', r.status, 200);
d = r.data;
check('Total score is 24', d.score.total, 24);
check('All 5 key evidence items were missed', d.missedEvidence.length, 5);
check('EV-010 shows you did not challenge it', entry(d, 'EV-010').you.challenged, false);
check('EV-010 earned no credit', entry(d, 'EV-010').credit, 0);
check('The feedback says you did not notice it', entry(d, 'EV-010').feedback.includes('did not notice'), true);
check('You made none of the key connections', d.connections.reduce((s, c) => s + c.credit, 0), 0);
check('You put no events on the timeline', count(d.timeline, (e) => e.youIncluded), 0);
check('You only considered one explanation', count(d.hypotheses, (h) => h.youConsidered), 1);
check('But your conclusion was the correct one', d.conclusion.correct, true);

// ---------- Same facts, same debrief ----------
const again = await call('GET', `/sessions/${idleId}/debrief`);
check('Opening the debrief twice gives an identical result', JSON.stringify(again.data) === JSON.stringify(d), true);

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
process.exitCode = failed === 0 ? 0 : 1;
