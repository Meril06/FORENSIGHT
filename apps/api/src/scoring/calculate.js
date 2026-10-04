// FORENSIGHT scoring engine.
//
// This file is PURE: it only turns numbers and lists into a score. It never touches the
// database, the clock or random numbers, so the same input always gives the same score.
// That is what makes a score reproducible and checkable.
//
// The spec fixes the seven categories and their maximums. The formulas below are this
// project's own design: change them here, change SCORER_VERSION, and the tests will
// show exactly which scores moved.

export const SCORER_VERSION = '1.0.0';

export const MAX = {
  discovery: 20,
  validation: 20,
  timeline: 15,
  correlation: 15,
  hypothesis: 10,
  reasoning: 10,
  conclusion: 10,
};

const round2 = (n) => Math.round(n * 100) / 100;
const clamp01 = (n) => Math.min(1, Math.max(0, n));

const GENUINE = ['GENUINE', 'LIKELY_GENUINE'];
const SYMMETRIC = ['CORROBORATES', 'CONTRADICTS', 'ASSOCIATED_WITH', 'UNRELATED'];
const AGREE = ['SUPPORTS', 'CORROBORATES'];
const DISAGREE = ['CONTRADICTS'];

// Which challenge reasons are sound for each kind of planting
const SOUND_REASONS = {
  TIMESTAMP_TAMPERING: ['TIMESTAMP_INCONSISTENT', 'POSSIBLY_TAMPERED', 'CONTRADICTED_BY_OTHER_EVIDENCE'],
  DEFAULT: ['POSSIBLY_TAMPERED', 'CONTRADICTED_BY_OTHER_EVIDENCE'],
};

export const isPoisoned = (a) => a.trueStatus === 'POISONED' || a.manipulationRisk >= 0.5;

function polarity(type) {
  if (AGREE.includes(type)) return 'agree';
  if (DISAGREE.includes(type)) return 'disagree';
  return 'other';
}

// ---------------------------------------------------------------------------
// 1. Evidence discovery (20)
//    Did the trainee find the key evidence AND make use of it?
//    Opening something is not enough; it must be marked relevant, linked, attached
//    to a hypothesis or cited in the conclusion. Inspecting irrelevant items costs nothing.
// ---------------------------------------------------------------------------
function scoreDiscovery(ctx) {
  const { truth, trainee, opened, code } = ctx;

  const used = new Set([
    ...trainee.markedRelevant,
    ...trainee.relationships.flatMap((r) => [r.source, r.target]),
    ...trainee.hypotheses.flatMap((h) => h.evidence.map((e) => e.artifactId)),
    ...(trainee.conclusion?.evidence ?? []).map((e) => e.artifactId),
  ]);

  const required = truth.requiredEvidence;
  const found = required.filter((id) => opened.has(id) && used.has(id));
  const missed = required.filter((id) => !found.includes(id));
  const score = required.length ? (MAX.discovery * found.length) / required.length : MAX.discovery;

  const notes = [
    missed.length === 0
      ? 'You found and used all of the key evidence.'
      : `You found and used ${found.length} of ${required.length} key evidence items. Missed: ${missed.map(code).join(', ')}.`,
  ];
  return { score: round2(score), max: MAX.discovery, notes, data: { required: required.length, found: found.length, foundIds: found, missedIds: missed } };
}

