import test from 'node:test';
import assert from 'node:assert/strict';
import { ReportController } from '../frontend/js/report-controller.js';
import { InterviewSession } from '../frontend/js/interview.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function session() {
  const current = new InterviewSession({ role: 'Engineer', level: 'Mid', model: 'gemma-4-26b-a4b-it', rounds: ['behavioral'], length: 'short' });
  current.prepareOpen().commit({ text: 'Question?' });
  current.prepareAnswer({ text: 'I shipped it.', delivery: { words: 12, fillers: { count: 1, byWord: { um: 1 } } } }).commit({ text: 'Next?', action: 'NEXT' });
  return current;
}
function harness() {
  const changes = [], requests = [], listeners = new Set();
  const tracker = {
    pending: new Set([new Promise(() => {})]),
    settle() { assert.fail('report must never await transcription'); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  const controller = new ReportController({ tracker,
    evaluate(payload, options) { const job = deferred(); requests.push({ ...job, payload, ...options }); return job.promise; },
    view: Object.fromEntries(['mount', 'loading', 'delivery', 'result', 'finished'].map((name) => [name, (...args) => changes.push({ name, args })])),
  });
  return { controller, changes, requests, listeners, notify() { for (const fn of listeners) fn(); } };
}

test('local report mounts and scoring starts while transcription is unresolved', async () => {
  const h = harness(), current = session();
  const loading = h.controller.open(current, { tracks: {} });
  assert.deepEqual(h.changes.map((c) => c.name), ['mount', 'loading']);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].payload.records[0].delivery.fillerShare, null);
  assert.equal(h.requests[0].payload.delivery.overall.words, null);
  current.records[0].turns[1].text = 'Changed later';
  assert.equal(h.requests[0].payload.records[0].turns[1].text, 'I shipped it.');
  h.notify();
  assert.equal(h.changes.at(-1).name, 'delivery');
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve({ ok: true, report: {} });
  await loading;
  h.notify(); // updates remain enabled after AI completion
  assert.deepEqual(h.changes.slice(-3).map((c) => c.name), ['result', 'finished', 'delivery']);
  h.controller.clear();
});

test('repeated report entry reuses the request; explicit retry aborts and supersedes it', async () => {
  const h = harness(), current = session();
  const first = h.controller.open(current, null);
  assert.equal(h.controller.open(current, null), first);
  assert.equal(h.requests.length, 1);
  const second = h.controller.retry();
  assert.equal(h.requests[0].signal.aborted, true);
  h.requests[1].resolve({ ok: true, report: { overall: { score: 4 } } });
  await second;
  const count = h.changes.length;
  h.requests[0].reject(new Error('Old failure'));
  await first;
  assert.equal(h.changes.length, count); // includes stale finally/loading state
  h.controller.clear();
});

test('new session and report exit reject stale successes and unsubscribe old updates', async () => {
  const h = harness();
  const old = h.controller.open(session(), null);
  const latest = h.controller.open(session(), null);
  assert.equal(h.listeners.size, 1);
  assert.equal(h.requests[0].signal.aborted, true);
  const count = h.changes.length;
  h.requests[0].resolve({ ok: true, report: { old: true } });
  await old;
  assert.equal(h.changes.length, count);
  h.controller.clear();
  assert.equal(h.listeners.size, 0);
  assert.equal(h.requests[1].signal.aborted, true);
  h.requests[1].reject(new Error('Late error'));
  await latest;
  assert.equal(h.changes.length, count);
});

test('AI deadline failure preserves mounted content and permits background updates/retry', async () => {
  const h = harness();
  const loading = h.controller.open(session(), null);
  h.requests[0].reject(Object.assign(new Error('Timed out'), { code: 'DEADLINE_EXCEEDED' }));
  await loading;
  assert.equal(h.changes.filter((c) => c.name === 'mount').length, 1);
  assert.equal(h.changes.find((c) => c.name === 'result').args[1].error, 'DEADLINE_EXCEEDED');
  h.notify();
  assert.equal(h.changes.at(-1).name, 'delivery');
  const retry = h.controller.retry();
  h.requests[1].resolve({ ok: false, message: 'Invalid JSON' });
  await retry;
  assert.equal(h.changes.filter((c) => c.name === 'mount').length, 1);
  h.controller.clear();
});

test('empty interviews finish without a provider request', async () => {
  const h = harness();
  const current = session(); current.records = [];
  await h.controller.open(current, null);
  assert.equal(h.requests.length, 0);
  assert.equal(h.changes.find((c) => c.name === 'result').args[1].error, 'NOTHING_TO_SCORE');
  h.controller.clear();
});
