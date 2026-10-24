import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPitch, findSpeech, summarizeAudio, summarizeFace, countFillers,
  countWords, combineDeliveries, describeDelivery, deliveryChips, measureFace, rmsDb, headBaseline,
  summarizeBody, bodyBaseline, voiceTracks, phraseEndings,
} from '../frontend/js/delivery-metrics.js';
import { renderReport } from '../frontend/js/report.js';

const FPS = 15;
const face = (x, y, extra = {}) => ({ smile: 10, x, y, eye: 60, yaw: 0, pitch: 0, ...extra });

test('measureFace reads smile blendshapes and the between-eyes point', () => {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  lm[33] = { x: 0.45, y: 0.4 };
  lm[263] = { x: 0.55, y: 0.4 };
  lm[168] = { x: 0.5, y: 0.42 };
  const result = {
    faceLandmarks: [lm],
    faceBlendshapes: [{ categories: [{ categoryName: 'mouthSmileLeft', score: 0.6 }, { categoryName: 'mouthSmileRight', score: 0.8 }] }],
    facialTransformationMatrixes: [{ data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
  };
  const m = measureFace(result, 640, 480);
  assert.equal(Math.round(m.smile), 70);
  assert.equal(Math.round(m.eye), 64);
  assert.equal(Math.round(m.x), 320);
  assert.equal(m.yaw, 0);
  assert.equal(measureFace({ faceLandmarks: [] }, 640, 480), null);
});

test('summarizeFace reports smiling share and looking away against a baseline', () => {
  const frames = [];
  for (let i = 0; i < 60; i++) {
    frames.push({ t: i / FPS, face: face(320, 240, { smile: i < 30 ? 60 : 5, yaw: i >= 45 ? 40 : 0 }) });
  }
  const base = headBaseline(frames);
  assert.deepEqual(base, { yaw: 0, pitch: 0 });
  const s = summarizeFace(frames, base);
  assert.equal(s.smileShare, 0.5);
  assert.equal(s.awayShare, 0.25);
  assert.equal(s.faceCoverage, 1);
});

function tone(hz, sampleRate = 48000, n = 2048, amp = 0.3) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // A voice-like tone with harmonics.
    const p = (2 * Math.PI * hz * i) / sampleRate;
    buf[i] = amp * (Math.sin(p) + 0.5 * Math.sin(2 * p) + 0.25 * Math.sin(3 * p));
  }
  return buf;
}

test('autocorrelation pitch finds the fundamental of a harmonic tone', () => {
  for (const hz of [110, 180, 260]) {
    const f = detectPitch(tone(hz), 48000);
    assert.ok(Math.abs(f - hz) < hz * 0.02, `${hz} Hz detected as ${f}`);
  }
  const noise = Float32Array.from({ length: 2048 }, () => Math.random() - 0.5);
  assert.equal(detectPitch(noise, 48000), null);
  // RMS of 0.3 × (1, 0.5, 0.25 harmonics) = 0.243 → -12.3 dBFS
  assert.ok(Math.abs(rmsDb(tone(200)) - -12.3) < 0.2);
});

/** 20 Hz audio frames: silence (-70 dB) with speech (-25 dB) during the given intervals. */
function audioTrack(seconds, speech, f0 = (t) => 180) {
  const frames = [];
  for (let i = 0; i <= seconds * 20; i++) {
    const t = i / 20;
    const on = speech.some(([a, b]) => t >= a && t < b);
    frames.push({ t, db: on ? -25 : -70, f0: on ? f0(t) : null });
  }
  return frames;
}

test('pause detection follows the 0.5 s minimum silent and sounding rules', () => {
  // Speech 2-6 s and 7-10 s, a 0.3 s gap inside the first block, and a 0.2 s click at 12 s.
  const s = findSpeech(audioTrack(14, [[2, 4], [4.3, 6], [7, 10], [12, 12.2]]));
  assert.equal(s.sounding.length, 2);
  assert.ok(Math.abs(s.firstSound - 2) < 0.06);
  assert.ok(Math.abs(s.lastSound - 10) < 0.06);
  assert.equal(findSpeech(audioTrack(5, [])), null);
});

