import { InterviewSession, STAR_TIP } from './interview.js';
import { api } from './api.js';
import { renderReport, renderProblem, escapeHtml } from './report.js';
import { Dictation, Speaker, voiceSupport } from './voice.js';
import { DeliveryTracker } from './delivery.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  screens: { setup: $('#screen-setup'), interview: $('#screen-interview'), report: $('#screen-report') },
  setupForm: $('#setup-form'),
  keyWarning: $('#key-warning'),
  voiceSupport: $('#voice-support'),
  progress: $('#progress'),
  roleLine: $('#role-line'),
  timer: $('#timer'),
  starBtn: $('#star-btn'),
  starTip: $('#star-tip'),
  endBtn: $('#end-btn'),
  coachBar: $('#coach-bar'),
  selfview: $('#selfview'),
  selfviewWrap: $('#selfview-wrap'),
  faceDot: $('#face-dot'),
  voiceStatus: $('#voice-status'),
  voiceInterim: $('#voice-interim'),
  micMeterWrap: $('#mic-meter-wrap'),
  micMeter: $('#mic-meter'),
  deliveryNotice: $('#delivery-notice'),
  skipBtn: $('#skip-voice'),
  micBtn: $('#mic-btn'),
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
};

let session = null;
let busy = false;
let sending = false;
let lastReport = null;
let lastSessionDelivery = null;
let timerHandle = null;
let codeFor = null; // record id the code editor currently belongs to

// Voice and delivery state
let handoff = 0; // bumping this cancels a pending "finish speaking, then listen" hand-off
let floorOpen = false; // the candidate's turn to answer is open
let speaking = false;
let spokenText = ''; // words dictated into the current answer
let speechBlocked = false; // dictation failed this interview; don't auto-restart it
const speaker = new Speaker();
const tracker = new DeliveryTracker({ video: els.selfview, onTick: showLevel });
const dictation = new Dictation({
  onText: (text) => {
    if (!floorOpen) return;
    const box = els.answer;
    box.value = box.value.trim() ? `${box.value.trimEnd()} ${text}` : text;
    spokenText = `${spokenText} ${text}`.trim();
    box.scrollTop = box.scrollHeight;
  },
  onInterim: (text) => {
    els.voiceInterim.textContent = text;
  },
  onState: (listening) => {
    els.micBtn.textContent = listening ? 'Stop mic' : 'Speak';
    els.micBtn.setAttribute('aria-pressed', String(listening));
    if (listening) setVoiceStatus('Listening… Press Send (Ctrl+Enter) when you finish your answer.');
    else if (floorOpen && !speaking && !speechBlocked) setVoiceStatus('Mic off. Press Speak to talk, or type your answer.');
  },
  onError: (message) => {
    speechBlocked = true;
    setVoiceStatus(message);
  },
});

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
  window.scrollTo({ top: 0 });
}

// The interview header (progress + camera) is pinned; share its height with the CSS
// so messages scrolled into view don't land underneath it.
const interviewHead = document.querySelector('#interview-head');
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--head-h', `${interviewHead.offsetHeight}px`);
}).observe(interviewHead);

async function checkHealth() {
  try {
    const h = await api.health();
    if (h.transcriber === 'deepgram') $('#transcriber').textContent = 'Deepgram';
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

function describeVoiceSupport() {
  const notes = [];
  if (voiceSupport.dictation) {
    notes.push("Speech-to-text uses your browser's speech service (Chrome sends the audio to Google to transcribe it).");
  } else {
    notes.push('Speech-to-text is not available in this browser, so you will type your answers. Use Google Chrome or Edge to talk.');
  }
  if (!voiceSupport.speech) notes.push('This browser cannot read questions aloud.');
  els.voiceSupport.textContent = notes.join(' ');
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
    voice: f.get('voice') === 'on',
    delivery: f.get('delivery') === 'on',
    autoHints: f.get('autoHints') === 'on',
  });
});

function startInterview(setup) {
  finishMedia();
  tracker.reset();
  lastSessionDelivery = null;
  speechBlocked = false;
  speaker.enabled = Boolean(setup.voice);
  session = new InterviewSession(setup);
  lastReport = null;
  codeFor = null;
  els.transcript.innerHTML = '';
  els.answer.value = '';
  els.code.value = '';
  els.starTip.hidden = true;
  els.starBtn.setAttribute('aria-expanded', 'false');
  els.roleLine.textContent = `${setup.level} ${setup.role}${setup.companyType ? ` · ${setup.companyType}` : ''}${setup.retry ? ' · Retry of weak questions' : ''}`;
  hideError();
  setupCoachBar();
  show('interview');
  startTimer();
  if (setup.delivery) startTracker();
  runTurn(session.prepareOpen());
}