// ---------------------------------------------------------------------------
// 2. Evidence validation (20)
//    Did the trainee judge each item correctly? Planted evidence counts four times
//    as much as an ordinary item. Irrelevant items are left out. Unopened items earn 0.
// ---------------------------------------------------------------------------
function scoreValidation(ctx) {
  const { artifacts, trainee, opened, suspicious } = ctx;
  const POISONED_WEIGHT = 4;

  let weightTotal = 0;
  let earned = 0;
  const notes = [];
  const items = [];

  for (const a of artifacts) {
    if (a.trueStatus === 'IRRELEVANT') continue;

    const poisoned = isPoisoned(a);
    const weight = poisoned ? POISONED_WEIGHT : 1;
    const challenges = trainee.challenges.filter((c) => c.artifactId === a.id);
    const flagged = suspicious.has(a.id);

    let value;
    let note;
    if (!opened.has(a.id)) {
      value = 0;
      note = 'you never opened it';
    } else if (poisoned) {
      const sound = SOUND_REASONS[a.manipulationType] ?? SOUND_REASONS.DEFAULT;
      if (challenges.length > 0) {
        value = challenges.some((c) => sound.includes(c.reason)) ? 1 : 0.7;
        note = value === 1 ? 'planted evidence, challenged for a sound reason' : 'planted evidence, challenged but for a weaker reason';
      } else if (flagged) {
        value = 0.6;
        note = 'planted evidence, marked suspicious but never challenged';
      } else {
        value = 0;
        note = 'planted evidence that you did not notice';
      }
    } else if (GENUINE.includes(a.trueStatus)) {
      if (challenges.length > 0) {
        value = 0;
        note = 'genuine evidence that you wrongly challenged';
      } else if (flagged) {
        value = 0.5;
        note = 'genuine evidence that you wrongly marked suspicious';
      } else {
        value = 1;
        note = 'genuine, and you treated it that way';
      }
    } else {
      // incomplete / unverified / contradictory: the right move is to flag its limits
      if (challenges.length > 0) {
        value = challenges.some((c) => c.reason === 'INCOMPLETE_OR_TRUNCATED') ? 1 : 0.9;
        note = 'limited evidence, and you recognised its limits';
      } else if (flagged) {
        value = 0.8;
        note = 'limited evidence, flagged as unreliable';
      } else {
        value = 0.5;
        note = 'limited evidence whose limits you did not flag';
      }
    }

    weightTotal += weight;
    earned += weight * value;
    items.push({ id: a.id, code: a.code, credit: value, weight, note });
    if (value < 1) notes.push(`${a.code}: ${note}.`);
  }

  if (notes.length === 0) notes.push('Every item was judged correctly.');
  const score = weightTotal ? (MAX.validation * earned) / weightTotal : 0;
  return { score: round2(score), max: MAX.validation, notes, data: { items } };
}

// ---------------------------------------------------------------------------
// 3. Timeline (15)
//    Compare the events the trainee kept with the expected timeline (precision and
//    recall, combined as F1). Adding misleading events lowers precision; leaving out
//    real events lowers recall. Order is not scored separately because the trainee's
//    timeline is always shown in time order.
// ---------------------------------------------------------------------------
function scoreTimeline(ctx) {
  const { truth, trainee, events } = ctx;
  const evCode = (id) => events.find((e) => e.id === id)?.code ?? id;

  const expected = truth.expectedTimeline;
  const chosen = new Set(trainee.timelineEventIds);
  const hits = expected.filter((id) => chosen.has(id));
  const missing = expected.filter((id) => !chosen.has(id));
  const extra = [...chosen].filter((id) => !expected.includes(id));

  const recall = expected.length ? hits.length / expected.length : 0;
  const precision = chosen.size ? hits.length / chosen.size : 0;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  const notes = [`Your timeline contained ${hits.length} of ${expected.length} expected events.`];
  if (missing.length) notes.push(`Missing: ${missing.map(evCode).join(', ')}.`);
  if (extra.length) notes.push(`Events that should not have been included: ${extra.map(evCode).join(', ')}.`);

  return { score: round2(MAX.timeline * f1), max: MAX.timeline, notes, data: { precision: round2(precision), recall: round2(recall), hitIds: hits, missingIds: missing, extraIds: extra } };
}

// ---------------------------------------------------------------------------
// 4. Correlation (15)
//    Did the trainee connect the evidence that really is connected?
//    Full credit for the right pair and type; half credit for the right pair with a
//    type that points the same way (supports vs corroborates). Many unrelated links
//    reduce the score a little so that linking everything to everything does not pay.
// ---------------------------------------------------------------------------
function scoreCorrelation(ctx) {
  const { truth, trainee, code } = ctx;
  const samePair = (x, y) =>
    (x.source === y.source && x.target === y.target) || (x.source === y.target && x.target === y.source);

  function credit(trueLink, link) {
    if (!samePair(trueLink, link)) return 0;
    const direction = link.source === trueLink.source && link.target === trueLink.target;
    if (link.type === trueLink.type && (SYMMETRIC.includes(trueLink.type) || direction)) return 1;
    const p = polarity(trueLink.type);
    if (p !== 'other' && polarity(link.type) === p) return 0.5;
    return 0;
  }

  const trueLinks = truth.relationships;
  const perTrueLink = trueLinks.map((t) => ({
    link: t,
    credit: Math.max(0, ...trainee.relationships.map((r) => credit(t, r))),
  }));
  const recall = trueLinks.length ? perTrueLink.reduce((s, x) => s + x.credit, 0) / trueLinks.length : 0;

  const useful = trainee.relationships.filter((r) => trueLinks.some((t) => credit(t, r) > 0)).length;
  const precision = trainee.relationships.length ? useful / trainee.relationships.length : 0;

  const score = MAX.correlation * recall * (0.5 + 0.5 * precision);

  const missed = perTrueLink.filter((x) => x.credit === 0).map((x) => `${code(x.link.source)} / ${code(x.link.target)}`);
  const notes = [`You found ${perTrueLink.filter((x) => x.credit > 0).length} of ${trueLinks.length} key connections.`];
  if (missed.length) notes.push(`Connections you did not make or got wrong: ${missed.join(', ')}.`);
  if (trainee.relationships.length - useful > 0) {
    notes.push(`${trainee.relationships.length - useful} of your ${trainee.relationships.length} links did not match any key connection.`);
  }

  const links = perTrueLink.map((x) => ({ source: x.link.source, target: x.link.target, type: x.link.type, credit: x.credit }));
  const unmatched = trainee.relationships.length - useful;
  return { score: round2(score), max: MAX.correlation, notes, data: { recall: round2(recall), precision: round2(precision), links, unmatched } };
}

