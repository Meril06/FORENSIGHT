import crypto from 'node:crypto';
import { Router } from 'express';
import { pool } from './db.js';
import { wrap } from './utils.js';

const TOKEN_TTL_SECONDS = 60 * 60 * 8;
const PASSWORD_N = 16384;
const PASSWORD_R = 8;
const PASSWORD_P = 1;
const PASSWORD_KEYLEN = 64;

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET must be set and contain at least 32 characters');
  }
  return secret;
}

// Fail when the server STARTS, not on the first sign-in attempt
getSecret();

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function safeEqual(a, b) {
  const aa = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, PASSWORD_KEYLEN, {
      N: PASSWORD_N,
      r: PASSWORD_R,
      p: PASSWORD_P,
    }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`scrypt$${PASSWORD_N}$${PASSWORD_R}$${PASSWORD_P}$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`);
    });
  });
}

export function verifyPassword(password, encoded) {
  return new Promise((resolve, reject) => {
    try {
      const [scheme, n, r, p, saltText, hashText] = String(encoded).split('$');
      if (scheme !== 'scrypt' || !n || !r || !p || !saltText || !hashText) return resolve(false);
      const salt = Buffer.from(saltText, 'base64url');
      const expected = Buffer.from(hashText, 'base64url');
      crypto.scrypt(password, salt, expected.length, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
      }, (err, derivedKey) => {
        if (err) return reject(err);
        resolve(crypto.timingSafeEqual(expected, derivedKey));
      });
    } catch {
      resolve(false);
    }
  });
}

// Used when the email is unknown, so that "no such account" takes as long as "wrong password".
// Otherwise the response time would reveal which emails have accounts.
const DUMMY_HASH = await hashPassword(`timing-equaliser-${crypto.randomUUID()}`);

export function createToken(user) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({
    sub: user.id,
    name: user.name,
    role: user.role,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', getSecret()).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

export function verifyToken(token) {
  const [header, payload, signature] = String(token || '').split('.');
  if (!header || !payload || !signature) return null;

  const unsigned = `${header}.${payload}`;
  const expected = crypto.createHmac('sha256', getSecret()).update(unsigned).digest('base64url');
  if (!safeEqual(signature, expected)) return null;

  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!claims.sub || !Number.isInteger(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }
  return claims;
}

export function requireAuth(req, res, next) {
  try {
    const value = req.get('authorization') || '';
    if (!value.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const claims = verifyToken(value.slice(7));
    if (!claims) return res.status(401).json({ error: 'Invalid or expired token' });
    req.user = claims;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action' });
    }
    next();
  };
}

const router = Router();

router.post('/register', wrap(async (req, res) => {
  const { name, email, password } = req.body ?? {};
  const cleanName = typeof name === 'string' ? name.trim() : '';
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (cleanName.length < 2 || cleanName.length > 100) {
    return res.status(400).json({ error: 'Name must be between 2 and 100 characters' });
  }
  if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'Password must be between 8 and 128 characters' });
  }

  const passwordHash = await hashPassword(password);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'TRAINEE')
       RETURNING id, name, email, role, created_at`,
      [cleanName, cleanEmail, passwordHash]
    );
    const user = rows[0];
    res.status(201).json({ user, token: createToken(user) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An account with that email already exists' });
    throw err;
  }
}));

router.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body ?? {};
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!cleanEmail || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const { rows } = await pool.query(
    `SELECT id, name, email, password_hash, role, created_at
     FROM users WHERE lower(email) = lower($1)`,
    [cleanEmail]
  );
  const user = rows[0];
  const passwordOk = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !passwordOk) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const { password_hash: _, ...safeUser } = user;
  res.json({ user: safeUser, token: createToken(safeUser) });
}));

router.get('/me', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, email, role, created_at FROM users WHERE id = $1`,
    [req.user.sub]
  );
  if (rows.length === 0) return res.status(401).json({ error: 'Account no longer exists' });
  res.json({ user: rows[0] });
}));

export default router;