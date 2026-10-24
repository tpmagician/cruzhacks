import { InterviewSession, STAR_TIP } from './interview.js';
import { api } from './api.js';
import { renderReport, renderProblem, escapeHtml } from './report.js';
import { Camera, Dictation } from './media.js';
import { DeliveryTracker } from './delivery.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  screens: { setup: $('#screen-setup'), interview: $('#screen-interview'), report: $('#screen-report') },
  setupForm: $('#setup-form'),
  keyWarning: $('#key-warning'),
  progress: $('#progress'),
  roleLine: $('#role-line'),
  timer: $('#timer'),
  starBtn: $('#star-btn'),
  starTip: $('#star-tip'),
  endBtn: $('#end-btn'),
  transcript: $('#transcript'),
  typing: $('#typing'),
  error: $('#error'),
  errorText: $('#error-text'),
  errorRetry: $('#error-retry'),
  composer: $('#composer'),
  codeArea: $('#code-area'),
  codeLabel: $('#code-label'),
  code: $('#code'),
  answer: $('#answer'),
  answerLabel: $('#answer-label'),
  hintBtn: $('#hint-btn'),
  hintCount: $('#hint-count'),
  sendBtn: $('#send-btn'),
  finished: $('#finished'),
  reportBtn: $('#report-btn'),
  reportLoading: $('#report-loading'),
  reportError: $('#report-error'),
  report: $('#report'),
  rescoreBtn: $('#rescore-btn'),
  retryWeakBtn: $('#retry-weak-btn'),
  newBtn: $('#new-btn'),
  themeToggle: $('#theme-toggle'),
  camVideo: $('#cam-video'),
  camOff: $('#cam-off'),
  camBtn: $('#cam-btn'),
  recDot: $('#rec-dot'),
  micBtn: $('#mic-btn'),
  micStatus: $('#mic-status'),
};

let session = null;
let busy = false;
let lastReport = null;
let timerHandle = null;
let codeFor = null; // record id the code editor currently belongs to

// Proactive hints: if the candidate goes quiet on a technical question, the interviewer checks in.
const QUIET_BEFORE_HINT = { coding: 150, sql: 150, other: 90 }; // seconds
let lastActivityAt = Date.now();
let lastInputSnapshot = '';

// ---------------------------------------------------------------------------
// Theme (per-viewer convenience only)

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
try {
  applyTheme(localStorage.getItem('ips-theme'));
} catch {
  // storage unavailable
}
els.themeToggle.addEventListener('click', () => {
  const current = document.documentElement.dataset.theme
    ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem('ips-theme', next);
  } catch {
    // ignore
  }
});

// ---------------------------------------------------------------------------
// Screens

function show(name) {
  for (const [key, el] of Object.entries(els.screens)) el.hidden = key !== name;
  if (name !== 'interview') stopMedia();
  window.scrollTo({ top: 0 });
}

async function checkHealth() {
  try {
    const h = await api.health();
    if (!h.hasKey) {
      els.keyWarning.hidden = false;
      els.keyWarning.textContent =
        'No API key found. Copy .env.example to .env, set GEMINI_API_KEY (from Google AI Studio), and restart the server.';
    }
  } catch {
    els.keyWarning.hidden = false;
    els.keyWarning.textContent = 'Could not reach the server. Start it with npm start.';
  }
}

// ---------------------------------------------------------------------------
// Setup

els.setupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(els.setupForm);
  const rounds = f.get('rounds') === 'both' ? ['behavioral', 'technical'] : [f.get('rounds')];
  startInterview({
    role: String(f.get('role')).trim() || 'Software Engineer',
    level: f.get('level'),
    companyType: String(f.get('companyType') ?? '').trim(),
    rounds,
    length: f.get('length'),
    model: f.get('model'),
    timer: f.get('timer') === 'on',
    autoHints: f.get('autoHints') === 'on',
  });
});

function startInterview(setup) {
  session = new InterviewSession(setup);
  lastReport = null;
  delivery.reset();
  dictation.takeHeard();
  codeFor = null;
  els.transcript.innerHTML = '';
  els.answer.value = '';
  els.code.value = '';
  els.starTip.hidden = true;
  els.starBtn.setAttribute('aria-expanded', 'false');
  els.roleLine.textContent = `${setup.level} ${setup.role}${setup.companyType ? ` · ${setup.companyType}` : ''}${setup.retry ? ' · Retry of weak questions' : ''}`;
  hideError();
  show('interview');
  startMedia();
  startTimer();
  runTurn(session.prepareOpen());
}

