// Step 8 test: run with   node scripts/step8-test.js
// The API must be running in another terminal (npm run dev).

import { getToken } from './test-auth.js';
const TOKEN = await getToken();

const BASE = 'http://localhost:4000/api';
const CASE_ID = 'c0000000-0000-0000-0000-000000000001';
const NOT_REAL = 'e0000000-0000-0000-0000-0000000000ff';

// Event ids look like e0000000-0000-0000-0000-0000000000NN
const ev = (n) => 'e0000000-0000-0000-0000-' + String(n).padStart(12, '0');

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

// Last two characters of each event id, in the order the API returned them
const order = (rows) => rows.map((e) => e.event_id.slice(-2)).join(',');

const session = await call('POST', '/sessions', { caseId: CASE_ID, mode: 'MENTOR' });
const sid = session.data.id;

// --- The pool of events found in the evidence ---
let r = await call('GET', `/sessions/${sid}/timeline-events`);
check('Event pool loads', r.status, 200);
check('Pool has 9 events (real ones and misleading ones)', r.data.length, 9);
check('Pool does not send event codes (they would give the answer away)', 'event_code' in r.data[0], false);

// --- Build a timeline, adding events out of order on purpose ---
r = await call('POST', `/sessions/${sid}/timeline`, { eventId: ev(1) });
check('Add the 09:14 logon event', r.status, 201);
r = await call('POST', `/sessions/${sid}/timeline`, { eventId: ev(3) });
check('Add the 09:21 file-open event', r.status, 201);
r = await call('POST', `/sessions/${sid}/timeline`, { eventId: ev(2) });
check('Add the 09:18 USB event (earlier than the one before)', r.status, 201);

r = await call('GET', `/sessions/${sid}/timeline`);
check('Timeline has 3 events', r.data.length, 3);
check('Timeline is sorted by time', order(r.data), '01,02,03');
check('Positions are 1, 2, 3', r.data.map((e) => e.position).join(','), '1,2,3');

r = await call('POST', `/sessions/${sid}/timeline`, { eventId: ev(2) });
check('Adding the same event twice is refused', r.status, 409);

// --- A misleading event (the cleanup task that claims to run at 08:50) ---
r = await call('POST', `/sessions/${sid}/timeline`, { eventId: ev(8) });
check('Add the 08:50 event', r.status, 201);
r = await call('GET', `/sessions/${sid}/timeline`);
check('08:50 event sorts to the top', order(r.data), '08,01,02,03');

// --- Remove it ---
r = await call('DELETE', `/sessions/${sid}/timeline/${ev(8)}`);
check('Remove the 08:50 event', r.status, 200);
r = await call('GET', `/sessions/${sid}/timeline`);
check('Timeline is back to 3 events', r.data.length, 3);
check('Positions are renumbered 1, 2, 3', r.data.map((e) => e.position).join(','), '1,2,3');

r = await call('DELETE', `/sessions/${sid}/timeline/${ev(8)}`);
check('Removing an event that is not there gives 404', r.status, 404);

// --- Bad input ---
r = await call('POST', `/sessions/${sid}/timeline`, { eventId: 'not-an-id' });
check('Invalid id is rejected', r.status, 400);
r = await call('POST', `/sessions/${sid}/timeline`, { eventId: NOT_REAL });
check('Unknown event gives 404', r.status, 404);

// --- The browser cannot fake the log entry ---
r = await call('POST', `/sessions/${sid}/actions`, { actionType: 'CREATE_TIMELINE_EVENT', targetId: ev(5) });
check('Faking CREATE_TIMELINE_EVENT through the generic route is refused', r.status, 403);

// --- The log: 3 adds + 1 add + 1 remove = 5 real actions ---
r = await call('GET', `/sessions/${sid}/actions`);
check('Log has exactly 5 entries', r.data.length, 5);

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
process.exitCode = failed === 0 ? 0 : 1;