// ---------------------------------------------------------------------------
// Voice and delivery

function setupCoachBar() {
  const { voice, delivery } = session.setup;
  els.coachBar.hidden = !voice && !delivery;
  els.selfviewWrap.hidden = true;
  els.micMeterWrap.hidden = true;
  els.voiceInterim.textContent = '';
  els.deliveryNotice.textContent = delivery ? '' : 'Delivery feedback is off for this interview.';
  setVoiceStatus('');
}

async function startTracker() {
  const current = session;
  els.deliveryNotice.textContent = 'Starting camera and microphone…';
  const state = await tracker.start();
  if (session !== current || !session?.setup.delivery) return;
  els.selfviewWrap.hidden = !state.camera;
  els.micMeterWrap.hidden = !state.mic;
  const on = [state.camera && 'camera', state.mic && 'microphone'].filter(Boolean);
  els.deliveryNotice.textContent = [
    on.length ? `Measuring delivery with your ${on.join(' and ')}. Nothing is saved.` : '',
    ...state.errors,
  ].filter(Boolean).join(' ');
  // The first question may have been waiting for the devices.
  if (floorOpen && !tracker.segment) tracker.beginSegment(currentKey());
}

function showLevel({ db, face }) {
  const level = Math.min(1, Math.max(0, (db + 70) / 50));
  els.micMeter.style.width = `${Math.round(level * 100)}%`;
  els.faceDot.className = `face-dot${face == null ? '' : face ? ' on' : ' off'}`;
  els.faceDot.title = face == null ? 'Face tracking off' : face ? 'Face tracked' : 'Face not visible';
}

function setVoiceStatus(text) {
  els.voiceStatus.textContent = text;
}

function setSpeaking(on) {
  speaking = on;
  els.skipBtn.hidden = !on;
  if (on) setVoiceStatus('Jordan is speaking… (press Esc or Skip to answer now)');
  updateChrome();
}

const currentKey = () => (session?.inRound ? session.record?.id ?? null : null);

/** After the interviewer replies: read it aloud (if voice is on), then open the candidate's turn. */
async function handOff(text) {
  const id = ++handoff;
  if (session.setup.voice && speaker.available) {
    setSpeaking(true);
    await speaker.speak(text);
    if (id !== handoff) return;
    setSpeaking(false);
  }
  if (id !== handoff || !session) return;
  if (session.done) {
    finishMedia();
    setVoiceStatus('Interview complete.');
    scheduleReport(); // open the feedback report once the goodbye has been read
    return;
  }
  openFloor();
}

function openFloor() {
  floorOpen = true;
  spokenText = '';
  markActivity(); // the quiet clock starts when the candidate's turn opens
  tracker.beginSegment(currentKey());
  if (session.setup.voice && voiceSupport.dictation && !speechBlocked) dictation.start();
  else if (!speechBlocked) setVoiceStatus(session.setup.voice ? 'Type your answer, then press Send.' : '');
  updateChrome();
}

/** Closes the candidate's turn without scoring it (hint request, ending early, switching modes). */
async function closeFloor() {
  handoff++;
  if (speaking) {
    speaker.cancel();
    setSpeaking(false);
  }
  if (dictation.listening) await dictation.stopAndFlush();
  tracker.cancelSegment();
  floorOpen = false;
  els.voiceInterim.textContent = '';
}

/** Releases the camera and microphone and stops all speech. Collected measurements are kept. */
function finishMedia() {
  handoff++;
  speaker.cancel();
  speaking = false;
  els.skipBtn.hidden = true;
  dictation.stop();
  tracker.stop();
  floorOpen = false;
  els.selfviewWrap.hidden = true;
  els.micMeterWrap.hidden = true;
  els.voiceInterim.textContent = '';
}

els.skipBtn.addEventListener('click', () => speaker.cancel());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && speaking) speaker.cancel();
});
els.micBtn.addEventListener('click', () => {
  if (speaking) {
    speaker.cancel(); // the hand-off then opens the mic
    return;
  }
  if (!floorOpen) return;
  if (dictation.listening) {
    dictation.stop();
  } else {
    speechBlocked = false;
    dictation.start();
  }
});
window.addEventListener('pagehide', finishMedia);

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
  floorOpen = false;
  hideError();
  els.typing.hidden = false;
  els.typing.scrollIntoView({ behavior: 'smooth', block: 'end' });
  updateChrome();
  let reply = null;
  try {
    const res = await api.interview(prepared.payload);
    prepared.commit(res);
    appendMessage('interviewer', res.text, '', res.problem);
    reply = res.text;
  } catch (err) {
    showError(err.message, () => runTurn(prepared));
  } finally {
    busy = false;
    els.typing.hidden = true;
    updateChrome();
  }
  if (reply != null && session) handOff(reply);
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

