import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryTracker } from '../frontend/js/delivery.js';
import { api } from '../frontend/js/api.js';

function globalValue(t, key, value) {
  const old = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => old ? Object.defineProperty(globalThis, key, old) : delete globalThis[key]);
}
function harness(t) {
  let time = 1000;
  globalValue(t, 'performance', { now: () => time });
  const video = { srcObject: null, play: async () => {} };
  const tracker = new DeliveryTracker({ video });
  t.after(() => tracker.stop());
  return { tracker, video, at: (seconds) => { time = 1000 + seconds * 1000; } };
}
const face = (smile = 40) => ({ smile, x: 320, y: 240, eye: 60, yaw: 0, pitch: 0 });

test('permission denial disables delivery without preventing typed answers', async (t) => {
  const { tracker } = harness(t);
  globalValue(t, 'window', { isSecureContext: true });
  const requested = [];
  globalValue(t, 'navigator', { mediaDevices: { getUserMedia: async (constraints) => {
    requested.push(constraints);
    throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
  } } });
  const state = await tracker.start();
  assert.deepEqual([state.camera, state.mic, tracker.running], [false, false, false]);
  assert.match(state.errors.join(' '), /Camera permission was denied/);
  assert.match(state.errors.join(' '), /Microphone permission was denied/);
  assert.equal(requested.length, 2);
  tracker.beginSegment('b1');
  const answer = tracker.endSegment({ text: 'I coordinated the release.' });
  assert.equal(answer.words, 4);
  assert.equal(answer.audio, null);
  assert.equal(answer.face, null);
});

test('insecure contexts fail before requesting devices', async (t) => {
  const { tracker } = harness(t);
  globalValue(t, 'window', { isSecureContext: false });
  globalValue(t, 'navigator', { mediaDevices: { getUserMedia: () => assert.fail('must not request media') } });
  const state = await tracker.start();
  assert.match(state.errors[0], /localhost or HTTPS/);
  assert.equal(tracker.sessionSummary(), null);
});

test('stop during device permission prompts releases streams that arrive late', async (t) => {
  const { tracker, video } = harness(t);
  globalValue(t, 'window', { isSecureContext: true });
  let resolveCamera;
  let stopped = 0;
  const stream = { getTracks: () => [{ stop: () => stopped++ }] };
  let requests = 0;
  globalValue(t, 'navigator', { mediaDevices: { getUserMedia: () => ++requests === 1 ? new Promise((resolve) => { resolveCamera = resolve; }) : Promise.resolve(stream) } });
  const starting = tracker.start();
  tracker.stop();
  resolveCamera(stream);
  await starting;
  assert.equal(stopped, 2);
  assert.equal(tracker.running, false);
  assert.equal(video.srcObject, null);
});

test('smile samples use session time, include listening, and mark a question only once', (t) => {
  const { tracker, at } = harness(t);
  tracker.t0 = 1000;
  tracker.usedCamera = true;
  tracker._addFace(face(20), null, 1100); // listening
  at(1);
  tracker.beginSegment('b1');
  tracker._addFace(face(40), null, 2100);
  tracker._addFace(face(80), null, 2500);
  tracker.cancelSegment();
  at(3);
  tracker.beginSegment('b1'); // follow-up to the same question
  tracker.cancelSegment();
  tracker._addFace(null, null, 4100); // missing face is not a zero smile
  const summary = tracker.sessionSummary();
  assert.deepEqual(summary.tracks.smile, [{ t: 0, v: 20 }, { t: 1, v: 60 }]);
  assert.deepEqual(summary.marks, [{ key: 'b1', t: 1 }]);
  assert.deepEqual(tracker.faceFrames.map((f) => f.phase), ['listen', 'answer', 'answer', 'listen']);
});

test('audio is collected only during answers and survives stop for the report', (t) => {
  const { tracker, at } = harness(t);
  const callbacks = new Map();
  globalValue(t, 'setInterval', (fn) => { callbacks.set(1, fn); return 1; });
  globalValue(t, 'clearInterval', (id) => callbacks.delete(id));
  tracker.t0 = 1000;
  tracker.usedMic = true;
  tracker.audioCtx = { sampleRate: 48000, close: async () => {} };
  tracker.audioBuf = new Float32Array(2048);
  tracker.analyser = { getFloatTimeDomainData: (buffer) => buffer.fill(0.1) };
  tracker._startAudioLoop();
  const tick = callbacks.get(1);
  at(0.1); tick(); // interviewer time
  tracker.beginSegment('b1');
  for (const second of [1, 2, 3]) { at(second); tick(); }
  tracker.cancelSegment();
  at(4); tick(); // interviewer time
  assert.deepEqual(tracker.voiceFrames.map((f) => f.t), [1, 2, 3]);
  tracker.stop();
  assert.equal(callbacks.size, 0);
  assert.deepEqual(tracker.sessionSummary().tracks.loudness, [{ t: 1, v: 0 }, { t: 2, v: 0 }, { t: 3, v: 0 }]);
  assert.equal(tracker.sessionSummary().duration, 3);
});

