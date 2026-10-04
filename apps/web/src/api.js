// All talking to the FORENSIGHT API happens in this one file.
// If you ever change the API port (for example to 4001), change it here.
const API = 'http://localhost:4000/api';

async function request(path, options) {
  const token = localStorage.getItem('forensight_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(API + path, {
    headers,
    ...options,
  });
  const data = await res.json();
  if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/register')) {
    // The login expired or is no longer valid: forget it and go back to the sign-in page
    localStorage.removeItem('forensight_token');
    window.location.reload();
  }
  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

export const getCases = () => request('/cases');

export const getCase = (id) => request(`/cases/${id}`);

export const startSession = (caseId, mode) =>
  request('/sessions', {
    method: 'POST',
    body: JSON.stringify({ caseId, mode }),
  });

export const openArtifact = (sessionId, artifactId) =>
  request(`/sessions/${sessionId}/artifacts/${artifactId}`);

// --- Step 7: validation ---
export const getMarks = (sessionId) => request(`/sessions/${sessionId}/marks`);

export const verifyHash = (sessionId, artifactId) =>
  request(`/sessions/${sessionId}/artifacts/${artifactId}/verify-hash`, { method: 'POST' });

export const setMark = (sessionId, artifactId, flag, value) =>
  request(`/sessions/${sessionId}/artifacts/${artifactId}/mark`, {
    method: 'POST',
    body: JSON.stringify({ flag, value }),
  });

// --- Step 8: timeline ---
export const getTimelinePool = (sessionId) => request(`/sessions/${sessionId}/timeline-events`);

export const getMyTimeline = (sessionId) => request(`/sessions/${sessionId}/timeline`);

export const addToTimeline = (sessionId, eventId) =>
  request(`/sessions/${sessionId}/timeline`, {
    method: 'POST',
    body: JSON.stringify({ eventId }),
  });

export const removeFromTimeline = (sessionId, eventId) =>
  request(`/sessions/${sessionId}/timeline/${eventId}`, { method: 'DELETE' });

// --- Step 9: correlation ---
export const getRelationships = (sessionId) => request(`/sessions/${sessionId}/relationships`);

export const addRelationship = (sessionId, body) =>
  request(`/sessions/${sessionId}/relationships`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const removeRelationship = (sessionId, relId) =>
  request(`/sessions/${sessionId}/relationships/${relId}`, { method: 'DELETE' });

// --- Step 10: hypotheses ---
export const getHypothesisOptions = (sessionId) =>
  request(`/sessions/${sessionId}/hypothesis-options`);

export const getHypotheses = (sessionId) => request(`/sessions/${sessionId}/hypotheses`);

export const adoptHypothesis = (sessionId, optionId) =>
  request(`/sessions/${sessionId}/hypotheses`, {
    method: 'POST',
    body: JSON.stringify({ optionId }),
  });

export const removeHypothesis = (sessionId, hypothesisId) =>
  request(`/sessions/${sessionId}/hypotheses/${hypothesisId}`, { method: 'DELETE' });

export const attachEvidence = (sessionId, hypothesisId, artifactId, relationship, weight) =>
  request(`/sessions/${sessionId}/hypotheses/${hypothesisId}/evidence/${artifactId}`, {
    method: 'PUT',
    body: JSON.stringify({ relationship, weight }),
  });

export const detachEvidence = (sessionId, hypothesisId, artifactId) =>
  request(`/sessions/${sessionId}/hypotheses/${hypothesisId}/evidence/${artifactId}`, {
    method: 'DELETE',
  });

// --- Step 11: conclusion ---
export const getConclusion = (sessionId) => request(`/sessions/${sessionId}/conclusion`);

export const submitConclusion = (sessionId, body) =>
  request(`/sessions/${sessionId}/conclusion`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

// --- Step 13: debrief ---
export const getDebrief = (sessionId) => request(`/sessions/${sessionId}/debrief`);

export const challengeEvidence = (sessionId, artifactId, body) =>
  request(`/sessions/${sessionId}/artifacts/${artifactId}/challenge`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
// --- Step 14: authentication ---
export const register = (body) =>
  request('/auth/register', { method: 'POST', body: JSON.stringify(body) });

export const login = (body) =>
  request('/auth/login', { method: 'POST', body: JSON.stringify(body) });

export const getMe = () => request('/auth/me');