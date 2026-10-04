// Prints the score of a completed investigation and checks that it can be reproduced.
//
//   node --env-file=.env scripts/score-report.js            (the most recent completed session)
//   node --env-file=.env scripts/score-report.js <sessionId>
//
// This is a DEVELOPER tool: it shows answers that trainees must not see during an investigation.

import {
  loadScoringInput,
  scoreSession,
  getStoredScore,
  latestCompletedSessionId,
  closeScorerPool,
} from '../src/scoring/score.js';
import { calculateScore } from '../src/scoring/calculate.js';

const LABELS = [
  ['discovery', 'evidence_discovery', 'Evidence discovery'],
  ['validation', 'evidence_validation', 'Evidence validation'],
  ['timeline', 'timeline_accuracy', 'Timeline reconstruction'],
  ['correlation', 'correlation', 'Evidence correlation'],
  ['hypothesis', 'hypothesis_quality', 'Hypothesis quality'],
  ['reasoning', 'reasoning', 'Reasoning'],
  ['conclusion', 'final_conclusion', 'Final conclusion'],
];

try {
  const sessionId = process.argv[2] ?? (await latestCompletedSessionId());
  if (!sessionId) {
    console.log('There is no completed investigation yet. Submit a conclusion in the website first.');
  } else {
    // 1. Recalculate from the stored actions (this changes nothing in the database)
    const input = await loadScoringInput(sessionId);
    const fresh = calculateScore(input);

    // 2. Get the score that was stored when the investigation closed (or create it now)
    let stored = await getStoredScore(sessionId);
    if (!stored) {
      console.log('No stored score for this session, so calculating and saving one now.\n');
      await scoreSession(sessionId);
      stored = await getStoredScore(sessionId);
    }

    console.log(`Session ${sessionId}`);
    console.log(`Mode: ${fresh.details.mode}    Hints used: ${fresh.details.hintsUsed}    Scoring rules version: ${fresh.details.scorerVersion}\n`);

    for (const [key, column, label] of LABELS) {
      const c = fresh.details.components[key];
      console.log(`${label.padEnd(26)} ${String(c.score.toFixed(2)).padStart(6)} / ${c.max}`);
      for (const note of c.notes) console.log(`      - ${note}`);
    }
    console.log('-'.repeat(44));
    console.log(`${'TOTAL'.padEnd(26)} ${String(fresh.total.toFixed(2)).padStart(6)} / 100\n`);

    const same =
      stored.total === fresh.total &&
      LABELS.every(([, column]) => stored[column] === fresh.scores[column]);
    console.log(`Stored score matches the score recalculated from the log: ${same ? 'YES' : 'NO'}`);
    if (!same) {
      console.log(`  stored total ${stored.total}, recalculated total ${fresh.total}`);
      process.exitCode = 1;
    }
  }
} finally {
  await closeScorerPool();
}
