// Pure delivery (nonverbal) measurements, shared by the browser tracker, the face
// worker, the server prompt builder, and the tests. No DOM access in this file.
//
// Methods follow MACH (Hoque et al., UbiComp 2013) where the paper specifies them:
// - Head nods/shakes: the paper's stable/extreme/transient frame states over a
//   ±2-frame window on the "between the eyes" point, with a 2-pixel threshold.
// - Pauses: minimum pitch 100 Hz, silence threshold -25 dB (relative to the loudest
//   frame, as in Praat), minimum silent and sounding intervals of 0.5 s.
// - Pitch: autocorrelation-based periodicity detection.
// - Weak language: filler words as a share of spoken words.
// Smile intensity comes from MediaPipe's mouthSmile blendshapes (0-100) instead of
// MACH's SHORE classifier. Side-to-side movement and gestures reuse the body-pose
// rules in body-language.js. All values are approximate coaching signals, not
// validated measures of interview skill, emotion, or confidence.
import { BodyLanguageAnalyzer } from './body-language.js';

const DEG = 180 / Math.PI;

export const SMILE_THRESHOLD = 35; // smile intensity (0-100) counted as smiling
export const AWAY_DEGREES = 20; // head turned this far from the usual position counts as "away"
export const MIN_PITCH_HZ = 100;
export const MAX_PITCH_HZ = 500;

const REF_EYE_PX = 60; // MACH's 2 px rule is applied to a face rescaled to 60 px between outer eye corners
const MAX_SWING_PX = 40; // larger swings are posture changes (e.g. looking down at notes), not nods
const MIN_FRAMES = 20; // about 1.3 s of face tracking before a face statistic is reported
const MIN_BODY_SECONDS = 5; // usable body tracking before a movement or gesture share is reported