// ---------------------------------------------------------------------------
// 5. Hypothesis quality (10)
//    Breadth (3): did the trainee weigh more than one explanation?
//    Evidence quality (4): was genuine, relevant evidence attached in support of the true
//      explanation, without trusting planted evidence or contradicting the truth with
//      good evidence?
//    Awareness of contradiction (3): did the trainee attach evidence that argues AGAINST
//      an explanation (and do it sensibly)?
// ---------------------------------------------------------------------------
function scoreHypotheses(ctx) {
  const { artifacts, truth, trainee, byId, code } = ctx;
  const notes = [];

  const considered = trainee.hypotheses;
  const breadth = considered.length >= 2 ? 3 : considered.length === 1 ? 1.5 : 0;
  notes.push(
    considered.length >= 2
      ? `You weighed ${considered.length} explanations.`
      : 'You weighed only one explanation. Competing explanations are how you test your own.'
  );

  const trueIds = new Set(truth.hypotheses.filter((h) => h.isTrue).map((h) => h.id));
  const goodSet = new Set(
    artifacts.filter((a) => GENUINE.includes(a.trueStatus) && a.relevance >= 0.7).map((a) => a.id)
  );

  const supportedTrue = new Set();
  let wrong = 0;
  let sensibleContradictions = 0;

  for (const h of considered) {
    const trueHyp = trueIds.has(h.optionId);
    for (const e of h.evidence) {
      const a = byId.get(e.artifactId);
      if (!a) continue;
      let isWrong = false;
      if (isPoisoned(a) && e.relationship === 'SUPPORTS') {
        isWrong = true;
        notes.push(`You treated ${a.code} as support, but it was planted evidence.`);
      }
      if (trueHyp && e.relationship === 'CONTRADICTS' && goodSet.has(a.id)) {
        isWrong = true;
        notes.push(`You used ${a.code} against the correct explanation, but it is genuine and fits it.`);
      }
      if (isWrong) wrong += 1;
      if (e.relationship === 'CONTRADICTS' && !isWrong) sensibleContradictions += 1;
      if (trueHyp && e.relationship === 'SUPPORTS' && goodSet.has(a.id)) supportedTrue.add(a.id);
    }
  }

  const denominator = Math.max(1, truth.requiredEvidence.length);
  const quality = clamp01(Math.min(supportedTrue.size, denominator) / denominator - 0.25 * wrong) * 4;
  if (supportedTrue.size < denominator) {
    notes.push(`You attached ${supportedTrue.size} supporting evidence items to the correct explanation; about ${denominator} were available.`);
  }

  const awareness = sensibleContradictions > 0 ? 3 : 0;
  if (!awareness) notes.push('You attached no evidence against any explanation. Looking for what does not fit is half of testing a hypothesis.');

  return { score: round2(breadth + quality + awareness), max: MAX.hypothesis, notes, data: { breadth, quality: round2(quality), awareness } };
}

