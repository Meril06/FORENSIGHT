// Step 11 test: run with   node scripts/step11-test.js
// The API must be running in another terminal (npm run dev).

import { getToken } from './test-auth.js';
const TOKEN = await getToken();

const BASE = 'http://localhost:4000/api';
const CASE_ID = 'c0000000-0000-0000-0000-000000000001';

const ev = (n) => 'a0000000-0000-0000-0000-' + String(n).padStart(12, '0');
const EVENT_1 = 'e0000000-0000-0000-0000-000000000001';
const NOT_REAL_EVIDENCE = ev(255);
const NOT_REAL = 'f0000000-0000-0000-0000-0000000000ff';

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

const session = await call('POST', '/sessions', { caseId: CASE_ID, mode: 'MENTOR' });
check('Start a session', session.status, 201);
const sid = session.data.id;

// Setup: consider one explanation
let r = await call('GET', `/sessions/${sid}/hypothesis-options`);
r = await call('POST', `/sessions/${sid}/hypotheses`, { optionId: r.data[0].id });
check('Consider an explanation (setup)', r.status, 201);
const hyp = r.data.id;

r = await call('GET', `/sessions/${sid}/conclusion`);
check('There is no conclusion yet', r.data, null);

// A complete, valid conclusion that we will break one piece at a time
const good = {
  hypothesisId: hyp,
  summary: 'The employee copied the file to a USB drive.',
  confidence: 'MEDIUM',
  reasoning: 'Several independent sources record the same file being opened and then copied.',
  evidence: [
    { artifactId: ev(3), role: 'SUPPORTING' },
    { artifactId: ev(4), role: 'SUPPORTING' },
    { artifactId: ev(10), role: 'SUSPICIOUS' },
  ],
};
const submit = (changes) => call('POST', `/sessions/${sid}/conclusion`, { ...good, ...changes });

// --- Rejected submissions ---
r = await submit({ hypothesisId: NOT_REAL });
check('A hypothesis you are not considering gives 404', r.status, 404);

r = await submit({ summary: 'too short' });
check('Too-short summary is rejected', r.status, 400);

r = await submit({ confidence: 'CERTAIN' });
check('Unknown confidence is rejected', r.status, 400);

r = await submit({ reasoning: 'too short' });
check('Too-short reasoning is rejected', r.status, 400);

r = await submit({ evidence: [] });
check('No evidence is rejected', r.status, 400);

r = await submit({ evidence: [{ artifactId: ev(3), role: 'AMAZING' }] });
check('Unknown evidence role is rejected', r.status, 400);

r = await submit({ evidence: [{ artifactId: ev(3), role: 'SUPPORTING' }, { artifactId: ev(3), role: 'BACKGROUND' }] });
check('Listing the same evidence twice is rejected', r.status, 400);

r = await submit({ evidence: [{ artifactId: NOT_REAL_EVIDENCE, role: 'SUPPORTING' }] });
check('Unknown evidence gives 404', r.status, 404);

r = await call('GET', `/sessions/${sid}`);
check('Failed attempts do not end the investigation', r.data.status, 'ACTIVE');

// --- The real submission ---
r = await submit({});
check('A valid conclusion is accepted', r.status, 201);
check('Reply has no score and no hint about the truth', Object.keys(r.data).sort().join(','), 'message,recorded,status');

r = await call('GET', `/sessions/${sid}`);
check('The session is now COMPLETED', r.data.status, 'COMPLETED');
check('The completion time is recorded', typeof r.data.completed_at, 'string');

r = await call('GET', `/sessions/${sid}/conclusion`);
check('The saved summary matches', r.data.summary, good.summary);
check('The saved conclusion has 3 evidence items', r.data.evidence.length, 3);

// --- Everything is closed afterwards ---
r = await submit({});
check('Submitting a second time gives 409', r.status, 409);

r = await call('POST', `/sessions/${sid}/actions`, { actionType: 'SEARCH', metadata: { query: 'usb' } });
check('Logging more actions is refused', r.status, 409);

r = await call('POST', `/sessions/${sid}/timeline`, { eventId: EVENT_1 });
check('Changing the timeline is refused', r.status, 409);

r = await call('GET', `/sessions/${sid}/hypotheses`);
check('Reading is still allowed', r.status, 200);

// --- The log: 1 hypothesis + 1 conclusion ---
r = await call('GET', `/sessions/${sid}/actions`);
check('Log has exactly 2 entries', r.data.length, 2);
check('The last entry is SUBMIT_CONCLUSION', r.data[r.data.length - 1]?.action_type, 'SUBMIT_CONCLUSION');

// --- The browser cannot fake the conclusion entry ---
const other = await call('POST', '/sessions', { caseId: CASE_ID, mode: 'MENTOR' });
r = await call('POST', `/sessions/${other.data.id}/actions`, { actionType: 'SUBMIT_CONCLUSION' });
check('Faking SUBMIT_CONCLUSION through the generic route is refused', r.status, 403);

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
process.exitCode = failed === 0 ? 0 : 1;
