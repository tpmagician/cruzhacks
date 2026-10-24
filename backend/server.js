import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';

import { AppError, generate, resolveModel, MODELS } from './gemini.js';
import {
  INTERVIEWER_NAME,
  EVALUATOR_INSTRUCTION,
  JSON_RETRY_MESSAGE,
  buildInterviewerTurn,
  buildEvaluationPrompt,
} from './prompts.js';
import { parseInterviewerReply, tryParseJson, normalizeEvaluation } from './parse.js';
import { transcribeVerbatim, transcriberName } from './transcribe.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const PORT = Number(process.env.PORT) || 3000;
const MAX_TEXT = 20_000;
const MAX_HISTORY = 200;

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'frontend')));

// ---------------------------------------------------------------------------
// Input cleaning

const clip = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v, min, max, fallback = min) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const FACE_METRICS = ['presentPct', 'eyeContactPct', 'smilePct', 'tensePct', 'blinksPerMin', 'headMovementDeg'];
const VOICE_METRICS = ['words', 'wpm', 'fillerCount', 'fillersPerMin', 'longPauses', 'longPausesPerMin', 'longestPauseSec', 'volumeDb', 'pitchVariation', 'clarityPct'];

/** Keeps only the known delivery numbers measured in the browser. */
function cleanDelivery(d) {
  if (!d || typeof d !== 'object') return null;
  const nums = (src, keys) => {
    if (!src || typeof src !== 'object') return null;
    const out = {};
    for (const k of keys) {
      const n = Number(src[k]);
      out[k] = src[k] != null && Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
    }
    return out;
  };
  const face = nums(d.face, FACE_METRICS);
  const voice = nums(d.voice, VOICE_METRICS);
  if (voice) {
    voice.fillerSource = ['verbatim', 'mixed', 'browser'].includes(d.voice.fillerSource) ? d.voice.fillerSource : 'browser';
    voice.topFillers = (Array.isArray(d.voice.topFillers) ? d.voice.topFillers : [])
      .slice(0, 5)
      .map((f) => ({ word: clip(f?.word, 20), count: int(f?.count, 0, 1000) }))
      .filter((f) => f.word);
  }
  const flags = (Array.isArray(d.flags) ? d.flags : [])
    .slice(0, 20)
    .map((f) => ({ area: f?.area === 'face' ? 'face' : 'voice', message: clip(f?.message, 200) }))
    .filter((f) => f.message);
  return face || voice ? { face, voice, flags } : null;
}
const ROUNDS = ['behavioral', 'technical'];
const STAGES = ['intro', 'behavioral', 'technical', 'candidate_questions', 'wrapup'];
const KINDS = ['open', 'answer', 'hint', 'candidate_questions', 'close'];
const TYPES = ['behavioral', 'conceptual', 'coding', 'sql', 'product', 'domain'];
const LEVELS = ['Entry', 'Mid', 'Senior'];

function cleanSetup(s = {}) {
  return {
    role: clip(s.role, 120) || 'Software Engineer',
    level: LEVELS.includes(s.level) ? s.level : 'Mid',
    companyType: clip(s.companyType, 120),
    model: resolveModel(s.model),
  };
}

function cleanQuestionRef(q) {
  if (!q || typeof q !== 'object') return null;
  return {
    action: ['new_question', 'switch_round', 'candidate_questions'].includes(q.action) ? q.action : 'candidate_questions',
    round: ROUNDS.includes(q.round) ? q.round : undefined,
    number: int(q.number, 1, 20),
    total: int(q.total, 1, 20),
    type: TYPES.includes(q.type) ? q.type : 'domain',
    topic: clip(q.topic, 200),
    retryText: clip(q.retryText, 8000) || undefined,
  };
}

function cleanTurn(t = {}) {
  if (!KINDS.includes(t.kind)) throw new AppError(400, 'BAD_REQUEST', 'Invalid turn kind.');
  return {
    kind: t.kind,
    stage: STAGES.includes(t.stage) ? t.stage : 'intro',
    questionNumber: int(t.questionNumber, 0, 20),
    totalQuestions: int(t.totalQuestions, 0, 20),
    followupsUsed: int(t.followupsUsed, 0, 5),
    maxFollowups: int(t.maxFollowups, 0, 5, 2),
    hintsUsed: int(t.hintsUsed, 0, 10),
    hintsLeftToday: int(t.hintsLeftToday, 0, 10),
    idleSeconds: int(t.idleSeconds, 0, 3600),
    forced: Boolean(t.forced),
    final: Boolean(t.final),
    includesCode: Boolean(t.includesCode),
    current: t.current ? { type: TYPES.includes(t.current.type) ? t.current.type : 'domain', topic: clip(t.current.topic, 200) } : null,
    next: cleanQuestionRef(t.next),
    roundsPlanned: Array.isArray(t.roundsPlanned)
      ? t.roundsPlanned.filter((r) => ROUNDS.includes(r?.round)).map((r) => ({ round: r.round, count: int(r.count, 1, 20) }))
      : [],
  };
}

