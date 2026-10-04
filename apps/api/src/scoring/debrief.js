import { loadScoringInput, scoreSession, getStoredScore } from './score.js';
import { calculateScore, isPoisoned } from './calculate.js';

const CATEGORIES = [
  ['discovery', 'Evidence discovery'],
  ['validation', 'Evidence validation'],
  ['timeline', 'Timeline reconstruction'],
  ['correlation', 'Evidence correlation'],
  ['hypothesis', 'Hypothesis quality'],
  ['reasoning', 'Reasoning'],
  ['conclusion', 'Final conclusion'],
];

// Builds everything the debrief screen shows, INCLUDING the hidden answers.
//
// SAFETY: only call this for a COMPLETED session that belongs to the person asking.
// The route in sessions.js checks that before calling. This function reads the answers
// with the scorer login, which the ordinary trainee routes never use.
export async function buildDebrief(sessionId) {
  const input = await loadScoringInput(sessionId); // throws unless the session is COMPLETED
  const result = calculateScore(input); // deterministic: matches the stored score
  const comp = result.details.components;

  // Make sure a score is on record (it normally already is)
  if (!(await getStoredScore(sessionId))) await scoreSession(sessionId);

  const { artifacts, events, truth, trainee } = input;
  const byId = new Map(artifacts.map((a) => [a.id, a]));
  const codeOf = (id) => byId.get(id)?.code ?? id;

  // ----- evidence: what each item really was, and what the trainee made of it -----
  const checks = new Map(comp.validation.data.items.map((i) => [i.id, i]));
  const opened = new Set(trainee.opened);
  const relevant = new Set(trainee.markedRelevant);
  const suspicious = new Set(trainee.markedSuspicious);
  const evidence = artifacts.map((a) => {
    const check = checks.get(a.id);
    const mine = trainee.challenges.filter((c) => c.artifactId === a.id);
    return {
      code: a.code,
      name: a.name,
      type: a.type,
      trueStatus: a.trueStatus,
      planted: isPoisoned(a),
      manipulationType: a.manipulationType,
      explanation: a.reason,
      you: {
        opened: opened.has(a.id),
        markedRelevant: relevant.has(a.id),
        markedSuspicious: suspicious.has(a.id),
        challenged: mine.length > 0,
        challengeReasons: mine.map((c) => c.reason),
      },
      credit: check ? check.credit : null, // null = not part of validation (irrelevant item)
      feedback: check ? check.note : 'Irrelevant to the case, so it is not scored.',
    };
  });

  // ----- timeline: every candidate event, marked real or misleading -----
  const expected = new Set(truth.expectedTimeline);
  const chosen = new Set(trainee.timelineEventIds);
  const timeline = [...events]
    .sort((x, y) => new Date(x.ts) - new Date(y.ts))
    .map((e) => ({
      time: e.ts,
      description: e.description,
      source: e.artifactId ? codeOf(e.artifactId) : null,
      real: expected.has(e.id),
      youIncluded: chosen.has(e.id),
    }));

  // ----- connections: the key links and whether the trainee made them -----
  const explanationFor = (l) =>
    truth.relationships.find((t) => t.source === l.source && t.target === l.target)?.explanation ?? null;
  const connections = comp.correlation.data.links.map((l) => ({
    from: codeOf(l.source),
    to: codeOf(l.target),
    type: l.type,
    explanation: explanationFor(l),
    credit: l.credit,
  }));

  // ----- hypotheses: which explanation was true -----
  const considered = new Set(trainee.hypotheses.map((h) => h.optionId));
  const concludedId = trainee.conclusion?.hypothesisOptionId ?? null;
  const hypotheses = truth.hypotheses.map((h) => ({
    title: h.title,
    description: h.description,
    isTrue: h.isTrue,
    youConsidered: considered.has(h.id),
    youConcluded: h.id === concludedId,
  }));

  // ----- the conclusion, compared with the truth -----
  const concluded = truth.hypotheses.find((h) => h.id === concludedId);
  const conclusion = trainee.conclusion
    ? {
        hypothesisTitle: concluded?.title ?? null,
        correct: concluded?.isTrue === true,
        confidence: trainee.conclusion.confidence,
        summary: trainee.conclusion.summary,
        reasoning: trainee.conclusion.reasoning,
        evidence: trainee.conclusion.evidence.map((e) => ({
          code: codeOf(e.artifactId),
          name: byId.get(e.artifactId)?.name ?? '',
          role: e.role,
        })),
      }
    : null;

  return {
    session: {
      mode: input.mode,
      hintsUsed: trainee.hintsUsed,
      completedAt: input.session.completedAt,
    },
    case: input.caseInfo,
    score: {
      total: result.total,
      max: 100,
      scorerVersion: result.details.scorerVersion,
      categories: CATEGORIES.map(([key, label]) => ({
        key,
        label,
        score: comp[key].score,
        max: comp[key].max,
        notes: comp[key].notes,
      })),
    },
    missedEvidence: comp.discovery.data.missedIds.map((id) => ({ code: codeOf(id), name: byId.get(id)?.name ?? '' })),
    evidence,
    timeline,
    connections,
    unmatchedLinks: comp.correlation.data.unmatched,
    hypotheses,
    conclusion,
  };
}