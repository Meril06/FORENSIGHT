// Show times in UTC so the trainee is not confused by their own time zone
export function fmt(value) {
  if (!value) return '—';
  return new Date(value).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}