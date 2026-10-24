// Delivery analysis: facial expression from the webcam and voice from the mic.
// Everything runs in the browser; only summary numbers leave the page (with the
// evaluation request). Measurements are only taken during the candidate's turns.
//
// Face: MediaPipe Face Landmarker blendshapes + head pose, sampled ~5x a second.
// Voice: Web Audio level and pitch every 100 ms, plus the dictated words
// (pace, filler words) and the recognizer's confidence as a clarity proxy.
// Each answer's audio is also sent for a verbatim transcript, because browser
// dictation drops most "um"s and "uh"s; when it returns, its filler counts win.

import { api } from './api.js';

const MEDIAPIPE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const FACE_MS = 200;
const AUDIO_MS = 100;
const LONG_PAUSE_MS = 2500;
const MIN_FACE_FRAMES = 25; // ~5 s of face data before we report on it
const MIN_WORDS = 15;
const PCM_RATE = 16000;
const MAX_ANSWER_SEC = 300; // cap per-answer audio (~9.6 MB of WAV)
const MIN_AUDIO_SEC = 2;

// "like" only counts as a filler when it isn't doing grammatical work ("I'd like", "looks like").
const FILLER_RE = /\b(um+|uh+m*|erm*|ah+|hmm+|you know|i mean|sort of|kind of|basically|literally|(?<!\b(?:would|i'd|we'd|you'd|they'd|i|we|you|they|look|looks|looked|feel|feels|felt|seem|seems|something|anything|things?|just)\s)like)\b/gi;

// What counts as worth flagging. Shared with the report so tiles and feedback agree.
export const LIMITS = {
  presentPct: { min: 80, message: 'Often out of frame. Center yourself in the camera.' },
  eyeContactPct: { min: 60, message: 'Looked away from the camera a lot. Look at the lens when you make key points.' },
  smilePct: { min: 5, message: 'Rarely smiled, so your expression may read as flat or nervous.' },
  tensePct: { max: 25, message: 'Brow furrowed or mouth tense much of the time.' },
  blinksPerMin: { max: 35, message: 'High blink rate, which often reads as nerves.' },
  headMovementDeg: { max: 9, message: 'Lots of head movement. Try to keep a steady, settled posture.' },
  wpm: { min: 110, max: 170, message: { low: 'Spoke slowly.', high: 'Spoke fast. Slow down and let key points land.' } },
  fillersPerMin: { max: 4, message: 'Frequent filler words. Swap them for a short silent pause.' },
  longPausesPerMin: { max: 2, message: 'Frequent long pauses mid-answer.' },
  volumeDb: { min: -42, message: 'Spoke quietly. Project a little more.' },
  pitchVariation: { min: 2, message: 'Fairly monotone. Vary your pitch to sound more engaged.' },
  clarityPct: { min: 75, message: 'The transcriber often struggled to understand you. Enunciate and finish your words.' },
};

function emptyAcc() {
  return {
    frames: 0, faceFrames: 0, awayFrames: 0, smileFrames: 0, tenseFrames: 0, blinks: 0,
    yawSum: 0, yawSq: 0, tiltSum: 0, tiltSq: 0,
    speakingMs: 0, pauses: 0, longestPauseMs: 0,
    voicedTicks: 0, dbSum: 0, f0Count: 0, stSum: 0, stSq: 0,
    words: 0, confSum: 0, confCount: 0, fillers: {},
    voiceSegs: 0, verbatimSegs: 0,
  };
}

function mergeInto(a, b) {
  for (const [k, v] of Object.entries(b)) {
    if (k === 'fillers') for (const [w, n] of Object.entries(v)) a.fillers[w] = (a.fillers[w] ?? 0) + n;
    else if (k === 'longestPauseMs') a[k] = Math.max(a[k], v);
    else a[k] += v;
  }
}

const pct = (n, d) => Math.round((100 * n) / d);
const std = (sum, sq, n) => Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2));
const round1 = (x) => Math.round(x * 10) / 10;

