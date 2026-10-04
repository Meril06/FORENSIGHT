// Step 12 unit test: run with   node scripts/step12-unit-test.js
// No database and no server needed. This tests the scoring rules only.

import { calculateScore, MAX } from '../src/scoring/calculate.js';

let failed = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (got ${actual}, expected ${expected})`);
}

// ---------- The demo case, in the shape the scorer receives ----------
const ART = (code, trueStatus, relevance, manipulationRisk, manipulationType = null) => ({
  id: code, code, trueStatus, relevance, manipulationRisk, manipulationType,
});
const artifacts = [
  ART('EV-001', 'GENUINE', 0.7, 0.05),
  ART('EV-002', 'GENUINE', 1.0, 0.05),
  ART('EV-003', 'GENUINE', 0.9, 0.05),
  ART('EV-004', 'GENUINE', 1.0, 0.05),
  ART('EV-005', 'GENUINE', 0.8, 0.05),
  ART('EV-006', 'IRRELEVANT', 0.1, 0.0),
  ART('EV-007', 'GENUINE', 0.8, 0.05),
  ART('EV-008', 'INCOMPLETE', 0.3, 0.2),
  ART('EV-009', 'GENUINE', 0.9, 0.05),
  ART('EV-010', 'POISONED', 0.6, 0.95, 'TIMESTAMP_TAMPERING'),
];
const ALL = artifacts.map((a) => a.id);
const REQUIRED = ['EV-002', 'EV-003', 'EV-004', 'EV-007', 'EV-009'];
const events = ['TL-001', 'TL-002', 'TL-003', 'TL-004', 'TL-005', 'TL-006', 'TL-007', 'TL-008', 'TL-009']
  .map((id) => ({ id, code: id, description: id }));
const TRUE_LINKS = [
  { source: 'EV-003', target: 'EV-009', type: 'CORROBORATES' },
  { source: 'EV-003', target: 'EV-007', type: 'CORROBORATES' },
  { source: 'EV-004', target: 'EV-007', type: 'CORROBORATES' },
  { source: 'EV-005', target: 'EV-004', type: 'SUPPORTS' },
  { source: 'EV-002', target: 'EV-004', type: 'SUPPORTS' },
  { source: 'EV-009', target: 'EV-010', type: 'CONTRADICTS' },
];
const truth = {
  requiredEvidence: REQUIRED,
  expectedTimeline: ['TL-001', 'TL-002', 'TL-003', 'TL-004', 'TL-005'],
  relationships: TRUE_LINKS,
  hypotheses: [
    { id: 'H1', isTrue: true },
    { id: 'H2', isTrue: false },
    { id: 'H3', isTrue: false },
    { id: 'H4', isTrue: false },
  ],
};

const supports = (ids) => ids.map((artifactId) => ({ artifactId, relationship: 'SUPPORTS', weight: 3 }));

// A flawless investigation. Other scenarios are copies of this one with something broken.
function perfect() {
  return {
    mode: 'MENTOR',
    artifacts,
    events,
    truth,
    trainee: {
      opened: [...ALL],
      markedRelevant: [...REQUIRED],
      markedSuspicious: ['EV-010'],
      challenges: [
        { artifactId: 'EV-010', reason: 'TIMESTAMP_INCONSISTENT' },
        { artifactId: 'EV-008', reason: 'INCOMPLETE_OR_TRUNCATED' },
      ],
      hintsUsed: 0,
      timelineEventIds: ['TL-001', 'TL-002', 'TL-003', 'TL-004', 'TL-005'],
      relationships: TRUE_LINKS.map((l) => ({ ...l })),
      hypotheses: [
        { optionId: 'H1', evidence: supports(REQUIRED) },
        { optionId: 'H2', evidence: [{ artifactId: 'EV-004', relationship: 'CONTRADICTS', weight: 2 }] },
      ],
      conclusion: {
        hypothesisOptionId: 'H1',
        confidence: 'HIGH',
        evidence: [
          ...REQUIRED.map((artifactId) => ({ artifactId, role: 'SUPPORTING' })),
          { artifactId: 'EV-010', role: 'SUSPICIOUS' },
        ],
      },
    },
  };
}

// ---------- 1. A flawless investigation ----------
let r = calculateScore(perfect());
check('Perfect run: discovery', r.scores.evidence_discovery, 20);
check('Perfect run: validation', r.scores.evidence_validation, 20);
check('Perfect run: timeline', r.scores.timeline_accuracy, 15);
check('Perfect run: correlation', r.scores.correlation, 15);
check('Perfect run: hypothesis quality', r.scores.hypothesis_quality, 10);
check('Perfect run: reasoning', r.scores.reasoning, 10);
check('Perfect run: final conclusion', r.scores.final_conclusion, 10);
check('Perfect run: total is 100', r.total, 100);
check('The maximums add up to 100', Object.values(MAX).reduce((a, b) => a + b, 0), 100);

// ---------- 2. Opens everything, then does nothing else (wrong-ish minimal effort) ----------
const idle = perfect();
idle.trainee = {
  ...idle.trainee,
  markedRelevant: [], markedSuspicious: [], challenges: [], timelineEventIds: [], relationships: [],
  hypotheses: [{ optionId: 'H1', evidence: [] }],
  conclusion: { hypothesisOptionId: 'H1', confidence: 'MEDIUM', evidence: [{ artifactId: 'EV-001', role: 'BACKGROUND' }] },
};
r = calculateScore(idle);
check('Opening everything but doing nothing: discovery is 0', r.scores.evidence_discovery, 0);
check('... validation misses the planted evidence (7.5 of 12 weight)', r.scores.evidence_validation, 12.5);
check('... total is 24, nowhere near 100', r.total, 24);

// ---------- 3. Does nothing at all, picks a wrong answer, admits doubt ----------
const nothing = perfect();
nothing.trainee = {
  opened: [], markedRelevant: [], markedSuspicious: [], challenges: [], hintsUsed: 0,
  timelineEventIds: [], relationships: [],
  hypotheses: [{ optionId: 'H3', evidence: [] }],
  conclusion: { hypothesisOptionId: 'H3', confidence: 'LOW', evidence: [{ artifactId: 'EV-001', role: 'BACKGROUND' }] },
};
r = calculateScore(nothing);
check('Doing nothing: validation is 0 (unopened evidence earns nothing)', r.scores.evidence_validation, 0);
check('Doing nothing: a wrong but humble conclusion earns 2', r.scores.final_conclusion, 2);
check('Doing nothing: total is 4.5', r.total, 4.5);

// ---------- 4. Trusts the planted evidence ----------
const fooled = perfect();
fooled.trainee.challenges = [{ artifactId: 'EV-008', reason: 'INCOMPLETE_OR_TRUNCATED' }];
fooled.trainee.markedSuspicious = [];
fooled.trainee.timelineEventIds = [...fooled.trainee.timelineEventIds, 'TL-008'];
fooled.trainee.hypotheses[0].evidence = [...fooled.trainee.hypotheses[0].evidence, { artifactId: 'EV-010', relationship: 'SUPPORTS', weight: 2 }];
fooled.trainee.conclusion.evidence = fooled.trainee.conclusion.evidence.map((e) => (e.artifactId === 'EV-010' ? { ...e, role: 'SUPPORTING' } : e));
r = calculateScore(fooled);
check('Fooled: validation drops because the planted item was missed', r.scores.evidence_validation, 13.33);
check('Fooled: the planted event on the timeline lowers it', r.scores.timeline_accuracy, 13.64);
check('Fooled: hypothesis quality loses a quarter of the evidence points', r.scores.hypothesis_quality, 9);
check('Fooled: reasoning loses the honesty points', r.scores.reasoning, 6);
check('Fooled: total', r.total, 86.97);

// ---------- 5. Wrongly accuses genuine evidence ----------
const paranoid = perfect();
paranoid.trainee.challenges.push({ artifactId: 'EV-009', reason: 'POSSIBLY_TAMPERED' });
r = calculateScore(paranoid);
check('Challenging genuine evidence costs validation points', r.scores.evidence_validation, 18.33);

// ---------- 6. Links everything to everything ----------
const spam = perfect();
const pairs = [];
for (let i = 0; i < ALL.length; i++) for (let j = i + 1; j < ALL.length; j++) pairs.push({ source: ALL[i], target: ALL[j], type: 'CORROBORATES' });
spam.trainee.relationships = pairs;
r = calculateScore(spam);
check('Linking all 45 pairs as "corroborates" scores far below 15', r.scores.correlation, 5.56);

// ---------- 7. Right pair, same direction of meaning, different word ----------
const wording = perfect();
wording.trainee.relationships = [{ source: 'EV-003', target: 'EV-009', type: 'SUPPORTS' }];
r = calculateScore(wording);
check('Half credit for a link that agrees but uses a different type (one link of six)', r.scores.correlation, 1.25);

// ---------- 8. No conclusion ----------
const unfinished = perfect();
unfinished.trainee.conclusion = null;
r = calculateScore(unfinished);
check('No conclusion: reasoning is 0', r.scores.reasoning, 0);
check('No conclusion: final conclusion is 0', r.scores.final_conclusion, 0);

// ---------- 9. Reproducible: same facts in a different order give the same score ----------
const a = calculateScore(perfect());
const shuffled = perfect();
shuffled.trainee.opened.reverse();
shuffled.trainee.relationships.reverse();
shuffled.trainee.timelineEventIds.reverse();
shuffled.trainee.hypotheses.reverse();
shuffled.artifacts = [...artifacts].reverse();
const b = calculateScore(shuffled);
check('Same facts in a different order: same total', b.total, a.total);
check('Calculating twice gives an identical result', JSON.stringify(calculateScore(perfect())) === JSON.stringify(a), true);

// ---------- 10. The input is not modified ----------
const input = perfect();
const before = JSON.stringify(input);
calculateScore(input);
check('The scorer does not change its input', JSON.stringify(input) === before, true);

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
process.exitCode = failed === 0 ? 0 : 1;