export const mean = (v) => v.reduce((s, n) => s + n, 0) / v.length;
export function median(v) {
  const a = [...v].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
const sd = (v) => {
  const m = mean(v);
  return Math.sqrt(mean(v.map((n) => (n - m) ** 2)));
};
const angleDelta = (a, b) => ((a - b + 540) % 360) - 180;
const sum = (v) => v.reduce((s, n) => s + n, 0);
export function round(n, digits = 0) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
function weighted(parts, value, weight) {
  const usable = parts.filter((p) => value(p) != null && weight(p) > 0);
  const w = sum(usable.map(weight));
  return w > 0 ? sum(usable.map((p) => value(p) * weight(p))) / w : null;
}

// ---------------------------------------------------------------------------
// Face

/** One frame of face measurements from a MediaPipe FaceLandmarker result, or null. */
export function measureFace(face, width, height) {
  const lm = face?.faceLandmarks?.[0];
  if (!lm?.length || !(width > 0) || !(height > 0)) return null;
  const between = lm[168]; // bridge of the nose, between the eyes
  const left = lm[33];
  const right = lm[263];
  if (![between, left, right].every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  const eye = Math.hypot((left.x - right.x) * width, (left.y - right.y) * height);
  if (!(eye > 4)) return null;

  const categories = face.faceBlendshapes?.[0]?.categories ?? [];
  const score = (name) => categories.find((c) => c.categoryName === name)?.score;
  const sl = score('mouthSmileLeft');
  const sr = score('mouthSmileRight');
  const smile = Number.isFinite(sl) && Number.isFinite(sr) ? Math.min(100, Math.max(0, ((sl + sr) / 2) * 100)) : null;

  let yaw = null;
  let pitch = null;
  const m = face.facialTransformationMatrixes?.[0]?.data;
  if (m?.length === 16 && [m[8], m[9], m[10]].every(Number.isFinite) && Math.hypot(m[8], m[9], m[10]) > 0.5) {
    // Column-major; the third column is the face normal.
    yaw = Math.atan2(m[8], m[10]) * DEG;
    pitch = Math.atan2(-m[9], Math.hypot(m[8], m[10])) * DEG;
  }
  return { smile, x: between.x * width, y: between.y * height, eye, yaw, pitch };
}

/**
 * MACH head nod (y axis) and shake (x axis) detection.
 * @param {{t: number, face: {x: number, y: number, eye: number} | null}[]} frames
 * @returns {{nods: object[], shakes: object[]}}
 */
export function detectHeadGestures(frames, { stablePx = 2, maxGap = 0.3 } = {}) {
  const result = { nods: [], shakes: [] };
  const runs = [];
  let run = [];
  for (const f of frames ?? []) {
    const ok = f?.face && Number.isFinite(f.face.x) && Number.isFinite(f.face.y) && f.face.eye > 0;
    if (!ok || (run.length && f.t - run.at(-1).t > maxGap)) {
      if (run.length) runs.push(run);
      run = [];
    }
    if (ok) run.push(f);
  }
  if (run.length) runs.push(run);
  for (const r of runs) {
    result.shakes.push(...gesturesOnAxis(r, 'x', stablePx));
    result.nods.push(...gesturesOnAxis(r, 'y', stablePx));
  }
  return result;
}

function gesturesOnAxis(run, axis, stablePx) {
  const n = run.length;
  if (n < 5) return [];
  const scale = REF_EYE_PX / median(run.map((f) => f.face.eye));
  const pos = run.map((f) => f.face[axis] * scale);

  const states = new Array(n).fill(null);
  for (let i = 2; i < n - 2; i++) {
    const w = pos.slice(i - 2, i + 3);
    const max = Math.max(...w);
    const min = Math.min(...w);
    if (max - min <= stablePx) states[i] = 'stable';
    else if (pos[i] === max) states[i] = 'max';
    else if (pos[i] === min) states[i] = 'min';
    else states[i] = 'transient';
  }

  const events = [];
  let seenStable = false;
  let extremes = [];
  let start = null;
  for (let i = 2; i < n - 2; i++) {
    const s = states[i];
    if (s === 'stable') {
      // More than two extremes between two stable states, each adjacent pair at
      // least stablePx apart, is one nod or shake.
      if (seenStable && extremes.length > 2 && extremes.every((e, k) => {
        if (k === 0) return true;
        const swing = Math.abs(e.v - extremes[k - 1].v);
        return swing >= stablePx && swing <= MAX_SWING_PX;
      })) {
        events.push({ start, end: run[i].t, swings: extremes.length });
      }
      seenStable = true;
      extremes = [];
      start = null;
      continue;
    }
    start ??= run[i].t;
    if (s === 'max' || s === 'min') {
      const last = extremes.at(-1);
      if (last?.type === s) {
        if ((s === 'max' && pos[i] > last.v) || (s === 'min' && pos[i] < last.v)) last.v = pos[i];
      } else {
        extremes.push({ type: s, v: pos[i] });
      }
    }
  }
  return events;
}

/** Face statistics for one stretch of frames. `baseline` is the usual {yaw, pitch}. */
export function summarizeFace(frames, baseline = null) {
  if (!frames?.length) return null;
  const tracked = frames.filter((f) => f.face);
  const smiles = tracked.map((f) => f.face.smile).filter(Number.isFinite);
  const heads = baseline
    ? tracked.filter((f) => Number.isFinite(f.face.yaw) && Number.isFinite(f.face.pitch))
    : [];
  const g = detectHeadGestures(frames);
  return {
    frames: frames.length,
    tracked: tracked.length,
    faceCoverage: tracked.length / frames.length,
    smileFrames: smiles.length,
    smileMean: smiles.length ? mean(smiles) : null,
    smileShare: smiles.length ? smiles.filter((s) => s >= SMILE_THRESHOLD).length / smiles.length : null,
    nods: g.nods.length,
    shakes: g.shakes.length,
    headFrames: heads.length,
    awayShare: heads.length
      ? heads.filter((f) => Math.abs(angleDelta(f.face.yaw, baseline.yaw)) > AWAY_DEGREES
        || Math.abs(f.face.pitch - baseline.pitch) > AWAY_DEGREES).length / heads.length
      : null,
  };
}

/** Median head direction over tracked frames, used as the "usual position". */
/** Usual shoulder position over the session, the reference for side-to-side movement. */
export function bodyBaseline(frames) {
  const xs = (frames ?? []).map((f) => f.body?.shoulders?.x).filter(Number.isFinite);
  return xs.length >= MIN_FRAMES ? { x: median(xs) } : null;
}

/**
 * Seconds of usable and flagged body tracking for one answer. `frames` are
 * { t, body } where body is null when pose tracking did not run on that frame.
 */
export function summarizeBody(frames, baseline = null) {
  const bodies = (frames ?? []).filter((f) => f.body);
  if (!bodies.length) return null;
  const analyzer = new BodyLanguageAnalyzer({ baseline: { yaw: null, pitch: null, x: baseline?.x ?? null } });
  for (const f of bodies) analyzer.add({ head: null, shoulders: f.body.shoulders, wrists: f.body.wrists }, f.t);
  const { shift, gestures } = analyzer.stats;
  return { shiftValid: shift.valid, shiftFlagged: shift.flagged, gestureValid: gestures.valid, gestureFlagged: gestures.flagged };
}

export function headBaseline(frames) {
  const heads = (frames ?? []).filter((f) => f.face && Number.isFinite(f.face.yaw) && Number.isFinite(f.face.pitch));
  if (heads.length < MIN_FRAMES) return null;
  return { yaw: median(heads.map((f) => f.face.yaw)), pitch: median(heads.map((f) => f.face.pitch)) };
}

// ---------------------------------------------------------------------------
// Audio

/** RMS level in dBFS (floor -100). */
export function rmsDb(samples) {
  let s = 0;
  for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
  const rms = Math.sqrt(s / samples.length);
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
}

/** Fundamental frequency in Hz by normalized autocorrelation, or null if unvoiced. */
export function detectPitch(samples, sampleRate, { minHz = MIN_PITCH_HZ, maxHz = MAX_PITCH_HZ, minClarity = 0.6 } = {}) {
  const n = samples.length;
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(n - 2, Math.ceil(sampleRate / minHz));
  if (maxLag <= minLag + 2) return null;

  let m = 0;
  for (let i = 0; i < n; i++) m += samples[i];
  m /= n;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = samples[i] - m;

  const r = new Float32Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let num = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i < n - lag; i++) {
      const a = x[i];
      const b = x[i + lag];
      num += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    r[lag] = e1 > 0 && e2 > 0 ? num / Math.sqrt(e1 * e2) : 0;
  }

  let best = -1;
  let bestLag = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (r[lag] > best) {
      best = r[lag];
      bestLag = lag;
    }
  }
  if (best < minClarity) return null;
  // The shortest lag that is a local peak close to the best avoids octave-down errors.
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (r[lag] >= 0.9 * best && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) {
      bestLag = lag;
      break;
    }
  }
  const a = r[bestLag - 1];
  const b = r[bestLag];
  const c = r[bestLag + 1];
  const denom = a - 2 * b + c;
  const shift = denom ? (0.5 * (a - c)) / denom : 0;
  const hz = sampleRate / (bestLag + (Math.abs(shift) < 1 ? shift : 0));
  return hz >= minHz && hz <= maxHz ? hz : null;
}

