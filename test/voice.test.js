import test from 'node:test';
import assert from 'node:assert/strict';

let moduleId = 0;
function globalValue(t, key, value) {
  const old = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => old ? Object.defineProperty(globalThis, key, old) : delete globalThis[key]);
}
async function browser(t, { supported = true } = {}) {
  const recognizers = [];
  const utterances = [];
  const timers = new Map();
  let timerId = 0;
  globalValue(t, 'setTimeout', (fn) => { timers.set(++timerId, fn); return timerId; });
  globalValue(t, 'clearTimeout', (id) => timers.delete(id));
  class Recognition {
    constructor() { recognizers.push(this); }
    start() {}
    stop() { this.onend(); }
  }
  globalValue(t, 'SpeechRecognition', supported ? Recognition : undefined);
  globalValue(t, 'webkitSpeechRecognition', undefined);
  globalValue(t, 'SpeechSynthesisUtterance', supported ? class { constructor(text) { this.text = text; } } : undefined);
  const preferred = { name: 'Google US English', lang: 'en-US' };
  globalValue(t, 'speechSynthesis', supported ? { getVoices: () => [{ name: 'French', lang: 'fr-FR' }, preferred], addEventListener() {}, speak: (u) => utterances.push(u), cancel() {} } : undefined);
  // Support is detected at module load, so each test imports under its own browser environment.
  const module = await import(`../frontend/js/voice.js?test=${++moduleId}`);
  return { ...module, recognizers, utterances, timers, preferred, runTimer: () => {
    const [id, fn] = timers.entries().next().value;
    timers.delete(id);
    fn();
  } };
}

test('unsupported speech APIs fail gracefully and leave typed interviews available', async (t) => {
  const { Dictation, Speaker, voiceSupport } = await browser(t, { supported: false });
  const errors = [];
  assert.deepEqual(voiceSupport, { dictation: false, speech: false });
  assert.equal(new Dictation({ onError: (text) => errors.push(text) }).start(), false);
  assert.match(errors[0], /type your answers/);
  const speaker = new Speaker();
  speaker.enabled = true;
  assert.equal(await speaker.speak('Hello.'), false);
});

test('dictation separates final from interim text and flushes before submission', async (t) => {
  const { Dictation, recognizers, timers } = await browser(t);
  const final = [];
  const interim = [];
  const dictation = new Dictation({ onText: (text) => final.push(text), onInterim: (text) => interim.push(text) });
  assert.equal(dictation.start(), true);
  dictation.start(); // repeated clicks must not create duplicate recognizers
  assert.equal(recognizers.length, 1);
  recognizers[0].onresult({ resultIndex: 1, results: [
    Object.assign([{ transcript: 'Already processed.' }], { isFinal: true }),
    Object.assign([{ transcript: ' I shipped it. ' }], { isFinal: true }),
    Object.assign([{ transcript: 'We reduced' }], { isFinal: false }),
  ] });
  assert.deepEqual(final, ['I shipped it.']);
  assert.equal(interim.at(-1), 'We reduced');
  await dictation.stopAndFlush();
  assert.equal(dictation.listening, false);
  assert.equal(timers.size, 0);
  assert.equal(interim.at(-1), '');
});

test('microphone denial stops dictation with a useful fallback message', async (t) => {
  const { Dictation, recognizers, timers } = await browser(t);
  const errors = [];
  const dictation = new Dictation({ onError: (error) => errors.push(error) });
  dictation.start();
  recognizers[0].onerror({ error: 'not-allowed' });
  recognizers[0].onend();
  assert.equal(dictation.listening, false);
  assert.match(errors[0], /permission was denied/);
  assert.match(errors[0], /type your answers/);
  assert.equal(timers.size, 0);
});

test('dictation restarts after silence but breaks repeated restart failures', async (t) => {
  const { Dictation, recognizers, runTimer, timers } = await browser(t);
  t.mock.method(Date, 'now', () => 1000);
  const errors = [];
  const dictation = new Dictation({ onError: (error) => errors.push(error) });
  dictation.start();
  for (let i = 0; i < 6; i++) {
    recognizers.at(-1).onerror({ error: 'no-speech' });
    recognizers.at(-1).onend();
    assert.equal(dictation.listening, true);
    runTimer();
  }
  recognizers.at(-1).onend();
  assert.equal(dictation.listening, false);
  assert.match(errors[0], /keeps stopping/);
  assert.equal(timers.size, 0);
});

test('speech chunks hide code and markdown while preserving sentence order', async (t) => {
  const { splitForSpeech } = await browser(t);
  const text = 'Read **this**. ```js\nconsole.log("private code");\n``` Then explain `complexity`.';
  const spoken = splitForSpeech(text).join(' ');
  assert.match(spoken, /Read this\./);
  assert.match(spoken, /see the code on screen/);
  assert.doesNotMatch(spoken, /console\.log|[`*]/);
  assert.deepEqual(splitForSpeech('   '), []);
});

test('speaker selects an English voice, completes playback, and cancels cleanly', async (t) => {
  const { Speaker, utterances, preferred, timers } = await browser(t);
  const speaker = new Speaker();
  speaker.enabled = true;
  const speaking = speaker.speak('Tell me about a time you took ownership.');
  assert.equal(speaker.speaking, true);
  assert.equal(utterances[0].voice, preferred);
  utterances[0].onstart();
  utterances.at(-1).onend();
  assert.equal(await speaking, true);
  assert.equal(speaker.speaking, false);
  const cancelled = speaker.speak('A second question.');
  speaker.cancel();
  assert.equal(await cancelled, false);
  assert.equal(speaker.speaking, false);
  assert.equal(timers.size, 0);
});

test('speaker resolves if playback never starts or the browser reports an error', async (t) => {
  const { Speaker, runTimer, utterances, timers } = await browser(t);
  const speaker = new Speaker();
  speaker.enabled = true;
  const blocked = speaker.speak('Hello.');
  runTimer();
  assert.equal(await blocked, false);
  const failed = speaker.speak('Try again.');
  utterances.at(-1).onerror({ error: 'synthesis-failed' });
  assert.equal(await failed, false);
  assert.equal(timers.size, 0);
});
