// Renders the feedback report. Any missing score shows as "unable to score".
import { combineDeliveries, deliveryChips, SMILE_THRESHOLD } from './delivery-metrics.js';

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

function chipsHtml(chips) {
  return chips.length
    ? `<ul class="chips">${chips.map((c) => `<li><span>${escapeHtml(c.label)}</span><strong>${escapeHtml(c.value)}</strong></li>`).join('')}</ul>`
    : '';
}

function localDeliveryHtml(parts) {
  const chips = deliveryChips(combineDeliveries(parts));
  const speech = (parts ?? []).filter((p) => p?.fillerSource && p.fillerSource !== 'typed');
  const pending = speech.filter((p) => p.transcriptionStatus === 'pending').length;
  const estimated = speech.filter((p) => p.fillerSource === 'dictation').length;
  const typed = (parts ?? []).some((p) => p?.fillerSource === 'typed');
  const note = pending
    ? `Filler counts are estimates. Transcribing ${pending} answer${pending === 1 ? '' : 's'} in the background…`
    : estimated ? 'Some filler counts use dictation estimates because verbatim audio was unavailable.'
      : speech.length ? 'Filler counts use completed verbatim transcripts.' : '';
  return `${chipsHtml(chips)}<p class="muted small" role="status">${note}${typed ? ' Filler totals include typed answers.' : ''}</p>`;
}

function questionDeliveryHtml(rec) {
  if (!rec.deliveries?.length) return '';
  return `<div class="delivery-block"><h4>Delivery</h4>
    <div data-local-delivery="${escapeHtml(rec.id)}">${localDeliveryHtml(rec.deliveries)}</div></div>`;
}

// One lane per track, sharing the time axis (MACH's summary view). Values outside
// a lane's range are drawn at its edge.
const LANES = [
  { key: 'smile', label: 'Smile', range: '0–100', min: 0, max: 100, guide: SMILE_THRESHOLD },
  { key: 'loudness', label: 'Loudness', range: '−40–0 dB', min: -40, max: 0 },
  { key: 'pitch', label: 'Pitch', range: '±12 st', min: -12, max: 12, guide: 0 },
];

