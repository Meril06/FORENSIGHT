// Used by the test scripts: signs in a dedicated test account and returns its login token.
// The first time, the account does not exist yet, so it is created (registered).
// After that it is simply signed in. It is an ordinary TRAINEE account.

const BASE = 'http://localhost:4000/api';
const EMAIL = 'tester@forensight.local';
const PASSWORD = 'Tester#12345';

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

export async function getToken() {
  let r = await post('/auth/login', { email: EMAIL, password: PASSWORD });
  if (r.status === 401) {
    r = await post('/auth/register', { name: 'Test Trainee', email: EMAIL, password: PASSWORD });
  }
  if (!r.data.token) {
    throw new Error(`Could not sign in the test account: ${r.data.error ?? 'HTTP ' + r.status}`);
  }
  return r.data.token;
}
