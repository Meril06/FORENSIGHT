// Step 7 test: run with   node scripts/step7-test.js
// The API must be running in another terminal (npm run dev).

import { getToken } from './test-auth.js';
const TOKEN = await getToken();

const BASE = 'http://localhost:4000/api';
const CASE_ID = 'c0000000-0000-0000-0000-000000000001';
const EV_009 = 'a0000000-0000-0000-0000-000000000009';
const EV_010 = 'a0000000-0000-0000-0000-000000000010';
const NOT_REAL = 'a0000000-0000-0000-0000-0000000000ff';

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
const sid = session.data.id;
const ev010 = `/sessions/${sid}/artifacts/${EV_010}`;

// --- Verify the hash ---
let r = await call('POST', `${ev010}/verify-hash`);
check('Verify hash works', r.status, 200);
check('Hash matches (a match does not prove the content is true)', r.data.matches, true);

// --- Marks ---
r = await call('POST', `${ev010}/mark`, { flag: 'SUSPICIOUS', value: true });
check('Mark suspicious', r.status, 201);
r = await call('POST', `${ev010}/mark`, { flag: 'RELEVANT', value: true });
check('Mark relevant', r.status, 201);
r = await call('POST', `${ev010}/mark`, { flag: 'RELEVANT', value: false });
check('Un-mark relevant (a new log entry, nothing edited)', r.status, 201);

r = await call('GET', `/sessions/${sid}/marks`);
check('Marks: suspicious is on', r.data[EV_010]?.suspicious, true);
check('Marks: relevant is off again', r.data[EV_010]?.relevant, false);
check('Marks: hash was checked', r.data[EV_010]?.hashChecked, true);
check('Marks: not challenged yet', r.data[EV_010]?.challenged, false);

// --- Challenge ---
r = await call('POST', `${ev010}/challenge`, {
  reason: 'TIMESTAMP_INCONSISTENT',
  explanation: 'The file was modified before it was created, which should not be possible.',
  relatedArtifactId: EV_009,
});
check('Challenge is accepted', r.status, 201);
check('Challenge is recorded', r.data.recorded, true);
check(
  'Reply does NOT reveal whether the challenge was right',
  Object.keys(r.data).sort().join(','),
  'message,recorded'
);

r = await call('GET', `/sessions/${sid}/marks`);
check('Marks: now challenged', r.data[EV_010]?.challenged, true);

// --- Bad input ---
r = await call('POST', `${ev010}/challenge`, { reason: 'BECAUSE', explanation: 'This is a long enough text.' });
check('Unknown challenge reason is rejected', r.status, 400);

r = await call('POST', `${ev010}/challenge`, { reason: 'SOURCE_UNRELIABLE', explanation: 'short' });
check('Too-short explanation is rejected', r.status, 400);

r = await call('POST', `${ev010}/challenge`, {
  reason: 'SOURCE_UNRELIABLE',
  explanation: 'This is a long enough text.',
  relatedArtifactId: EV_010,
});
check('Evidence cannot be related to itself', r.status, 400);

r = await call('POST', `${ev010}/mark`, { flag: 'SHINY', value: true });
check('Unknown flag is rejected', r.status, 400);

r = await call('POST', `${ev010}/mark`, { flag: 'RELEVANT', value: 'yes' });
check('Non-boolean value is rejected', r.status, 400);

r = await call('POST', `/sessions/${sid}/artifacts/${NOT_REAL}/mark`, { flag: 'RELEVANT', value: true });
check('Unknown artifact gives 404', r.status, 404);

// --- The browser cannot fake server-only actions ---
r = await call('POST', `/sessions/${sid}/actions`, { actionType: 'HASH_CHECK', targetId: EV_009 });
check('Faking HASH_CHECK through the generic route is refused', r.status, 403);

// --- The log holds exactly the 5 real actions (rejected requests were not logged) ---
r = await call('GET', `/sessions/${sid}/actions`);
check('Log has exactly 5 entries', r.data.length, 5);

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
process.exitCode = failed === 0 ? 0 : 1;
