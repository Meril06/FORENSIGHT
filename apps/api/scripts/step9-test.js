// Step 9 test: run with   node scripts/step9-test.js
// The API must be running in another terminal (npm run dev).

import { getToken } from './test-auth.js';
const TOKEN = await getToken();

const BASE = 'http://localhost:4000/api';
const CASE_ID = 'c0000000-0000-0000-0000-000000000001';

// Evidence ids look like a0000000-0000-0000-0000-0000000000NN  (NN = 01..10)
const ev = (n) => 'a0000000-0000-0000-0000-' + String(n).padStart(12, '0');
const NOT_REAL = ev(255);

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

const link = (source, target, relationshipType, explanation = 'This is a long enough explanation.') => ({
  sourceArtifactId: source,
  targetArtifactId: target,
  relationshipType,
  explanation,
});

const session = await call('POST', '/sessions', { caseId: CASE_ID, mode: 'MENTOR' });
check('Start a session', session.status, 201);
const sid = session.data.id;

// --- Make links ---
let r = await call('POST', `/sessions/${sid}/relationships`, link(ev(3), ev(9), 'CORROBORATES'));
check('Add EV-003 corroborates EV-009', r.status, 201);
check('Reply contains the new link id', typeof r.data.id, 'string');
check(
  'Reply does NOT say whether the link is right',
  Object.keys(r.data).sort().join(','),
  'id,recorded'
);

r = await call('POST', `/sessions/${sid}/relationships`, link(ev(9), ev(3), 'CORROBORATES'));
check('Same two-way link in reverse is a duplicate', r.status, 409);

r = await call('POST', `/sessions/${sid}/relationships`, link(ev(9), ev(10), 'CONTRADICTS'));
check('Add EV-009 contradicts EV-010', r.status, 201);
const contradictsId = r.data.id;

r = await call('POST', `/sessions/${sid}/relationships`, link(ev(5), ev(4), 'SUPPORTS'));
check('Add EV-005 supports EV-004', r.status, 201);

r = await call('POST', `/sessions/${sid}/relationships`, link(ev(4), ev(5), 'SUPPORTS'));
check('SUPPORTS has a direction, so the reverse is a different link', r.status, 201);

r = await call('POST', `/sessions/${sid}/relationships`, link(ev(5), ev(4), 'SUPPORTS'));
check('The exact same SUPPORTS link twice is a duplicate', r.status, 409);

r = await call('GET', `/sessions/${sid}/relationships`);
check('There are 4 links', r.data.length, 4);
const c = r.data.find((x) => x.relationship_type === 'CONTRADICTS');
check('The contradiction goes from EV-009 to EV-010', `${c?.source_code}>${c?.target_code}`, 'EV-009>EV-010');

// --- Bad input ---
r = await call('POST', `/sessions/${sid}/relationships`, link(ev(1), ev(1), 'SUPPORTS'));
check('Linking evidence to itself is rejected', r.status, 400);

r = await call('POST', `/sessions/${sid}/relationships`, link(ev(1), ev(2), 'LIKES'));
check('Unknown link type is rejected', r.status, 400);

r = await call('POST', `/sessions/${sid}/relationships`, link(ev(1), ev(2), 'SUPPORTS', 'short'));
check('Too-short explanation is rejected', r.status, 400);

r = await call('POST', `/sessions/${sid}/relationships`, link(ev(1), NOT_REAL, 'SUPPORTS'));
check('Unknown evidence gives 404', r.status, 404);

r = await call('POST', `/sessions/${sid}/relationships`, link('not-an-id', ev(2), 'SUPPORTS'));
check('Invalid id is rejected', r.status, 400);

// --- Remove a link ---
r = await call('DELETE', `/sessions/${sid}/relationships/${contradictsId}`);
check('Remove the contradiction', r.status, 200);

r = await call('GET', `/sessions/${sid}/relationships`);
check('Now there are 3 links', r.data.length, 3);

r = await call('DELETE', `/sessions/${sid}/relationships/${contradictsId}`);
check('Removing it again gives 404', r.status, 404);

// --- The browser cannot fake the log entry ---
r = await call('POST', `/sessions/${sid}/actions`, { actionType: 'CORRELATE', targetId: ev(1) });
check('Faking CORRELATE through the generic route is refused', r.status, 403);

// --- The log holds only the real actions: 4 links added + 1 removed (rejected requests are not logged) ---
r = await call('GET', `/sessions/${sid}/actions`);
check('Log has exactly 5 entries (4 adds, 1 remove)', r.data.length, 5);

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
process.exitCode = failed === 0 ? 0 : 1;
