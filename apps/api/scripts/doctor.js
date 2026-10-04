// FORENSIGHT doctor. Run it whenever something does not work:
//     node --env-file=.env scripts/doctor.js
//
// It checks your settings, the database, and the API, then tells you what is wrong
// in plain words. It changes nothing.

import pg from 'pg';

const PORT = process.env.PORT || 4000;
const BASE = `http://localhost:${PORT}/api`;

let problems = 0;
const ok = (msg) => console.log(`  OK    ${msg}`);
const warn = (msg) => console.log(`  WARN  ${msg}`);
function bad(msg, fix) {
  problems++;
  console.log(`  FAIL  ${msg}`);
  if (fix) console.log(`        -> ${fix}`);
}
const heading = (t) => console.log(`\n${t}`);

// ---------------------------------------------------------------- 1. settings
heading('1. Settings in apps/api/.env');
for (const name of ['DATABASE_URL', 'DATABASE_URL_SCORER', 'AUTH_SECRET']) {
  if (!process.env[name]) bad(`${name} is missing`, `Add a ${name}=... line to apps/api/.env and restart the API.`);
  else ok(`${name} is set`);
}
const secret = process.env.AUTH_SECRET ?? '';
if (secret) {
  if (secret.length < 32) bad(`AUTH_SECRET is only ${secret.length} characters (needs 32 or more)`, 'Generate a new one: node -e "console.log(require(\'node:crypto\').randomBytes(48).toString(\'base64url\'))"');
  else if (/secret|change|password|forensight|example|test|123/i.test(secret)) warn('AUTH_SECRET looks like a placeholder. Replace it with a random one (see the command above).');
  else ok(`AUTH_SECRET is ${secret.length} characters and looks random`);
}

// ---------------------------------------------------------------- 2. database
heading('2. Database');
async function tryDb(name, url, sql) {
  if (!url) return null;
  const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 4000 });
  try {
    const r = await pool.query(sql);
    return r.rows;
  } catch (e) {
    bad(`${name} could not use the database: ${e.code ?? ''} ${e.message}`,
      e.code === 'ECONNREFUSED'
        ? 'The database is not running. Open Docker Desktop, then: docker compose -f docker/docker-compose.yml up -d'
        : e.code === '28P01'
          ? 'Wrong password or user. Check the line in .env.'
          : e.code === '42501'
            ? 'Missing permission. Run the database files 001 to 008 in order.'
            : 'See the message above.');
    return null;
  } finally {
    await pool.end();
  }
}
const appRows = await tryDb('The trainee login (DATABASE_URL)', process.env.DATABASE_URL, 'SELECT 1 AS ok');
if (appRows) ok('The trainee login connects');
const scorerRows = await tryDb('The scorer login (DATABASE_URL_SCORER)', process.env.DATABASE_URL_SCORER, 'SELECT count(*)::int AS n FROM truth.case_truth');
if (scorerRows) ok(`The scorer login connects and can read the hidden answers (${scorerRows[0].n} case)`);

if (appRows) {
  const checks = await tryDb('The trainee login', process.env.DATABASE_URL, `
    SELECT
      (SELECT count(*) FROM information_schema.columns WHERE table_name='trainee_timeline' AND column_name='event_id')::int AS m005,
      (SELECT count(*) FROM information_schema.tables  WHERE table_name='hypothesis_options')::int AS m006,
      (SELECT count(*) FROM information_schema.columns WHERE table_name='scores' AND column_name='details')::int AS m007,
      (SELECT count(*) FROM pg_indexes WHERE indexname='users_email_lower_unique')::int AS m008`);
  if (checks) {
    const c = checks[0];
    for (const [key, file] of [['m005', '005_trainee_timeline_event_link.sql'], ['m006', '006_hypothesis_options.sql'], ['m007', '007_scoring.sql'], ['m008', '008_auth.sql']]) {
      if (c[key]) ok(`${file} has been applied`);
      else bad(`${file} has NOT been applied`, `docker exec forensight-db psql -U forensight -d forensight -f /docker-entrypoint-initdb.d/${file}`);
    }
  }
}

// ---------------------------------------------------------------- 3. the API
heading(`3. The API on port ${PORT}`);
let apiAnswers = false;
try {
  const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) });
  const body = await res.json().catch(() => null);
  if (res.ok && body?.status === 'ok') {
    ok('The API answers and can reach the database');
    apiAnswers = true;
  } else {
    bad(`The API answered, but not normally (HTTP ${res.status}) ${JSON.stringify(body)}`,
      'Look at the API terminal for red text.');
  }
} catch (e) {
  const code = e.cause?.code ?? e.name;
  if (code === 'ECONNREFUSED') {
    bad('Nothing is listening on that port: the API is not running',
      'Open a terminal:  cd D:\\forensight\\apps\\api   then   npm run dev   (and look at what it prints).');
  } else if (['ECONNRESET', 'UND_ERR_SOCKET', 'EPIPE'].includes(code)) {
    bad(`Something is on that port but it DROPPED the connection (${code})`,
      'Either an OLD copy of the API is still running, or the API crashed when this request arrived. ' +
      'Look at the API terminal for red text. Then free the port: netstat -ano | findstr LISTENING | findstr ":4000 "  ' +
      '(the last number is the PID), tasklist /FI "PID eq <PID>", taskkill /PID <PID> /F, and start ONE API with npm run dev.');
  } else if (code === 'TimeoutError') {
    bad('The API did not answer within 5 seconds', 'It may be stuck. Stop it with Ctrl+C and start it again.');
  } else {
    bad(`Could not reach the API: ${code} ${e.message}`);
  }
}

if (apiAnswers) {
  // Is this the NEW API (with sign-in), or an old copy without it?
  try {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'doctor@check.invalid', password: 'not-a-real-password' }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401) ok('The sign-in system is running (it refused a made-up login, as it should)');
    else if (res.status === 404) bad('This API has NO sign-in system: an old copy is running', 'Stop every API (Ctrl+C), free the port (see above), and start one with npm run dev.');
    else bad(`The sign-in system gave an unexpected answer (HTTP ${res.status})`, 'Look at the API terminal for red text.');
  } catch (e) {
    bad(`The API dropped the connection on a sign-in request: ${e.cause?.code ?? e.message}`,
      'The API probably CRASHED on that request. Look at the API terminal: the red text there is the real reason. Send it to me.');
  }

  try {
    const res = await fetch(`${BASE}/cases`, { signal: AbortSignal.timeout(5000) });
    if (res.status === 401) ok('The case list correctly requires a login');
    else warn(`The case list answered HTTP ${res.status} without a login. Replace apps/api/src/index.js with the latest version.`);
  } catch { /* already reported above */ }
}

// ---------------------------------------------------------------- summary
console.log(problems === 0 ? '\nEverything looks healthy.' : `\n${problems} problem(s) found. Fix the first FAIL above, then run this again.`);
process.exitCode = problems === 0 ? 0 : 1;
