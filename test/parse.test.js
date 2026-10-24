import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInterviewerReply, parseProblem, tryParseJson, normalizeEvaluation } from '../backend/parse.js';

const statement = `Title: Sum an Array
Difficulty: EASY
Description:
Return the sum of all values in \`nums\`.
Example 1:
Input: nums = [1, 2]
Output: 3
Explanation: 1 + 2 = 3.
Constraints:
- 0 <= nums.length <= 100
Follow-up: Can you do it in constant space?`;

test('hidden actions, reasoning, speaker labels, and stage directions stay out of speech', () => {
  const result = parseInterviewerReply('<think>Private reasoning.</think>\nACTION: FOLLOW-UP\nJordan: *nods* What did **you** do?', 'Jordan');
  assert.equal(result.action, 'FOLLOW_UP');
  assert.equal(result.text, 'What did you do?');
  assert.equal(result.problem, null);
  for (const action of ['HINT', 'NEXT', 'CONTINUE', 'END']) assert.equal(parseInterviewerReply(`ACTION: ${action}\nThanks.`, 'Jordan').action, action);
});

test('coding statement is separated from speech and survives a retry round trip', () => {
  const result = parseInterviewerReply(`ACTION: NEXT\nRead the problem on screen.\n<problem>\n${statement}\n</problem>`, 'Jordan');
  assert.equal(result.text, 'Read the problem on screen.');
  assert.equal(result.problem.title, 'Sum an Array');
  assert.equal(result.problem.difficulty, 'Easy');
  assert.deepEqual(result.problem.examples, [{ input: 'nums = [1, 2]', output: '3', explanation: '1 + 2 = 3.' }]);
  assert.deepEqual(result.problem.constraints, ['0 <= nums.length <= 100']);
  const retried = parseInterviewerReply(result.problem.raw, 'Jordan');
  assert.deepEqual(retried.problem, result.problem);
});

test('SQL schema and multiline example tables are preserved', () => {
  const problem = parseProblem('Title: Users\nSchema:\n| id | name |\n| int | text |\nDescription: Select all users.\nExample 1:\nInput:\n| 1 | Ana |\nOutput:\n| Ana |');
  assert.match(problem.schema, /\| int \| text \|/);
  assert.equal(problem.examples[0].input, '| 1 | Ana |');
  assert.equal(problem.examples[0].output, '| Ana |');
});

test('missing problem descriptions fail safely and missing closing tags are tolerated', () => {
  assert.equal(parseProblem('Title: Incomplete\nConstraints: x > 0'), null);
  assert.equal(parseInterviewerReply(`<problem>\n${statement}`, 'Jordan').problem.title, 'Sum an Array');
  assert.equal(parseInterviewerReply(null, 'Jordan').text, '');
});

test('evaluation JSON tolerates fences, reasoning, and trailing commas', () => {
  const expected = { overall: { score: 3 } };
  for (const raw of ['{"overall":{"score":3}}', '```json\n{"overall":{"score":3}}\n```', '<thinking>Check it.</thinking>{"overall":{"score":3,},}']) {
    assert.deepEqual(tryParseJson(raw), expected);
  }
  for (const raw of ['', 'not JSON', '{broken}', '[]', 'null']) assert.equal(tryParseJson(raw), null);
});

test('valid evaluations match question IDs even when the model returns a different order', () => {
  const records = [{ id: 'b1', round: 'behavioral' }, { id: 't1', round: 'technical' }];
  const result = normalizeEvaluation({
    questions: [
      { id: 'T1', scores: { correctness: 4, approach: 3, communication: 2, efficiency: 1 }, modelApproach: 'Use a map.' },
      { id: 'b1', scores: { star: 3, specificity: 4, relevance: 5, clarity: 2 }, strongerAnswer: 'I owned the rollout.' },
    ], topPractice: ['Practice tracing', { item: 'Explain tradeoffs' }, { text: 'Quantify outcomes' }, 'Extra'],
  }, records);
  assert.equal(result.questions[0].strongerAnswer, 'I owned the rollout.');
  assert.equal(result.questions[0].modelApproach, null);
  assert.equal(result.questions[1].scores.correctness, 4);
  assert.equal(result.questions[1].strongerAnswer, null);
  assert.deepEqual(result.topPractice, ['Practice tracing', 'Explain tradeoffs', 'Quantify outcomes']);
});

test('missing evaluation fields remain unscored instead of crashing the report', () => {
  const result = normalizeEvaluation({}, [{ id: 'b1', round: 'behavioral' }]);
  assert.deepEqual(result.questions[0].scores, { star: null, specificity: null, relevance: null, clarity: null });
  assert.equal(result.overall.score, null);
  assert.equal(result.rounds.behavioral.score, null);
  assert.equal(result.questions[0].improve, null);
  assert.deepEqual(result.topPractice, []);
});

test('trailing-comma repair preserves punctuation and escaped quotes inside feedback', () => {
  const summary = 'Keep ",}" and ", ]" in code, including \\ paths and "quoted" evidence.';
  const raw = `{"overall":{"summary":${JSON.stringify(summary)},},"topPractice":["Use a,b,}",],}`;
  const result = tryParseJson(raw);
  assert.equal(result.overall.summary, summary);
  assert.deepEqual(result.topPractice, ['Use a,b,}']);
});
