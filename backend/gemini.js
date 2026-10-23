// Thin wrapper around @google/genai for Gemma 4 on the Gemini API.
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

export const MODELS = ['gemma-4-26b-a4b-it', 'gemma-4-31b-it'];
export const DEFAULT_MODEL = 'gemma-4-31b-it';

const THINKING = {
  minimal: ThinkingLevel?.MINIMAL ?? 'MINIMAL',
  high: ThinkingLevel?.HIGH ?? 'HIGH',
};

export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let client = null;
let clientKey = null;

function getClient() {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key || key === 'your_api_key_here') {
    throw new AppError(
      500,
      'MISSING_API_KEY',
      'No Gemini API key is configured. Add GEMINI_API_KEY to the .env file in the project root and restart the server.'
    );
  }
  if (!client || clientKey !== key) {
    client = new GoogleGenAI({ apiKey: key });
    clientKey = key;
  }
  return client;
}

export function resolveModel(model) {
  return MODELS.includes(model) ? model : DEFAULT_MODEL;
}

/**
 * Calls generateContent and returns the reply text (thought parts excluded).
 * `contents` uses the SDK shape: [{ role: 'user' | 'model', parts: [{ text }] }].
 *
 * If the model rejects system instructions or the thinking config, retries once
 * per problem with that feature adapted (system prompt inlined / thinking dropped).
 */
export async function generate({ model, systemInstruction, contents, thinking = 'minimal', temperature }) {
  const ai = getClient();
  let inlineSystem = false;
  let useThinking = true;

  for (let attempt = 0; attempt < 3; attempt++) {
    const config = {};
    if (temperature != null) config.temperature = temperature;
    if (useThinking) config.thinkingConfig = { thinkingLevel: THINKING[thinking] ?? THINKING.minimal };

    let reqContents = contents;
    if (systemInstruction) {
      if (inlineSystem) reqContents = inlineSystemPrompt(contents, systemInstruction);
      else config.systemInstruction = systemInstruction;
    }

    try {
      const res = await ai.models.generateContent({ model, contents: reqContents, config });
      return extractText(res);
    } catch (err) {
      if (err instanceof AppError) throw err;
      const status = err?.status;
      const msg = String(err?.message ?? '');
      if (status === 400 && !inlineSystem && /system[_ ]?instruction|developer instruction/i.test(msg)) {
        inlineSystem = true;
        continue;
      }
      if (status === 400 && useThinking && /think/i.test(msg)) {
        useThinking = false;
        continue;
      }
      throw toAppError(err);
    }
  }
  throw new AppError(502, 'UPSTREAM_ERROR', 'The model request failed after several attempts.');
}

function inlineSystemPrompt(contents, systemInstruction) {
  const [first, ...rest] = contents;
  const firstText = first.parts.map((p) => p.text).join('\n');
  return [
    { role: 'user', parts: [{ text: `[Instructions]\n${systemInstruction}\n\n[Conversation begins]\n${firstText}` }] },
    ...rest,
  ];
}

function extractText(res) {
  const candidate = res?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const text = parts
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('')
    .trim();
  if (text) return text;

  const blocked = res?.promptFeedback?.blockReason;
  if (blocked) throw new AppError(502, 'BLOCKED', `The model blocked this request (${blocked}).`);
  throw new AppError(
    502,
    'EMPTY_RESPONSE',
    `The model returned an empty response${candidate?.finishReason ? ` (${candidate.finishReason})` : ''}. Please retry.`
  );
}

function toAppError(err) {
  const status = err?.status;
  const msg = String(err?.message ?? '');

  if (/API key not valid|API_KEY_INVALID|invalid api key/i.test(msg) || status === 401) {
    return new AppError(401, 'INVALID_API_KEY', 'The Gemini API key was rejected. Check GEMINI_API_KEY in .env (create one at Google AI Studio) and restart the server.');
  }
  if (status === 403) {
    return new AppError(403, 'INVALID_API_KEY', 'The API key does not have permission to use this model. Check the key in Google AI Studio.');
  }
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) {
    return new AppError(429, 'RATE_LIMIT', 'Rate limit reached for the Gemini API. Wait a minute, then retry.');
  }
  if (status === 404) {
    return new AppError(404, 'MODEL_NOT_FOUND', 'The selected model was not found for this API key. Try the other model in settings.');
  }
  if (status === 500 || status === 503 || status === 504) {
    return new AppError(503, 'UPSTREAM_UNAVAILABLE', 'The Gemini API is temporarily unavailable. Please retry in a moment.');
  }
  if (!status) {
    return new AppError(502, 'NETWORK', `Could not reach the Gemini API: ${msg || 'network error'}`);
  }
  return new AppError(502, 'UPSTREAM_ERROR', `Gemini API error (${status}): ${msg.slice(0, 300)}`);
}
