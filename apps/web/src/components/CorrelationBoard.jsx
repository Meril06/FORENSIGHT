import { useEffect, useState } from 'react';
import { getRelationships, addRelationship, removeRelationship } from '../api.js';

// [value sent to the API, words shown in the sentence, help text]
const TYPES = [
  ['CORROBORATES', 'corroborates', 'Two independent sources confirm the same fact.'],
  ['SUPPORTS', 'supports', 'The first adds weight to the second, but is not independent confirmation.'],
  ['CONTRADICTS', 'contradicts', 'The two cannot both be true as they stand.'],
  ['PRECEDES', 'happened before', 'The first happened before the second.'],
  ['FOLLOWS', 'happened after', 'The first happened after the second.'],
  ['CAUSED_BY', 'was caused by', 'The first exists or happened because of the second.'],
  ['ASSOCIATED_WITH', 'is associated with', 'They are connected, but you cannot say how.'],
  ['UNRELATED', 'is unrelated to', 'They have nothing to do with each other.'],
];
const VERB = Object.fromEntries(TYPES.map(([key, verb]) => [key, verb]));

function edgeClass(type) {
  if (type === 'CORROBORATES' || type === 'SUPPORTS') return 'edge good';
  if (type === 'CONTRADICTS') return 'edge bad';
  return 'edge neutral';
}

// Evidence items sit on a circle; each link is a line between two of them
function Graph({ artifacts, links }) {
  const size = 360;
  const centre = size / 2;
  const radius = 140;

  const position = {};
  artifacts.forEach((a, i) => {
    const angle = (2 * Math.PI * i) / artifacts.length - Math.PI / 2;
    position[a.id] = {
      x: centre + radius * Math.cos(angle),
      y: centre + radius * Math.sin(angle),
    };
  });

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="graph" role="img" aria-label="Links between evidence">
      {links.map((l) => (
        <line
          key={l.id}
          className={edgeClass(l.relationship_type)}
          x1={position[l.source_artifact_id].x}
          y1={position[l.source_artifact_id].y}
          x2={position[l.target_artifact_id].x}
          y2={position[l.target_artifact_id].y}
        />
      ))}
      {artifacts.map((a) => (
        <g key={a.id}>
          <circle cx={position[a.id].x} cy={position[a.id].y} r="17" className="node" />
          <text x={position[a.id].x} y={position[a.id].y} dy="4" textAnchor="middle" className="node-label">
            {a.artifact_code.replace('EV-', '')}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function CorrelationBoard({ session, artifacts }) {
  const [links, setLinks] = useState(null);
  const [source, setSource] = useState(artifacts[0]?.id ?? '');
  const [target, setTarget] = useState(artifacts[1]?.id ?? '');
  const [type, setType] = useState('CORROBORATES');
  const [explanation, setExplanation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getRelationships(session.id)
      .then(setLinks)
      .catch((e) => setError(e.message));
  }, [session.id]);

  // Runs one change, then reloads the links from the server
  async function change(action) {
    setBusy(true);
    setError('');
    try {
      await action();
      setLinks(await getRelationships(session.id));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const add = () =>
    change(async () => {
      await addRelationship(session.id, {
        sourceArtifactId: source,
        targetArtifactId: target,
        relationshipType: type,
        explanation,
      });
      setExplanation('');
    });

  if (!links) {
    return error ? <p className="error">{error}</p> : <p>Loading links...</p>;
  }

  const options = artifacts.map((a) => (
    <option key={a.id} value={a.id}>
      {a.artifact_code} · {a.name}
    </option>
  ));

  return (
    <div>
      <h2>Correlation</h2>
      <p className="muted">
        Connect pieces of evidence and explain why. Links are saved on the server; whether
        a link is right is revealed in the debrief.
      </p>

      {session.mode === 'GUIDED' && (
        <p className="note">
          Tip: the strongest links connect evidence from different sources. Look for two items
          that record the same moment independently, and for items whose times or details do
          not fit together. Explain each link in your own words.
        </p>
      )}

      {error && <p className="error">{error}</p>}

      <div className="timeline-cols">
        <div>
          <h3>Make a link</h3>
          <div className="link-form">
            <div className="link-row">
              <select value={source} onChange={(e) => setSource(e.target.value)}>
                {options}
              </select>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {TYPES.map(([key, verb]) => (
                  <option key={key} value={key}>
                    {verb}
                  </option>
                ))}
              </select>
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                {options}
              </select>
            </div>
            <p className="muted">{TYPES.find((t) => t[0] === type)[2]}</p>

            <label>
              Why? (at least 10 characters)
              <textarea
                rows={3}
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
              />
            </label>

            <button
              className="btn on"
              disabled={busy || source === target || explanation.trim().length < 10}
              onClick={add}
            >
              Add link
            </button>
            {source === target && <p className="muted">Pick two different pieces of evidence.</p>}
          </div>

          <h3>My links ({links.length})</h3>
          {links.length === 0 ? (
            <p className="muted">No links yet.</p>
          ) : (
            links.map((l) => (
              <div key={l.id} className="event mine">
                <div>
                  <strong>{l.source_code}</strong> {VERB[l.relationship_type]}{' '}
                  <strong>{l.target_code}</strong>
                </div>
                <p>{l.explanation}</p>
                <div className="event-meta">
                  <span />
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => change(() => removeRelationship(session.id, l.id))}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div>
          <h3>Map</h3>
          <Graph artifacts={artifacts} links={links} />
          <p className="muted">
            Numbers are the EV codes (10 = EV-010). Green lines confirm or support, red lines
            contradict, grey lines are other links.
          </p>
        </div>
      </div>
    </div>
  );
}