test('summarizeAudio gives latency, pause share, pitch variation and pace', () => {
  const frames = audioTrack(14, [[2, 6], [7, 12]], (t) => 150 + 30 * Math.sin(t));
  const words = Array.from({ length: 22 }, () => 'word').join(' ');
  const a = summarizeAudio(frames, { spokenText: words });
  assert.ok(Math.abs(a.latency - 2) < 0.06);
  assert.equal(a.pauses, 1);
  assert.ok(Math.abs(a.pauseTime - 1) < 0.1);
  assert.ok(a.pitchVarSt > 1 && a.pitchVarSt < 6);
  assert.equal(Math.round(a.wpm), 132); // 22 words over 10 s
  const flat = summarizeAudio(audioTrack(8, [[1, 7]]), { spokenText: 'a b c' });
  assert.equal(flat.pitchVarSt, 0);
  assert.equal(flat.wpm, null); // too few words to judge pace
});

test('a pitch rise at the end of a phrase counts as uptalk; a flat or falling ending does not', () => {
  // Three 2 s phrases at 150 Hz; the first ends 0.4 s at 190 Hz (+4.1 st), the second falls to 120 Hz.
  const f0 = (t) => (t >= 1.6 && t < 2 ? 190 : t >= 4.6 && t < 5 ? 120 : 150);
  const frames = audioTrack(9, [[0, 2], [3, 5], [6, 8]], f0);
  const a = summarizeAudio(frames);
  assert.equal(a.pitchPhrases, 3);
  assert.equal(a.uptalk, 1);
  // Creaky octave jumps at the end are ignored rather than read as a rise.
  const creak = summarizeAudio(audioTrack(3, [[0, 2]], (t) => (t >= 1.7 ? 600 : 150)));
  assert.equal(creak.uptalk, 0);
});

test('volume fading at the end of a phrase counts as trailing off', () => {
  const frames = audioTrack(9, [[0, 2], [3, 5], [6, 8]]).map((f) => ({ ...f, db: f.db > -60 && f.t >= 1.5 && f.t < 2 ? -33 : f.db }));
  const a = summarizeAudio(frames);
  assert.equal(a.loudPhrases, 3);
  assert.equal(a.trailOff, 1);
});

test('articulation rate excludes pauses, unlike overall pace', () => {
  const a = summarizeAudio(audioTrack(14, [[2, 6], [7, 12]]), { spokenText: Array(22).fill('w').join(' ') });
  assert.equal(Math.round(a.wpm), 132); // over the 10 s span
  assert.equal(Math.round(a.articulationWpm), 147); // over 9 s of sound
});

test('think-aloud: long silences while solving are split by whether code was being typed', () => {
  // Talk 0-5 s, silent 5-25 s while typing, talk 25-30 s, silent 30-48 s without typing.
  const frames = audioTrack(48, [[0, 5], [25, 30]]);
  const typing = Array.from({ length: 30 }, (_, i) => 6 + i * 0.5);
  const a = summarizeAudio(frames, { thinkAloud: true, typing });
  assert.equal(a.silence.silentStretches, 2);
  assert.equal(a.silence.silentCoding, 1);
  assert.equal(Math.round(a.silence.longestSilence), 20);
  // Never speaking at all is one long silence.
  const mute = summarizeAudio(audioTrack(30, []), { thinkAloud: true });
  assert.equal(mute.spoke, false);
  assert.equal(mute.silence.silentStretches, 1);
  // Not measured unless asked (behavioral answers, typed interviews).
  assert.equal(summarizeAudio(frames).silence, null);
  const d = combineDeliveries([{ audio: a, face: null, fillers: { count: 0, byWord: {} }, words: 20 }, { audio: mute, face: null, fillers: { count: 0, byWord: {} }, words: 0 }]);
  assert.equal(d.silentStretches, 3);
  assert.equal(d.longestSilence, 30);
  assert.match(describeDelivery(d).join('\n'), /3 silent stretches of 15 s or longer \(1 while typing code\)/);
});

