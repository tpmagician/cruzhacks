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

function questionDeliveryHtml(rec, q) {
  const d = combineDeliveries(rec.deliveries);
  const chips = deliveryChips(d);
  if (!chips.length) return '';
  return `
      <div class="delivery-block">
        <h4>Delivery</h4>
        ${chipsHtml(chips)}
        ${q?.delivery ? `<p>${escapeHtml(q.delivery)}</p>` : ''}
      </div>`;
}

/** Smile intensity per second with markers where each question's answer began (MACH's summary view). */
function smileTimeline(s) {
  const pts = s?.timeline ?? [];
  if (pts.length < 3) return '';
  const W = 600;
  const H = 130;
  const left = 30;
  const right = 10;
  const top = 18;
  const bottom = 20;
  const dur = Math.max(s.duration ?? 0, pts.at(-1).t + 1, 1);
  const x = (t) => left + (t / dur) * (W - left - right);
  const y = (v) => H - bottom - (v / 100) * (H - top - bottom);
  const runs = [];
  for (const p of pts) {
    const run = runs.at(-1);
    if (run && p.t - run.at(-1).t <= 2) run.push(p);
    else runs.push([p]);
  }
  const lines = runs
    .map((run) => (run.length === 1
      ? `<circle class="tl-dot" cx="${x(run[0].t).toFixed(1)}" cy="${y(run[0].smile).toFixed(1)}" r="1.8" />`
      : `<polyline class="tl-line" points="${run.map((p) => `${x(p.t).toFixed(1)},${y(p.smile).toFixed(1)}`).join(' ')}" />`))
    .join('');
  const marks = (s.marks ?? [])
    .map((m) => `<line class="tl-mark" x1="${x(m.t).toFixed(1)}" x2="${x(m.t).toFixed(1)}" y1="${top - 4}" y2="${H - bottom}" /><text class="tl-label" x="${(x(m.t) + 3).toFixed(1)}" y="${top - 6}">${escapeHtml(m.key.toUpperCase())}</text>`)
    .join('');
  const step = Math.max(1, Math.ceil(dur / 60 / 10));
  let ticks = '';
  for (let m = 0; m * 60 <= dur; m += step) {
    ticks += `<text class="tl-axis" x="${x(m * 60).toFixed(1)}" y="${H - 4}" text-anchor="middle">${m}m</text>`;
  }
  return `
    <figure class="timeline">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Smile intensity from 0 to 100 across the interview">
        <line class="tl-grid" x1="${left}" x2="${W - right}" y1="${y(0)}" y2="${y(0)}" />
        <line class="tl-grid" x1="${left}" x2="${W - right}" y1="${y(100)}" y2="${y(100)}" />
        <line class="tl-threshold" x1="${left}" x2="${W - right}" y1="${y(SMILE_THRESHOLD)}" y2="${y(SMILE_THRESHOLD)}" />
        <text class="tl-axis" x="${left - 4}" y="${y(100) + 4}" text-anchor="end">100</text>
        <text class="tl-axis" x="${left - 4}" y="${y(0) + 4}" text-anchor="end">0</text>
        ${marks}${lines}${ticks}
      </svg>
      <figcaption class="muted small">Smile intensity (0–100) across the whole interview, including while Jordan spoke. The dashed line is where it counts as smiling; labels mark when you began each answer.</figcaption>
    </figure>`;
}

function deliverySectionHtml(records, report, sessionDelivery) {
  const overall = combineDeliveries(records.flatMap((r) => r.deliveries ?? []));
  const chips = deliveryChips(overall);
  if (sessionDelivery?.listeningNods != null && sessionDelivery.listeningSeconds >= 10) {
    chips.push({ label: 'Nods while listening', value: String(sessionDelivery.listeningNods) });
  }
  const timeline = smileTimeline(sessionDelivery);
  if (!chips.length && !timeline) return '';
  const summary = report?.delivery?.summary;
  const tips = report?.delivery?.tips ?? [];
  return `
    <section class="card delivery">
      <h2>Delivery</h2>
      <p class="muted small">Measured on your device from your camera and microphone, following the MACH interview-coaching method (Hoque et al., 2013). These are approximate signals, not a score.</p>
      ${chipsHtml(chips)}
      ${timeline}
      ${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
      ${tips.length ? `<h4>Delivery practice</h4><ol>${tips.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ol>` : ''}
    </section>`;
}

function questionHtml(rec, q) {
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
      ${questionDeliveryHtml(rec, q)}
      ${better}
    </article>`;
}

/**
 * @param {HTMLElement} el
 * @param {import('./interview.js').InterviewSession} session
 * @param {{ok: boolean, report?: object, message?: string}} result
 * @param {object|null} sessionDelivery DeliveryTracker.sessionSummary()
 */
export function renderReport(el, session, result, sessionDelivery = null) {
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
    ${deliverySectionHtml(records, report, sessionDelivery)}
    <h2>Question by question</h2>
    ${records.map((rec) => questionHtml(rec, report?.questions?.find((q) => q.id === rec.id))).join('')}
  `;
}
