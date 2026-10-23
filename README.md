# Interview Prep Studio

A realistic, continuous mock job interview with a behavioral round and a technical round. The interviewer runs on Google's **Gemma 4** through the Gemini API. When the interview ends, you get a scored feedback report.

## Setup

1. **Get an API key.** Go to [Google AI Studio](https://aistudio.google.com/apikey) and create a Gemini API key.
2. **Install dependencies** (Node 18 or newer):
   ```bash
   npm install
   ```
3. **Add your key.** Copy the example env file and paste your key into it:
   ```bash
   cp .env.example .env
   # then edit .env:  GEMINI_API_KEY=your_real_key
   ```
4. **Start the app:**
   ```bash
   npm start
   ```
   Open http://localhost:3000.

`npm run dev` restarts the server automatically when files change.

The API key stays on the server. The browser only talks to `/api/*` on the local Express server and never sees the key.

## How it works

```
frontend/            static app served by Express
  index.html         setup, interview, and report screens
  styles.css         placeholder styling (light/dark)
  js/interview.js    interview state machine + question plans
  js/app.js          UI wiring (transcript, code editor, timer, errors)
  js/report.js       feedback report rendering
  js/api.js          fetch helpers
backend/
  server.js          Express: /api/health, /api/interview, /api/evaluate
  prompts.js         interviewer persona, per-turn directives, evaluation prompt
  gemini.js          @google/genai wrapper, error mapping
  parse.js           reply cleanup, defensive JSON parsing, score normalization
```

### Interview flow

The structure lives in a JavaScript state machine (`frontend/js/interview.js`), not in the model:

`intro → behavioral → technical → candidate_questions → wrapup → report`

- The state machine tracks the current round, the main question number, and the follow-ups on each question (at most 2).
- On every turn, the frontend sends the current state and what should happen next: the next topic, whether a follow-up is still allowed, and whether a round transition is coming. `backend/prompts.js` turns that into the system instruction: persona, role, stage, and a directive for this turn.
- After an answer, the model decides whether to follow up or move on. It starts its reply with a hidden `ACTION: FOLLOW_UP` or `ACTION: NEXT` line, which the server strips before returning the reply. Once a question has had 2 follow-ups, the app makes the model move on.
- The candidate-questions stage ends when you say you have no more questions, or after 3 of your questions.

### Model settings

| Use | Model | Thinking level |
| --- | --- | --- |
| Live interviewer turns | `gemma-4-31b-it` (default) or `gemma-4-26b-a4b-it` | `minimal` |
| Turns where you submit code | same | `high` |
| End-of-interview evaluation | same | `high` |

Conversation history goes to the model as multi-turn `contents`, with `user` for the candidate and `model` for the interviewer. The persona goes in `config.systemInstruction`. If a model ever rejects system instructions or the thinking config, `gemini.js` retries with that feature adapted.

### Evaluation

`POST /api/evaluate` asks for strict JSON. The server strips code fences and pulls out the JSON object. If the JSON is invalid, it asks the model again once. If that also fails, it returns `{ ok: false, error: "unable_to_score" }`, and the report shows "unable to score" instead of crashing. Missing or out-of-range scores also show as "unable to score".

### API

| Route | Body | Response |
| --- | --- | --- |
| `GET /api/health` | none | `{ hasKey, models }` |
| `POST /api/interview` | `{ setup, turn, history }` | `{ text, action }` |
| `POST /api/evaluate` | `{ setup, records }` | `{ ok, report }` or `{ ok: false, error }` |

Errors come back as `{ error: { code, message } }`. The codes are `MISSING_API_KEY`, `INVALID_API_KEY`, `RATE_LIMIT`, `MODEL_NOT_FOUND`, `UPSTREAM_UNAVAILABLE`, `NETWORK`, and `NOTHING_TO_SCORE`.