/**
 * Praat-style silence detection on a list of {t, db} frames at a regular step.
 * Returns the sounding intervals, or null when nobody spoke.
 */
export function findSpeech(frames, { silenceDb = -25, floorDb = -60, minSilence = 0.5, minSound = 0.5 } = {}) {
  const valid = (frames ?? []).filter((f) => Number.isFinite(f.db) && Number.isFinite(f.t));
  if (valid.length < 4) return null;
  const maxDb = valid.reduce((max, f) => Math.max(max, f.db), -Infinity);
  if (maxDb < floorDb + 6) return null;
  const threshold = Math.max(maxDb + silenceDb, floorDb);
  const step = median(valid.slice(1).map((f, i) => f.t - valid[i].t)) || 0.05;

  let runs = [];
  for (const f of valid) {
    const sound = f.db >= threshold;
    const last = runs.at(-1);
    if (last && last.sound === sound) last.end = f.t + step;
    else runs.push({ sound, start: f.t, end: f.t + step });
  }
  const merge = (list) => list.reduce((out, r) => {
    const last = out.at(-1);
    if (last && last.sound === r.sound) last.end = r.end;
    else out.push({ ...r });
    return out;
  }, []);
  // Short silences inside speech are part of the speech; short sounds are clicks or coughs.
  runs = merge(runs.map((r, i) => (!r.sound && i > 0 && i < runs.length - 1 && r.end - r.start < minSilence ? { ...r, sound: true } : r)));
  runs = merge(runs.map((r) => (r.sound && r.end - r.start < minSound ? { ...r, sound: false } : r)));

  const sounding = runs.filter((r) => r.sound).map(({ start, end }) => ({ start, end }));
  if (!sounding.length) return null;
  return { threshold, maxDb, sounding, firstSound: sounding[0].start, lastSound: sounding.at(-1).end };
}