// ---------------------------------------------------------------------------
// Transcript

function appendMessage(role, text, code = '', problem = null) {
  const wrap = document.createElement('div');
  wrap.className = `msg msg-${role}`;
  const avatar = role === 'interviewer' ? '<div class="avatar" aria-hidden="true">J</div>' : '';
  const name = role === 'interviewer' ? 'Jordan · Interviewer' : 'You';
  wrap.innerHTML = `
    ${avatar}
    <div class="bubble">
      <div class="who">${name}</div>
      ${text ? `<div class="text">${escapeHtml(text)}</div>` : ''}
      ${code ? `<pre class="code-block">${escapeHtml(code)}</pre>` : ''}
    </div>`;
  els.transcript.append(wrap);
  if (problem) {
    const card = document.createElement('article');
    card.className = 'card problem';
    card.innerHTML = renderProblem(problem);
    els.transcript.append(card);
    // Land on the top of the statement, not the bottom.
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  wrap.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// ---------------------------------------------------------------------------
// Turns

async function runTurn(prepared) {
  if (busy) return;
  busy = true;
  hideError();
  els.typing.hidden = false;
  els.typing.scrollIntoView({ behavior: 'smooth', block: 'end' });
  updateChrome();
  try {
    const res = await api.interview(prepared.payload);
    prepared.commit(res);
    appendMessage('interviewer', res.text, '', res.problem);
    markActivity(); // the quiet clock restarts after every interviewer turn
    if (session.done) scheduleReport();
  } catch (err) {
    showError(err.message, () => runTurn(prepared));
  } finally {
    busy = false;
    els.typing.hidden = true;
    updateChrome();
  }
}

els.composer.addEventListener('submit', (e) => {
  e.preventDefault();
  sendAnswer();
});

els.answer.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendAnswer();
  }
});

function sendAnswer() {
  if (busy || !session || session.done || !els.error.hidden) return;
  const coding = session.isCodingQuestion();
  const text = els.answer.value;
  const code = coding ? els.code.value : '';
  if (!text.trim() && !code.trim()) return;

  // File this answer's delivery measurements under the question being answered.
  delivery.endAnswer(session.inRound ? session.record?.id : null, dictation.takeHeard());
  const prepared = session.prepareAnswer({ text, code, explanation: text });
  appendMessage('candidate', prepared.display.text, prepared.display.code);
  els.answer.value = '';
  dictation.base = '';
  runTurn(prepared);
}

els.hintBtn.addEventListener('click', () => {
  if (busy || !session?.canHint() || !els.error.hidden) return;
  const prepared = session.prepareHint();
  appendMessage('candidate', prepared.display.text);
  runTurn(prepared);
});

function markActivity() {
  lastActivityAt = Date.now();
}

/** Typing, dictation, and code edits all change the inputs; no change for a while means they're stuck. */
function checkQuiet() {
  if (!session?.setup.autoHints || busy || session.done || !els.error.hidden || !session.canHint()) {
    markActivity();
    return;
  }
  const snapshot = `${els.answer.value}\u0000${els.code.value}`;
  if (snapshot !== lastInputSnapshot) {
    lastInputSnapshot = snapshot;
    markActivity();
    return;
  }
  const limit = QUIET_BEFORE_HINT[session.planItem?.type] ?? QUIET_BEFORE_HINT.other;
  const quiet = Math.round((Date.now() - lastActivityAt) / 1000);
  if (quiet >= limit) runTurn(session.prepareHint({ idleSeconds: quiet }));
}

els.endBtn.addEventListener('click', () => {
  if (!session || busy) return;
  if (session.done) return goToReport();
  if (!session.answeredRecords().length) {
    if (confirm('End the interview? Nothing has been answered yet, so there is nothing to score.')) {
      stopTimer();
      show('setup');
    }
    return;
  }
  if (!confirm('End the interview now and go to feedback?')) return;
  hideError();
  const prepared = session.prepareEnd();
  appendMessage('candidate', prepared.display.text);
  runTurn(prepared);
});

