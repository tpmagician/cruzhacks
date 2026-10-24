import test from 'node:test';
import assert from 'node:assert/strict';
import { InterviewSession, MAX_FOLLOWUPS, roleCategory } from '../frontend/js/interview.js';

const setup = { role: 'Software Engineer', level: 'Entry', model: 'gemma-4-26b-a4b-it', companyType: '', rounds: ['behavioral', 'technical'], length: 'short' };
const reply = (text = 'Next question?', action = 'NEXT', problem = null) => ({ text, action, problem });
function fresh(t, overrides = {}) {
  const storage = new Map();
  installStorage(t, storage);
  return new InterviewSession({ ...setup, ...overrides });
}
function installStorage(t, storage) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } });
  t.after(() => descriptor ? Object.defineProperty(globalThis, 'localStorage', descriptor) : delete globalThis.localStorage);
}
function open(session) { session.prepareOpen().commit(reply('Tell me about teamwork.')); }

test('role routing recognizes SWE, analyst, PM, and generic roles', () => {
  for (const role of ['SWE', 'Frontend Developer', 'SRE', 'iOS Engineer']) assert.equal(roleCategory(role), 'engineering');
  assert.equal(roleCategory('Business Intelligence Analyst'), 'analyst');
  assert.equal(roleCategory('Product Manager'), 'pm');
  assert.equal(roleCategory('Accountant'), 'general');
});

test('plans respect selected rounds and lengths, with coding or SQL slots', (t) => {
  fresh(t);
  for (const [length, count] of [['short', 3], ['standard', 5], ['long', 8]]) {
    const session = new InterviewSession({ ...setup, length });
    assert.equal(session.plans.behavioral.length, count);
    assert.equal(session.plans.technical.length, count);
    assert.equal(new Set(session.plans.behavioral.map((q) => q.topic)).size, count);
    assert.equal(session.plans.technical.filter((q) => q.type === 'coding').length, length === 'long' ? 2 : 1);
  }
  const analyst = new InterviewSession({ ...setup, role: 'Data Analyst', rounds: ['technical'] });
  assert.deepEqual(analyst.rounds, ['technical']);
  assert.ok(analyst.plans.technical.some((q) => q.type === 'sql'));
  assert.equal(analyst.plans.behavioral, undefined);
});

test('preparing or retrying a request does not mutate interview state', (t) => {
  const session = fresh(t);
  const initial = JSON.stringify(session);
  const first = session.prepareOpen();
  assert.deepEqual(session.prepareOpen().payload, first.payload);
  assert.equal(JSON.stringify(session), initial);
  first.commit(reply());
  const beforeAnswer = JSON.stringify(session);
  const pending = session.prepareAnswer({ text: 'I resolved a merge conflict.' });
  assert.equal(JSON.stringify(session), beforeAnswer);
  assert.equal(pending.payload.history.at(-1).text, 'I resolved a merge conflict.');
  pending.commit(reply('What was your role?', 'FOLLOW_UP'));
  assert.equal(session.history.length, 4);
  assert.equal(session.record.turns[1].text, 'I resolved a merge conflict.');
});

test('a complete interview advances rounds, closes records, and caps candidate questions', (t) => {
  let now = 10000;
  t.mock.method(Date, 'now', () => now);
  const session = fresh(t);
  open(session);
  for (const id of ['b1', 'b2', 'b3', 't1', 't2', 't3']) {
    assert.equal(session.record.id, id);
    now += 5000;
    session.prepareAnswer({ text: 'My reasoning.', explanation: 'My reasoning.', code: 'return 1;' }).commit(reply());
  }
  assert.equal(session.stage, 'candidate_questions');
  assert.equal(session.done, false);
  assert.deepEqual(session.records.map((r) => r.seconds), [5, 5, 5, 5, 5, 5]);
  assert.ok(session.records.every((r) => r.closed));
  for (let i = 0; i < 3; i++) session.prepareAnswer({ text: 'How does the team work?' }).commit(reply('We collaborate.', 'CONTINUE'));
  assert.equal(session.done, true);
  assert.equal(session.stage, 'wrapup');
  assert.equal(session.answeredRecords().length, 6);
});

test('missing action tags count as follow-ups, and the cap forces advancement', (t) => {
  const session = fresh(t);
  open(session);
  for (let i = 0; i < MAX_FOLLOWUPS; i++) {
    session.prepareAnswer({ text: 'A partial answer.' }).commit(reply('Tell me more.', null));
    assert.equal(session.record.id, 'b1');
    assert.equal(session.followups, i + 1);
  }
  const forced = session.prepareAnswer({ text: 'More detail.' });
  assert.equal(forced.payload.turn.forced, true);
  forced.commit(reply('Next question.', 'FOLLOW_UP'));
  assert.equal(session.record.id, 'b2');
  assert.equal(session.followups, 0);
});

