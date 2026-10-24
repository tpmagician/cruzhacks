// Renders the feedback report. Any missing score shows as "unable to score".

import { LIMITS } from './delivery.js';

const CRITERIA_LABELS = {
  star: 'STAR structure',
  specificity: 'Specificity',
  relevance: 'Relevance',
  clarity: 'Clarity',
  correctness: 'Correctness',
  approach: 'Approach',
  communication: 'Communication',
  efficiency: 'Efficiency',
};
const ROUND_TITLE = { behavioral: 'Behavioral', technical: 'Technical' };

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------------------------------------------------------------------------
// LeetCode-style problem statement

/** Escapes, then renders `code` spans and 10^4-style exponents. */
function inline(s) {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(\d)\^(-?\d+)/g, '$1<sup>$2</sup>');
}

function paragraphs(s) {
  return s
    .split(/\n\s*\n/)
    .map((para) => `<p>${inline(para.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function exampleHtml(ex, i) {
  const field = (label, v) => {
    if (!v) return '';
    const sep = v.includes('\n') ? '\n' : ' ';
    return `<strong>${label}:</strong>${sep}${escapeHtml(v)}\n`;
  };
  return `
    <p class="pb-label"><strong>Example ${i + 1}:</strong></p>
    <pre class="pb-example${/\+-{2,}/.test(ex.input + ex.output) ? ' pb-table' : ''}">${field('Input', ex.input)}${field('Output', ex.output)}${field('Explanation', ex.explanation)}</pre>`;
}

function constraintHtml(c) {
  // LeetCode shows bare bounds like "1 <= n <= 10^5" in code style.
  const bare = !c.includes('`') && /[<>=^]/.test(c);
  return `<li>${bare ? `<code>${inline(c)}</code>` : inline(c)}</li>`;
}

/** @param {{ title, difficulty, schema, description, examples, constraints, followUp }} p */
export function renderProblem(p) {
  const diff = p.difficulty ? `<span class="pb-diff pb-${p.difficulty.toLowerCase()}">${escapeHtml(p.difficulty)}</span>` : '';
  return `
    <div class="pb-head">
      <h3 class="pb-title">${escapeHtml(p.title || 'Problem')}</h3>
      ${diff}
    </div>
    ${p.schema ? `<pre class="pb-schema">${escapeHtml(p.schema)}</pre>` : ''}
    <div class="pb-desc">${paragraphs(p.description)}</div>
    ${p.examples.map(exampleHtml).join('')}
    ${p.constraints.length ? `<p class="pb-label"><strong>Constraints:</strong></p><ul class="pb-constraints">${p.constraints.map(constraintHtml).join('')}</ul>` : ''}
    ${p.followUp ? `<p class="pb-label"><strong>Follow-up:</strong> ${inline(p.followUp)}</p>` : ''}`;
}

/** Strips the problem block from stored interviewer text for plain display. */
function spoken(text) {
  return String(text ?? '').replace(/\s*<problem>[\s\S]*?(?:<\/problem>|$)/i, '').trim();
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Delivery (facial expression and voice)

const TILES = {
  face: [
    ['eyeContactPct', 'Eye contact', '%'],
    ['smilePct', 'Smiling', '%'],
    ['tensePct', 'Tense expression', '%'],
    ['blinksPerMin', 'Blink rate', '/min'],
    ['headMovementDeg', 'Head movement', '°'],
    ['presentPct', 'In frame', '%'],
  ],
  voice: [
    ['wpm', 'Pace', ' wpm'],
    ['fillersPerMin', 'Filler words', '/min'],
    ['longPausesPerMin', 'Long pauses', '/min'],
    ['pitchVariation', 'Vocal variety', ' st'],
    ['clarityPct', 'Clarity', '%'],
    ['volumeDb', 'Volume', ' dB'],
  ],
};

function target(lim) {
  if (lim.min != null && lim.max != null) return `target ${lim.min}–${lim.max}`;
  return lim.min != null ? `target ≥ ${lim.min}` : `target ≤ ${lim.max}`;
}

function tileHtml(data, [key, label, unit]) {
  const v = data[key];
  if (v == null) return '';
  const lim = LIMITS[key];
  const off = (lim.min != null && v < lim.min) || (lim.max != null && v > lim.max);
  let extra = '';
  if (key === 'fillersPerMin') {
    const source = { verbatim: 'Counted from a verbatim transcript', mixed: 'Partly from browser dictation (may undercount)', browser: 'From browser dictation (may undercount)' }[data.fillerSource];
    if (data.topFillers?.length) extra += `<div class="tile-note">${data.topFillers.map((f) => `“${escapeHtml(f.word)}” ×${f.count}`).join(', ')}</div>`;
    if (source) extra += `<div class="tile-note">${source}</div>`;
  }
  return `
    <div class="tile ${off ? 'tile-watch' : 'tile-ok'}">
      <div class="tile-label">${label}</div>
      <div class="tile-value">${v}<small>${unit}</small></div>
      <div class="tile-note tile-status">${off ? 'Work on this' : 'Good'} · ${target(lim)}</div>
      ${extra}
    </div>`;
}

function deliverySection(measured, fb) {
  if (!measured) {
    return `
      <section class="card">
        <h2>Delivery: expression and voice</h2>
        <p class="muted">No delivery data was captured. Keep your camera on and speak your answers (rather than typing) to get feedback on facial expression and voice.</p>
      </section>`;
  }
  const group = (area, title, comment) => {
    const data = measured[area];
    if (!data) {
      const how = area === 'face' ? 'Turn your camera on' : 'Speak your answers with the mic on';
      return `<h3>${title}</h3><p class="muted small">Not measured. ${how} to get this feedback.</p>`;
    }
    return `
      <h3>${title}</h3>
      ${comment ? `<p>${escapeHtml(comment)}</p>` : ''}
      <div class="tiles">${TILES[area].map((t) => tileHtml(data, t)).join('')}</div>`;
  };
  const tips = fb?.tips?.length ? `<h4>Delivery tips</h4><ul>${fb.tips.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : '';
  return `
    <section class="card delivery">
      <div class="delivery-head">
        <h2>Delivery: expression and voice</h2>
        ${fb ? scoreBadge(fb.score) : ''}
      </div>
      ${fb?.summary ? `<p>${escapeHtml(fb.summary)}</p>` : ''}
      ${group('face', 'Facial expression', fb?.face)}
      ${group('voice', 'Voice and articulation', fb?.voice)}
      ${tips}
      <p class="muted small">Measured in your browser from webcam face tracking and the microphone; only these numbers are sent for scoring. They are estimates, so treat them as pointers rather than verdicts.</p>
    </section>`;
}

function questionDeliveryHtml(d, note) {
  if (!d && !note) return '';
  const chips = [];
  if (d?.face) chips.push(`Eye contact ${d.face.eyeContactPct}%`, `Smiling ${d.face.smilePct}%`);
  if (d?.voice) chips.push(`${d.voice.wpm} wpm`, `${d.voice.fillerCount} filler word${d.voice.fillerCount === 1 ? '' : 's'}`, `${d.voice.longPauses} long pause${d.voice.longPauses === 1 ? '' : 's'}`);
  const flagged = d?.flags?.length ? `<ul class="flags">${d.flags.map((f) => `<li>${escapeHtml(f.message)}</li>`).join('')}</ul>` : '';
  return `
    <h4>Delivery</h4>
    ${chips.length ? `<div class="chips">${chips.map((c) => `<span class="chip">${c}</span>`).join('')}</div>` : ''}
    ${note ? `<p>${escapeHtml(note)}</p>` : ''}
    ${flagged}`;
}

// ---------------------------------------------------------------------------

function scoreBadge(v) {
  return v == null
    ? '<span class="score score-none">unable to score</span>'
    : `<span class="score score-${v}">${v}<small>/5</small></span>`;
}

function text(v, fallback = 'Unable to score.') {
  return v ? escapeHtml(v) : `<span class="muted">${fallback}</span>`;
}

function formatTime(seconds) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  return `${m}:${String(seconds % 60).padStart(2, '0')}`;
}

function transcriptHtml(rec) {
  return rec.turns
    .slice(1)
    .map((t) => {
      const who = t.speaker === 'interviewer' ? 'Interviewer' : 'You';
      return `<div class="rq-turn rq-${t.speaker}"><strong>${who}:</strong> ${escapeHtml(spoken(t.text))}</div>`;
    })
    .join('');
}

function questionHtml(rec, q, measured) {
  const scores = Object.entries(q?.scores ?? {})
    .map(([k, v]) => `<li><span>${CRITERIA_LABELS[k] ?? k}</span>${scoreBadge(v)}</li>`)
    .join('');
  const better =
    rec.round === 'behavioral'
      ? `<h4>Stronger STAR version</h4><p class="pre">${text(q?.strongerAnswer, 'Not available.')}</p>`
      : `<h4>Model approach</h4><p class="pre">${text(q?.modelApproach, 'Not available.')}</p>`;
  const meta = [
    `${ROUND_TITLE[rec.round]} · ${rec.id.toUpperCase()}`,
    rec.hintsUsed ? `${rec.hintsUsed} hint${rec.hintsUsed > 1 ? 's' : ''} used` : '',
    formatTime(rec.seconds),
  ].filter(Boolean).join(' · ');

  return `
    <article class="card rq">
      <div class="rq-meta">${meta}</div>
      ${rec.problem
        ? `<h3 class="rq-question">${escapeHtml(rec.problem.title || 'Coding problem')}</h3>
           <details><summary>Problem statement</summary><div class="problem">${renderProblem(rec.problem)}</div></details>`
        : `<h3 class="rq-question">${escapeHtml(spoken(rec.question))}</h3>`}
      <details>
        <summary>Your answer${rec.turns.length > 2 ? ' and follow-ups' : ''}</summary>
        <div class="rq-transcript">${transcriptHtml(rec)}</div>
        ${rec.code ? `<pre class="code-block">${escapeHtml(rec.code)}</pre>` : ''}
      </details>
      <ul class="scores">${scores}</ul>
      <div class="rq-grid">
        <div><h4>What went well</h4><p>${text(q?.wentWell)}</p></div>
        <div><h4>What to improve</h4><p>${text(q?.improve)}</p></div>
      </div>
      ${better}
      ${questionDeliveryHtml(measured, q?.deliveryNote)}
    </article>`;
}

/**
 * @param {HTMLElement} el
 * @param {import('./interview.js').InterviewSession} session
 * @param {{ok: boolean, report?: object, message?: string}} result
 * @param {{ overall: object|null, byRecord: Record<string, object|null> }} [measured]  delivery measurements
 */
export function renderReport(el, session, result, measured = { overall: null, byRecord: {} }) {
  const records = session.answeredRecords();
  const report = result.ok ? result.report : null;

  const banner = result.ok
    ? ''
    : `<div class="card notice">We were unable to score this interview${result.message ? `: ${escapeHtml(result.message)}` : '.'} Your transcript is below. You can try scoring again.</div>`;

  const rounds = [...new Set(records.map((r) => r.round))]
    .map((r) => `
      <div class="card round-score">
        <div class="label">${ROUND_TITLE[r]}</div>
        ${scoreBadge(report?.rounds?.[r]?.score)}
        <p>${text(report?.rounds?.[r]?.summary, '')}</p>
      </div>`)
    .join('');

  const practice = report?.topPractice?.length
    ? `<ol>${report.topPractice.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ol>`
    : '<p class="muted">Unable to score.</p>';

  el.innerHTML = `
    ${banner}
    <div class="summary-grid">
      <div class="card round-score overall">
        <div class="label">Overall</div>
        ${scoreBadge(report?.overall?.score)}
        <p>${text(report?.overall?.summary, '')}</p>
      </div>
      ${rounds}
    </div>
    <section class="card">
      <h2>Top 3 things to practice</h2>
      ${practice}
    </section>
    ${deliverySection(measured.overall, report?.delivery)}
    <h2>Question by question</h2>
    ${records.map((rec) => questionHtml(rec, report?.questions?.find((q) => q.id === rec.id), measured.byRecord?.[rec.id])).join('')}
  `;
}
