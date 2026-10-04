import { useEffect, useState } from 'react';
import { getCases } from '../api.js';

export default function CaseLibrary({ onSelect }) {
  const [cases, setCases] = useState(null); // null = still loading
  const [error, setError] = useState('');

  // Runs once when the screen first appears
  useEffect(() => {
    getCases()
      .then(setCases)
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return <p className="error">Could not load cases: {error}. Is the API running?</p>;
  }
  if (!cases) {
    return <p>Loading cases...</p>;
  }

  return (
    <section>
      <h2>Case Library</h2>
      <div className="grid">
        {cases.map((c) => (
          <button key={c.id} className="card" onClick={() => onSelect(c.id)}>
            <span className="badge">{c.difficulty}</span>
            <h3>{c.title}</h3>
            <p>{c.description}</p>
            <small>
              {c.case_code} · {c.category} · {c.platform}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}