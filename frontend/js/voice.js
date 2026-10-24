// Voice for the interview: browser speech recognition (your answers) and speech
// synthesis (the interviewer). Both are optional; typing always works.

const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

export const voiceSupport = {
  dictation: Boolean(Recognition),
  speech: typeof globalThis.speechSynthesis !== 'undefined' && typeof globalThis.SpeechSynthesisUtterance !== 'undefined',
};

const RECOGNITION_ERRORS = {
  'not-allowed': 'Microphone permission was denied, so speech input is off. Allow the microphone for this site, or type your answers.',
  'service-not-allowed': 'This browser does not allow speech input here. Use Google Chrome or Microsoft Edge, or type your answers.',
  'audio-capture': 'No microphone was found for speech input. Connect one, or type your answers.',
  network: 'Speech input could not reach the recognition service. It needs Google Chrome or Edge (not Chromium) and an internet connection. You can type your answers.',
  'language-not-supported': 'Speech input does not support this language. You can type your answers.',
};

/** Continuous dictation that restarts itself when the browser ends a session on silence. */
export class Dictation {
  constructor({ onText = () => {}, onInterim = () => {}, onState = () => {}, onError = () => {}, lang = 'en-US' } = {}) {
    Object.assign(this, { onText, onInterim, onState, onError, lang });
    this.want = false;
    this.rec = null;
    this.restarts = [];
    this.waiters = [];
  }

  get listening() {
    return this.want;
  }

  start() {
    if (!Recognition) {
      this.onError('Speech input is not available in this browser. Use Google Chrome or Edge, or type your answers.');
      return false;
    }
    if (this.want) return true;
    this.want = true;
    this.restarts = [];
    this._spawn();
    this.onState(true);
    return true;
  }

  /** Stops listening without waiting for the last words. */
  stop() {
    this.want = false;
    try {
      this.rec?.stop();
    } catch {
      // already stopped
    }
    if (!this.rec) this._ended();
  }

  /** Stops listening and waits (up to `ms`) for the final transcript of the last words. */
  stopAndFlush(ms = 1500) {
    if (!this.rec) {
      this.stop();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
      this.stop();
    });
  }

  _spawn() {
    const rec = new Recognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = this.lang;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? '';
        if (r.isFinal) {
          if (text.trim()) this.onText(text.trim());
        } else {
          interim += text;
        }
      }
      this.onInterim(interim.trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      this.want = false;
      this.onError(RECOGNITION_ERRORS[e.error] ?? `Speech input stopped (${e.error}). You can type your answers.`);
    };
    rec.onend = () => {
      if (this.rec === rec) this.rec = null;
      this.onInterim('');
      if (!this.want) return this._ended();
      // Chrome ends sessions after silence; restart, but not in a tight failure loop.
      const now = Date.now();
      this.restarts = this.restarts.filter((t) => now - t < 5000);
      this.restarts.push(now);
      if (this.restarts.length > 6) {
        this.want = false;
        this.onError('Speech input keeps stopping. Check your microphone and connection, or type your answers.');
        return this._ended();
      }
      setTimeout(() => {
        if (this.want && !this.rec) this._spawn();
      }, 120);
    };
    try {
      rec.start();
      this.rec = rec;
    } catch (err) {
      this.want = false;
      this.onError(`Speech input could not start: ${err.message}`);
      this._ended();
    }
  }

  _ended() {
    this.onState(false);
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((w) => w());
  }
}

/** Reads interviewer replies aloud. speak() resolves when finished or cancelled. */
export class Speaker {
  constructor() {
    this.enabled = false;
    this.voice = null;
    this.current = null;
    if (voiceSupport.speech) {
      const pick = () => {
        this.voice = chooseVoice(speechSynthesis.getVoices());
      };
      pick();
      speechSynthesis.addEventListener?.('voiceschanged', pick);
    }
  }

  get available() {
    return voiceSupport.speech;
  }

  speak(text) {
    this.cancel();
    if (!this.enabled || !voiceSupport.speech || !text?.trim()) return Promise.resolve(false);
    const chunks = splitForSpeech(text);
    return new Promise((resolve) => {
      const job = { cancelled: false, done: null };
      this.current = job;
      let timer = null;
      const finish = (spoken) => {
        if (job.done) return;
        job.done = true;
        clearTimeout(timer);
        if (this.current === job) this.current = null;
        resolve(spoken);
      };
      job.finish = finish;
      // With no installed voices nothing ever starts; don't keep the candidate waiting.
      timer = setTimeout(() => finish(false), 2500);
      let started = false;
      const words = text.split(/\s+/).length;
      chunks.forEach((chunk, i) => {
        const u = new SpeechSynthesisUtterance(chunk);
        if (this.voice) u.voice = this.voice;
        u.lang = this.voice?.lang ?? 'en-US';
        u.rate = 1.02;
        u.onstart = () => {
          if (started) return;
          started = true;
          // Some browsers never fire 'end'; give up after a generous estimate.
          clearTimeout(timer);
          timer = setTimeout(() => finish(true), (words / 2.2 + 4) * 1000);
        };
        if (i === chunks.length - 1) {
          u.onend = () => finish(true);
        }
        u.onerror = (e) => {
          if (e.error !== 'interrupted' && e.error !== 'canceled') finish(false);
        };
        speechSynthesis.speak(u);
      });
    });
  }

  get speaking() {
    return Boolean(this.current);
  }

  cancel() {
    const job = this.current;
    this.current = null;
    if (voiceSupport.speech) speechSynthesis.cancel();
    job?.finish?.(false);
  }
}

function chooseVoice(voices) {
  const english = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  const prefer = [/Google US English/i, /Natural/i, /Aria|Jenny|Guy|Samantha|Ava|Daniel/i, /en[-_]US/i];
  for (const re of prefer) {
    const v = english.find((x) => re.test(x.name) || re.test(x.lang));
    if (v) return v;
  }
  return english[0] ?? voices[0] ?? null;
}

/** Sentence-sized chunks; Chrome cuts off single utterances longer than ~15 s. */
export function splitForSpeech(text) {
  const clean = String(text).replace(/```[\s\S]*?```/g, ' (see the code on screen) ').replace(/[`*_#]/g, '').replace(/\s+/g, ' ').trim();
  const sentences = clean.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [clean];
  const chunks = [];
  for (const s of sentences.map((x) => x.trim()).filter(Boolean)) {
    const last = chunks.at(-1);
    if (last && last.length + s.length < 180) chunks[chunks.length - 1] = `${last} ${s}`;
    else chunks.push(s);
  }
  return chunks;
}