els.starBtn.addEventListener('click', () => {
  const open = els.starTip.hidden;
  els.starTip.hidden = !open;
  els.starBtn.setAttribute('aria-expanded', String(open));
});
els.starTip.textContent = STAR_TIP;

// ---------------------------------------------------------------------------
// Chrome: progress, controls, timer

function updateChrome() {
  if (!session) return;
  els.progress.textContent = session.progressLabel();

  const behavioral = session.stage === 'behavioral';
  const technical = session.stage === 'technical';
  const coding = session.isCodingQuestion();

  els.starBtn.hidden = !behavioral;
  if (!behavioral) els.starTip.hidden = true;

  els.hintBtn.hidden = !technical;
  const hints = session.record?.hintsUsed ?? 0;
  els.hintBtn.textContent = session.canHint() ? `I'm stuck (${session.hintsLeft} hint${session.hintsLeft === 1 ? '' : 's'} left today)` : 'No hints left today';
  els.hintCount.textContent = technical && hints ? `${hints} hint${hints > 1 ? 's' : ''} used` : '';

  // Code editor belongs to one coding question; clear it when a new one starts.
  const recId = session.record?.id ?? null;
  if (coding && codeFor !== recId) {
    els.code.value = '';
    codeFor = recId;
  }
  els.codeArea.hidden = !coding;
  els.codeLabel.textContent = session.planItem?.type === 'sql' ? 'SQL editor' : 'Code editor';
  els.answerLabel.textContent = coding
    ? 'Explain your approach and complexity'
    : session.stage === 'candidate_questions'
      ? 'Ask the interviewer a question (or say you have none)'
      : 'Your answer';

  els.composer.hidden = session.done;
  els.finished.hidden = !session.done;
  els.endBtn.textContent = session.done ? 'Go to feedback' : 'End interview';
  for (const el of [els.answer, els.code, els.sendBtn, els.hintBtn]) el.disabled = busy;
  if (!session.canHint()) els.hintBtn.disabled = true;
  // Don't transcribe while the interviewer is replying or after the interview ends.
  dictation.setPaused(busy);
  if (session.done) dictation.stop();
  syncDelivery();

  els.timer.hidden = !session.setup.timer || session.questionSeconds() == null;
  if (session.done) stopTimer();
}

function startTimer() {
  stopTimer();
  timerHandle = setInterval(() => {
    checkQuiet();
    const s = session?.questionSeconds();
    if (s == null) return;
    els.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    els.timer.hidden = !session.setup.timer;
  }, 500);
}

function stopTimer() {
  clearInterval(timerHandle);
  timerHandle = null;
}

// ---------------------------------------------------------------------------
// Webcam and dictation

const camera = new Camera(els.camVideo);
const delivery = new DeliveryTracker(els.camVideo);
const dictation = new Dictation(els.answer, ({ listening, error }) => {
  syncDelivery();
  els.micBtn.setAttribute('aria-pressed', String(dictation.wanted));
  els.micBtn.textContent = dictation.wanted ? 'Stop speaking' : 'Start speaking';
  els.recDot.hidden = !listening;
  if (error) els.micStatus.textContent = error;
  else if (listening) els.micStatus.textContent = 'Listening… your words appear in the answer box.';
  else if (dictation.wanted) els.micStatus.textContent = 'Mic paused while the interviewer responds.';
  else els.micStatus.textContent = 'Mic off. Click Start speaking, or type below.';
});

if (!Dictation.supported) {
  els.micBtn.disabled = true;
  els.micStatus.textContent = 'Voice transcription is not supported in this browser (try Chrome or Edge). You can type instead.';
}

function updateCamChrome() {
  els.camOff.hidden = camera.on;
  els.camBtn.textContent = camera.on ? 'Turn camera off' : 'Turn camera on';
  syncDelivery();
}

/** Measure face and voice only during the candidate's turn, and voice only while dictating. */
function syncDelivery() {
  const turn = Boolean(session) && !busy && !session.done && !els.screens.interview.hidden;
  delivery.setActive({ face: turn && camera.on, voice: turn && dictation.listening });
}