async function sendAnswer() {
  if (busy || sending || !session || session.done || !els.error.hidden) return;
  sending = true;
  try {
    if (speaking) {
      // Answering before Jordan finishes: stop the voice and skip the hand-off.
      handoff++;
      speaker.cancel();
      setSpeaking(false);
    }
    if (dictation.listening) await dictation.stopAndFlush();
    const coding = session.isCodingQuestion();
    const text = els.answer.value;
    const code = coding ? els.code.value : '';
    if (!text.trim() && !code.trim()) {
      if (floorOpen && session.setup.voice && voiceSupport.dictation && !speechBlocked) dictation.start();
      return;
    }

    // Think-aloud check only applies when the candidate is expected to talk through code.
    const delivery = tracker.endSegment({ text, spokenText, thinkAloud: coding && session.setup.voice });
    floorOpen = false;
    const prepared = session.prepareAnswer({ text, code, explanation: text, delivery });
    appendMessage('candidate', prepared.display.text, prepared.display.code);
    els.answer.value = '';
    spokenText = '';
    els.voiceInterim.textContent = '';
    runTurn(prepared);
  } finally {
    sending = false;
  }
}

els.hintBtn.addEventListener('click', async () => {
  if (busy || sending || !session?.canHint() || !els.error.hidden) return;
  await closeFloor();
  const prepared = session.prepareHint();
  appendMessage('candidate', prepared.display.text);
  runTurn(prepared);
});

function markActivity() {
  lastActivityAt = Date.now();
}

/**
 * Typing, dictation (including words still being recognized), and code edits all
 * change the inputs; no change for a while on an open turn means they're stuck.
 */
function checkQuiet() {
  if (!session?.setup.autoHints || busy || sending || speaking || !floorOpen || session.done
    || !els.error.hidden || !session.canHint()) {
    markActivity();
    return;
  }
  const snapshot = `${els.answer.value}\u0000${els.code.value}\u0000${els.voiceInterim.textContent}`;
  if (snapshot !== lastInputSnapshot) {
    lastInputSnapshot = snapshot;
    markActivity();
    return;
  }
  const limit = QUIET_BEFORE_HINT[session.planItem?.type] ?? QUIET_BEFORE_HINT.other;
  const quiet = Math.round((Date.now() - lastActivityAt) / 1000);
  if (quiet >= limit) offerHint(quiet);
}

/** The interviewer checks in with a hint after a quiet stretch. */
async function offerHint(idleSeconds) {
  sending = true;
  try {
    await closeFloor();
    runTurn(session.prepareHint({ idleSeconds }));
  } finally {
    sending = false;
  }
}

els.endBtn.addEventListener('click', async () => {
  if (!session || busy) return;
  if (session.done) return goToReport();
  if (!session.answeredRecords().length) {
    if (confirm('End the interview? Nothing has been answered yet, so there is nothing to score.')) {
      stopTimer();
      finishMedia();
      show('setup');
    }
    return;
  }
  if (!confirm('End the interview now and go to feedback?')) return;
  hideError();
  await closeFloor();
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

  els.micBtn.hidden = !session.setup.voice || !voiceSupport.dictation || session.done;
  els.micBtn.disabled = busy || (!floorOpen && !speaking);

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

els.code.addEventListener('input', () => tracker.noteTyping());

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
  finishMedia();
  lastSessionDelivery = session?.setup.delivery ? tracker.sessionSummary() : null;
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
    await tracker.settle(); // let verbatim filler counts land first
    const result = await api.evaluate(session.evaluationPayload(lastSessionDelivery));
    lastReport = result.ok ? result.report : null;
    renderReport(els.report, session, result, lastSessionDelivery);
    els.rescoreBtn.hidden = result.ok;
    els.retryWeakBtn.hidden = false;
  } catch (err) {
    els.reportError.hidden = false;
    els.reportError.textContent = err.message;
    els.rescoreBtn.hidden = err.code === 'NOTHING_TO_SCORE';
    if (session.answeredRecords().length) renderReport(els.report, session, { ok: false }, lastSessionDelivery);
  } finally {
    els.reportLoading.hidden = true;
  }
}

els.retryWeakBtn.addEventListener('click', () => {
  const setup = session?.retrySetup(lastReport);
  if (setup) startInterview(setup);
});

els.newBtn.addEventListener('click', () => {
  stopTimer();
  finishMedia();
  session = null;
  show('setup');
});

describeVoiceSupport();
checkHealth();
