import { useState } from 'react';
import { verifyHash, setMark, challengeEvidence } from '../api.js';

// [value sent to the API, label shown to the trainee]
const REASONS = [
  ['TIMESTAMP_INCONSISTENT', 'The timestamps do not add up'],
  ['SOURCE_UNRELIABLE', 'The source is unreliable'],
  ['CONTRADICTED_BY_OTHER_EVIDENCE', 'Other evidence contradicts it'],
  ['INCOMPLETE_OR_TRUNCATED', 'It looks incomplete or cut off'],
  ['POSSIBLY_TAMPERED', 'It may have been tampered with'],
  ['NOT_RELEVANT', 'It is not relevant to this case'],
];

export default function ValidationPanel({ session, artifact, others, marks, onChanged }) {
  const [hashResult, setHashResult] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState(REASONS[0][0]);
  const [explanation, setExplanation] = useState('');
  const [related, setRelated] = useState('');

  // Runs one action: show errors if it fails, refresh the marks if it works
  async function run(action) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      await onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const checkHash = () =>
    run(async () => setHashResult(await verifyHash(session.id, artifact.id)));

  const toggle = (flag, current) =>
    run(() => setMark(session.id, artifact.id, flag, !current));

  const submitChallenge = () =>
    run(async () => {
      const body = { reason, explanation };
      if (related) body.relatedArtifactId = related;
      const result = await challengeEvidence(session.id, artifact.id, body);
      setMessage(result.message);
      setShowForm(false);
      setExplanation('');
    });

  return (
    <div className="validation">
      <h3>Validate this evidence</h3>

      <div className="actions">
        <button className="btn" disabled={busy} onClick={checkHash}>
          Verify hash
        </button>
        <button
          className={marks.relevant ? 'btn on' : 'btn'}
          disabled={busy}
          onClick={() => toggle('RELEVANT', marks.relevant)}
        >
          {marks.relevant ? '✓ Relevant' : 'Mark relevant'}
        </button>
        <button
          className={marks.suspicious ? 'btn on warn' : 'btn'}
          disabled={busy}
          onClick={() => toggle('SUSPICIOUS', marks.suspicious)}
        >
          {marks.suspicious ? '⚠ Suspicious' : 'Mark suspicious'}
        </button>
        <button className="btn" disabled={busy} onClick={() => setShowForm(!showForm)}>
          Challenge this evidence
        </button>
      </div>

      {hashResult && (
        <p className={hashResult.matches ? 'note' : 'note bad'}>
          {hashResult.matches
            ? 'Hash matches. This copy has not changed since it was collected. That does not, by itself, prove its contents are true.'
            : 'Hash does NOT match. This copy has changed since it was collected.'}
        </p>
      )}

      {showForm && (
        <div className="challenge-form">
          <label>
            Why do you doubt it?
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label>
            Explain your reasoning (at least 10 characters)
            <textarea
              rows={3}
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
            />
          </label>

          <label>
            Which other evidence supports your doubt? (optional)
            <select value={related} onChange={(e) => setRelated(e.target.value)}>
              <option value="">None</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>{o.artifact_code} · {o.name}</option>
              ))}
            </select>
          </label>

          <button
            className="btn on"
            disabled={busy || explanation.trim().length < 10}
            onClick={submitChallenge}
          >
            Submit challenge
          </button>
        </div>
      )}

      {message && <p className="note">{message}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}