// Live delivery tracking during the interview (MACH-style): the webcam feeds a face
// worker (smiles, nods, head direction) and the microphone feeds prosody analysis
// (pauses, pitch, loudness). Everything runs on this device; only the derived
// numbers are sent to the server with the transcript for feedback.
import {
  summarizeAudio, summarizeFace, headBaseline, detectHeadGestures, countFillers, countWords, rmsDb, detectPitch,
} from './delivery-metrics.js';

const FACE_FPS = 15;
const AUDIO_MS = 50;
const PITCH_FLOOR_DB = -60;

const CAMERA_ERRORS = {
  NotAllowedError: 'Camera permission was denied, so smile and head-movement feedback is off.',
  NotFoundError: 'No camera was found, so smile and head-movement feedback is off.',
  NotReadableError: 'The camera is in use by another app, so smile and head-movement feedback is off.',
};
const MIC_ERRORS = {
  NotAllowedError: 'Microphone permission was denied, so pace, pause, and pitch feedback is off.',
  NotFoundError: 'No microphone was found, so pace, pause, and pitch feedback is off.',
  NotReadableError: 'The microphone is in use by another app, so pace, pause, and pitch feedback is off.',
};

export class DeliveryTracker {
  /**
   * @param {{ video: HTMLVideoElement, onTick?: (s: {db: number|null, face: boolean}) => void }} opts
   */
  constructor({ video, onTick = () => {} }) {
    this.video = video;
    this.onTick = onTick;
    this.epoch = 0;
    this.reset();
  }

  reset() {
    this.stop();
    this.t0 = null;
    this.faceFrames = []; // { t, face, phase: 'answer' | 'listen' }
    this.smileBuckets = new Map(); // whole second → { sum, n }
    this.marks = []; // { key, t } first time each question was answered
    this.segment = null;
    this.usedCamera = false;
    this.usedMic = false;
  }

  get running() {
    return Boolean(this.videoStream || this.audioStream);
  }

  now(at = performance.now()) {
    return (at - this.t0) / 1000;
  }

  /** Opens the camera and microphone. Resolves to { camera, mic, errors }. */
  async start() {
    if (this.running || this.startingPromise) return this.startingPromise ?? { camera: Boolean(this.worker), mic: Boolean(this.audioCtx), errors: [] };
    this.startingPromise = this._start().finally(() => {
      this.startingPromise = null;
    });
    return this.startingPromise;
  }

  async _start() {
    const epoch = ++this.epoch;
    const state = { camera: false, mic: false, errors: [] };
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      state.errors.push('Delivery coaching needs localhost or HTTPS and a browser with camera and microphone support.');
      return state;
    }
    this.t0 ??= performance.now();