export const TRACK_FLOOR_DB = -60; // quieter seconds are drawn at the floor
const TRACK_MIN_VOICED = 2; // voiced frames needed in a second to plot its pitch

/**
 * One point per second for the report's loudness and pitch lanes, from answer
 * audio frames ({ t, db, f0 }). Loudness is mean dB relative to the loudest
 * second (0 = loudest); pitch is the second's median in semitones relative to
 * the session's median pitch, so different voices are comparable.
 */
export function voiceTracks(frames) {
  const buckets = new Map();
  for (const f of frames ?? []) {
    const sec = Math.floor(f.t);
    const b = buckets.get(sec) ?? { db: [], f0: [] };
    b.db.push(Math.max(TRACK_FLOOR_DB, f.db));
    if (Number.isFinite(f.f0)) b.f0.push(f.f0);
    buckets.set(sec, b);
  }
  const secs = [...buckets.keys()].sort((a, b) => a - b);
  const loud = secs.map((t) => ({ t, db: mean(buckets.get(t).db) }));
  const top = loud.length ? loud.reduce((max, p) => Math.max(max, p.db), -Infinity) : 0;
  const voiced = secs.filter((t) => buckets.get(t).f0.length >= TRACK_MIN_VOICED);
  const ref = voiced.length ? median(voiced.flatMap((t) => buckets.get(t).f0)) : null;
  return {
    loudness: loud.map((p) => ({ t: p.t, v: round(Math.max(TRACK_FLOOR_DB, p.db - top), 1) })),
    pitch: voiced.map((t) => ({ t, v: round(12 * Math.log2(median(buckets.get(t).f0) / ref), 1) })),
  };
}

export const UPTALK_SEMITONES = 2.5; // phrase ending this much above the phrase's median pitch
export const TRAIL_OFF_DB = 6; // phrase ending this much quieter than the rest of the phrase
export const SILENT_STRETCH_S = 15; // think-aloud: silence this long while solving is flagged
const PHRASE_MIN_S = 1; // phrases shorter than this are too short to judge an ending
const ENDING_S = 0.4; // the "ending" of a phrase for pitch
const ENDING_LOUD_S = 0.5; // the "ending" of a phrase for loudness

/**
 * Phrase endings: rising pitch (possible uptalk) and fading loudness (trailing
 * off). Frames and non-overlapping sounding intervals are in chronological order.
 * Phrases are the sounding intervals between pauses of 0.5 s or more.
 */
