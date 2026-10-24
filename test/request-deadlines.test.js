import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGenerate, DEFAULT_MODEL } from '../backend/gemini.js';
import { createApp } from '../backend/server.js';

async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function clock(t) {
  const timers = new Map(); let id = 0;
  t.mock.method(globalThis, 'setTimeout', (fn, ms) => { timers.set(++id, { fn, ms }); return id; });
  t.mock.method(globalThis, 'clearTimeout', (key) => timers.delete(key));
  return { timers, fire(ms) {
    const entry = [...timers].find(([, timer]) => timer.ms === ms);
    assert.ok(entry, `missing ${ms}ms timer`);
    timers.delete(entry[0]); entry[1].fn();
  } };
}
const reply = (text) => ({ candidates: [{ content: { parts: [{ text }] } }] });
const contents = [{ role: 'user', parts: [{ text: 'Evaluate this answer.' }] }];

test('default model requests time out even when the SDK ignores cancellation', async (t) => {
  const c = clock(t); let signal;
  const generate = createGenerate(() => ({ models: { generateContent: (request) => { signal = request.config.abortSignal; return new Promise(() => {}); } } }));
  const waiting = generate({ model: DEFAULT_MODEL, contents });
  await flush(); c.fire(30000);
  await assert.rejects(waiting, (err) => err.code === 'DEADLINE_EXCEEDED' && err.status === 504);
  assert.equal(signal.aborted, true);
  assert.equal(c.timers.size, 0);
});

test('fallback attempts share the total deadline and never reset it', async (t) => {
  const c = clock(t), models = [];
  const generate = createGenerate(() => ({ models: { generateContent: (request) => { models.push(request.model); return new Promise(() => {}); } } }));
  const waiting = generate({ model: 'gemma-4-31b-it', contents });
  await flush(); c.fire(30000); await flush();
  assert.deepEqual(models, ['gemma-4-31b-it', DEFAULT_MODEL]);
  c.fire(60000);
  await assert.rejects(waiting, (err) => err.code === 'DEADLINE_EXCEEDED');
  assert.equal(c.timers.size, 0);
});

test('cancellation interrupts retry backoff without another SDK call', async (t) => {
  const c = clock(t), controller = new AbortController(); let calls = 0;
  const generate = createGenerate(() => ({ models: { generateContent: async () => { calls++; throw { status: 503 }; } } }));
  const waiting = generate({ model: DEFAULT_MODEL, contents, signal: controller.signal });
  await flush();
  assert.ok([...c.timers.values()].some((timer) => timer.ms === 1000));
  controller.abort();
  await assert.rejects(waiting, (err) => err.code === 'CANCELLED');
  assert.equal(calls, 1);
  assert.equal(c.timers.size, 0);
});

test('audio failures never fall back to the interview text model', async () => {
  const models = [];
  const generate = createGenerate(() => ({ models: { generateContent: async ({ model }) => { models.push(model); throw { status: 503 }; } } }));
  await assert.rejects(generate({ model: 'gemini-audio', contents, maxTransientRetries: 0 }), (err) => err.code === 'UPSTREAM_UNAVAILABLE');
  assert.deepEqual(models, ['gemini-audio']);
});

test('successful generations dispose deadlines and preserve adaptation support', async () => {
  const requests = [];
  const generate = createGenerate(() => ({ models: { generateContent: async (request) => {
    requests.push(request);
    if (requests.length === 1) throw { status: 400, message: 'system instruction not supported' };
    return reply('Scored.');
  } } }));
  assert.equal(await generate({ model: DEFAULT_MODEL, contents, systemInstruction: 'Coach fairly.' }), 'Scored.');
  assert.match(requests[1].contents[0].parts[0].text, /Coach fairly/);
});

function route(options, path = '/api/evaluate', body = {}) {
  const app = createApp(options);
  const handler = app.router.stack.find((layer) => layer.route?.path === path).route.stack.at(-1).handle;
  const res = new EventEmitter();
  res.writableEnded = false;
  res.json = (data) => { assert.equal(res.writableEnded, false, 'must not send twice'); res.data = data; res.writableEnded = true; };
  const req = { body, get: () => 'audio/wav' };
  return { handler, req, res };
}
const body = {
  setup: { role: 'Engineer' },
  records: [{ id: 'b1', round: 'behavioral', turns: [{ text: 'Um I led the release.' }], delivery: { wpm: 130, words: 10, fillers: 3, fillerShare: 0.3 } }],
};

