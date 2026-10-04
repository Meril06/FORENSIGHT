import { useEffect, useState } from 'react';
import { getConclusion, getHypotheses, submitConclusion } from '../api.js';

// [value sent to the API, label, help text]
const CONFIDENCE = [
  ['LOW', 'Low', 'The evidence is thin or mixed. I could easily be wrong.'],
  ['MEDIUM', 'Medium', 'The evidence points one way, but some doubts remain.'],
  ['HIGH', 'High', 'Independent evidence agrees and I can explain the contradictions.'],
];
const ROLES = [
  ['', 'Not included'],
  ['SUPPORTING', 'Supports my conclusion'],
  ['CONTRADICTING', 'Contradicts it'],
  ['SUSPICIOUS', 'Suspicious or unreliable'],
  ['BACKGROUND', 'Background only'],
];
const ROLE_LABEL = Object.fromEntries(ROLES);

export default function ConclusionBoard({ session, artifacts, onSubmitted }) {
  const [loaded, setLoaded] = useState(false);
  const [conclusion, setConclusion] = useState(null); // the submitted conclusion, if any
  const [mine, setMine] = useState([]); // explanations the trainee is considering

  const [hypothesisId, setHypothesisId] = useState('');
  const [summary, setSummary] = useState('');
  const [confidence, setConfidence] = useState('MEDIUM');
  const [reasoning, setReasoning] = useState('');
  const [roles, setRoles] = useState({}); // artifact id -> role ('' = not included)

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([getConclusion(session.id), getHypotheses(session.id)])
      .then(([existing, hypotheses]) => {
        setConclusion(existing);
        setMine(hypotheses);
        setHypothesisId(hypotheses[0]?.id ?? '');
        setLoaded(true);
        if (existing) onSubmitted(false);
      })
      .catch((e) => setError(e.message));
  }, [session.id]); // eslint-disable-line

  const evidence = Object.entries(roles)
    .filter(([, role]) => role)
    .map(([artifactId, role]) => ({ artifactId, role }));

  const ready =
    hypothesisId && summary.trim().length >= 20 && reasoning.trim().length >= 30 && evidence.length >= 1;

  async function submit() {
    if (!window.confirm('Submit your conclusion? This ends the investigation and cannot be undone.')) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await submitConclusion(session.id, { hypothesisId, summary, confidence, reasoning, evidence });
      setConclusion(await getConclusion(session.id));
      onSubmitted(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return error ? <p className="error">{error}</p> : <p>Loading...</p>;
  }

  // ---- After submitting: read-only view ----
  if (conclusion) {
    return (
      <div>
        <h2>Conclusion submitted</h2>
        <p className="note">
          The investigation is closed. Open the Debrief tab to see your score and what the
          evidence really was.
        </p>

        <h3>Your explanation</h3>
        <p>
          <strong>{conclusion.hypothesis_title}</strong> · confidence: {conclusion.confidence}
        </p>

        <h3>What happened</h3>
        <p>{conclusion.summary}</p>

        <h3>Your reasoning</h3>
        <p>{conclusion.reasoning}</p>

        <h3>Key evidence</h3>
        <ul className="evidence-links">
          {conclusion.evidence.map((e) => (
            <li key={e.artifact_id}>
              <strong>{e.artifact_code}</strong> {e.name}
              <span className="tag">{ROLE_LABEL[e.role]}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // ---- Before submitting: the form ----
  if (mine.length === 0) {
    return (
      <div>
        <h2>Conclude</h2>
        <p className="muted">
          Before you can conclude, consider at least one explanation in the Hypotheses tab.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2>Conclude</h2>
      <p className="muted">
        When you are ready, commit to an answer. Submitting ends the investigation: after
        that nothing can be changed.
      </p>

      {session.mode === 'GUIDED' && (
        <p className="note">
          Tip: a good conclusion names the most likely explanation, says how sure you are
          and why, and is honest about evidence you did not trust. Include the items that
          support you, and also the ones you set aside.
        </p>
      )}

      {error && <p className="error">{error}</p>}

      <div className="link-form">
        <label>
          Which explanation do you conclude is most likely?
          <select value={hypothesisId} onChange={(e) => setHypothesisId(e.target.value)}>
            {mine.map((h) => (
              <option key={h.id} value={h.id}>
                {h.title}
              </option>
            ))}
          </select>
        </label>

        <label>
          What happened? (at least 20 characters)
          <textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>

        <label>
          How confident are you?
          <select value={confidence} onChange={(e) => setConfidence(e.target.value)}>
            {CONFIDENCE.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">{CONFIDENCE.find((c) => c[0] === confidence)[2]}</p>

        <div>
          <strong>Key evidence</strong>
          <p className="muted">
            For each item that matters to your conclusion, say what role it plays. Leave
            the rest as "Not included". Choose at least one.
          </p>
          <div className="role-list">
            {artifacts.map((a) => (
              <div key={a.id} className="role-row">
                <span>
                  <strong>{a.artifact_code}</strong> {a.name}
                </span>
                <select
                  value={roles[a.id] ?? ''}
                  onChange={(e) => setRoles({ ...roles, [a.id]: e.target.value })}
                >
                  {ROLES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        <label>
          Explain your reasoning (at least 30 characters)
          <textarea rows={5} value={reasoning} onChange={(e) => setReasoning(e.target.value)} />
        </label>

        <button className="btn on" disabled={busy || !ready} onClick={submit}>
          Submit conclusion
        </button>
        {!ready && (
          <p className="muted">
            To submit: write a summary and your reasoning, and include at least one piece of
            evidence.
          </p>
        )}
      </div>
    </div>
  );
}