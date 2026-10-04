// Step 14 test: run with
//     node --env-file=.env scripts/auth-test.js
// The API must be running in another terminal (npm run dev).
// It needs DATABASE_URL and AUTH_SECRET from .env.
//
// This test tries to BREAK the sign-in system: forged tokens, expired tokens,
// stolen identities, privilege escalation. A secure system refuses all of them.

import crypto from 'node:crypto';
import pg from 'pg';

const BASE = 'http://localhost:4000/api';
const CASE_ID = 'c0000000-0000-0000-0000-000000000001';
const SECRET = process.env.AUTH_SECRET;

let failed = 0;

async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, data };
}

function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (got ${actual}, expected ${expected})`);
}
const info = (label, value) => console.log(`INFO  ${label}: ${value}`);

// Build a token the same way the server does, so we can forge bad ones
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
function makeToken(payload, secret = SECRET) {
  const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
  const sig = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${sig}`;
}
const now = () => Math.floor(Date.now() / 1000);

const stamp = Date.now();
const emailA = `probe-${stamp}-a@example.com`;
const emailB = `probe-${stamp}-b@example.com`;
const PASSWORD = 'Probe#Pass1234';

// ---------- Registration ----------
let r = await call('POST', '/auth/register', { name: 'Probe A', email: emailA, password: PASSWORD });
check('Registering a new account works', r.status, 201);
check('The reply contains a login token', typeof r.data.token, 'string');
check('The reply never contains the password hash', 'password_hash' in r.data.user, false);
const userA = r.data.user;
const tokenA = r.data.token;

r = await call('POST', '/auth/register', { name: 'Probe B', email: emailB, password: PASSWORD, role: 'ADMIN' });
check('Asking to be an ADMIN while registering is ignored (still a TRAINEE)', r.data.user.role, 'TRAINEE');
const tokenB = r.data.token;

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const stored = (await db.query(`SELECT password_hash FROM users WHERE id = $1`, [userA.id])).rows[0].password_hash;
check('The password is stored as a salted scrypt hash', stored.startsWith('scrypt$'), true);
check('... and the plain password is not stored anywhere in it', stored.includes(PASSWORD), false);
await db.end();

r = await call('POST', '/auth/register', { name: 'Probe A', email: emailA, password: PASSWORD });
check('The same email twice is refused', r.status, 409);
r = await call('POST', '/auth/register', { name: 'Probe A', email: emailA.toUpperCase(), password: PASSWORD });
check('... even when the capital letters differ', r.status, 409);
r = await call('POST', '/auth/register', { name: 'X Y', email: `s-${stamp}@example.com`, password: 'short12' });
check('A 7-character password is refused', r.status, 400);
r = await call('POST', '/auth/register', { name: 'X Y', email: `l-${stamp}@example.com`, password: 'x'.repeat(129) });
check('A 129-character password is refused', r.status, 400);
r = await call('POST', '/auth/register', { name: 'X Y', email: 'not-an-email', password: PASSWORD });
check('An invalid email is refused', r.status, 400);
r = await call('POST', '/auth/register', { name: 'X', email: `n-${stamp}@example.com`, password: PASSWORD });
check('A 1-character name is refused', r.status, 400);

// ---------- Login ----------
r = await call('POST', '/auth/login', { email: emailA, password: PASSWORD });
check('Logging in with the right password works', r.status, 200);
r = await call('POST', '/auth/login', { email: emailA.toUpperCase(), password: PASSWORD });
check('Email capital letters do not matter when logging in', r.status, 200);

const wrongPassword = await call('POST', '/auth/login', { email: emailA, password: 'Wrong#Pass1234' });
const unknownEmail = await call('POST', '/auth/login', { email: `nobody-${stamp}@example.com`, password: 'Wrong#Pass1234' });
check('A wrong password is refused', wrongPassword.status, 401);
check('An unknown email is refused', unknownEmail.status, 401);
check('Both give the same message (so nobody can find out which emails exist)', wrongPassword.data.error, unknownEmail.data.error);

r = await call('POST', '/auth/login', { email: "' OR '1'='1", password: "' OR '1'='1" });
check("SQL-injection style input is refused, not a server error", r.status === 401 || r.status === 400, true);

r = await call('POST', '/auth/login', { email: 'demo.trainee@forensight.local', password: 'Demo@1234' });
check('The demo account signs in with the documented password', r.status, 200);