// ---------------------------------------------------------------------------
// 6. Reasoning (10)
//    The free text is NOT judged by keyword matching. Instead we check whether the
//    conclusion is backed by the right evidence, in the right roles:
//      coverage (4): key evidence cited as supporting
//      honesty (4): planted evidence named as suspicious (not used as support)
//      breadth (2): how many distinct pieces of evidence were cited
//    (Judging the written explanation itself is for the AI Examiner or an instructor.)
// ---------------------------------------------------------------------------
function scoreReasoning(ctx) {
  const { artifacts, truth, trainee, code } = ctx;
  if (!trainee.conclusion) {
    return { score: 0, max: MAX.reasoning, notes: ['No conclusion was submitted.'], data: {} };
  }
  const roleOf = new Map(trainee.conclusion.evidence.map((e) => [e.artifactId, e.role]));
  const notes = [];

  const required = truth.requiredEvidence;
  const cited = required.filter((id) => roleOf.get(id) === 'SUPPORTING');
  const coverage = required.length ? (4 * cited.length) / required.length : 4;
  const uncited = required.filter((id) => !cited.includes(id));
  notes.push(
    uncited.length === 0
      ? 'Your conclusion cites all of the key evidence as support.'
      : `Key evidence missing from your conclusion as support: ${uncited.map(code).join(', ')}.`
  );

  const planted = artifacts.filter(isPoisoned);
  const roleValue = { SUSPICIOUS: 1, CONTRADICTING: 0.75, BACKGROUND: 0.25, SUPPORTING: 0 };
  const honestyValues = planted.map((a) => (roleOf.has(a.id) ? roleValue[roleOf.get(a.id)] : 0.25));
  const honesty = planted.length ? (4 * honestyValues.reduce((s, v) => s + v, 0)) / planted.length : 4;
  for (const a of planted) {
    const role = roleOf.get(a.id);
    if (role === 'SUSPICIOUS') notes.push(`You correctly named ${a.code} as suspicious in your conclusion.`);
    else if (role === 'SUPPORTING') notes.push(`Your conclusion relies on ${a.code} as support, but it was planted evidence.`);
    else notes.push(`Your conclusion does not call out ${a.code}, the planted evidence, as unreliable.`);
  }

  const distinct = trainee.conclusion.evidence.length;
  const breadth = distinct >= 3 ? 2 : distinct === 2 ? 1 : 0;

  return { score: round2(coverage + honesty + breadth), max: MAX.reasoning, notes, data: {} };
}

// ---------------------------------------------------------------------------
// 7. Final conclusion (10)
//    Correct explanation: 7. Calibration of confidence: up to 3.
//    Confident and right is rewarded; confident and wrong is not; honest doubt is
//    rewarded when the answer is wrong.
// ---------------------------------------------------------------------------
function scoreConclusion(ctx) {
  const { truth, trainee } = ctx;
  if (!trainee.conclusion) {
    return { score: 0, max: MAX.conclusion, notes: ['No conclusion was submitted.'], data: {} };
  }
  const chosen = truth.hypotheses.find((h) => h.id === trainee.conclusion.hypothesisOptionId);
  const correct = chosen?.isTrue === true;
  const calibration = correct
    ? { HIGH: 3, MEDIUM: 2, LOW: 1 }[trainee.conclusion.confidence] ?? 0
    : { HIGH: 0, MEDIUM: 1, LOW: 2 }[trainee.conclusion.confidence] ?? 0;

  const notes = [
    correct ? 'You chose the correct explanation.' : 'You chose an explanation that the evidence does not support.',
    `Confidence ${trainee.conclusion.confidence}: ${
      correct
        ? calibration === 3 ? 'well matched to a correct answer.' : 'a correct answer deserved more confidence.'
        : calibration === 2 ? 'appropriately cautious for a wrong answer.' : 'too sure for a wrong answer.'
    }`,
  ];
  return { score: round2((correct ? 7 : 0) + calibration), max: MAX.conclusion, notes, data: { correct } };
}

// ---------------------------------------------------------------------------
// Put it all together
// ---------------------------------------------------------------------------
export function calculateScore(input) {
  const { artifacts, events = [], truth, trainee, mode = null } = input;

  const byId = new Map(artifacts.map((a) => [a.id, a]));
  const ctx = {
    artifacts,
    events,
    truth,
    trainee,
    byId,
    code: (id) => byId.get(id)?.code ?? id,
    opened: new Set(trainee.opened),
    suspicious: new Set(trainee.markedSuspicious),
  };

  const components = {
    discovery: scoreDiscovery(ctx),
    validation: scoreValidation(ctx),
    timeline: scoreTimeline(ctx),
    correlation: scoreCorrelation(ctx),
    hypothesis: scoreHypotheses(ctx),
    reasoning: scoreReasoning(ctx),
    conclusion: scoreConclusion(ctx),
  };

  const scores = {
    evidence_discovery: components.discovery.score,
    evidence_validation: components.validation.score,
    timeline_accuracy: components.timeline.score,
    correlation: components.correlation.score,
    hypothesis_quality: components.hypothesis.score,
    reasoning: components.reasoning.score,
    final_conclusion: components.conclusion.score,
  };
  const total = round2(Object.values(scores).reduce((s, v) => s + v, 0));

  return {
    scores,
    total,
    details: { scorerVersion: SCORER_VERSION, mode, hintsUsed: trainee.hintsUsed ?? 0, components },
  };
}