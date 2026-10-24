// Verbatim speech-to-text for delivery analysis. Unlike the browser's dictation,
// these keep filler words ("um", "uh", "like") and false starts.
//
// Uses Deepgram (filler_words=true) when DEEPGRAM_API_KEY is set, otherwise a
// Gemini audio model with the existing GEMINI_API_KEY.

import { AppError, generate } from './gemini.js';

const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen?model=nova-3&language=en&filler_words=true&punctuate=true';
const GEMINI_AUDIO_MODEL = () => (process.env.TRANSCRIBE_MODEL || 'gemini-3.8-flash').trim();

const VERBATIM_PROMPT = `Transcribe this audio verbatim, exactly as spoken.
Keep every filler word and disfluency: um, uh, er, ah, hmm, like, you know, I mean, so, repeated words, and false starts. Write hesitation sounds as "um" or "uh".
Do not clean up, correct grammar, summarize, or add speaker labels or timestamps. Output only the transcript text. If there is no speech, output exactly: (silence)`;

const deepgramKey = () => (process.env.DEEPGRAM_API_KEY || '').trim();

export function transcriberName() {
  return deepgramKey() ? 'deepgram' : 'gemini';
}

/** @returns {Promise<{ text: string, provider: string }>} */
export async function transcribeVerbatim(audio, mimeType, { signal } = {}) {
  if (deepgramKey()) return { text: await viaDeepgram(audio, mimeType, signal), provider: 'deepgram' };
  return { text: await viaGemini(audio, mimeType, signal), provider: 'gemini' };
}

async function viaDeepgram(audio, mimeType, signal) {
  let res;
  try {
    res = await fetch(DEEPGRAM_URL, {
      method: 'POST',
      headers: { Authorization: `Token ${deepgramKey()}`, 'Content-Type': mimeType },
      body: audio,
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw signal.reason;
    throw new AppError(502, 'NETWORK', `Could not reach Deepgram: ${err.message}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new AppError(401, 'INVALID_API_KEY', 'The Deepgram API key was rejected. Check DEEPGRAM_API_KEY in .env.');
  }
  if (!res.ok) throw new AppError(502, 'UPSTREAM_ERROR', `Deepgram error (${res.status}).`);
  const data = await res.json();
  return String(data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '').trim();
}

async function viaGemini(audio, mimeType, signal) {
  try {
    const text = await generate({
      model: GEMINI_AUDIO_MODEL(),
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mimeType.split(';')[0], data: audio.toString('base64') } }, { text: VERBATIM_PROMPT }] }],
      temperature: 0,
      signal,
      fallbackModel: null,
    });
    return /^\(?silence\)?\.?$/i.test(text.trim()) ? '' : text.trim();
  } catch (err) {
    if (err.code === 'EMPTY_RESPONSE') return '';
    throw err;
  }
}