export function phraseEndings(frames, sounding) {
  const out = { pitchPhrases: 0, uptalk: 0, loudPhrases: 0, trailOff: 0 };
  let cursor = 0;
  for (const r of sounding ?? []) {
    if (r.end - r.start < PHRASE_MIN_S) continue;
    while (cursor < frames.length && frames[cursor].t < r.start) cursor++;
    const start = cursor;
    while (cursor < frames.length && frames[cursor].t < r.end) cursor++;
    const inPhrase = frames.slice(start, cursor);
    const voiced = inPhrase.filter((f) => Number.isFinite(f.f0));
    if (voiced.length >= 9) {
      const ref = median(voiced.map((f) => f.f0));
      // Semitones from the phrase median; ignore octave errors from creaky endings.
      const st = (f) => 12 * Math.log2(f.f0 / ref);
      const usable = voiced.filter((f) => Math.abs(st(f)) <= 12);
      const tail = usable.filter((f) => f.t >= r.end - ENDING_S).map(st);
      const body = usable.filter((f) => f.t < r.end - ENDING_S).map(st);
      if (tail.length >= 3 && body.length >= 6) {
        out.pitchPhrases++;
        if (median(tail) - median(body) >= UPTALK_SEMITONES) out.uptalk++;
      }
    }
    const tailDb = inPhrase.filter((f) => f.t >= r.end - ENDING_LOUD_S).map((f) => f.db);
    const bodyDb = inPhrase.filter((f) => f.t < r.end - ENDING_LOUD_S).map((f) => f.db);
    if (tailDb.length >= 4 && bodyDb.length >= 6) {
      out.loudPhrases++;
      if (mean(bodyDb) - mean(tailDb) >= TRAIL_OFF_DB) out.trailOff++;
    }
  }
  return out;
}

/**
 * Think-aloud check for coding questions: silences of SILENT_STRETCH_S or more,
 * split by whether the candidate was typing code during them.
 * @param {number[]} typing times (s) of code-editor input events
 */
export function silentStretches(speech, startT, endT, typing = []) {
  const quiet = [];
  if (!speech) quiet.push([startT, endT]);
  else {
    quiet.push([startT, speech.firstSound]);
    speech.sounding.slice(1).forEach((r, i) => quiet.push([speech.sounding[i].end, r.start]));
    quiet.push([speech.lastSound, endT]);
  }
  const long = quiet.filter(([a, b]) => b - a >= SILENT_STRETCH_S);
  return {
    longestSilence: quiet.reduce((max, [a, b]) => Math.max(max, b - a), 0),
    silentStretches: long.length,
    silentCoding: long.filter(([a, b]) => typing.filter((t) => t >= a && t <= b).length >= 5).length,
  };
}

/**
 * Prosody for one answer from {t, db, f0} frames.
 * `thinkAloud` (spoken coding answers) adds silent-stretch stats using `typing` times.
 */
export function summarizeAudio(frames, { spokenText = '', typing = [], thinkAloud = false } = {}) {
  if (!frames?.length) return null;
  const startT = frames[0].t;
  const endT = frames.at(-1).t;
  const speech = findSpeech(frames);
  const silence = thinkAloud ? silentStretches(speech, startT, endT, typing) : null;
  if (!speech) return { spoke: false, seconds: endT - startT, silence };

  const span = speech.lastSound - speech.firstSound;
  const soundTime = sum(speech.sounding.map((r) => r.end - r.start));
  const gaps = speech.sounding.slice(1).map((r, i) => r.start - speech.sounding[i].end);
  let interval = 0;
  const voiced = frames.filter((f) => {
    while (interval < speech.sounding.length && f.t >= speech.sounding[interval].end) interval++;
    return interval < speech.sounding.length && f.t >= speech.sounding[interval].start;
  });
  const f0 = voiced.map((f) => f.f0).filter(Number.isFinite);
  const loud = voiced.map((f) => f.db).filter(Number.isFinite);
  const words = countWords(spokenText);
  const med = f0.length >= 10 ? median(f0) : null;

  return {
    spoke: true,
    seconds: endT - startT,
    latency: Math.max(0, speech.firstSound - startT),
    span,
    soundTime,
    pauseTime: Math.max(0, span - soundTime),
    pauses: gaps.length,
    longPauses: gaps.filter((g) => g >= 2).length,
    pitchFrames: f0.length,
    pitchHz: med,
    pitchVarSt: med ? sd(f0.map((f) => 12 * Math.log2(f / med))) : null,
    loudFrames: loud.length,
    loudVarDb: loud.length >= 10 ? sd(loud) : null,
    spokenWords: words,
    wpm: words >= 5 && span >= 3 ? (words / span) * 60 : null,
    // Speaking rate while actually talking, pauses excluded.
    articulationWpm: words >= 5 && soundTime >= 3 ? (words / soundTime) * 60 : null,
    ...phraseEndings(frames, speech.sounding),
    silence,
  };
}

