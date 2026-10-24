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
import { requestDeadline } from './request.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const PORT = Number(process.env.PORT) || 3000;
const MAX_TEXT = 20_000;
const MAX_HISTORY = 200;

// ---------------------------------------------------------------------------
// Input cleaning

const clip = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v, min, max, fallback = min) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
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
    problem: q.problem && typeof q.problem === 'object'
      ? {
        title: clip(q.problem.title, 100),
        difficulty: ['Easy', 'Medium', 'Hard'].includes(q.problem.difficulty) ? q.problem.difficulty : '',
        brief: clip(q.problem.brief, 400),
      }
      : undefined,
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

// Delivery measurements arrive as numbers computed in the browser; keep only known
// fields within plausible ranges.
const DELIVERY_RANGES = {
  answers: [0, 50], spokenSeconds: [0, 7200], latency: [0, 600], wpm: [0, 400], pauseShare: [0, 1],
  pauses: [0, 5000], longPauses: [0, 5000], pitchHz: [50, 600], pitchVarSt: [0, 24], loudVarDb: [0, 60],
  words: [0, 100000], fillers: [0, 10000], fillerShare: [0, 1], faceCoverage: [0, 1], smileMean: [0, 100],
  smileShare: [0, 1], awayShare: [0, 1],
  articulationWpm: [0, 500], pitchPhrases: [0, 5000], uptalk: [0, 5000], uptalkShare: [0, 1],
  loudPhrases: [0, 5000], trailOff: [0, 5000], trailShare: [0, 1],
  longestSilence: [0, 7200], silentStretches: [0, 1000], silentCoding: [0, 1000],
  shiftShare: [0, 1], gestureShare: [0, 1],
};
const num = (v, [min, max]) => {
  if (v == null || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};

function cleanDelivery(d) {
  if (!d || typeof d !== 'object') return null;
  const out = Object.fromEntries(Object.entries(DELIVERY_RANGES).map(([k, range]) => [k, num(d[k], range)]));
  // Filler counts continue to change in the browser while this snapshot is scored.
  // Keep AI coaching independent of that optional background transcription.
  for (const key of ['words', 'fillers', 'fillerShare']) out[key] = null;
  out.fillerWords = {};
  return out;
}

function cleanSessionDelivery(d) {
  if (!d || typeof d !== 'object') return null;
  return {
    overall: cleanDelivery(d.overall),
  };
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
      seconds: int(r.seconds, 0, 24 * 3600),
      delivery: cleanDelivery(r.delivery),
    }];
  });
}

// Evaluation reasons over the whole interview, so it gets minimal thinking (high
// thinking measured at over 150 s for two questions) and a longer budget than
// interviewer turns: 60 s per attempt, 90 s per generation, 95 s for the route,
// which also covers the JSON repair retry. The browser waits slightly longer.
const EVALUATION = { thinking: 'minimal', attemptTimeoutMs: 60_000, timeoutMs: 90_000 };

export function createApp({ generateContent = generate, transcribe = transcribeVerbatim, requestTimeoutMs = 60000, evaluateTimeoutMs = 95000 } = {}) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  // Expose only the browser runtime, never the rest of node_modules.
  app.get('/vendor/mediapipe/vision_bundle.js', (_req, res) => {
    res.sendFile(path.join(ROOT, 'node_modules/@mediapipe/tasks-vision/vision_bundle.js'));
  });
  app.use('/vendor/mediapipe/wasm', express.static(path.join(ROOT, 'node_modules/@mediapipe/tasks-vision/wasm')));
  app.use(express.static(path.join(ROOT, 'frontend')));

  // ---------------------------------------------------------------------------
  // Routes

  app.get('/api/health', (_req, res) => {
    const key = (process.env.GEMINI_API_KEY || '').trim();
    res.json({ ok: true, hasKey: Boolean(key && key !== 'your_api_key_here'), models: MODELS, transcriber: transcriberName() });
  });

  app.post('/api/interview', requestDeadline(async (req, res, signal) => {
    const setup = cleanSetup(req.body?.setup);
    const turn = cleanTurn(req.body?.turn);
    const contents = toContents(req.body?.history);
    const { systemInstruction, expectsAction, thinking } = buildInterviewerTurn(setup, turn);

    const raw = await generateContent({ model: setup.model, systemInstruction, contents, thinking, temperature: 0.8, signal });
    signal.throwIfAborted();
    const parsed = parseInterviewerReply(raw, INTERVIEWER_NAME);
    const { action, problem } = parsed;
    const text = parsed.text || (problem ? "Here's the next problem. Take a moment to read it on your screen." : '');
    if (!text) throw new AppError(502, 'EMPTY_RESPONSE', 'The interviewer returned an empty reply. Please retry.');

    res.json({ text, action: expectsAction ? action : null, problem, thinking });
  }, requestTimeoutMs));

  // Verbatim transcript of one answer's audio (WAV), used to count filler words.
  app.post('/api/transcribe', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '20mb' }), requestDeadline(async (req, res, signal) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 1000) {
      throw new AppError(400, 'BAD_REQUEST', 'No audio received.');
    }
    const mimeType = clip(req.get('content-type'), 100) || 'audio/wav';
    const result = await transcribe(req.body, mimeType, { signal });
    signal.throwIfAborted();
    res.json(result);
  }, requestTimeoutMs));

  app.post('/api/evaluate', requestDeadline(async (req, res, signal) => {
    const setup = cleanSetup(req.body?.setup);
    const records = cleanRecords(req.body?.records);
    if (!records.length) {
      throw new AppError(400, 'NOTHING_TO_SCORE', 'There are no answered questions to score yet.');
    }

    const prompt = buildEvaluationPrompt(setup, records, cleanSessionDelivery(req.body?.delivery));
    const contents = [{ role: 'user', parts: [{ text: prompt }] }];
    const opts = { model: setup.model, systemInstruction: EVALUATOR_INSTRUCTION, temperature: 0.2, signal, ...EVALUATION };

    let out = await generateContent({ ...opts, contents });
    signal.throwIfAborted();
    let parsed = tryParseJson(out);

    if (!parsed) {
      out = await generateContent({
        ...opts,
        contents: [
          ...contents,
          { role: 'model', parts: [{ text: out.slice(0, MAX_TEXT) }] },
          { role: 'user', parts: [{ text: JSON_RETRY_MESSAGE }] },
        ],
      });
      signal.throwIfAborted();
      parsed = tryParseJson(out);
    }

    if (!parsed) {
      return res.json({ ok: false, error: 'unable_to_score', message: 'The model did not return a valid evaluation after a retry.' });
    }
    res.json({ ok: true, report: normalizeEvaluation(parsed, records) });
  }, evaluateTimeoutMs));

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

  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createApp().listen(PORT, () => {
    const key = (process.env.GEMINI_API_KEY || '').trim();
    console.log(`Interview Prep Studio running at http://localhost:${PORT}`);
    if (!key || key === 'your_api_key_here') {
      console.warn('Warning: GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.');
    }
  });
}
