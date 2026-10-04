// Step 4 test: run with   node scripts/step4-test.js
// The API must be running in another terminal (npm run dev).

import { getToken } from './test-auth.js';
const TOKEN = await getToken();

const BASE = 'http://localhost:4000/api';
const CASE_ID = 'c0000000-0000-0000-0000-000000000001';
const EV_002 = 'a0000000-0000-0000-0000-000000000002'; // the USB connection artifact

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

// --- GUIDED session: hints up to level 4 ---
const guided = await call('POST', '/sessions', { caseId: CASE_ID, mode: 'GUIDED' });
check('Start a GUIDED session', guided.status, 201);
check('GUIDED max hint level is 4', guided.data.max_hint_level, 4);
const gid = guided.data.id;

let r = await call('POST', `/sessions/${gid}/actions`, { actionType: 'SEARCH', metadata: { query: 'usb' } });
check('Log a SEARCH', r.status, 201);

r = await call('POST', `/sessions/${gid}/actions`, { actionType: 'OPEN_ARTIFACT', targetId: EV_002 });
check('Faking OPEN_ARTIFACT from the browser is refused', r.status, 403);

r = await call('POST', `/sessions/${gid}/actions`, { actionType: 'ASK_AI', metadata: { hint_level: 4 } });
check('GUIDED may ask a level 4 hint', r.status, 201);

r = await call('POST', `/sessions/${gid}/actions`, { actionType: 'ASK_AI', metadata: { hint_level: 5 } });
check('GUIDED may NOT ask a level 5 hint (the answer)', r.status, 403);

// --- MENTOR session: hints up to level 3 ---
const mentor = await call('POST', '/sessions', { caseId: CASE_ID, mode: 'MENTOR' });
check('Start a MENTOR session', mentor.status, 201);

r = await call('POST', `/sessions/${mentor.data.id}/actions`, { actionType: 'ASK_AI', metadata: { hint_level: 4 } });
check('MENTOR may NOT ask a level 4 hint', r.status, 403);

r = await call('POST', `/sessions/${mentor.data.id}/actions`, { actionType: 'ASK_AI', metadata: { hint_level: 3 } });
check('MENTOR may ask a level 3 hint', r.status, 201);

// --- ASSESSMENT session: no help at all ---
const exam = await call('POST', '/sessions', { caseId: CASE_ID, mode: 'ASSESSMENT' });
r = await call('POST', `/sessions/${exam.data.id}/actions`, { actionType: 'ASK_AI', metadata: { hint_level: 1 } });
check('ASSESSMENT may NOT ask any hint', r.status, 403);

// --- Bad input is rejected ---
r = await call('POST', `/sessions/${gid}/actions`, { actionType: 'DO_MAGIC' });
check('Unknown action type is rejected', r.status, 400);

r = await call('POST', '/sessions', { caseId: CASE_ID, mode: 'EASY' });
check('Unknown mode is rejected', r.status, 400);

// --- The log remembers everything that was allowed ---
r = await call('GET', `/sessions/${gid}/actions`);
check('GUIDED session log has 2 entries', r.data.length, 2);

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
process.exitCode = failed === 0 ? 0 : 1;
