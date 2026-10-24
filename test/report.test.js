import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReport, updateReportAI, updateReportDelivery } from '../frontend/js/report.js';
import { voiceTracks } from '../frontend/js/delivery-metrics.js';

const record = { id: 'b1', round: 'behavioral', question: 'Tell me about a project.', turns: [{ speaker: 'interviewer', text: 'Question' }, { speaker: 'candidate', text: 'I shipped it.' }], deliveries: [] };
function render(delivery, result = { ok: false }, records = [record]) {
  const el = { innerHTML: '' };
  renderReport(el, { answeredRecords: () => records }, result, delivery);
  return el.innerHTML;
}
const track = (times, v = 0) => times.map((t) => ({ t, v }));
const lines = (html) => [...html.matchAll(/<polyline class="tl-line" points="([^"]+)"/g)].map((m) => m[1].split(' ').map((point) => point.split(',').map(Number)));

test('all tracks and question markers share the same time axis', () => {
  const html = render({ duration: 10, marks: [{ key: 'b1', t: 2 }], tracks: { smile: track([0, 1, 2], 40), loudness: track([0, 1, 2], -10), pitch: track([0, 1, 2], 3) } });
  assert.match(html, /aria-label="Smile, Loudness, Pitch across the interview"/);
  const paths = lines(html);
  assert.equal(paths.length, 3);
  assert.deepEqual(paths[0].map(([x]) => x), paths[1].map(([x]) => x));
  assert.deepEqual(paths[1].map(([x]) => x), paths[2].map(([x]) => x));
  const markerX = Number(html.match(/class="tl-mark" x1="([^"]+)"/)[1]);
  assert.equal(markerX, paths[0][2][0]);
  assert.match(html, />B1</);
});

test('gaps over two seconds break lines instead of implying continuous capture', () => {
  const html = render({ duration: 20, tracks: { loudness: track([0, 1, 4, 5, 9], -6) } });
  assert.equal(lines(html).length, 2);
  assert.equal((html.match(/class="tl-dot"/g) ?? []).length, 1);
  assert.ok(lines(html).every((points) => points.length === 2));
});

test('two-second gaps stay connected and sparse lanes are withheld independently', () => {
  const html = render({ tracks: { smile: track([0, 2, 4], 40), loudness: track([0, 1], -6), pitch: [] } });
  assert.equal(lines(html).length, 1);
  assert.match(html, /aria-label="Smile across the interview"/);
  assert.doesNotMatch(html, /class="tl-lane"[^>]*>Loudness/);
  assert.doesNotMatch(render({ tracks: { smile: track([0, 1]) } }), /class="timeline"/);
});

test('unvoiced audio yields a loudness lane without an invented pitch lane', () => {
  const tracks = voiceTracks([0, 1, 2].map((t) => ({ t, db: -40, f0: null })));
  const html = render({ tracks });
  assert.match(html, /aria-label="Loudness across the interview"/);
  assert.doesNotMatch(html, /class="tl-lane"[^>]*>Pitch/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test('plot values outside display ranges are clamped to lane edges', () => {
  const html = render({ tracks: { pitch: [{ t: 0, v: -100 }, { t: 1, v: 0 }, { t: 2, v: 100 }] } });
  const [[low, middle, high]] = lines(html);
  assert.ok(low[1] > middle[1] && middle[1] > high[1]);
  assert.equal(low[1] - high[1], 64);
});

test('failed evaluation preserves the transcript and available delivery tracks', () => {
  const html = render({ tracks: { loudness: track([0, 1, 2], -6) } }, { ok: false, message: 'Invalid evaluation.' });
  assert.match(html, /unable to score this interview: Invalid evaluation/);
  assert.match(html, /I shipped it\./);
  assert.match(html, /class="timeline"/);
});

test('model feedback, candidate text, code, and marker labels are escaped', () => {
  const attack = '<img src=x onerror=alert(1)>';
  const html = render({ marks: [{ key: attack, t: 0 }], tracks: { smile: track([0, 1, 2], 40) } }, {
    ok: true, report: { questions: [{ id: 'b1', improve: attack, strongerAnswer: attack }], topPractice: [attack] },
  }, [{ ...record, question: attack, code: attack, turns: [record.turns[0], { speaker: 'candidate', text: attack }] }]);
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('pending AI renders local delivery and transcript without false failure scores', () => {
  const part = { words: 12, fillers: { count: 1 }, fillerSource: 'dictation', transcriptionStatus: 'pending' };
  const html = render({ tracks: { smile: track([0, 1, 2], 40) } }, { pending: true }, [{ ...record, deliveries: [part] }]);
  assert.match(html, /class="timeline"/);
  assert.match(html, /I shipped it/);
  assert.match(html, /Transcribing 1 answer/);
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, /unable to score|Unable to score/);
});

test('AI and transcription updates write only owned slots, preserving charts and expanded answers', () => {
  const slot = (dataset = {}) => ({ dataset, innerHTML: '', attributes: {}, setAttribute(k, v) { this.attributes[k] = v; } });
  const overview = slot(), coaching = slot(), question = slot({ aiQuestion: 'b1' });
  const overall = slot({ localDelivery: 'overall' }), local = slot({ localDelivery: 'b1' });
  const untouched = { chart: {}, details: { open: true } };
  const el = {
    set innerHTML(_) { assert.fail('must not replace the mounted report'); },
    querySelector: (selector) => ({ '[data-ai-overview]': overview, '[data-ai-delivery]': coaching })[selector],
    querySelectorAll: (selector) => ({ '[data-ai-question]': [question], '[data-local-delivery]': [overall, local] })[selector],
    ...untouched,
  };
  const part = { words: 12, fillers: { count: 1 }, fillerSource: 'dictation', transcriptionStatus: 'pending' };
  const session = { answeredRecords: () => [{ ...record, deliveries: [part] }] };
  updateReportAI(el, session, { ok: true, report: { overall: { score: 4 }, questions: [{ id: 'b1', improve: 'Quantify results.' }] } });
  assert.match(overview.innerHTML, /4<small>/);
  assert.match(question.innerHTML, /Quantify results/);
  assert.equal(question.attributes['aria-busy'], 'false');
  const ai = question.innerHTML;
  part.fillers.count = 2; part.fillerSource = 'verbatim'; part.transcriptionStatus = 'ready';
  updateReportDelivery(el, session, null);
  assert.match(local.innerHTML, /2 \(16.7%\)/);
  assert.match(overall.innerHTML, /completed verbatim transcripts/);
  assert.equal(question.innerHTML, ai);
  assert.equal(el.chart, untouched.chart);
  assert.equal(el.details.open, true);
});

test('typed and unavailable speech counts disclose their sources', () => {
  const records = [{ ...record, deliveries: [
    { words: 12, fillers: { count: 0 }, fillerSource: 'dictation', transcriptionStatus: 'unavailable' },
    { words: 12, fillers: { count: 0 }, fillerSource: 'typed', transcriptionStatus: 'not-needed' },
  ] }];
  const html = render(null, { pending: true }, records);
  assert.match(html, /dictation estimates/);
  assert.match(html, /totals include typed answers/);
});
