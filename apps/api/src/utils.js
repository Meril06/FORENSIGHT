// Wraps an async route so any error goes to the error handler in index.js
export const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Checks that text looks like a valid id (UUID)
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;