/** Turns raw counters into reportable numbers and flags. */
export function summarize(acc) {
  let face = null;
  if (acc.faceFrames >= MIN_FACE_FRAMES) {
    const minutes = (acc.faceFrames * FACE_MS) / 60000;
    face = {
      presentPct: pct(acc.faceFrames, acc.frames),
      eyeContactPct: pct(acc.faceFrames - acc.awayFrames, acc.faceFrames),
      smilePct: pct(acc.smileFrames, acc.faceFrames),
      tensePct: pct(acc.tenseFrames, acc.faceFrames),
      blinksPerMin: Math.round(acc.blinks / minutes),
      headMovementDeg: round1(Math.hypot(std(acc.yawSum, acc.yawSq, acc.faceFrames), std(acc.tiltSum, acc.tiltSq, acc.faceFrames))),
    };
  }

  let voice = null;
  if (acc.words >= MIN_WORDS && acc.speakingMs > 5000) {
    const minutes = acc.speakingMs / 60000;
    const fillerCount = Object.values(acc.fillers).reduce((a, b) => a + b, 0);
    voice = {
      words: acc.words,
      wpm: Math.round(acc.words / minutes),
      fillerCount,
      fillersPerMin: round1(fillerCount / minutes),
      topFillers: Object.entries(acc.fillers).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([word, count]) => ({ word, count })),
      longPauses: acc.pauses,
      longPausesPerMin: round1(acc.pauses / minutes),
      longestPauseSec: round1(acc.longestPauseMs / 1000),
      volumeDb: acc.voicedTicks ? Math.round(acc.dbSum / acc.voicedTicks) : null,
      pitchVariation: acc.f0Count >= 30 ? round1(std(acc.stSum, acc.stSq, acc.f0Count)) : null,
      clarityPct: acc.confCount ? pct(acc.confSum, acc.confCount) : null,
      fillerSource: acc.verbatimSegs >= acc.voiceSegs ? 'verbatim' : acc.verbatimSegs ? 'mixed' : 'browser',
    };
  }

  const flags = [];
  for (const [area, data] of [['face', face], ['voice', voice]]) {
    if (!data) continue;
    for (const [metric, lim] of Object.entries(LIMITS)) {
      const v = data[metric];
      if (v == null) continue;
      if (lim.min != null && v < lim.min) flags.push({ area, metric, message: lim.message.low ?? lim.message });
      else if (lim.max != null && v > lim.max) flags.push({ area, metric, message: lim.message.high ?? lim.message });
    }
  }
  return face || voice ? { face, voice, flags } : null;
}

// ---------------------------------------------------------------------------

export class DeliveryTracker {
  constructor(video) {
    this.video = video;
    this.reset();
    this.faceActive = false;
    this.voiceActive = false;
    this.landmarker = null;
    this.faceStatus = 'idle'; // idle | loading | ready | failed
    this.audio = null;
  }

  /** Clears all measurements (new interview). */
  reset() {
    this.segment = emptyAcc();
    this.segments = []; // [{ recordId, acc }], one per answer
    this.pending = new Set(); // verbatim transcriptions in flight
    this._blinkOpen = true;
    this._resetVoiceRun();
    this._resetPcm();
  }

  _resetPcm() {
    this._pcm = [];
    this._pcmLen = 0;
    this._pcmPos = 0;
  }

  _resetVoiceRun() {
    this._hadVoice = false;
    this._silenceMs = 0;
  }

  /** Measure only while it's the candidate's turn; voice only while dictating. */
  setActive({ face, voice }) {
    this.faceActive = face;
    if (voice !== this.voiceActive) this._resetVoiceRun(); // gaps between turns aren't pauses
    this.voiceActive = voice;
    if (face) this._ensureFace();
    if (voice) this._ensureAudio();
  }

  /**
   * Closes the current answer and files it under a question.
   * @param {string|null} recordId  question id, or null for intro / candidate questions
   * @param {{ text: string, confidence: number }[]} heard  final dictated chunks for this answer
   */
  endAnswer(recordId, heard = []) {
    const seg = this.segment;
    for (const { text, confidence } of heard) {
      seg.words += countWords(text);
      if (confidence > 0) {
        seg.confSum += confidence;
        seg.confCount++;
      }
      addFillers(seg.fillers, text);
    }
    if (seg.words) seg.voiceSegs = 1;
    this.segments.push({ recordId, acc: seg });

    const wav = this._pcmLen >= PCM_RATE * MIN_AUDIO_SEC && seg.words ? encodeWav(this._pcm, this._pcmLen) : null;
    this._resetPcm();
    if (wav) this._transcribe(seg, wav);

    this.segment = emptyAcc();
    this._resetVoiceRun();
  }

  _transcribe(seg, wav) {
    const job = api.transcribe(wav)
      .then(({ text }) => {
        if (!text) return;
        seg.words = countWords(text);
        seg.fillers = {};
        addFillers(seg.fillers, text);
        seg.verbatimSegs = 1;
      })
      .catch((err) => console.warn('Verbatim transcription failed; using browser filler counts.', err))
      .finally(() => this.pending.delete(job));
    this.pending.add(job);
  }