// ---------------------------------------------------------------------------
// Words

export function countWords(text) {
  return String(text ?? '').match(/[a-z0-9']+/gi)?.length ?? 0;
}

export const FILLER_KEYS = ['um', 'uh', 'like', 'you know', 'basically', 'actually', 'literally', 'totally', 'kind of', 'sort of', 'I mean'];
const FILLER_PATTERNS = {
  um: /\b(?:u+m+|e+r+m+|h+m+)\b/g,
  uh: /\b(?:u+h+|e+r+|a+h+)\b/g,
  like: /\blike\b/g,
  'you know': /\byou know\b/g,
  basically: /\bbasically\b/g,
  actually: /\bactually\b/g,
  literally: /\bliterally\b/g,
  totally: /\btotally\b/g,
  'kind of': /\bkind of\b/g,
  'sort of': /\bsort of\b/g,
  'I mean': /\bi mean\b/g,
};

/** Filler ("weak language") words in a transcript. */
export function countFillers(text) {
  let t = ` ${String(text ?? '').toLowerCase().replace(/[’]/g, "'")} `;
  // Ordinary uses that are not fillers.
  t = t.replace(/\b(would|i'd|we'd|you'd|they'd|i|we|you|they|to|look|looks|looked|feel|feels|felt|seem|seems|something|things|just|more|much|be|is|was|looks)\s+like\b/g, '$1 ');
  t = t.replace(/\b(do|did|if|don't|didn't|let me|let us)\s+you know\b/g, '$1 ');
  t = t.replace(/\bi mean (it|that|to)\b/g, ' ');
  const byWord = {};
  let count = 0;
  for (const [key, re] of Object.entries(FILLER_PATTERNS)) {
    const n = t.match(re)?.length ?? 0;
    if (n) {
      byWord[key] = n;
      count += n;
    }
  }
  return { count, byWord };
}

// ---------------------------------------------------------------------------
// Combining answers into question-level and interview-level summaries

/**
 * Combines per-answer parts ({audio, face, fillers, words}) into one flat,
 * rounded summary. Fields are null when there is not enough data.
 */
export function combineDeliveries(parts) {
  const list = (parts ?? []).filter(Boolean);
  if (!list.length) return null;
  const audio = list.map((p) => p.audio).filter((a) => a?.spoke);
  const face = list.map((p) => p.face).filter((f) => f?.frames);
  const span = sum(audio.map((a) => a.span));
  const wpmParts = audio.filter((a) => a.wpm != null);
  const wpmSpan = sum(wpmParts.map((a) => a.span));
  const words = sum(list.map((p) => p.words ?? 0));
  const fillers = sum(list.map((p) => p.fillers?.count ?? 0));
  const fillerWords = {};
  for (const p of list) {
    for (const [k, v] of Object.entries(p.fillers?.byWord ?? {})) fillerWords[k] = (fillerWords[k] ?? 0) + v;
  }
  const faceFrames = sum(face.map((f) => f.frames));
  const smileParts = face.filter((f) => f.smileFrames > 0);
  const smileFrames = sum(smileParts.map((f) => f.smileFrames));
  const headParts = face.filter((f) => f.headFrames > 0);
  const headFrames = sum(headParts.map((f) => f.headFrames));
  const hasFace = faceFrames >= MIN_FRAMES && sum(face.map((f) => f.tracked)) >= MIN_FRAMES;
  const artParts = audio.filter((a) => a.articulationWpm != null);
  const artSound = sum(artParts.map((a) => a.soundTime));
  const pitchPhrases = sum(audio.map((a) => a.pitchPhrases ?? 0));
  const loudPhrases = sum(audio.map((a) => a.loudPhrases ?? 0));
  const uptalk = sum(audio.map((a) => a.uptalk ?? 0));
  const trailOff = sum(audio.map((a) => a.trailOff ?? 0));
  const silences = list.map((p) => p.audio?.silence).filter(Boolean);
  const body = list.map((p) => p.body).filter(Boolean);
  const shiftValid = sum(body.map((b) => b.shiftValid));
  const gestureValid = sum(body.map((b) => b.gestureValid));

  return {
    answers: list.length,
    spokenSeconds: audio.length ? round(span, 1) : null,
    latency: audio.length ? round(audio[0].latency, 1) : null,
    wpm: wpmSpan > 0 ? round((sum(wpmParts.map((a) => a.spokenWords)) / wpmSpan) * 60) : null,
    articulationWpm: artSound > 0 ? round((sum(artParts.map((a) => a.spokenWords)) / artSound) * 60) : null,
    pitchPhrases: audio.length ? pitchPhrases : null,
    uptalk: audio.length ? uptalk : null,
    uptalkShare: pitchPhrases >= 3 ? round(uptalk / pitchPhrases, 2) : null,
    loudPhrases: audio.length ? loudPhrases : null,
    trailOff: audio.length ? trailOff : null,
    trailShare: loudPhrases >= 3 ? round(trailOff / loudPhrases, 2) : null,
    longestSilence: silences.length ? round(Math.max(...silences.map((s) => s.longestSilence))) : null,
    silentStretches: silences.length ? sum(silences.map((s) => s.silentStretches)) : null,
    silentCoding: silences.length ? sum(silences.map((s) => s.silentCoding)) : null,
    pauseShare: span >= 3 ? round(sum(audio.map((a) => a.pauseTime)) / span, 2) : null,
    pauses: audio.length ? sum(audio.map((a) => a.pauses)) : null,
    longPauses: audio.length ? sum(audio.map((a) => a.longPauses)) : null,
    pitchHz: round(weighted(audio, (a) => a.pitchHz, (a) => a.pitchFrames)),
    pitchVarSt: round(weighted(audio, (a) => a.pitchVarSt, (a) => a.pitchFrames), 1),
    loudVarDb: round(weighted(audio, (a) => a.loudVarDb, (a) => a.loudFrames), 1),
    words,
    fillers,
    fillerShare: words >= 10 ? round(fillers / words, 3) : null,
    fillerWords,
    faceCoverage: faceFrames ? round(sum(face.map((f) => f.tracked)) / faceFrames, 2) : null,
    smileMean: hasFace && smileFrames >= MIN_FRAMES ? round(weighted(smileParts, (f) => f.smileMean, (f) => f.smileFrames)) : null,
    smileShare: hasFace && smileFrames >= MIN_FRAMES ? round(weighted(smileParts, (f) => f.smileShare, (f) => f.smileFrames), 2) : null,
    nods: hasFace ? sum(face.map((f) => f.nods)) : null,
    shakes: hasFace ? sum(face.map((f) => f.shakes)) : null,
    awayShare: hasFace && headFrames >= MIN_FRAMES ? round(weighted(headParts, (f) => f.awayShare, (f) => f.headFrames), 2) : null,
    shiftShare: shiftValid >= MIN_BODY_SECONDS ? round(sum(body.map((b) => b.shiftFlagged)) / shiftValid, 2) : null,
    gestureShare: gestureValid >= MIN_BODY_SECONDS ? round(sum(body.map((b) => b.gestureFlagged)) / gestureValid, 2) : null,
  };
}

const pct = (v) => `${Math.round(v * 100)}%`;
const plural = (n, word) => `${n} ${n === 1 ? word : word.replace(/(ch|sh|s|x)$/, '$1e')}${n === 1 ? '' : 's'}`;

function fillerList(fillerWords) {
  return Object.entries(fillerWords ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `"${k}" ×${v}`)
    .join(', ');
}

/** Plain-language measurement lines (used in the evaluation prompt). */
export function describeDelivery(d) {
  if (!d) return [];
  const out = [];
  if (d.wpm != null) out.push(`speaking rate ${d.wpm} words per minute`);
  if (d.articulationWpm != null) out.push(`articulation rate ${d.articulationWpm} words per minute of actual talking (pauses excluded)`);
  if (d.uptalkShare != null) out.push(`pitch rose at the end of ${d.uptalk} of ${d.pitchPhrases} phrases (possible uptalk)`);
  if (d.trailShare != null) out.push(`volume faded at the end of ${d.trailOff} of ${d.loudPhrases} phrases (trailing off)`);
  if (d.silentStretches != null) {
    out.push(`while solving: ${plural(d.silentStretches, 'silent stretch')} of ${SILENT_STRETCH_S} s or longer${d.silentStretches ? ` (${d.silentCoding} while typing code)` : ''}; longest silence ${d.longestSilence} s`);
  }
  if (d.pauseShare != null) {
    out.push(`pauses took ${pct(d.pauseShare)} of the speaking time (${plural(d.pauses ?? 0, 'pause')} of 0.5 s or longer${d.longPauses ? `, ${d.longPauses} over 2 s` : ''})`);
  }
  if (d.latency != null) out.push(`${d.latency} s of silence before the first word`);
  if (d.pitchVarSt != null) out.push(`pitch variation ${d.pitchVarSt} semitones (standard deviation) around a median of ${d.pitchHz} Hz`);
  if (d.loudVarDb != null) out.push(`loudness variation ${d.loudVarDb} dB`);
  if (d.fillerShare != null) {
    out.push(`${plural(d.fillers, 'filler word')} in ${d.words} words (${(d.fillerShare * 100).toFixed(1)}%)${d.fillers ? `: ${fillerList(d.fillerWords)}` : ''}`);
  }
  if (d.smileShare != null) out.push(`smiling ${pct(d.smileShare)} of the time (mean smile intensity ${d.smileMean}/100)`);
  if (d.nods != null) out.push(`${plural(d.nods, 'head nod')} and ${plural(d.shakes, 'head shake')} while answering`);
  if (d.awayShare != null) out.push(`head turned away from their usual position ${pct(d.awayShare)} of the time`);
  if (d.shiftShare != null) out.push(`shifted sideways from their usual position ${pct(d.shiftShare)} of the time (swaying, leaning, or moving in the seat)`);
  if (d.gestureShare != null) out.push(`hands moving (gesturing) ${pct(d.gestureShare)} of the time both hands were visible`);
  if (d.faceCoverage != null && d.faceCoverage < 0.6) out.push(`face visible to the camera only ${pct(d.faceCoverage)} of the time`);
  return out;
}

/** Short label/value pairs for the report. */
export function deliveryChips(d) {
  if (!d) return [];
  const chips = [];
  if (d.wpm != null) chips.push({ label: 'Pace', value: `${d.wpm} wpm` });
  if (d.articulationWpm != null) chips.push({ label: 'Talking speed', value: `${d.articulationWpm} wpm` });
  if (d.uptalkShare != null) chips.push({ label: 'Rising endings', value: pct(d.uptalkShare) });
  if (d.trailShare != null) chips.push({ label: 'Trailing off', value: pct(d.trailShare) });
  if (d.silentStretches != null) {
    chips.push({ label: `Silent ${SILENT_STRETCH_S} s+`, value: `${d.silentStretches} (longest ${d.longestSilence} s)` });
  }
  if (d.pauseShare != null) chips.push({ label: 'Pauses', value: pct(d.pauseShare) });
  if (d.latency != null) chips.push({ label: 'First word after', value: `${d.latency} s` });
  if (d.pitchVarSt != null) chips.push({ label: 'Pitch variation', value: `${d.pitchVarSt} st` });
  if (d.fillerShare != null) chips.push({ label: 'Fillers', value: `${d.fillers} (${(d.fillerShare * 100).toFixed(1)}%)` });
  if (d.smileShare != null) chips.push({ label: 'Smiling', value: pct(d.smileShare) });
  if (d.nods != null) chips.push({ label: 'Nods / shakes', value: `${d.nods} / ${d.shakes}` });
  if (d.awayShare != null) chips.push({ label: 'Looking away', value: pct(d.awayShare) });
  if (d.shiftShare != null) chips.push({ label: 'Side-to-side', value: pct(d.shiftShare) });
  if (d.gestureShare != null) chips.push({ label: 'Gesturing', value: pct(d.gestureShare) });
  return chips;
}
