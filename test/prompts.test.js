import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInterviewerTurn, buildEvaluationPrompt } from '../backend/prompts.js';

const setup = { role: 'Software Engineer', level: 'Entry', companyType: 'startup' };
const turn = { kind: 'answer', stage: 'technical', questionNumber: 1, totalQuestions: 3, followupsUsed: 0, maxFollowups: 2, hintsUsed: 0, hintsLeftToday: 3, current: { type: 'coding', topic: 'arrays' }, next: { action: 'candidate_questions' } };

test('interviewer stays neutral and uses deeper reasoning when reviewing code', () => {
  const normal = buildInterviewerTurn(setup, turn);
  const code = buildInterviewerTurn(setup, { ...turn, includesCode: true });
  assert.equal(normal.thinking, 'minimal');
  assert.equal(code.thinking, 'high');
  assert.match(code.systemInstruction, /check it for correctness, edge cases, and complexity/);
  assert.match(normal.systemInstruction, /Never give feedback, scores, grades/);
  assert.match(normal.systemInstruction, /Entry-level Software Engineer/);
});

test('hints escalate from a nudge to the key idea without revealing code', () => {
  const prompts = [0, 1, 2].map((hintsUsed) => buildInterviewerTurn(setup, { ...turn, kind: 'hint', hintsUsed }).systemInstruction);
  assert.match(prompts[0], /gentle nudge/);
  assert.match(prompts[1], /pointer toward the right technique/);
  assert.match(prompts[2], /key idea of a working approach/);
  for (const prompt of prompts) assert.match(prompt, /Never give the full solution or write code/);
});

test('forced advancement prevents further follow-ups and presents the next coding problem', () => {
  const result = buildInterviewerTurn(setup, { ...turn, forced: true, next: { action: 'new_question', round: 'technical', number: 2, total: 3, type: 'coding', topic: 'hash maps' } });
  assert.equal(result.expectsAction, false);
  assert.match(result.systemInstruction, /do not follow up further/);
  assert.match(result.systemInstruction, /<problem>/);
  assert.match(result.systemInstruction, /hash maps/);
});

test('evaluation preserves question IDs, final code, hint usage, and transcript evidence', () => {
  const prompt = buildEvaluationPrompt(setup, [{ id: 't2', round: 'technical', type: 'coding', topic: 'arrays', hintsUsed: 1, seconds: 125, code: 'return 42;', turns: [{ speaker: 'interviewer', text: 'Find the sum.' }, { speaker: 'candidate', text: 'I use one pass.' }] }]);
  assert.match(prompt, /question id below \(t2\)/);
  assert.match(prompt, /Hints used: 1 \| Time spent: 2m 5s/);
  assert.match(prompt, /Candidate: I use one pass\./);
  assert.match(prompt, /Final code in editor:\nreturn 42;/);
  assert.doesNotMatch(prompt, /"strongerAnswer"/);
});

test('presenting a coding or SQL problem uses minimal thinking to stay within the turn deadline', () => {
  for (const type of ['coding', 'sql']) {
    const presenting = buildInterviewerTurn(setup, { ...turn, current: { type: 'conceptual', topic: 'caching' }, next: { action: 'next', round: 'technical', number: 2, total: 3, type, topic: 'joins' } });
    assert.match(presenting.systemInstruction, /<problem>/);
    assert.equal(presenting.thinking, 'minimal');
  }
  // Reviewing submitted code still reasons more carefully (measured ~10 s, within the limit).
  const reviewing = buildInterviewerTurn(setup, { ...turn, includesCode: true, next: { action: 'next', round: 'technical', number: 2, total: 3, type: 'coding', topic: 'joins' } });
  assert.equal(reviewing.thinking, 'high');
});
