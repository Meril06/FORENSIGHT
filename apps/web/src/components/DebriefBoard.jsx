import { useEffect, useState } from 'react';
import { getDebrief } from '../api.js';
import { fmt } from '../format.js';

const STATUS_LABEL = {
  GENUINE: 'Genuine',
  LIKELY_GENUINE: 'Likely genuine',
  UNVERIFIED: 'Unverified',
  INCOMPLETE: 'Incomplete',
  CONTRADICTORY: 'Contradictory',
  SUSPICIOUS: 'Suspicious',
  POISONED: 'Planted / poisoned',
  IRRELEVANT: 'Irrelevant',
};

const TYPE_LABEL = {
  CORROBORATES: 'corroborates',
  SUPPORTS: 'supports',
  CONTRADICTS: 'contradicts',
  PRECEDES: 'happened before',
  FOLLOWS: 'happened after',
  CAUSED_BY: 'was caused by',
  ASSOCIATED_WITH: 'is associated with',
  UNRELATED: 'is unrelated to',
};

// Words and a tag colour for how well the trainee judged one piece of evidence
function verdict(e) {
  if (e.credit === null) return { text: 'Not scored', tag: 'tag' };
  if (e.credit >= 1) return { text: 'Judged correctly', tag: 'tag' };
  if (e.credit >= 0.5) return { text: 'Partly right', tag: 'tag warn' };
  return { text: 'Judged wrongly', tag: 'tag danger' };
}

function ScoreBar({ score, max }) {
  return (
    <div className="bar">
      <span style={{ width: `${(100 * score) / max}%` }} />
    </div>
  );
}

export default function DebriefBoard({ session }) {
  const [debrief, setDebrief] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getDebrief(session.id)
      .then(setDebrief)
      .catch((e) => setError(e.message));
  }, [session.id]);

  if (!debrief) {
    return error ? <p className="error">{error}</p> : <p>Preparing your debrief...</p>;
  }

  const d = debrief;
  const yourMarks = (you) =>
    [
      you.opened ? 'opened' : 'never opened',
      you.markedRelevant && 'marked relevant',
      you.markedSuspicious && 'marked suspicious',
      you.challenged && 'challenged',
    ].filter(Boolean);

  return (
    <div>
      <h2>Debrief · {d.case.title}</h2>
      <p className="muted">
        Mode: {d.session.mode} · hints used: {d.session.hintsUsed} · scoring rules version{' '}
        {d.score.scorerVersion}
      </p>

      {/* ---- Score ---- */}
      <div className="validation">
        <div className="big-score">
          {d.score.total.toFixed(1)} <small>/ {d.score.max}</small>
        </div>
        {d.score.categories.map((c) => (
          <div key={c.key} className="category">
            <div className="category-head">
              <strong>{c.label}</strong>
              <span>
                {c.score.toFixed(1)} / {c.max}
              </span>
            </div>
            <ScoreBar score={c.score} max={c.max} />
            <ul className="notes">
              {c.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* ---- Conclusion comparison ---- */}
      <h3>Your conclusion compared with the truth</h3>
      {d.conclusion ? (
        <div className="event mine">
          <p>
            You concluded: <strong>{d.conclusion.hypothesisTitle}</strong> with{' '}
            {d.conclusion.confidence.toLowerCase()} confidence.{' '}
            <span className={d.conclusion.correct ? 'tag' : 'tag danger'}>
              {d.conclusion.correct ? 'Correct' : 'Incorrect'}
            </span>
          </p>
          <p className="muted">{d.conclusion.summary}</p>
        </div>
      ) : (
        <p className="muted">No conclusion was submitted.</p>
      )}

      <h3>The possible explanations</h3>
      {d.hypotheses.map((h) => (
        <div key={h.title} className="event">
          <strong>{h.title}</strong>{' '}
          <span className={h.isTrue ? 'tag' : 'tag danger'}>{h.isTrue ? 'True' : 'False'}</span>
          {h.youConsidered && <span className="tag warn">you weighed it</span>}
          {h.youConcluded && <span className="tag warn">your conclusion</span>}
          <p className="muted">{h.description}</p>
        </div>
      ))}

      {/* ---- Missed evidence ---- */}
      <h3>Key evidence you missed</h3>
      {d.missedEvidence.length === 0 ? (
        <p className="muted">None. You found and used all of the key evidence.</p>
      ) : (
        <ul className="evidence-links">
          {d.missedEvidence.map((m) => (
            <li key={m.code}>
              <strong>{m.code}</strong> {m.name}
            </li>
          ))}
        </ul>
      )}

      {/* ---- Evidence ---- */}
      <h3>What each piece of evidence really was</h3>
      {d.evidence.map((e) => {
        const v = verdict(e);
        return (
          <div key={e.code} className={e.planted ? 'event planted' : 'event'}>
            <div>
              <strong>
                {e.code} · {e.name}
              </strong>{' '}
              <span className={e.planted ? 'tag danger' : 'tag'}>{STATUS_LABEL[e.trueStatus]}</span>
              <span className={v.tag}>{v.text}</span>
            </div>
            <p>{e.explanation}</p>
            <p className="muted">
              What you did: {yourMarks(e.you).join(', ')}. {e.feedback.replace(/^./, (c) => c.toUpperCase())}
              {e.feedback.endsWith('.') ? '' : '.'}
            </p>
          </div>
        );
      })}

      {/* ---- Timeline ---- */}
      <h3>The timeline</h3>
      {d.timeline.map((e, i) => {
        let tag;
        if (e.real && e.youIncluded) tag = <span className="tag">Real · you included it</span>;
        else if (e.real) tag = <span className="tag danger">Real · you missed it</span>;
        else if (e.youIncluded) tag = <span className="tag danger">Misleading · you included it</span>;
        else tag = <span className="tag">Misleading · you left it out</span>;
        return (
          <div key={i} className="event">
            <div className="event-time">{fmt(e.time)}</div>
            <div>{e.description}</div>
            <div className="event-meta">
              <span className="muted">{e.source}</span>
              {tag}
            </div>
          </div>
        );
      })}

      {/* ---- Connections ---- */}
      <h3>The key connections</h3>
      {d.connections.map((c, i) => (
        <div key={i} className="event">
          <div>
            <strong>{c.from}</strong> {TYPE_LABEL[c.type]} <strong>{c.to}</strong>{' '}
            {c.credit >= 1 ? (
              <span className="tag">You made this link</span>
            ) : c.credit > 0 ? (
              <span className="tag warn">Partly: right pair, different relationship</span>
            ) : (
              <span className="tag danger">You did not make this link</span>
            )}
          </div>
          {c.explanation && <p className="muted">{c.explanation}</p>}
        </div>
      ))}
      {d.unmatchedLinks > 0 && (
        <p className="muted">
          {d.unmatchedLinks} of your own links did not match any key connection. They are not
          necessarily wrong, but they did not earn points.
        </p>
      )}
    </div>
  );
}