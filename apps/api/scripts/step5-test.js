// Step 5 test: run with   node scripts/step5-test.js
// The API must be running in another terminal (npm run dev).

import { getToken } from './test-auth.js';
const TOKEN = await getToken();

const BASE = 'http://localhost:4000/api';
const CASE_ID = 'c0000000-0000-0000-0000-000000000001';
const EV_010 = 'a0000000-0000-0000-0000-000000000010'; // cleanup_task.xml (the fake one)
const NOT_REAL = 'a0000000-0000-0000-0000-0000000000ff'; // a valid-looking id that does not exist

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

// Start a fresh session so the log is clean
const session = await call('POST', '/sessions', { caseId: CASE_ID, mode: 'MENTOR' });
const sid = session.data.id;

// Open the evidence twice
let r = await call('GET', `/sessions/${sid}/artifacts/${EV_010}`);
check('Open EV-010', r.status, 200);
check('It is EV-010', r.data.artifact_code, 'EV-010');
check('It has a 64-character SHA-256 hash', r.data.sha256?.length, 64);
check('It has inspectable content', typeof r.data.content, 'object');
check('Trainee sees UNVERIFIED', r.data.display_status, 'UNVERIFIED');

// The hidden answers must never be in the response
check('Response has no true_status', 'true_status' in r.data, false);
check('Response has no manipulation_type', 'manipulation_type' in r.data, false);
check('Response has no reason', 'reason' in r.data, false);

await call('GET', `/sessions/${sid}/artifacts/${EV_010}`);

// Bad requests
r = await call('GET', `/sessions/${sid}/artifacts/${NOT_REAL}`);
check('Unknown artifact gives 404', r.status, 404);

r = await call('GET', `/sessions/${sid}/artifacts/not-an-id`);
check('Invalid id gives 400', r.status, 400);

// The server logged the opens by itself
r = await call('GET', `/sessions/${sid}/actions`);
check('Log has exactly 2 entries (failed opens are not logged)', r.data.length, 2);
check('Entry 1 is OPEN_ARTIFACT', r.data[0]?.action_type, 'OPEN_ARTIFACT');
check('Entry 1 points at EV-010', r.data[0]?.target_id, EV_010);

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
process.exitCode = failed === 0 ? 0 : 1;
