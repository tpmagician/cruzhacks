// Offline synthetic CPU benchmark. No devices, network requests, or model calls.
// An optional module path lets the same fixtures measure a previous revision.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { renderReport } from '../frontend/js/report.js';

const metrics = await import(process.argv[2]
  ? pathToFileURL(path.resolve(process.argv[2])).href
  : '../frontend/js/delivery-metrics.js');
const { summarizeAudio, voiceTracks, detectPitch } = metrics;

function measure(name, work, extra = {}) {
  for (let i = 0; i < 2; i++) work();
  const times = Array.from({ length: 7 }, () => {
    const start = performance.now();
    work();
    return performance.now() - start;
  }).sort((a, b) => a - b);
  console.log(JSON.stringify({ name, ...extra, medianMs: +times[3].toFixed(2) }));
}

console.log(JSON.stringify({ runtime: process.version, samples: 7, warmups: 2 }));
for (const seconds of [60, 300, 1800]) {
  // Two-second phrases separated by one-second pauses (20 Hz audio analysis).
  const frames = Array.from({ length: seconds * 20 }, (_, i) => ({
    t: i / 20,
    db: i % 60 < 40 ? -25 : -70,
    f0: i % 60 < 40 ? 180 : null,
  }));
  measure('answerSummary', () => summarizeAudio(frames), { seconds, frames: frames.length });
  measure('sessionVoiceTracks', () => voiceTracks(frames), { seconds, frames: frames.length });
  const delivery = { duration: seconds, tracks: voiceTracks(frames), marks: [] };
  const records = Array.from({ length: 16 }, (_, i) => ({
    id: `b${i + 1}`, round: 'behavioral', question: 'Tell me about a project.',
    turns: [{ speaker: 'interviewer', text: 'Question' }, { speaker: 'candidate', text: 'I shipped a release.' }],
    deliveries: [],
  }));
  measure('reportHtml', () => renderReport({ innerHTML: '' }, { answeredRecords: () => records }, { ok: false }, delivery), { seconds });
}
const tone = Float32Array.from({ length: 2048 }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 180 * i / 48000));
measure('pitchFrame', () => detectPitch(tone, 48000), { samples: tone.length, sampleRate: 48000 });
