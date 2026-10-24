import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvaluationPrompt } from '../backend/prompts.js';
import { normalizeEvaluation } from '../backend/parse.js';

const setup = { role: 'Software Engineer', level: 'Mid', companyType: '' };
const record = (delivery) => ({
  id: 'b1', round: 'behavioral', type: 'behavioral', topic: 'teamwork', hintsUsed: 0, seconds: 95, code: '',
  turns: [{ speaker: 'interviewer', text: 'Tell me about a time…' }, { speaker: 'candidate', text: 'Um, so at my internship…' }],
  delivery,
});
const delivery = {
  answers: 1, spokenSeconds: 62, latency: 1.4, wpm: 171, pauseShare: 0.12, pauses: 5, longPauses: 1, pitchHz: 182,
  pitchVarSt: 1.6, loudVarDb: 4.2, words: 180, fillers: 6, fillerShare: 0.033, fillerWords: { um: 4, like: 2 },
  faceCoverage: 0.96, smileMean: 14, smileShare: 0.08, nods: 1, shakes: 0, awayShare: 0.1,
  articulationWpm: 196, pitchPhrases: 9, uptalk: 4, uptalkShare: 0.44, loudPhrases: 9, trailOff: 1, trailShare: 0.11,
  longestSilence: null, silentStretches: null, silentCoding: null,
};

test('evaluation prompt includes delivery measurements and asks for delivery coaching', () => {
  const prompt = buildEvaluationPrompt(setup, [record(delivery)], { overall: delivery, listeningNods: 3, listeningShakes: 0, listeningSeconds: 120 });
  assert.match(prompt, /Delivery measurements: speaking rate 171 words per minute/);
  assert.match(prompt, /"um" ×4/);
  assert.match(prompt, /"delivery": \{ "summary"/);
  assert.match(prompt, /made 3 head nod\(s\)/);
  assert.match(prompt, /never infer emotions/);
  assert.match(prompt, /pitch rose at the end of 4 of 9 phrases \(possible uptalk\)/);
  assert.match(prompt, /articulation rate 196 words per minute/);
  assert.match(prompt, /Think-aloud \(coding questions\)/);
  assert.match(prompt, /Hedging/);
  assert.doesNotMatch(prompt, /while solving/); // behavioral answer: no think-aloud stats
});

test('typed interviews get the original prompt without delivery sections', () => {
  const prompt = buildEvaluationPrompt(setup, [record(null)]);
  assert.doesNotMatch(prompt, /Delivery measurements/);
  assert.doesNotMatch(prompt, /"delivery"/);
});

test('normalizeEvaluation keeps delivery coaching only where measurements exist', () => {
  const raw = {
    overall: { score: 4, summary: 'Solid.' },
    rounds: { behavioral: { score: 4, summary: 'Good.' } },
    questions: [{ id: 'b1', scores: { star: 4, specificity: 3, relevance: 5, clarity: 4 }, delivery: 'At 171 wpm you rushed the result.' }],
    topPractice: ['a', 'b', 'c'],
    delivery: { summary: 'Fast but clear.', tips: ['Slow down', { tip: 'Smile when greeting' }, 'null'] },
  };
  const withMeasures = normalizeEvaluation(raw, [record(delivery)]);
  assert.equal(withMeasures.questions[0].delivery, 'At 171 wpm you rushed the result.');
  assert.deepEqual(withMeasures.delivery.tips, ['Slow down', 'Smile when greeting']);
  const typed = normalizeEvaluation(raw, [record(null)]);
  assert.equal(typed.questions[0].delivery, null);
});