/** Smile, loudness, and pitch per second, with markers where each answer began. */
function deliveryTracks(s) {
  const lanes = LANES.filter((l) => (s?.tracks?.[l.key]?.length ?? 0) >= 3);
  if (!lanes.length) return '';
  const W = 600;
  const left = 64;
  const right = 10;
  const top = 18;
  const laneH = 64;
  const gap = 14;
  const bottom = 20;
  const H = top + lanes.length * laneH + (lanes.length - 1) * gap + bottom;
  const last = Math.max(...lanes.map((l) => s.tracks[l.key].at(-1).t));
  const dur = Math.max(s.duration ?? 0, last + 1, 1);
  const x = (t) => left + (t / dur) * (W - left - right);
  const laneSvg = (lane, i) => {
    const y0 = top + i * (laneH + gap);
    const y = (v) => {
      const f = (Math.min(lane.max, Math.max(lane.min, v)) - lane.min) / (lane.max - lane.min);
      return y0 + laneH - f * laneH;
    };
    const runs = [];
    for (const p of s.tracks[lane.key]) {
      const run = runs.at(-1);
      if (run && p.t - run.at(-1).t <= 2) run.push(p);
      else runs.push([p]);
    }
    const lines = runs
      .map((run) => (run.length === 1
        ? `<circle class="tl-dot" cx="${x(run[0].t).toFixed(1)}" cy="${y(run[0].v).toFixed(1)}" r="1.8" />`
        : `<polyline class="tl-line" points="${run.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}" />`))
      .join('');
    return `
        <line class="tl-grid" x1="${left}" x2="${W - right}" y1="${y0}" y2="${y0}" />
        <line class="tl-grid" x1="${left}" x2="${W - right}" y1="${y0 + laneH}" y2="${y0 + laneH}" />
        ${lane.guide != null ? `<line class="tl-threshold" x1="${left}" x2="${W - right}" y1="${y(lane.guide).toFixed(1)}" y2="${y(lane.guide).toFixed(1)}" />` : ''}
        <text class="tl-lane" x="${left - 6}" y="${y0 + 12}" text-anchor="end">${lane.label}</text>
        <text class="tl-axis" x="${left - 6}" y="${y0 + 25}" text-anchor="end">${lane.range}</text>
        ${lines}`;
  };
  const bottomY = H - bottom;
  const marks = (s.marks ?? [])
    .map((m) => `<line class="tl-mark" x1="${x(m.t).toFixed(1)}" x2="${x(m.t).toFixed(1)}" y1="${top - 4}" y2="${bottomY}" /><text class="tl-label" x="${(x(m.t) + 3).toFixed(1)}" y="${top - 6}">${escapeHtml(m.key.toUpperCase())}</text>`)
    .join('');
  const step = Math.max(1, Math.ceil(dur / 60 / 10));
  let ticks = '';
  for (let m = 0; m * 60 <= dur; m += step) {
    ticks += `<text class="tl-axis" x="${x(m * 60).toFixed(1)}" y="${H - 4}" text-anchor="middle">${m}m</text>`;
  }
  const notes = {
    smile: 'Smile is intensity across the whole interview, including while Jordan spoke; the dashed line is where it counts as smiling.',
    loudness: 'Loudness is relative to your loudest second.',
    pitch: 'Pitch is relative to your usual pitch, in semitones.',
  };
  const voice = lanes.some((l) => l.key !== 'smile') ? ' Loudness and pitch are measured only while you answered.' : '';
  return `
    <figure class="timeline">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${lanes.map((l) => l.label).join(', ')} across the interview">
        ${lanes.map(laneSvg).join('')}${marks}${ticks}
      </svg>
      <figcaption class="muted small">${lanes.map((l) => notes[l.key]).join(' ')}${voice} Labels mark when you began each answer. These are for exploring how you came across, not targets.</figcaption>
    </figure>`;
}

