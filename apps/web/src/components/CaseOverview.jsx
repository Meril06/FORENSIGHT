import { useEffect, useState } from 'react';
import { getCase, startSession } from '../api.js';

// These hint limits match the rules in the API (sessions.js)
const MODES = [
  {
    key: 'GUIDED',
    title: 'Guided',
    who: "I'm new to this",
    text: 'Step-by-step help while you learn. Hints up to level 4. The answer is only revealed at the end.',
  },
  {
    key: 'MENTOR',
    title: 'Mentor',
    who: 'I know the basics',
    text: 'Help when you ask for it. Hints up to level 3.',
  },
  {
    key: 'ASSESSMENT',
    title: 'Assessment',
    who: 'Test me',
    text: 'No hints at all.',
  },
];

export default function CaseOverview({ caseId, onBack, onStarted }) {
  const [caseData, setCaseData] = useState(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    getCase(caseId)
      .then(setCaseData)
      .catch((e) => setError(e.message));
  }, [caseId]);

  async function start(mode) {
    setStarting(true);
    setError('');
    try {
      const session = await startSession(caseId, mode);
      onStarted(session);
    } catch (e) {
      setError(e.message);
      setStarting(false);
    }
  }

  if (!caseData && !error) {
    return <p>Loading case...</p>;
  }

  return (
    <section>
      <button className="link" onClick={onBack}>← Back to case library</button>

      {caseData && (
        <>
          <h2>{caseData.title}</h2>
          <p className="muted">
            {caseData.case_code} · {caseData.difficulty} · {caseData.category} · {caseData.platform}
          </p>
          <p>{caseData.description}</p>
          <p className="muted">{caseData.artifacts.length} pieces of evidence to examine.</p>
        </>
      )}

      <h3>Choose your guidance</h3>
      <div className="grid">
        {MODES.map((m) => (
          <button
            key={m.key}
            className="card"
            disabled={starting || !caseData}
            onClick={() => start(m.key)}
          >
            <span className="badge">{m.who}</span>
            <h3>{m.title}</h3>
            <p>{m.text}</p>
          </button>
        ))}
      </div>

      {error && <p className="error">{error}</p>}
    </section>
  );
}