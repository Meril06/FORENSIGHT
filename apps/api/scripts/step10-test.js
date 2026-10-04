// Step 10 test: run with   node scripts/step10-test.js
// The API must be running in another terminal (npm run dev).
// Needs the 006 database change first.

import { getToken } from './test-auth.js';
const TOKEN = await getToken();

const BASE = 'http://localhost:4000/api';
const CASE_ID = 'c0000000-0000-0000-0000-000000000001';

// Evidence ids look like a0000000-0000-0000-0000-0000000000NN  (NN = 01..10)
const ev = (n) => 'a0000000-0000-0000-0000-' + String(n).padStart(12, '0');
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

// --- The menu of possible explanations ---
let r = await call('GET', `/sessions/${sid}/hypothesis-options`);
check('The menu loads', r.status, 200);
check('The menu has 4 explanations', r.data.length, 4);
check(
  'Menu entries have no answer fields (only id, title, description)',
  Object.keys(r.data[0]).sort().join(','),
  'description,id,title'
);
const optA = r.data[0].id;
const optB = r.data[1].id;

// --- Consider two explanations ---
r = await call('POST', `/sessions/${sid}/hypotheses`, { optionId: optA });
check('Consider the first explanation', r.status, 201);
check('Reply does not say which explanation is true', Object.keys(r.data).sort().join(','), 'id,recorded');
const hypA = r.data.id;

r = await call('POST', `/sessions/${sid}/hypotheses`, { optionId: optA });
check('Considering the same explanation twice is refused', r.status, 409);

r = await call('POST', `/sessions/${sid}/hypotheses`, { optionId: optB });
check('Consider a second explanation', r.status, 201);
const hypB = r.data.id;

r = await call('GET', `/sessions/${sid}/hypotheses`);
check('Two hypotheses are listed', r.data.length, 2);

// --- Attach evidence ---
r = await call('PUT', `/sessions/${sid}/hypotheses/${hypA}/evidence/${ev(9)}`, { relationship: 'CONTRADICTS', weight: 3 });
check('Attach EV-009 as contradicting', r.status, 200);

r = await call('PUT', `/sessions/${sid}/hypotheses/${hypA}/evidence/${ev(4)}`, { relationship: 'SUPPORTS', weight: 2 });
check('Attach EV-004 as supporting', r.status, 200);

r = await call('PUT', `/sessions/${sid}/hypotheses/${hypA}/evidence/${ev(4)}`, { relationship: 'UNKNOWN', weight: 1 });
check('Change your mind about EV-004', r.status, 200);

r = await call('GET', `/sessions/${sid}/hypotheses`);
const a = r.data.find((h) => h.id === hypA);
check('The hypothesis has 2 evidence items (EV-004 was updated, not duplicated)', a.evidence.length, 2);
const e4 = a.evidence.find((e) => e.artifact_code === 'EV-004');
check('EV-004 is now UNKNOWN with weight 1', `${e4.relationship}/${e4.weight}`, 'UNKNOWN/1');

// --- Bad input ---
r = await call('PUT', `/sessions/${sid}/hypotheses/${hypA}/evidence/${ev(2)}`, { relationship: 'LOVES', weight: 2 });
check('Unknown relationship is rejected', r.status, 400);

r = await call('PUT', `/sessions/${sid}/hypotheses/${hypA}/evidence/${ev(2)}`, { relationship: 'SUPPORTS', weight: 5 });
check('Weight above 3 is rejected', r.status, 400);

r = await call('PUT', `/sessions/${sid}/hypotheses/${hypA}/evidence/${ev(2)}`, { relationship: 'SUPPORTS', weight: '2' });
check('Weight as text is rejected', r.status, 400);

r = await call('PUT', `/sessions/${sid}/hypotheses/${hypA}/evidence/${NOT_REAL_EVIDENCE}`, { relationship: 'SUPPORTS', weight: 2 });
check('Unknown evidence gives 404', r.status, 404);

r = await call('PUT', `/sessions/${sid}/hypotheses/${NOT_REAL}/evidence/${ev(2)}`, { relationship: 'SUPPORTS', weight: 2 });
check('Unknown hypothesis gives 404', r.status, 404);

r = await call('POST', `/sessions/${sid}/hypotheses`, { optionId: NOT_REAL });
check('Unknown explanation gives 404', r.status, 404);

r = await call('POST', `/sessions/${sid}/hypotheses`, { optionId: 'not-an-id' });
check('Invalid id is rejected', r.status, 400);

// --- Detach and remove ---
r = await call('DELETE', `/sessions/${sid}/hypotheses/${hypA}/evidence/${ev(9)}`);
check('Detach EV-009', r.status, 200);

r = await call('DELETE', `/sessions/${sid}/hypotheses/${hypA}/evidence/${ev(9)}`);
check('Detaching it again gives 404', r.status, 404);

r = await call('DELETE', `/sessions/${sid}/hypotheses/${hypB}`);
check('Stop considering the second explanation', r.status, 200);

r = await call('GET', `/sessions/${sid}/hypotheses`);
check('One hypothesis is left', r.data.length, 1);

// --- The browser cannot fake the log entry ---
r = await call('POST', `/sessions/${sid}/actions`, { actionType: 'CREATE_HYPOTHESIS', targetId: hypA });
check('Faking CREATE_HYPOTHESIS through the generic route is refused', r.status, 403);

// --- Real actions: 2 adopts, 3 attach/update, 1 detach, 1 remove = 7 ---
r = await call('GET', `/sessions/${sid}/actions`);
check('Log has exactly 7 entries', r.data.length, 7);

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
process.exitCode = failed === 0 ? 0 : 1;