test('spoken answers produce 16 kHz mono WAV uploads and replace dictated filler counts', async (t) => {
  const { tracker, at } = harness(t);
  tracker.t0 = 1000;
  let uploaded;
  t.mock.method(api, 'transcribe', async (blob) => { uploaded = blob; return { text: 'Um I um shipped it' }; });
  tracker.beginSegment('b1');
  tracker._pushPcm(tracker.segment, new Float32Array(96000).fill(0.25), 48000);
  at(2);
  const part = tracker.endSegment({ text: 'I shipped it', spokenText: 'I shipped it' });
  await Promise.all([...tracker.pending]);
  assert.equal(uploaded.type, 'audio/wav');
  const wav = new DataView(await uploaded.arrayBuffer());
  const label = (start, length) => String.fromCharCode(...new Uint8Array(wav.buffer, start, length));
  assert.equal(label(0, 4), 'RIFF');
  assert.equal(label(8, 4), 'WAVE');
  assert.equal(wav.getUint16(22, true), 1);
  assert.equal(wav.getUint32(24, true), 16000);
  assert.equal(wav.getUint16(34, true), 16);
  assert.equal(wav.getUint32(40, true), 64000);
  assert.equal(part.fillers.count, 2);
  assert.equal(part.words, 5);
  assert.equal(tracker.pending.size, 0);
});

test('typed, short, and cancelled answers do not upload audio', (t) => {
  const { tracker } = harness(t);
  tracker.t0 = 1000;
  t.mock.method(api, 'transcribe', () => assert.fail('must not upload'));
  tracker.beginSegment('b1');
  tracker._pushPcm(tracker.segment, new Float32Array(32000), 16000);
  assert.equal(tracker.endSegment({ text: 'A typed answer.' }).words, 3);
  tracker.beginSegment('b2');
  tracker._pushPcm(tracker.segment, new Float32Array(16000), 16000);
  tracker.endSegment({ text: 'A spoken answer.', spokenText: 'A spoken answer.' });
  tracker.beginSegment('b3');
  tracker.cancelSegment();
  assert.equal(tracker.endSegment({ spokenText: 'Discard this.' }), null);
});

test('transcription failure preserves dictated counts and clears pending work', async (t) => {
  const { tracker } = harness(t);
  tracker.t0 = 1000;
  t.mock.method(api, 'transcribe', async () => { throw new Error('offline'); });
  t.mock.method(console, 'warn', () => {});
  tracker.beginSegment('b1');
  tracker._pushPcm(tracker.segment, new Float32Array(32000), 16000);
  const part = tracker.endSegment({ text: 'Um I shipped it', spokenText: 'Um I shipped it' });
  await Promise.all([...tracker.pending]);
  assert.equal(part.fillers.count, 1);
  assert.equal(part.words, 4);
  assert.equal(tracker.pending.size, 0);
});

test('stop releases devices and worker; reset removes the previous interview tracks', (t) => {
  const { tracker, video } = harness(t);
  let tracksStopped = 0;
  let workersStopped = 0;
  let contextsClosed = 0;
  const stream = { getTracks: () => [{ stop: () => tracksStopped++ }] };
  tracker.t0 = 1000;
  tracker.videoStream = stream;
  tracker.audioStream = stream;
  tracker.worker = { terminate: () => workersStopped++ };
  tracker.audioCtx = { close: async () => { contextsClosed++; } };
  video.srcObject = stream;
  tracker._addFace(face(), null, 2000);
  tracker.voiceFrames.push({ t: 1, db: -20, f0: 200 });
  tracker.stop();
  assert.deepEqual([tracksStopped, workersStopped, contextsClosed], [2, 1, 1]);
  assert.equal(video.srcObject, null);
  assert.equal(tracker.running, false);
  assert.equal(tracker.sessionSummary().tracks.smile.length, 1);
  tracker.reset();
  assert.equal(tracker.sessionSummary(), null);
  assert.deepEqual(tracker.faceFrames, []);
  assert.deepEqual(tracker.voiceFrames, []);
  assert.deepEqual(tracker.marks, []);
});