async function startCamera() {
  try {
    await camera.start();
  } catch (err) {
    els.camOff.textContent = err.name === 'NotAllowedError' ? 'Camera blocked' : 'No camera found';
  }
  updateCamChrome();
}

function startMedia() {
  startCamera();
  if (Dictation.supported) dictation.start();
}

function stopMedia() {
  camera.stop();
  dictation.stop();
  delivery.stop();
  updateCamChrome();
}

els.camBtn.addEventListener('click', () => {
  if (camera.on) {
    camera.stop();
    els.camOff.textContent = 'Camera off';
    updateCamChrome();
  } else {
    startCamera();
  }
});

els.micBtn.addEventListener('click', () => dictation.toggle());

// ---------------------------------------------------------------------------
// Errors

let retryAction = null;

function showError(message, retry) {
  els.errorText.textContent = message;
  retryAction = retry;
  els.error.hidden = false;
  els.error.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function hideError() {
  els.error.hidden = true;
  retryAction = null;
}

els.errorRetry.addEventListener('click', () => {
  const action = retryAction;
  hideError();
  action?.();
});

// ---------------------------------------------------------------------------
// Code editor: Tab / Shift+Tab indentation

const INDENT = '    ';
els.code.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  const ta = els.code;
  const { selectionStart: start, selectionEnd: end, value } = ta;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;

  if (!e.shiftKey && start === end) {
    ta.setRangeText(INDENT, start, end, 'end');
    return;
  }
  const block = value.slice(lineStart, end);
  const lines = block.split('\n');
  const changed = e.shiftKey
    ? lines.map((l) => l.replace(/^( {1,4}|\t)/, ''))
    : lines.map((l) => INDENT + l);
  const replacement = changed.join('\n');
  ta.setRangeText(replacement, lineStart, end, 'preserve');
  const delta = changed[0].length - lines[0].length;
  ta.selectionStart = Math.max(lineStart, start + delta);
  ta.selectionEnd = lineStart + replacement.length;
});

// ---------------------------------------------------------------------------
// Report

els.reportBtn.addEventListener('click', goToReport);
els.rescoreBtn.addEventListener('click', loadReport);

// When the interviewer closes the interview, open the report on its own after a
// short pause so the goodbye can be read.
const REPORT_DELAY_MS = 3000;
let reportTimer = null;

function scheduleReport() {
  clearTimeout(reportTimer);
  const forSession = session;
  reportTimer = setTimeout(() => {
    if (session === forSession && !els.screens.interview.hidden) goToReport();
  }, REPORT_DELAY_MS);
}

function goToReport() {
  clearTimeout(reportTimer);
  stopTimer();
  show('report');
  loadReport();
}

async function loadReport() {
  els.report.innerHTML = '';
  els.reportError.hidden = true;
  els.rescoreBtn.hidden = true;
  els.retryWeakBtn.hidden = true;
  els.reportLoading.hidden = false;
  try {
    await delivery.settle(); // let verbatim filler counts land first
    const payload = session.evaluationPayload();
    const measured = deliverySummaries(payload.records.map((r) => r.id));
    for (const r of payload.records) r.delivery = measured.byRecord[r.id];
    payload.delivery = measured.overall;
    const result = await api.evaluate(payload);
    lastReport = result.ok ? result.report : null;
    renderReport(els.report, session, result, measured);
    els.rescoreBtn.hidden = result.ok;
    els.retryWeakBtn.hidden = false;
  } catch (err) {
    els.reportError.hidden = false;
    els.reportError.textContent = err.message;
    els.rescoreBtn.hidden = err.code === 'NOTHING_TO_SCORE';
    if (session.answeredRecords().length) {
      renderReport(els.report, session, { ok: false }, deliverySummaries(session.answeredRecords().map((r) => r.id)));
    }
  } finally {
    els.reportLoading.hidden = true;
  }
}

function deliverySummaries(ids) {
  return {
    overall: delivery.summary(),
    byRecord: Object.fromEntries(ids.map((id) => [id, delivery.summaryFor(id)])),
  };
}

els.retryWeakBtn.addEventListener('click', () => {
  const setup = session?.retrySetup(lastReport);
  if (setup) startInterview(setup);
});

els.newBtn.addEventListener('click', () => {
  stopTimer();
  session = null;
  show('setup');
});

checkHealth();