// ---------- Tokens ----------
r = await call('GET', '/auth/me', null, tokenA);
check('A valid token identifies its owner', r.data?.user?.email, emailA);

r = await call('GET', '/auth/me');
check('No token is refused', r.status, 401);
r = await call('GET', '/auth/me', null, 'garbage');
check('A garbage token is refused', r.status, 401);

const [h, p, s] = tokenA.split('.');
const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
const tampered = `${h}.${b64({ ...claims, role: 'ADMIN' })}.${s}`;
r = await call('GET', '/auth/me', null, tampered);
check('A token whose contents were edited (role changed to ADMIN) is refused', r.status, 401);

r = await call('GET', '/auth/me', null, makeToken({ ...claims }, 'x'.repeat(48)));
check('A token signed with a different secret is refused', r.status, 401);

r = await call('GET', '/auth/me', null, makeToken({ ...claims, iat: now() - 7200, exp: now() - 3600 }));
check('An expired token is refused', r.status, 401);

r = await call('GET', '/auth/me', null, `${b64({ alg: 'none', typ: 'JWT' })}.${p}.`);
check('A token with no signature ("alg none" trick) is refused', r.status, 401);

// ---------- Access control ----------
r = await call('POST', '/sessions', { caseId: CASE_ID, mode: 'MENTOR' });
check('Starting an investigation without logging in is refused', r.status, 401);
r = await call('GET', '/sessions/c0000000-0000-0000-0000-000000000001');
check('Reading a session without logging in is refused', r.status, 401);

r = await call('POST', '/sessions', { caseId: CASE_ID, mode: 'MENTOR' }, makeToken({ ...claims, role: 'INSTRUCTOR' }));
check('A validly signed INSTRUCTOR token cannot start trainee investigations', r.status, 403);

r = await call('GET', '/cases');
check('The case list needs a login', r.status, 401);
r = await call('GET', '/cases', null, tokenA);
check('... and works with one', r.status, 200);
r = await call('GET', '/health');
check('The health check stays public (so you can see the server is alive)', r.status, 200);

// ---------- Ownership: one trainee cannot touch another trainee's work ----------
r = await call('POST', '/sessions', { caseId: CASE_ID, mode: 'MENTOR' }, tokenA);
check('Trainee A starts an investigation', r.status, 201);
const sid = r.data.id;

r = await call('GET', `/sessions/${sid}`, null, tokenA);
check('Trainee A can read it', r.status, 200);
r = await call('GET', `/sessions/${sid}`, null, tokenB);
check('Trainee B cannot read it', r.status, 404);
r = await call('POST', `/sessions/${sid}/actions`, { actionType: 'SEARCH', metadata: { query: 'x' } }, tokenB);
check('Trainee B cannot add actions to it', r.status, 404);
r = await call('GET', `/sessions/${sid}/artifacts/a0000000-0000-0000-0000-000000000010`, null, tokenB);
check('Trainee B cannot open evidence through it', r.status, 404);
r = await call('GET', `/sessions/${sid}/debrief`, null, tokenB);
check("Trainee B cannot open A's debrief", r.status, 404);

// ---------- Things worth knowing (not pass/fail) ----------

const statuses = [];
for (let i = 0; i < 15; i++) {
  statuses.push((await call('POST', '/auth/login', { email: emailA, password: 'Wrong#' + i })).status);
}
info('15 wrong passwords in a row, statuses', [...new Set(statuses)].join(','));
info('... so there is no lockout or rate limit yet', statuses.every((s) => s === 401));

async function average(email) {
  const times = [];
  for (let i = 0; i < 6; i++) {
    const t = performance.now();
    await call('POST', '/auth/login', { email, password: 'Wrong#Pass1234' });
    times.push(performance.now() - t);
  }
  return Math.round(times.reduce((a, b) => a + b, 0) / times.length);
}
const knownMs = await average(emailA);
const unknownMs = await average(`nobody-${stamp}@example.com`);
info('Average wrong-password time, existing account (ms)', knownMs);
info('Average wrong-password time, unknown email (ms)', unknownMs);
check('Unknown emails take about as long as wrong passwords (no timing leak)', Math.abs(knownMs - unknownMs) < 25, true);
info('Token lifetime in hours', (claims.exp - claims.iat) / 3600);

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
process.exitCode = failed === 0 ? 0 : 1;
