// Browser fixture for the real app: no devices, API keys, or provider calls.
// Run `node scripts/report-smoke-server.mjs`, then open localhost:3001/__report_smoke.
import { readFileSync } from 'node:fs';
import { createApp } from '../backend/server.js';

const app = createApp();
app.get('/__report_smoke', (_req, res) => {
  const html = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
  res.type('html').send(html.replace('src="js/app.js"', 'src="/__report_smoke_setup.js"'));
});
app.get('/__report_smoke_setup.js', (_req, res) => {
  res.type('js').send(`(${installFixture.toString()})()`);
});
app.listen(3001, '127.0.0.1', () => console.log('Report smoke fixture: http://localhost:3001/__report_smoke'));

async function installFixture() {
  const { api } = await import('/js/api.js');
  const { DeliveryTracker } = await import('/js/delivery.js');
  const evaluations = [], transcriptions = [];
  api.health = async () => ({ hasKey: true, transcriber: 'gemini' });
  api.interview = async ({ turn }) => ({
    text: turn.kind === 'candidate_questions' ? 'Thanks for your time.' : 'Tell me about a project you led.',
    action: turn.kind === 'candidate_questions' ? 'END' : 'NEXT',
  });
  api.evaluate = (payload, { signal }) => new Promise((resolve, reject) => evaluations.push({ payload, signal, resolve, reject }));
  api.transcribe = (_audio, { signal }) => new Promise((resolve) => transcriptions.push({ signal, resolve }));
  DeliveryTracker.prototype.start = async function () {
    this.t0 = performance.now(); this.usedMic = true;
    return { camera: false, mic: true, errors: [] };
  };
  DeliveryTracker.prototype.endSegment = function () {
    if (!this.segment) return null;
    const part = {
      key: this.segment.key, words: 20, fillers: { count: 1, byWord: { um: 1 } }, fillerSource: 'dictation',
      audio: { spoke: true, span: 10, soundTime: 9, spokenWords: 20, wpm: 120, articulationWpm: 133,
        latency: 1, pauseTime: 1, pauses: 1, longPauses: 0, pitchFrames: 20, pitchHz: 180,
        pitchVarSt: 2, loudFrames: 20, loudVarDb: 4 },
    };
    this.segment = null;
    this._transcribe(part, new Blob(['fixture'], { type: 'audio/wav' }));
    return part;
  };
  DeliveryTracker.prototype.sessionSummary = () => ({ duration: 10, marks: [{ key: 'b1', t: 0 }], tracks: {
    smile: [0, 1, 2, 3].map((t) => ({ t, v: 40 + t * 5 })),
    loudness: [0, 1, 2, 3].map((t) => ({ t, v: -t * 2 })),
    pitch: [0, 1, 2, 3].map((t) => ({ t, v: t - 2 })),
  } });
  const controls = document.createElement('section');
  controls.className = 'card'; controls.setAttribute('aria-label', 'Smoke test controls');
  document.querySelector('main').prepend(controls);
  const add = (label, action) => {
    const button = document.createElement('button'); button.textContent = label; button.className = 'btn';
    button.onclick = action; controls.append(button);
  };
  const finish = (job) => job?.resolve({ ok: true, report: {
    overall: { score: 4, summary: 'Fixture feedback complete.' },
    rounds: { behavioral: { score: 4, summary: 'Strong examples.' } },
    questions: job.payload.records.map((r) => ({ id: r.id, scores: { star: 4, clarity: 4 }, improve: 'Quantify the outcome.' })),
    topPractice: ['Practice concise examples.'],
  } });
  add('Complete AI', () => finish(evaluations.at(-1)));
  add('Complete older AI', () => finish(evaluations[0]));
  add('Fail AI', () => evaluations.at(-1)?.reject(Object.assign(new Error('Fixture request deadline exceeded.'), { code: 'DEADLINE_EXCEEDED' })));
  add('Complete transcription', () => {
    for (const job of transcriptions) job.resolve({ text: `Um uh ${Array(18).fill('word').join(' ')}` });
  });
  // Load the actual application only after replacing its service/device adapters.
  await import('/js/app.js');
  document.querySelector('[name="voice"]').checked = false;
  document.querySelector('[name="autoHints"]').checked = false;
  document.querySelector('[name="rounds"][value="behavioral"]').checked = true;
  document.querySelector('[name="length"][value="short"]').checked = true;
}