test('evaluation JSON repair shares the route deadline and omits changing filler metrics', async (t) => {
  const c = clock(t), requests = [];
  const r = route({ evaluateTimeoutMs: 7000, generateContent: async (request) => {
    requests.push(request);
    if (requests.length === 1) return 'invalid JSON';
    return new Promise(() => {});
  } }, '/api/evaluate', body);
  const waiting = r.handler(r.req, r.res);
  await flush();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].signal, requests[1].signal);
  assert.doesNotMatch(requests[0].contents[0].parts[0].text, /3 filler words|30\.0%/);
  c.fire(7000);
  await assert.rejects(waiting, (err) => err.code === 'DEADLINE_EXCEEDED');
  assert.equal(requests[1].signal.aborted, true);
  assert.equal(r.res.data, undefined);
  assert.equal(c.timers.size, 0);
});

test('disconnect cancels server work and late provider results cannot send a response', async () => {
  let finish, signal;
  const r = route({ generateContent: (request) => {
    signal = request.signal;
    return new Promise((resolve) => { finish = resolve; });
  } }, '/api/evaluate', body);
  const waiting = r.handler(r.req, r.res);
  await flush(); r.res.emit('close');
  await waiting;
  assert.equal(signal.aborted, true);
  finish('{"overall":{"score":4}}');
  await flush();
  assert.equal(r.res.data, undefined);
  assert.equal(r.res.listenerCount('close'), 0);
});

test('transcription route passes its deadline to the provider', async (t) => {
  const c = clock(t); let signal;
  const r = route({ requestTimeoutMs: 8000, transcribe: (_audio, _mime, options) => {
    signal = options.signal; return new Promise(() => {});
  } }, '/api/transcribe', Buffer.alloc(1000));
  const waiting = r.handler(r.req, r.res);
  await flush(); c.fire(8000);
  await assert.rejects(waiting, (err) => err.code === 'DEADLINE_EXCEEDED');
  assert.equal(signal.aborted, true);
});

test('successful and empty evaluation routes retain their response contracts', async () => {
  const good = route({ generateContent: async () => '{"overall":{"score":4},"questions":[]}' }, '/api/evaluate', body);
  await good.handler(good.req, good.res);
  assert.equal(good.res.data.ok, true);
  assert.equal(good.res.data.report.overall.score, 4);
  const empty = route({}, '/api/evaluate', {});
  await assert.rejects(empty.handler(empty.req, empty.res), (err) => err.code === 'NOTHING_TO_SCORE');
});

test('evaluation uses minimal thinking with a longer budget than interviewer turns', async () => {
  const calls = { evaluate: [], interview: [] };
  const generateContent = (key) => async (request) => { calls[key].push(request); return key === 'evaluate' ? '{"overall":{"score":4}}' : 'Thanks. Next question.'; };
  const evaluate = route({ generateContent: generateContent('evaluate') }, '/api/evaluate', body);
  await evaluate.handler(evaluate.req, evaluate.res);
  assert.equal(evaluate.res.data.ok, true);
  assert.equal(calls.evaluate[0].thinking, 'minimal');
  assert.equal(calls.evaluate[0].attemptTimeoutMs, 60000);
  assert.equal(calls.evaluate[0].timeoutMs, 90000);
  const interview = route({ generateContent: generateContent('interview') }, '/api/interview', { setup: { role: 'Engineer' }, turn: { kind: 'open', stage: 'intro' }, history: [{ role: 'user', text: 'Hi' }] });
  await interview.handler(interview.req, interview.res);
  assert.equal(calls.interview[0].attemptTimeoutMs, undefined, 'interviewer turns keep the default 30 s attempt limit');
  assert.equal(calls.interview[0].timeoutMs, undefined);
});

test('the evaluation route allows 95 s by default while other routes keep 60 s', async (t) => {
  const c = clock(t);
  const r = route({ generateContent: () => new Promise(() => {}) }, '/api/evaluate', body);
  const waiting = r.handler(r.req, r.res);
  await flush();
  assert.ok([...c.timers.values()].some((timer) => timer.ms === 95000));
  c.fire(95000);
  await assert.rejects(waiting, (err) => err.code === 'DEADLINE_EXCEEDED');
});
