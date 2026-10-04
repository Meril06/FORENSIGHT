import { useEffect, useState } from 'react';
import {
  getHypothesisOptions,
  getHypotheses,
  adoptHypothesis,
  removeHypothesis,
  attachEvidence,
  detachEvidence,
} from '../api.js';

// [value sent to the API, label shown]
const RELATIONSHIPS = [
  ['SUPPORTS', 'Supports it'],
  ['CONTRADICTS', 'Contradicts it'],
  ['UNKNOWN', 'Unclear'],
];
const WEIGHTS = [
  [1, 'Weak'],
  [2, 'Moderate'],
  [3, 'Strong'],
];
const REL_LABEL = Object.fromEntries(RELATIONSHIPS);
const WEIGHT_LABEL = Object.fromEntries(WEIGHTS);

function tagClass(relationship) {
  if (relationship === 'SUPPORTS') return 'tag';
  if (relationship === 'CONTRADICTS') return 'tag danger';
  return 'tag warn';
}

// One explanation the trainee is considering, with its attached evidence
function HypothesisCard({ hypothesis, artifacts, busy, onRemove, onAttach, onDetach }) {
  const [artifactId, setArtifactId] = useState(artifacts[0]?.id ?? '');
  const [relationship, setRelationship] = useState('SUPPORTS');
  const [weight, setWeight] = useState(2);

  return (
    <div className="event mine">
      <strong>{hypothesis.title}</strong>
      <p>{hypothesis.description}</p>

      {hypothesis.evidence.length === 0 ? (
        <p className="muted">No evidence attached yet.</p>
      ) : (
        <ul className="evidence-links">
          {hypothesis.evidence.map((e) => (
            <li key={e.artifact_id}>
              <strong>{e.artifact_code}</strong> {e.name}
              <span className={tagClass(e.relationship)}>
                {REL_LABEL[e.relationship]} · {WEIGHT_LABEL[e.weight]}
              </span>
              <button
                className="link"
                disabled={busy}
                onClick={() => onDetach(hypothesis.id, e.artifact_id)}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="attach-row">
        <select value={artifactId} onChange={(e) => setArtifactId(e.target.value)}>
          {artifacts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.artifact_code} · {a.name}
            </option>
          ))}
        </select>
        <select value={relationship} onChange={(e) => setRelationship(e.target.value)}>
          {RELATIONSHIPS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={weight} onChange={(e) => setWeight(Number(e.target.value))}>
          {WEIGHTS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          className="btn"
          disabled={busy}
          onClick={() => onAttach(hypothesis.id, artifactId, relationship, weight)}
        >
          Attach evidence
        </button>
      </div>

      <div className="event-meta">
        <span />
        <button className="btn" disabled={busy} onClick={() => onRemove(hypothesis.id)}>
          Stop considering this
        </button>
      </div>
    </div>
  );
}

export default function HypothesisBoard({ session, artifacts }) {
  const [options, setOptions] = useState(null); // the menu of possible explanations
  const [mine, setMine] = useState([]); // the ones the trainee is considering
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([getHypothesisOptions(session.id), getHypotheses(session.id)])
      .then(([menu, hypotheses]) => {
        setOptions(menu);
        setMine(hypotheses);
      })
      .catch((e) => setError(e.message));
  }, [session.id]);

  // Runs one change, then reloads the hypotheses from the server
  async function change(action) {
    setBusy(true);
    setError('');
    try {
      await action();
      setMine(await getHypotheses(session.id));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!options) {
    return error ? <p className="error">{error}</p> : <p>Loading explanations...</p>;
  }

  const considering = new Set(mine.map((h) => h.option_id));

  return (
    <div>
      <h2>Hypotheses</h2>
      <p className="muted">
        Choose the explanations you think are worth testing, then weigh the evidence for and
        against each one. The order below is shuffled for every investigation.
      </p>

      {session.mode === 'GUIDED' && (
        <p className="note">
          Tip: weigh every explanation against all the evidence, not only the items that fit
          it. Evidence that contradicts an explanation matters as much as evidence that
          supports it. If an explanation cannot account for something, say so by attaching it
          as "Contradicts it".
        </p>
      )}

      {error && <p className="error">{error}</p>}

      <div className="timeline-cols">
        <div>
          <h3>Possible explanations</h3>
          {options.map((o) => (
            <div key={o.id} className="event">
              <strong>{o.title}</strong>
              <p>{o.description}</p>
              <div className="event-meta">
                <span />
                <button
                  className="btn"
                  disabled={busy || considering.has(o.id)}
                  onClick={() => change(() => adoptHypothesis(session.id, o.id))}
                >
                  {considering.has(o.id) ? 'Considering' : 'Consider this'}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div>
          <h3>My hypotheses ({mine.length})</h3>
          {mine.length === 0 ? (
            <p className="muted">Nothing yet. Pick an explanation to start weighing it.</p>
          ) : (
            mine.map((h) => (
              <HypothesisCard
                key={h.id}
                hypothesis={h}
                artifacts={artifacts}
                busy={busy}
                onRemove={(id) => change(() => removeHypothesis(session.id, id))}
                onAttach={(id, artifactId, relationship, weight) =>
                  change(() => attachEvidence(session.id, id, artifactId, relationship, weight))
                }
                onDetach={(id, artifactId) =>
                  change(() => detachEvidence(session.id, id, artifactId))
                }
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}