function deliveryCoachingHtml(report) {
  const summary = report?.delivery?.summary;
  const tips = report?.delivery?.tips ?? [];
  return `${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
    ${tips.length ? `<h4>Delivery practice</h4><ol>${tips.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ol>` : ''}`;
}

function deliverySectionHtml(records, report, sessionDelivery) {
  const parts = records.flatMap((r) => r.deliveries ?? []);
  const timeline = deliveryTracks(sessionDelivery);
  if (!parts.length && !timeline) return '';
  return `<section class="card delivery">
    <h2>Delivery</h2>
    <p class="muted small">Measured on your device from your camera and microphone, following the MACH interview-coaching method (Hoque et al., 2013). These are approximate signals, not a score.</p>
    <div data-local-delivery="overall">${localDeliveryHtml(parts)}</div>
    ${timeline}
    <div data-ai-delivery>${deliveryCoachingHtml(report)}</div>
  </section>`;
}

function questionFeedbackHtml(rec, q, pending) {
  if (pending) return '<p class="muted">AI feedback is loading…</p>';
  const scores = Object.entries(q?.scores ?? {})
    .map(([k, v]) => `<li><span>${CRITERIA_LABELS[k] ?? k}</span>${scoreBadge(v)}</li>`).join('');
  const better = rec.round === 'behavioral'
    ? `<h4>Stronger STAR version</h4><p class="pre">${text(q?.strongerAnswer, 'Not available.')}</p>`
    : `<h4>Model approach</h4><p class="pre">${text(q?.modelApproach, 'Not available.')}</p>`;
  return `<ul class="scores">${scores}</ul>
    <div class="rq-grid">
      <div><h4>What went well</h4><p>${text(q?.wentWell)}</p></div>
      <div><h4>What to improve</h4><p>${text(q?.improve)}</p></div>
    </div>
    ${q?.delivery ? `<p>${escapeHtml(q.delivery)}</p>` : ''}${better}`;
}

function questionHtml(rec, q, pending) {
  const meta = [
    `${ROUND_TITLE[rec.round]} · ${rec.id.toUpperCase()}`,
    rec.hintsUsed ? `${rec.hintsUsed} hint${rec.hintsUsed > 1 ? 's' : ''} used` : '',
    formatTime(rec.seconds),
  ].filter(Boolean).join(' · ');
  return `<article class="card rq">
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
    ${questionDeliveryHtml(rec)}
    <div data-ai-question="${escapeHtml(rec.id)}" aria-busy="${pending}">${questionFeedbackHtml(rec, q, pending)}</div>
  </article>`;
}

function overviewHtml(records, result) {
  if (result.pending) return '<section class="card"><h2>AI feedback</h2><p class="muted">Your scores and coaching will appear here when ready.</p></section>';
  const report = result.ok ? result.report : null;
  const banner = result.ok ? ''
    : `<div class="card notice">We were unable to score this interview${result.message ? `: ${escapeHtml(result.message)}` : '.'} Your transcript is below. You can try scoring again.</div>`;
  const rounds = [...new Set(records.map((r) => r.round))].map((r) => `<div class="card round-score">
    <div class="label">${ROUND_TITLE[r]}</div>${scoreBadge(report?.rounds?.[r]?.score)}
    <p>${text(report?.rounds?.[r]?.summary, '')}</p></div>`).join('');
  const practice = report?.topPractice?.length
    ? `<ol>${report.topPractice.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ol>`
    : '<p class="muted">Unable to score.</p>';
  return `${banner}<div class="summary-grid"><div class="card round-score overall">
    <div class="label">Overall</div>${scoreBadge(report?.overall?.score)}
    <p>${text(report?.overall?.summary, '')}</p></div>${rounds}</div>
    <section class="card"><h2>Top 3 things to practice</h2>${practice}</section>`;
}

/** Mount once. Updates below replace only their owned slots, preserving charts/details. */
export function renderReport(el, session, result, sessionDelivery = null) {
  const records = session.answeredRecords();
  const report = result.ok ? result.report : null;
  const byId = new Map((report?.questions ?? []).map((q) => [q.id, q]));
  el.innerHTML = `${deliverySectionHtml(records, report, sessionDelivery)}
    <div data-ai-overview aria-busy="${Boolean(result.pending)}">${overviewHtml(records, result)}</div>
    <h2>Question by question</h2>
    ${records.map((rec) => questionHtml(rec, byId.get(rec.id), Boolean(result.pending))).join('')}`;
}

export function updateReportAI(el, session, result) {
  const records = session.answeredRecords();
  const report = result.ok ? result.report : null;
  const overview = el.querySelector('[data-ai-overview]');
  overview.innerHTML = overviewHtml(records, result);
  overview.setAttribute('aria-busy', String(Boolean(result.pending)));
  const coaching = el.querySelector('[data-ai-delivery]');
  if (coaching) coaching.innerHTML = deliveryCoachingHtml(report);
  const byId = new Map((report?.questions ?? []).map((q) => [q.id, q]));
  const recordById = new Map(records.map((r) => [r.id, r]));
  for (const slot of el.querySelectorAll('[data-ai-question]')) {
    const rec = recordById.get(slot.dataset.aiQuestion);
    if (rec) slot.innerHTML = questionFeedbackHtml(rec, byId.get(rec.id), Boolean(result.pending));
    slot.setAttribute('aria-busy', String(Boolean(result.pending)));
  }
}

export function updateReportDelivery(el, session) {
  const records = session.answeredRecords();
  const byId = new Map(records.map((r) => [r.id, r.deliveries]));
  for (const slot of el.querySelectorAll('[data-local-delivery]')) {
    const overall = slot.dataset.localDelivery === 'overall';
    const parts = overall ? records.flatMap((r) => r.deliveries ?? []) : byId.get(slot.dataset.localDelivery);
    slot.innerHTML = localDeliveryHtml(parts);
  }
}