  /** Waits (up to `ms`) for verbatim transcriptions still in flight. */
  async settle(ms = 60000) {
    if (!this.pending.size) return;
    await Promise.race([Promise.allSettled([...this.pending]), new Promise((r) => setTimeout(r, ms))]);
  }

  _merged(filter) {
    const acc = emptyAcc();
    for (const s of this.segments) if (filter(s)) mergeInto(acc, s.acc);
    return acc;
  }

  summaryFor(recordId) {
    return summarize(this._merged((s) => s.recordId === recordId));
  }

  summary() {
    return summarize(this._merged(() => true));
  }

  stop() {
    this.faceActive = false;
    this.voiceActive = false;
    clearInterval(this._faceTimer);
    this._faceTimer = null;
    if (this.audio) {
      clearInterval(this.audio.timer);
      this.audio.proc.onaudioprocess = null;
      this.audio.stream.getTracks().forEach((t) => t.stop());
      this.audio.ctx.close();
      this.audio = null;
    }
  }

  // ---- face ----------------------------------------------------------------

  async _ensureFace() {
    if (this.faceStatus === 'idle') {
      this.faceStatus = 'loading';
      try {
        const { FaceLandmarker, FilesetResolver } = await import(`${MEDIAPIPE}/vision_bundle.mjs`);
        const fileset = await FilesetResolver.forVisionTasks(`${MEDIAPIPE}/wasm`);
        const options = (delegate) => ({
          baseOptions: { modelAssetPath: FACE_MODEL, delegate },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
        this.landmarker = await FaceLandmarker.createFromOptions(fileset, options('GPU'))
          .catch(() => FaceLandmarker.createFromOptions(fileset, options('CPU')));
        this.faceStatus = 'ready';
      } catch (err) {
        console.warn('Face analysis unavailable:', err);
        this.faceStatus = 'failed';
        return;
      }
    }
    if (this.faceStatus === 'ready' && !this._faceTimer) {
      this._faceTimer = setInterval(() => this._faceTick(), FACE_MS);
    }
  }

  _faceTick() {
    const v = this.video;
    if (!this.faceActive || !v.srcObject || v.readyState < 2) return;
    let res;
    try {
      res = this.landmarker.detectForVideo(v, performance.now());
    } catch {
      return;
    }
    const seg = this.segment;
    seg.frames++;
    const shapes = res.faceBlendshapes?.[0]?.categories;
    if (!shapes) return;
    seg.faceFrames++;

    const b = Object.fromEntries(shapes.map((c) => [c.categoryName, c.score]));
    const avg = (l, r) => (b[l] + b[r]) / 2;

    // Head pose from the 4x4 column-major transform.
    const m = res.facialTransformationMatrixes?.[0]?.data;
    const yaw = m ? (Math.atan2(m[8], m[10]) * 180) / Math.PI : 0;
    const tilt = m ? (Math.asin(Math.max(-1, Math.min(1, -m[9]))) * 180) / Math.PI : 0;
    seg.yawSum += yaw;
    seg.yawSq += yaw * yaw;
    seg.tiltSum += tilt;
    seg.tiltSq += tilt * tilt;

    const gazeSide = Math.max(b.eyeLookOutLeft, b.eyeLookInLeft, b.eyeLookOutRight, b.eyeLookInRight);
    const gazeVert = Math.max(avg('eyeLookUpLeft', 'eyeLookUpRight'), avg('eyeLookDownLeft', 'eyeLookDownRight'));
    if (Math.abs(yaw) > 20 || Math.abs(tilt) > 20 || gazeSide > 0.6 || gazeVert > 0.6) seg.awayFrames++;

    if (avg('mouthSmileLeft', 'mouthSmileRight') > 0.4) seg.smileFrames++;
    if (avg('browDownLeft', 'browDownRight') > 0.4 || avg('mouthFrownLeft', 'mouthFrownRight') > 0.35 || avg('mouthPressLeft', 'mouthPressRight') > 0.5) {
      seg.tenseFrames++;
    }

    const closed = avg('eyeBlinkLeft', 'eyeBlinkRight') > 0.5;
    if (closed && this._blinkOpen) seg.blinks++;
    this._blinkOpen = !closed;
  }

  // ---- voice ---------------------------------------------------------------

  async _ensureAudio() {
    if (this.audio || this._audioPending || !navigator.mediaDevices?.getUserMedia) return;
    this._audioPending = true;
    try {
      // AGC off so the level reflects how loudly they actually speak.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      // Raw samples for the verbatim transcript. The processor only runs while
      // connected to the output, so route it through a muted gain node.
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const mute = ctx.createGain();
      mute.gain.value = 0;
      source.connect(proc);
      proc.connect(mute).connect(ctx.destination);
      proc.onaudioprocess = (e) => {
        if (this.voiceActive) this._pushPcm(e.inputBuffer.getChannelData(0), ctx.sampleRate);
      };
      ctx.resume();

      const buf = new Float32Array(analyser.fftSize);
      this.audio = { stream, ctx, analyser, proc, buf, noiseDb: -60, timer: setInterval(() => this._audioTick(), AUDIO_MS) };
    } catch (err) {
      console.warn('Voice analysis unavailable:', err);
    } finally {
      this._audioPending = false;
    }
  }

  /** Resamples to 16 kHz 16-bit and appends to the current answer's audio. */
  _pushPcm(input, rate) {
    if (this._pcmLen >= PCM_RATE * MAX_ANSWER_SEC) return;
    const step = rate / PCM_RATE;
    const out = new Int16Array(Math.ceil((input.length - this._pcmPos) / step));
    let n = 0;
    let t = this._pcmPos;
    for (; t < input.length; t += step) {
      const x = Math.max(-1, Math.min(1, input[Math.floor(t)]));
      out[n++] = x < 0 ? x * 0x8000 : x * 0x7fff;
    }
    this._pcmPos = t - input.length;
    this._pcm.push(out.subarray(0, n));
    this._pcmLen += n;
  }

  _audioTick() {
    const a = this.audio;
    if (!this.voiceActive) return;
    a.analyser.getFloatTimeDomainData(a.buf);
    let sq = 0;
    for (const x of a.buf) sq += x * x;
    const db = 10 * Math.log10(sq / a.buf.length + 1e-12);

    // Track the noise floor: fall fast, rise slowly.
    a.noiseDb = db < a.noiseDb ? db : a.noiseDb + 0.05;
    const voiced = db > Math.max(-58, a.noiseDb + 12);
    const seg = this.segment;

    if (voiced) {
      if (this._hadVoice) {
        if (this._silenceMs >= LONG_PAUSE_MS) {
          seg.pauses++;
          seg.longestPauseMs = Math.max(seg.longestPauseMs, this._silenceMs);
        } else {
          seg.speakingMs += this._silenceMs; // short gaps are part of normal speech
        }
      }
      seg.speakingMs += AUDIO_MS;
      this._silenceMs = 0;
      this._hadVoice = true;

      seg.voicedTicks++;
      seg.dbSum += db;
      const f0 = detectPitch(a.buf, a.ctx.sampleRate);
      if (f0) {
        const st = 12 * Math.log2(f0 / 100);
        seg.f0Count++;
        seg.stSum += st;
        seg.stSq += st * st;
      }
    } else if (this._hadVoice) {
      this._silenceMs += AUDIO_MS;
    }
  }
}

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function addFillers(into, text) {
  for (const m of text.toLowerCase().matchAll(FILLER_RE)) {
    const w = m[1].replace(/(.)\1+$/, '$1'); // "ummm" -> "um"
    into[w] = (into[w] ?? 0) + 1;
  }
}

/** 16 kHz mono 16-bit PCM chunks -> WAV blob. */
function encodeWav(chunks, length) {
  const view = new DataView(new ArrayBuffer(44 + length * 2));
  const str = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, PCM_RATE, true);
  view.setUint32(28, PCM_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, length * 2, true);
  let o = 44;
  for (const chunk of chunks) {
    for (const v of chunk) {
      view.setInt16(o, v, true);
      o += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}

/** Autocorrelation pitch estimate in Hz (75-400), or null if not clearly voiced. */
function detectPitch(buf, sampleRate) {
  const n = buf.length;
  const minLag = Math.floor(sampleRate / 400);
  const maxLag = Math.min(Math.floor(sampleRate / 75), n - 1);
  let energy = 0;
  for (let i = 0; i < n; i++) energy += buf[i] * buf[i];
  if (!energy) return null;

  const corr = new Float32Array(maxLag + 1);
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0;
    for (let i = 0; i < n - lag; i++) c += buf[i] * buf[i + lag];
    corr[lag] = (c / energy) * (n / (n - lag));
    if (corr[lag] > best) best = corr[lag];
  }
  if (best < 0.6) return null;
  // Take the shortest lag that is nearly as strong as the best, to avoid octave-down errors.
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (corr[lag] >= 0.9 * best && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) return sampleRate / lag;
  }
  return null;
}
