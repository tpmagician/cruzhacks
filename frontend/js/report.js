// Renders the feedback report. Any missing score shows as "unable to score".

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
      return `<div class="rq-turn rq-${t.speaker}"><strong>${who}:</strong> ${escapeHtml(t.text)}</div>`;
    })
    .join('');
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
      <h3 class="rq-question">${escapeHtml(rec.question)}</h3>
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
    </article>`;
}

/**
 * @param {HTMLElement} el
 * @param {import('./interview.js').InterviewSession} session
 * @param {{ok: boolean, report?: object, message?: string}} result
 */
export function renderReport(el, session, result) {
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
    <h2>Question by question</h2>
    ${records.map((rec) => questionHtml(rec, report?.questions?.find((q) => q.id === rec.id))).join('')}
  `;
}