    let videoStream = null;
    let audioStream = null;
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } },
      });
    } catch (e) {
      state.errors.push(CAMERA_ERRORS[e.name] ?? `Camera unavailable (${e.message}), so smile and head-movement feedback is off.`);
    }
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        // Raw levels are needed for loudness and pauses; echo cancellation keeps the interviewer's voice out.
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      });
    } catch (e) {
      state.errors.push(MIC_ERRORS[e.name] ?? `Microphone unavailable (${e.message}), so pace, pause, and pitch feedback is off.`);
    }
    if (epoch !== this.epoch) {
      [videoStream, audioStream].forEach((s) => s?.getTracks().forEach((t) => t.stop()));
      return { camera: false, mic: false, errors: [] };
    }

    if (videoStream) {
      this.videoStream = videoStream;
      this.video.srcObject = videoStream;
      await this.video.play().catch(() => {});
      try {
        await this._loadWorker(epoch);
        if (epoch !== this.epoch) return state;
        state.camera = true;
        this.usedCamera = true;
        this._startFaceLoop();
      } catch (e) {
        state.errors.push(e.message);
        videoStream.getTracks().forEach((t) => t.stop());
        this.videoStream = null;
        this.video.srcObject = null;
        this.worker?.terminate();
        this.worker = null;
      }
    }

    if (audioStream && epoch === this.epoch) {
      try {
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(audioStream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        await ctx.resume().catch(() => {});
        this.audioStream = audioStream;
        this.audioCtx = ctx;
        this.analyser = analyser;
        this.audioBuf = new Float32Array(analyser.fftSize);
        state.mic = true;
        this.usedMic = true;
        this._startAudioLoop();
      } catch (e) {
        audioStream.getTracks().forEach((t) => t.stop());
        state.errors.push(`Audio analysis could not start (${e.message}).`);
      }
    } else {
      audioStream?.getTracks().forEach((t) => t.stop());
    }
    return state;
  }

  _loadWorker(epoch) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./delivery-worker.js', import.meta.url));
      this.worker = worker;
      let loading = true;
      const timeout = setTimeout(() => reject(new Error('Face tracking took too long to load, so smile and head-movement feedback is off.')), 45000);
      worker.onmessage = ({ data }) => {
        if (worker !== this.worker) return;
        if (data.type === 'ready') {
          loading = false;
          clearTimeout(timeout);
          resolve();
        } else if (data.type === 'error') {
          clearTimeout(timeout);
          if (loading) reject(new Error(data.message));
          else this._stopFace();
        } else if (data.type === 'sample') {
          if (this.flight?.timestamp === data.timestamp) this._clearFlight();
          if (epoch === this.epoch) this._addFace(data.sample, data.timestamp);
        }
      };
      worker.onerror = (event) => {
        if (worker !== this.worker) return;
        event.preventDefault();
        clearTimeout(timeout);
        if (loading) reject(new Error('Face tracking failed to start, so smile and head-movement feedback is off.'));
        else this._stopFace();
      };
      worker.postMessage({ type: 'init' });
    });
  }

  _startFaceLoop() {
    clearInterval(this.faceLoop);
    this.lastVideoTime = -1;
    this.faceLoop = setInterval(() => this._capture(), 1000 / FACE_FPS);
  }

  async _capture() {
    const video = this.video;
    if (this.flight || !this.worker || video.readyState < 2 || video.currentTime === this.lastVideoTime || document.hidden) return;
    const timestamp = performance.now();
    const flight = { timestamp };
    const worker = this.worker;
    this.flight = flight;
    this.lastVideoTime = video.currentTime;
    try {
      const scale = Math.min(1, 640 / video.videoWidth);
      const bitmap = await createImageBitmap(video, {
        resizeWidth: Math.max(1, Math.round(video.videoWidth * scale)),
        resizeHeight: Math.max(1, Math.round(video.videoHeight * scale)),
      });
      if (worker !== this.worker) {
        bitmap.close();
        if (this.flight === flight) this._clearFlight();
        return;
      }
      worker.postMessage({ type: 'frame', bitmap, timestamp }, [bitmap]);
      flight.timeout = setTimeout(() => {
        if (this.flight === flight) this._clearFlight();
      }, 5000);
    } catch {
      if (this.flight === flight) this._clearFlight();
    }
  }

  _clearFlight() {
    clearTimeout(this.flight?.timeout);
    this.flight = null;
  }

  _addFace(sample, timestamp) {
    const t = this.now(timestamp);
    this.faceFrames.push({ t, face: sample ?? null, phase: this.segment ? 'answer' : 'listen' });
    if (Number.isFinite(sample?.smile)) {
      const sec = Math.floor(t);
      const b = this.smileBuckets.get(sec) ?? { sum: 0, n: 0 };
      b.sum += sample.smile;
      b.n += 1;
      this.smileBuckets.set(sec, b);
    }
    this.lastFace = Boolean(sample);
  }

  _startAudioLoop() {
    clearInterval(this.audioLoop);
    let ticks = 0;
    this.audioLoop = setInterval(() => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(this.audioBuf);
      const db = rmsDb(this.audioBuf);
      if (this.segment) {
        const f0 = db > PITCH_FLOOR_DB ? detectPitch(this.audioBuf, this.audioCtx.sampleRate) : null;
        this.segment.audio.push({ t: this.now(), db, f0 });
      }
      this.lastDb = db;
      if (++ticks % 2 === 0) this.onTick({ db, face: this.worker ? Boolean(this.lastFace) : null });
    }, AUDIO_MS);
  }

  // ---- answer segments -----------------------------------------------------

  /** Starts measuring one answer. `key` is the question id (e.g. "b2"), or null. */
  beginSegment(key = null) {
    if (this.t0 == null) return;
    const start = this.now();
    this.segment = { key, start, audio: [], typing: [] };
    if (key && !this.marks.some((m) => m.key === key)) this.marks.push({ key, t: start });
  }

  /** Records code-editor activity (for the think-aloud check on coding questions). */
  noteTyping() {
    const seg = this.segment;
    if (!seg || this.t0 == null) return;
    const t = this.now();
    if (!seg.typing.length || t - seg.typing.at(-1) >= 0.25) seg.typing.push(t);
  }

  /**
   * Ends the current answer and returns its measurements, or null if none was running.
   * `thinkAloud` adds the silent-stretch check (spoken answers to coding questions).
   */
  endSegment({ text = '', spokenText = '', thinkAloud = false } = {}) {
    const seg = this.segment;
    this.segment = null;
    if (!seg) return null;
    const face = this.faceFrames.filter((f) => f.t >= seg.start && f.phase === 'answer');
    return {
      key: seg.key,
      audio: this.usedMic && seg.audio.length >= 20
        ? summarizeAudio(seg.audio, { spokenText, typing: seg.typing, thinkAloud })
        : null,
      face: this.usedCamera && face.length ? summarizeFace(face, headBaseline(this.faceFrames)) : null,
      fillers: countFillers(text),
      words: countWords(text),
    };
  }

  cancelSegment() {
    this.segment = null;
  }

  /** Whole-interview data: smile timeline, question marks, and nodding while listening. */
  sessionSummary() {
    if (this.t0 == null) return null;
    const listening = this.faceFrames.map((f) => (f.phase === 'listen' ? f : { t: f.t, face: null }));
    const g = detectHeadGestures(listening);
    let listenSeconds = 0;
    for (let i = 1; i < listening.length; i++) {
      const dt = listening[i].t - listening[i - 1].t;
      if (listening[i].face && listening[i - 1].face && dt <= 0.3) listenSeconds += dt;
    }
    const timeline = [...this.smileBuckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, b]) => ({ t, smile: Math.round(b.sum / b.n) }));
    return {
      camera: this.usedCamera,
      mic: this.usedMic,
      duration: this.faceFrames.length ? Math.ceil(this.faceFrames.at(-1).t) : Math.ceil(this.now()),
      timeline,
      marks: [...this.marks],
      listeningSeconds: Math.round(listenSeconds),
      listeningNods: this.usedCamera ? g.nods.length : null,
      listeningShakes: this.usedCamera ? g.shakes.length : null,
    };
  }

  // ---- teardown ------------------------------------------------------------

  _stopFace() {
    clearInterval(this.faceLoop);
    this.faceLoop = null;
    this._clearFlight();
    this.worker?.terminate();
    this.worker = null;
    this.videoStream?.getTracks().forEach((t) => t.stop());
    this.videoStream = null;
    if (this.video) this.video.srcObject = null;
    this.lastFace = false;
  }

  /** Releases the camera and microphone. Collected data is kept until reset(). */
  stop() {
    this.epoch++;
    this.segment = null;
    this._stopFace();
    clearInterval(this.audioLoop);
    this.audioLoop = null;
    this.audioStream?.getTracks().forEach((t) => t.stop());
    this.audioStream = null;
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.analyser = null;
  }
}