test('filler words are counted without flagging ordinary "like" and "you know"', () => {
  const r = countFillers("Um, so I was, like, basically the lead. I would like to say you know, uh, it went well. Do you know Redis? It looks like a cache.");
  assert.deepEqual(r.byWord, { um: 1, uh: 1, like: 1, 'you know': 1, basically: 1 });
  assert.equal(r.count, 5);
  assert.equal(countWords("I'd say it's 42 percent."), 5);
});

test('combineDeliveries merges answers and describeDelivery explains them', () => {
  const frames = [];
  for (let i = 0; i < 60; i++) frames.push({ t: i / FPS, face: face(320, 240, { smile: 50 }) });
  const part = {
    audio: summarizeAudio(audioTrack(14, [[2, 6], [7, 12]]), { spokenText: Array(22).fill('w').join(' ') }),
    face: summarizeFace(frames, { yaw: 0, pitch: 0 }),
    fillers: countFillers('um I think, like, yes'),
    words: 30,
  };
  const d = combineDeliveries([part, { ...part, audio: null, face: null, words: 10, fillers: { count: 0, byWord: {} } }]);
  assert.equal(d.answers, 2);
  assert.equal(d.wpm, 132);
  assert.equal(d.fillers, 2);
  assert.equal(d.fillerShare, 0.05);
  assert.equal(d.smileShare, 1);
  const lines = describeDelivery(d).join('\n');
  assert.match(lines, /132 words per minute/);
  assert.match(lines, /"um" ×1/);
  assert.ok(deliveryChips(d).some((c) => c.label === 'Smiling' && c.value === '100%'));
  assert.equal(combineDeliveries([]), null);
  // Typed answers only: no audio or face statistics are invented.
  const typed = combineDeliveries([{ audio: null, face: null, fillers: { count: 0, byWord: {} }, words: 40 }]);
  assert.equal(typed.wpm, null);
  assert.equal(typed.smileShare, null);
});

// Pose runs on every other camera frame; the rest carry body: null.
function bodyTrack(seconds, bodyAt) {
  const frames = [];
  for (let i = 0; i <= seconds * FPS; i++) {
    const t = i / FPS;
    frames.push({ t, face: face(320, 240), body: i % 2 ? null : bodyAt(t) });
  }
  return frames;
}

test('side-to-side movement is measured against the usual shoulder position', () => {
  const still = bodyTrack(10, () => ({ shoulders: { x: 0.5, scale: 0.3 }, wrists: null }));
  assert.deepEqual(bodyBaseline(still), { x: 0.5 });
  const swaying = bodyTrack(10, (t) => ({ shoulders: { x: t < 5 ? 0.5 : 0.65, scale: 0.3 }, wrists: null }));
  const b = summarizeBody(swaying, { x: 0.5 });
  assert.ok(b.shiftValid > 9);
  assert.ok(Math.abs(b.shiftFlagged / b.shiftValid - 0.5) < 0.05);
  assert.equal(b.gestureValid, 0);
  // Not enough frames for a usual position yet: movement stays unmeasured.
  assert.equal(bodyBaseline(still.slice(0, 10)), null);
  assert.equal(summarizeBody(swaying, null).shiftValid, 0);
  assert.equal(summarizeBody(still.map((f) => ({ ...f, body: null })), { x: 0.5 }), null);
});

test('combineDeliveries reports movement and gesture shares only with enough body tracking', () => {
  const wrists = (t) => [{ x: -0.5 + (Math.floor(t * 2) % 2), y: 1 }, { x: 0.5, y: 1 }];
  const body = summarizeBody(bodyTrack(10, (t) => ({ shoulders: { x: 0.5, scale: 0.3 }, wrists: wrists(t) })), { x: 0.5 });
  const base = { audio: null, face: null, fillers: { count: 0, byWord: {} }, words: 0 };
  const d = combineDeliveries([{ ...base, body }]);
  assert.equal(d.shiftShare, 0);
  assert.ok(d.gestureShare > 0.5);
  assert.match(describeDelivery(d).join('\n'), /shifted sideways from their usual position 0%/);
  assert.ok(deliveryChips(d).some((c) => c.label === 'Gesturing'));
  const brief = summarizeBody(bodyTrack(3, () => ({ shoulders: { x: 0.5, scale: 0.3 }, wrists: null })), { x: 0.5 });
  const short = combineDeliveries([{ ...base, body: brief }]);
  assert.equal(short.shiftShare, null);
  assert.equal(short.gestureShare, null);
});

