import { useEffect, useState } from 'react';
import {
  getTimelinePool,
  getMyTimeline,
  addToTimeline,
  removeFromTimeline,
} from '../api.js';
import { fmt } from '../format.js';

export default function TimelineBoard({ session, onOpenArtifact }) {
  const [pool, setPool] = useState(null); // events found in the evidence
  const [mine, setMine] = useState([]); // the trainee's own timeline
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([getTimelinePool(session.id), getMyTimeline(session.id)])
      .then(([events, timeline]) => {
        setPool(events);
        setMine(timeline);
      })
      .catch((e) => setError(e.message));
  }, [session.id]);

  const onTimeline = new Set(mine.map((e) => e.event_id));

  // Runs one change, then reloads the trainee's timeline from the server
  async function change(action) {
    setBusy(true);
    setError('');
    try {
      await action();
      setMine(await getMyTimeline(session.id));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!pool) {
    return error ? <p className="error">{error}</p> : <p>Loading timeline...</p>;
  }

  return (
    <div>
      <h2>Timeline</h2>
      <p className="muted">
        These events were found in the evidence. Add only the ones you believe really
        happened. Your timeline is always shown in time order.
      </p>

      {session.mode === 'GUIDED' && (
        <p className="note">
          Tip: an event is only as trustworthy as the evidence behind it. Use "Source" to
          open the evidence and validate it before you add its event.
        </p>
      )}

      {error && <p className="error">{error}</p>}

      <div className="timeline-cols">
        <div>
          <h3>Events found in the evidence</h3>
          {pool.map((e) => (
            <div key={e.id} className="event">
              <div className="event-time">{fmt(e.ts)}</div>
              <div>{e.description}</div>
              <div className="event-meta">
                {e.artifact_id && (
                  <button className="link" onClick={() => onOpenArtifact(e.artifact_id)}>
                    Source: {e.artifact_code}
                  </button>
                )}
                <button
                  className="btn"
                  disabled={busy || onTimeline.has(e.id)}
                  onClick={() => change(() => addToTimeline(session.id, e.id))}
                >
                  {onTimeline.has(e.id) ? 'Added' : 'Add to my timeline'}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div>
          <h3>My timeline ({mine.length})</h3>
          {mine.length === 0 ? (
            <p className="muted">Nothing yet. Add events from the list.</p>
          ) : (
            mine.map((e) => (
              <div key={e.event_id} className="event mine">
                <div className="event-time">
                  {e.position}. {fmt(e.ts)}
                </div>
                <div>{e.description}</div>
                <div className="event-meta">
                  <span className="muted">{e.artifact_code}</span>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => change(() => removeFromTimeline(session.id, e.event_id))}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}