test('coding problems persist in history and unchanged code is not resent', (t) => {
  const problem = { title: 'Sum', raw: '<problem>\nDescription: Sum the values.\n</problem>' };
  const session = fresh(t, { retry: [{ round: 'technical', type: 'coding', topic: 'arrays', retryText: problem.raw }] });
  session.prepareOpen().commit(reply('Read the problem.', 'NEXT', problem));
  assert.equal(session.isCodingQuestion(), true);
  assert.deepEqual(session.record.problem, problem);
  assert.match(session.history.at(-1).text, /<problem>/);
  const code = 'return nums.reduce((a, b) => a + b, 0);';
  const answer = session.prepareAnswer({ code, explanation: 'I scan the array once.' });
  assert.equal(answer.payload.turn.includesCode, true);
  assert.match(answer.payload.history.at(-1).text, /My code:/);
  answer.commit(reply('What about an empty array?', 'FOLLOW_UP'));
  const unchanged = session.prepareAnswer({ code, explanation: 'The initial value handles it.' });
  assert.equal(unchanged.payload.turn.includesCode, false);
  assert.doesNotMatch(unchanged.payload.history.at(-1).text, /My code:/);
  assert.equal(session.record.code, code);
});

test('requested and offered hints consume the shared allowance only on commit', (t) => {
  const session = fresh(t, { rounds: ['technical'] });
  open(session);
  assert.equal(session.hintsLeft, 3);
  const requested = session.prepareHint();
  assert.equal(session.hintsLeft, 3);
  requested.commit(reply('Try a small example.'));
  assert.equal(session.record.hintsUsed, 1);
  assert.equal(session.followups, 0);
  const offered = session.prepareHint({ idleSeconds: 90 });
  assert.equal(offered.display, null);
  offered.commit(reply('Consider lookup costs.'));
  session.prepareAnswer({ text: 'I am stuck.' }).commit(reply('Consider hashing.', 'HINT'));
  assert.equal(session.record.hintsUsed, 3);
  assert.equal(session.hintsLeft, 0);
  assert.equal(session.canHint(), false);
  const another = new InterviewSession({ ...setup, rounds: ['technical'] });
  open(another);
  assert.equal(another.hintsLeft, 0);
});

test('early termination excludes unanswered questions from evaluation', (t) => {
  const session = fresh(t);
  open(session);
  session.prepareAnswer({ text: 'I coordinated a release.' }).commit(reply());
  session.prepareEnd().commit(reply('Thanks for your time.'));
  assert.equal(session.done, true);
  assert.deepEqual(session.evaluationPayload().records.map((r) => r.id), ['b1']);
});

test('evaluation aggregates per-answer delivery and keeps listening data separate', (t) => {
  const session = fresh(t);
  open(session);
  const delivery = { audio: null, face: null, words: 12, fillers: { count: 1, byWord: { um: 1 } } };
  session.prepareAnswer({ text: 'I led the rollout.', delivery }).commit(reply('What changed?', 'FOLLOW_UP'));
  session.prepareAnswer({ text: 'We reduced failures.', delivery }).commit(reply());
  const payload = session.evaluationPayload({ listeningNods: 2, listeningShakes: 0, listeningSeconds: 20 });
  assert.equal(payload.records[0].delivery.answers, 2);
  assert.equal(payload.records[0].delivery.words, 24);
  assert.equal(payload.delivery.overall.fillers, 2);
  assert.equal(payload.delivery.listeningNods, 2);
  assert.equal(payload.delivery.overall.wpm, null);
});

test('weak-question retries preserve the original problem and prioritize low scores', (t) => {
  const session = fresh(t);
  open(session);
  session.prepareAnswer({ text: 'First answer.' }).commit(reply('Second question?'));
  session.prepareAnswer({ text: 'Second answer.' }).commit(reply());
  const retry = session.retrySetup({ questions: [{ id: 'b1', scores: { star: 4 } }, { id: 'b2', scores: { star: 2 } }] });
  assert.equal(retry.retry.length, 1);
  assert.equal(retry.retry[0].retryText, 'Second question?');
  assert.equal(new InterviewSession(retry).plans.behavioral.length, 1);
});
