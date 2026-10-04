import pg from 'pg';

// One shared connection pool for the whole API
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

// If an idle database connection drops (for example when Docker resets it),
// print a message instead of crashing the whole API. The pool opens a new connection.
pool.on('error', (err) => {
  console.error('Database connection problem:', err.message);
});