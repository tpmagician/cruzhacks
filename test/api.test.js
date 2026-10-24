import test from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError } from '../frontend/js/api.js';

test('interview and evaluation requests send JSON to their respective routes', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ ok: true }) };
  });
  const body = { setup: { role: 'SWE' }, records: [] };
  assert.deepEqual(await api.interview(body), { ok: true });
  await api.evaluate(body);
  assert.deepEqual(requests.map((r) => r.url), ['/api/interview', '/api/evaluate']);
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(requests[0].options.body), body);
});

test('transcription uploads raw audio without JSON or base64 conversion', async (t) => {
  const audio = new Blob(['test audio'], { type: 'audio/wav' });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/transcribe');
    assert.equal(options.body, audio);
    assert.equal(options.headers['Content-Type'], 'audio/wav');
    return { ok: true, json: async () => ({ text: 'Um, hello.' }) };
  });
  assert.deepEqual(await api.transcribe(audio), { text: 'Um, hello.' });
});

test('network failures and structured server errors expose actionable API errors', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('offline'); });
  await assert.rejects(api.interview({}), (err) => err instanceof ApiError && err.code === 'NETWORK' && err.status === 0);
  fetch.mock.mockImplementation(async () => ({ ok: false, status: 429, json: async () => ({ error: { code: 'RATE_LIMIT', message: 'Wait a minute.' } }) }));
  await assert.rejects(api.evaluate({}), (err) => err.code === 'RATE_LIMIT' && err.status === 429 && err.message === 'Wait a minute.');
});

test('non-JSON server failures fall back to an HTTP error', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError(); } }));
  await assert.rejects(api.evaluate({}), (err) => err.code === 'HTTP_502' && err.message === 'Request failed (502).');
});
