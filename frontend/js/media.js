// Webcam self-view and microphone dictation for the interview composer.
// Dictation uses the browser's Web Speech API (Chrome, Edge, Safari). Where it
// is unavailable the candidate can still type.

const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;

export class Camera {
  constructor(video) {
    this.video = video;
    this.stream = null;
  }

  get on() {
    return Boolean(this.stream);
  }

  async start() {
    if (this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot access a webcam.');
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    this.video.srcObject = this.stream;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}

export class Dictation {
  static supported = Boolean(SpeechRecognition);

  /**
   * @param {HTMLTextAreaElement} textarea  where the transcript is written
   * @param {(state: { listening: boolean, error: string }) => void} onState
   */
  constructor(textarea, onState) {
    this.textarea = textarea;
    this.onState = onState;
    this.wanted = false; // the candidate turned the mic on
    this.paused = false; // the app paused it (e.g. while the interviewer replies)
    this.running = false;
    this.base = ''; // textarea text that is already final
    this.error = '';
    this.heard = []; // final chunks since the last takeHeard(), for delivery analysis

    if (!Dictation.supported) return;
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';

    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          this.base = join(this.base, chunk);
          this.heard.push({ text: chunk, confidence: e.results[i][0].confidence });
        }
        else interim += chunk;
      }
      this.textarea.value = join(this.base, interim);
      this.textarea.scrollTop = this.textarea.scrollHeight;
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      this.wanted = false;
      this.error = e.error === 'not-allowed' || e.error === 'service-not-allowed'
        ? 'Microphone access was blocked. Allow it in your browser to dictate.'
        : `Speech recognition error: ${e.error}`;
      this._emit();
    };
    rec.onend = () => {
      this.running = false;
      // Browsers end recognition after a stretch of silence; keep going while wanted.
      if (this.wanted && !this.paused) this._start();
      else this._emit();
    };
    this.rec = rec;

    // Typed edits become the new base so dictation appends after them.
    textarea.addEventListener('input', () => {
      this.base = textarea.value;
    });
  }

  /** Returns and clears what was dictated for the current answer. */
  takeHeard() {
    const heard = this.heard;
    this.heard = [];
    return heard;
  }

  get listening() {
    return this.wanted && !this.paused;
  }

  toggle() {
    if (this.wanted) this.stop();
    else this.start();
  }

  start() {
    if (!this.rec) return;
    this.wanted = true;
    this.error = '';
    this.base = this.textarea.value;
    if (!this.paused) this._start();
    this._emit();
  }

  stop() {
    if (!this.rec) return;
    this.wanted = false;
    this._halt();
    this._emit();
  }

  /** Pause or resume without changing whether the candidate wants the mic on. */
  setPaused(paused) {
    if (!this.rec || paused === this.paused) return;
    this.paused = paused;
    if (paused) this._halt(true);
    else if (this.wanted) {
      this.base = this.textarea.value;
      this._start();
    }
    this._emit();
  }

  _start() {
    if (this.running) return;
    try {
      this.rec.start();
      this.running = true;
    } catch {
      // already started
    }
  }

  // stop() keeps words still being recognized; abort() drops them.
  _halt(discard = false) {
    if (!this.running) return;
    if (discard) this.rec.abort();
    else this.rec.stop();
  }

  _emit() {
    this.onState({ listening: this.listening, error: this.error });
  }
}

function join(a, b) {
  b = b.trim();
  if (!b) return a;
  if (!a.trim()) return b;
  return /\s$/.test(a) ? a + b : `${a} ${b}`;
}
