import { useEffect, useState } from 'react';
import { getCase, openArtifact, getMarks } from '../api.js';
import { fmt } from '../format.js';
import ValidationPanel from './ValidationPanel.jsx';
import TimelineBoard from './TimelineBoard.jsx';
import CorrelationBoard from './CorrelationBoard.jsx';
import HypothesisBoard from './HypothesisBoard.jsx';
import ConclusionBoard from './ConclusionBoard.jsx';
import DebriefBoard from './DebriefBoard.jsx';

// "children" is whatever is placed between <EvidenceDetail> and </EvidenceDetail>
function EvidenceDetail({ a, children }) {
  const rows = [
    ['Type', a.type],
    ['Source', a.source],
    ['Path', a.path || '—'],
    ['Created', fmt(a.created_at_ts)],
    ['Modified', fmt(a.modified_at_ts)],
    ['Accessed', fmt(a.accessed_at_ts)],
    ['Acquired', fmt(a.acquired_at_ts)],
    ['Size', a.size ? `${a.size} bytes` : '—'],
    ['SHA-256', a.sha256 || '—'],
    ['Provenance', a.provenance || '—'],
  ];

  return (
    <div>
      <h2>
        {a.artifact_code} · {a.name}
      </h2>
      <span className="badge">{a.display_status}</span>
      <p>{a.description}</p>

      {children}

      <h3>Evidence DNA</h3>
      <dl className="dna">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <h3>Content</h3>
      <pre>{JSON.stringify(a.content, null, 2)}</pre>
    </div>
  );
}

export default function Workspace({ caseId, session }) {
  const [caseData, setCaseData] = useState(null);
  const [view, setView] = useState('evidence'); // 'evidence' or 'timeline'
  const [selected, setSelected] = useState(null); // the artifact currently open
  const [marks, setMarks] = useState({}); // relevant / suspicious / challenged per artifact
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false); // true once the conclusion is submitted

  useEffect(() => {
    getCase(caseId)
      .then(setCaseData)
      .catch((e) => setError(e.message));
    getMarks(session.id)
      .then(setMarks)
      .catch((e) => setError(e.message));
  }, [caseId, session.id]);

  // Clicking an item asks the API to open it. The API records the action itself.
  async function open(artifactId) {
    setError('');
    try {
      setSelected(await openArtifact(session.id, artifactId));
    } catch (e) {
      setError(e.message);
    }
  }

  // From the timeline's "Source" link: jump to the evidence screen and open that item
  function openFromTimeline(artifactId) {
    setView('evidence');
    open(artifactId);
  }

  async function refreshMarks() {
    setMarks(await getMarks(session.id));
  }

  if (!caseData) {
    return error ? <p className="error">{error}</p> : <p>Loading workspace...</p>;
  }

  return (
    <div className="workspace">
      <aside>
        <h2>{caseData.case_code}</h2>
        <p className="muted">
          Mode: {session.mode} · hints up to level {session.max_hint_level}
        </p>

        <ul className="evidence-list">
          {caseData.artifacts.map((a) => {
            const m = marks[a.id] || {};
            return (
              <li key={a.id}>
                <button
                  className={selected?.id === a.id && view === 'evidence' ? 'active' : ''}
                  onClick={() => {
                    setView('evidence');
                    open(a.id);
                  }}
                >
                  <strong>{a.artifact_code}</strong> {a.name}
                  <small>{a.type}</small>
                  <span className="tags">
                    {m.relevant && <span className="tag">relevant</span>}
                    {m.suspicious && <span className="tag warn">suspicious</span>}
                    {m.challenged && <span className="tag danger">challenged</span>}
                    {m.hashChecked && <span className="tag">hash checked</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="detail">
        <div className="tabs">
          <button
            className={view === 'evidence' ? 'tab on' : 'tab'}
            onClick={() => setView('evidence')}
          >
            Evidence
          </button>
          <button
            className={view === 'timeline' ? 'tab on' : 'tab'}
            onClick={() => setView('timeline')}
          >
            Timeline
          </button>
          <button
            className={view === 'correlation' ? 'tab on' : 'tab'}
            onClick={() => setView('correlation')}
          >
            Correlation
          </button>
          <button
            className={view === 'hypotheses' ? 'tab on' : 'tab'}
            onClick={() => setView('hypotheses')}
          >
            Hypotheses
          </button>
          <button
            className={view === 'conclusion' ? 'tab on' : 'tab'}
            onClick={() => setView('conclusion')}
          >
            Conclude
          </button>
          {completed && (
            <button
              className={view === 'debrief' ? 'tab on' : 'tab'}
              onClick={() => setView('debrief')}
            >
              Debrief
            </button>
          )}
        </div>

        {completed && view !== 'conclusion' && view !== 'debrief' && (
          <p className="note">
            This investigation is complete and now read-only. Open the Debrief tab to see
            your score and what the evidence really was.
          </p>
        )}

        {error && <p className="error">{error}</p>}

        {view === 'timeline' ? (
          <TimelineBoard session={session} onOpenArtifact={openFromTimeline} />
        ) : view === 'correlation' ? (
          <CorrelationBoard session={session} artifacts={caseData.artifacts} />
        ) : view === 'hypotheses' ? (
          <HypothesisBoard session={session} artifacts={caseData.artifacts} />
        ) : view === 'conclusion' ? (
          <ConclusionBoard
            session={session}
            artifacts={caseData.artifacts}
            onSubmitted={(justNow) => {
              setCompleted(true);
              if (justNow) setView('debrief');
            }}
          />
        ) : view === 'debrief' ? (
          <DebriefBoard session={session} />
        ) : !selected ? (
          <p className="muted">Select an evidence item on the left to inspect it.</p>
        ) : (
          <EvidenceDetail a={selected}>
            <ValidationPanel
              key={selected.id}
              session={session}
              artifact={selected}
              others={caseData.artifacts.filter((x) => x.id !== selected.id)}
              marks={marks[selected.id] || {}}
              onChanged={refreshMarks}
            />
          </EvidenceDetail>
        )}
      </section>
    </div>
  );
}