test('voiceTracks gives per-second loudness and pitch relative to the session', () => {
  const frames = [];
  // Second 0: loud, 200 Hz. Second 1: 12 dB quieter, 400 Hz (an octave up). Second 2: silent.
  for (let i = 0; i < 20; i++) frames.push({ t: i * 0.05, db: -20, f0: 200 });
  for (let i = 0; i < 20; i++) frames.push({ t: 1 + i * 0.05, db: -32, f0: 400 });
  for (let i = 0; i < 20; i++) frames.push({ t: 2 + i * 0.05, db: -100, f0: null });
  // Answer gap, then one second with a single voiced frame (too few to plot pitch).
  frames.push({ t: 10.1, db: -25, f0: 300 }, { t: 10.2, db: -25, f0: null });
  const { loudness, pitch } = voiceTracks(frames);
  assert.deepEqual(loudness, [{ t: 0, v: 0 }, { t: 1, v: -12 }, { t: 2, v: -40 }, { t: 10, v: -5 }]);
  assert.deepEqual(pitch.map((p) => p.t), [0, 1]);
  assert.equal(pitch[1].v - pitch[0].v, 12);
  assert.deepEqual(voiceTracks([]), { loudness: [], pitch: [] });
});

test('the report draws a lane for each track with enough points', () => {
  const track = (n, v) => Array.from({ length: n }, (_, t) => ({ t, v }));
  const rec = { id: 'b1', round: 'behavioral', question: 'Tell me about a time…', turns: [{ speaker: 'interviewer', text: 'q' }, { speaker: 'candidate', text: 'a' }], deliveries: [] };
  const el = { innerHTML: '' };
  const session = { answeredRecords: () => [rec] };
  renderReport(el, session, { ok: false }, { duration: 30, marks: [{ key: 'b1', t: 2 }], tracks: { smile: track(20, 40), loudness: track(10, -6), pitch: track(2, 1) } });
  assert.match(el.innerHTML, /Smile, Loudness across the interview/);
  assert.doesNotMatch(el.innerHTML, /tl-lane[^>]*>Pitch/);
  assert.match(el.innerHTML, />B1</);
  renderReport(el, session, { ok: false }, { duration: 30, marks: [], tracks: { smile: [], loudness: [], pitch: [] } });
  assert.doesNotMatch(el.innerHTML, /class="timeline"/);
});

test('long recordings do not exceed the function argument limit in speech detection', () => {
  const frames = Array.from({ length: 150000 }, (_, i) => ({ t: i / 20, db: -25, f0: 180 }));
  const speech = findSpeech(frames);
  assert.equal(speech.sounding.length, 1);
  assert.equal(speech.firstSound, 0);
  assert.ok(speech.lastSound > 7499);
});

test('phrase analysis scans frames once across many separated phrases', () => {
  const intervals = Array.from({ length: 100 }, (_, i) => ({ start: i * 3, end: i * 3 + 2 }));
  let reads = 0;
  const frames = Array.from({ length: 6000 }, (_, i) => ({
    get t() { reads++; return i / 20; },
    db: -25, f0: 180,
  }));
  const endings = phraseEndings(frames, intervals);
  assert.deepEqual(endings, { pitchPhrases: 100, uptalk: 0, loudPhrases: 100, trailOff: 0 });
  // Bound work using timestamp reads, independent of machine speed.
  assert.ok(reads < frames.length * 10, `${reads} frame timestamp reads`);
});

test('whole-answer audio summary does not search every phrase for every frame', () => {
  let reads = 0;
  const frames = Array.from({ length: 6000 }, (_, i) => ({
    get t() { reads++; return i / 20; },
    db: i % 60 < 40 ? -25 : -70,
    f0: i % 60 < 40 ? 180 : null,
  }));
  const summary = summarizeAudio(frames);
  assert.equal(summary.pitchPhrases, 100);
  assert.equal(summary.pauses, 99);
  assert.equal(summary.pitchVarSt, 0);
  assert.ok(reads < frames.length * 30, `${reads} frame timestamp reads`);
});