/** Converts [{role, text}] into SDK contents: starts with user, merges same-role neighbours. */
function toContents(history) {
  if (!Array.isArray(history) || history.length === 0) {
    throw new AppError(400, 'BAD_REQUEST', 'History must contain at least one message.');
  }
  const contents = [];
  for (const m of history.slice(-MAX_HISTORY)) {
    const role = m?.role === 'model' ? 'model' : 'user';
    const text = clip(m?.text, MAX_TEXT);
    if (!text) continue;
    const last = contents.at(-1);
    if (last && last.role === role) last.parts[0].text += `\n\n${text}`;
    else contents.push({ role, parts: [{ text }] });
  }
  if (contents[0]?.role !== 'user') contents.unshift({ role: 'user', parts: [{ text: '(The candidate has joined the call.)' }] });
  if (contents.at(-1).role !== 'user') throw new AppError(400, 'BAD_REQUEST', 'The last message must be from the candidate.');
  return contents;
}

function cleanRecords(records) {
  if (!Array.isArray(records)) return [];
  return records.slice(0, 30).flatMap((r) => {
    if (!r || !ROUNDS.includes(r.round)) return [];
    const turns = (Array.isArray(r.turns) ? r.turns : [])
      .map((t) => ({ speaker: t?.speaker === 'interviewer' ? 'interviewer' : 'candidate', text: clip(t?.text, MAX_TEXT) }))
      .filter((t) => t.text);
    if (!turns.some((t) => t.speaker === 'candidate')) return [];
    return [{
      id: clip(r.id, 12) || `${r.round[0]}?`,
      round: r.round,
      type: TYPES.includes(r.type) ? r.type : 'domain',
      topic: clip(r.topic, 200),
      turns,
      code: clip(r.code, MAX_TEXT),
      hintsUsed: int(r.hintsUsed, 0, 50),
      delivery: cleanDelivery(r.delivery),
      seconds: int(r.seconds, 0, 24 * 3600),
    }];
  });
}

// ---------------------------------------------------------------------------
// Routes

app.get('/api/health', (_req, res) => {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  res.json({ ok: true, hasKey: Boolean(key && key !== 'your_api_key_here'), models: MODELS, transcriber: transcriberName() });
});

app.post('/api/interview', async (req, res) => {
  const setup = cleanSetup(req.body?.setup);
  const turn = cleanTurn(req.body?.turn);
  const contents = toContents(req.body?.history);
  const { systemInstruction, expectsAction, thinking } = buildInterviewerTurn(setup, turn);

  const raw = await generate({ model: setup.model, systemInstruction, contents, thinking, temperature: 0.8 });
  const parsed = parseInterviewerReply(raw, INTERVIEWER_NAME);
  const { action, problem } = parsed;
  const text = parsed.text || (problem ? "Here's the next problem. Take a moment to read it on your screen." : '');
  if (!text) throw new AppError(502, 'EMPTY_RESPONSE', 'The interviewer returned an empty reply. Please retry.');

  res.json({ text, action: expectsAction ? action : null, problem, thinking });
});

// Verbatim transcript of one answer's audio (WAV), used to count filler words.
app.post('/api/transcribe', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '20mb' }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length < 1000) {
    throw new AppError(400, 'BAD_REQUEST', 'No audio received.');
  }
  const mimeType = clip(req.get('content-type'), 100) || 'audio/wav';
  res.json(await transcribeVerbatim(req.body, mimeType));
});

app.post('/api/evaluate', async (req, res) => {
  const setup = cleanSetup(req.body?.setup);
  const records = cleanRecords(req.body?.records);
  if (!records.length) {
    throw new AppError(400, 'NOTHING_TO_SCORE', 'There are no answered questions to score yet.');
  }

  const delivery = cleanDelivery(req.body?.delivery);
  const prompt = buildEvaluationPrompt(setup, records, delivery);
  const contents = [{ role: 'user', parts: [{ text: prompt }] }];
  const opts = { model: setup.model, systemInstruction: EVALUATOR_INSTRUCTION, thinking: 'high', temperature: 0.2 };

  let out = await generate({ ...opts, contents });
  let parsed = tryParseJson(out);

  if (!parsed) {
    out = await generate({
      ...opts,
      contents: [
        ...contents,
        { role: 'model', parts: [{ text: out.slice(0, MAX_TEXT) }] },
        { role: 'user', parts: [{ text: JSON_RETRY_MESSAGE }] },
      ],
    });
    parsed = tryParseJson(out);
  }

  if (!parsed) {
    return res.json({ ok: false, error: 'unable_to_score', message: 'The model did not return a valid evaluation after a retry.' });
  }
  res.json({ ok: true, report: normalizeEvaluation(parsed, records, Boolean(delivery)) });
});

app.use('/api', (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Unknown API route.')));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'The request was too large.' } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Unexpected server error. Check the server logs.' } });
});

app.listen(PORT, () => {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  console.log(`Interview Prep Studio running at http://localhost:${PORT}`);
  if (!key || key === 'your_api_key_here') {
    console.warn('Warning: GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.');
  }
});
