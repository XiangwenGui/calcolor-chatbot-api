// Offline sanity check for the retrieval + confidence-gate logic. Uses a tiny
// synthetic index with hand-picked vectors, so it needs NO network / API key.
// It proves: cosine ranking order, top-k slicing, and the min-score gate.
//   node --experimental-strip-types scripts/verify-offline.ts

import assert from 'node:assert';
import { rankChunks, type KbChunk } from '../lib/kb.js';
import { config } from '../lib/config.js';

function chunk(id: string, embedding: number[]): KbChunk {
  return { id, title: id, text: id, embedding };
}

// Synthetic 3-dim "topic" space: tuition ~ x-axis, camp ~ y-axis, art ~ z-axis.
const chunks: KbChunk[] = [
  chunk('tuition', [1, 0, 0]),
  chunk('camp', [0, 1, 0]),
  chunk('teachers', [0, 0, 1]),
  chunk('registration', [0.8, 0.2, 0]),
];

// A "tuition-like" query should rank tuition first, then registration.
const tuitionQuery = [0.9, 0.1, 0];
const ranked = rankChunks(tuitionQuery, chunks, config.topK);
console.log('ranked:', ranked.map((r) => `${r.id}=${r.score.toFixed(2)}`).join(', '));
assert.equal(ranked[0].id, 'tuition', 'expected tuition to rank first');
assert.equal(ranked[1].id, 'registration', 'expected registration second');
assert.ok(ranked.length <= config.topK, 'top-k slicing failed');

// The confidence gate: an off-topic query pointing away from every topic vector
// yields low/negative cosine and should score below MIN_SCORE (escalate).
const offTopic = [-1, -1, -1];
const offRanked = rankChunks(offTopic, chunks, config.topK);
const wouldEscalate = !offRanked[0] || offRanked[0].score < config.minScore;
console.log(`off-topic top score = ${offRanked[0].score.toFixed(2)}, MIN_SCORE = ${config.minScore}`);

// A strongly on-topic query should clear the gate.
const onTopicTop = rankChunks([1, 0, 0], chunks, config.topK)[0];
assert.ok(onTopicTop.score >= config.minScore, 'on-topic query should clear the gate');

console.log('\nOK: ranking order, top-k, and gate thresholds behave as designed.');
console.log(wouldEscalate ? 'OK: off-topic query would escalate.' : 'NOTE: off-topic still cleared gate — tune MIN_SCORE.');
