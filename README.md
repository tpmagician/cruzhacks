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

## Voice and delivery coaching (MACH-style)

Two options on the setup screen bring the interview closer to MIT's MACH
interview coach (Hoque et al., UbiComp 2013), with Gemma 4 adding what MACH
lacked: understanding the content of your answers and tying delivery to it.

- **Talk out loud.** Jordan reads each reply aloud (browser speech synthesis),
  then your microphone dictates into the answer box (browser speech recognition:
  Google Chrome or Edge; Chrome sends that audio to Google to transcribe it).
  Press **Send** or Ctrl+Enter when you finish. **Esc** or **Skip** interrupts Jordan.
- **Delivery feedback.** Your camera and microphone are analyzed on this device
  while you answer. Video never leaves the device. Browser dictation drops most
  "um"s and "uh"s, so the audio of each spoken answer is sent to Gemini (or
  Deepgram, if `DEEPGRAM_API_KEY` is set) for a word-for-word transcript used
  only to count filler words; the app does not store it. Only the numbers below
  go to Gemma with your transcript.
- **Hints.** On technical questions you can press **I'm stuck**, and Jordan
  offers one on its own after a quiet stretch (90 s, or 150 s on coding and SQL
  problems). Hints get stronger each time (nudge, technique, key idea) and are
  limited to 3 per day per browser; the evaluator weighs them in scoring.
- **On-screen problems.** Coding and SQL questions appear as a LeetCode-style
  statement with examples and constraints; Jordan only introduces them aloud.

| Signal | How it is measured | Source |
| --- | --- | --- |
| Smiles | MediaPipe `mouthSmileLeft/Right` blendshapes, 0–100; "smiling" at 35+ | MACH used SHORE (0–100) |
| Head nods / shakes | Stable/extreme/transient states over ±2 frames on the between-the-eyes point, 2 px rule (rescaled to face size), more than two extremes between stable states | MACH algorithm |
| Pauses | -25 dB silence threshold relative to the loudest frame, 0.5 s minimum silent and sounding intervals | MACH (Praat settings) |
| Pitch variation | Autocorrelation pitch (100–500 Hz), standard deviation in semitones | MACH (autocorrelation) |
| Pace, fillers | Words per minute from the dictated transcript; filler words as a share of words, counted from the word-for-word transcript when it is available (otherwise from dictation, which undercounts "um"/"uh") | MACH "weak language" |
| Looking away, time to first word, nods while listening | Head direction vs. your median position; silence before speech; nods outside your answers | Added |
| Talking speed | Words per minute of actual sound, pauses excluded (articulation rate) | Speeko-style |
| Rising endings (uptalk) | Last 0.4 s of a phrase (≥1 s long) is 2.5+ semitones above the rest of the phrase; octave jumps ignored | Speeko-style |
| Trailing off | Last 0.5 s of a phrase is 6+ dB quieter than the rest | Speeko-style |
| Think-aloud (coding questions, voice on) | Silences of 15 s or more while solving, split by whether you were typing code | Added (SWE-specific) |

Gemma also gets guidance to flag hedging language ("I just", "sort of", "I guess") from the transcript.

The report adds a **Delivery** section (metrics, a smile timeline across the whole
interview with markers per question, and Gemma's delivery coaching) and a short
delivery note per question. These are approximate coaching signals, not validated
measures of skill, emotion, or confidence. Pure measurement code lives in
`frontend/js/delivery-metrics.js` (shared with the server and tested with
synthetic signals in `test/delivery-metrics.test.js`); `delivery.js` runs the
camera/microphone capture, `delivery-worker.js` runs face tracking, and
`voice.js` handles speech. Face tracking needs `npm run setup:models`.

## Presentation practice

The **Presentation practice** tab provides a separate webcam rehearsal mode with
MediaPipe Pose Lite and Face Landmarker. It works without a Gemini API key.

Download the two pinned model bundles once after installing dependencies:

```bash
npm run setup:models
```

The setup script downloads version 1 float16 bundles from Google's official
MediaPipe model storage and verifies their SHA-256 checksums. Models are stored
in `frontend/models/` and ignored by Git; run the command on each new checkout or
deployment. The MediaPipe JavaScript and WASM runtime is served from the pinned
`@mediapipe/tasks-vision` dependency. No CDN is needed during practice.

1. Run `npm start`, open the app, and choose **Presentation practice**.
2. Enable your camera. Use localhost or HTTPS, preferably in current Chrome or
   Edge with Web Workers, OffscreenCanvas, and ImageBitmap support.
3. Put the camera at eye level on a stable surface. Keep your face, shoulders,
   and hands visible. Face forward in a comfortable position and choose
   **Calibrate & start**. Calibration requires 3 consecutive seconds of usable,
   steady face tracking (shoulders are used if visible); it times out after 30 seconds so you can retry.
4. Rehearse out loud. Use **Pause** / **Resume** for breaks and **Finish & view
   report** when done. Hiding the tab automatically pauses active practice.

The report shows head direction, side-to-side movement, gesture activity,
tracking coverage, and timestamped sustained head and shift events. Calibration and pauses
are excluded. Switching back to interview mode finishes the practice and keeps
its report until the next practice begins. Finishing, leaving presentation mode,
or navigating away releases the camera and worker.

Video frames are analyzed locally in a dedicated worker, at up to 12 frames per
second and 640 pixels wide, with one frame in flight. Only derived measurements
return to the UI. No video/audio is recorded, uploaded, or persisted; reports
live in memory until the page is closed or a new practice begins. The preview is
mirrored for convenience; analysis uses the original camera orientation.

Feedback uses transparent heuristics: a head turn over 25 degrees or pitch over
20 degrees from calibration, a sideways shoulder shift over 0.3 shoulder widths,
and wrist speed over 0.35 shoulder widths per second. Measurements are smoothed
over roughly 250 ms. Head and shift events must last 2 seconds. Each percentage needs at least 5 seconds of usable
observations; missing landmarks and processing gaps over 500 ms do not count as
good or bad behavior. Low-confidence or cropped body landmarks are excluded.
These thresholds are initial coaching heuristics to tune with representative
rehearsals, not validated speaking scores. Head direction does not measure eye
contact, and wrist movement does not measure gesture quality. The app does not infer emotions or confidence.

Relevant files: `presentation.js` handles camera/session controls and report UI;
`presentation-worker.js` runs both models; `body-language.js` contains geometry,
calibration, coverage, smoothing, and temporal event rules. `npm test` exercises
the analysis with synthetic landmark sequences, including pauses and missing
observations.

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
| Live interviewer turns | `gemma-4-26b-a4b-it` (default) or `gemma-4-31b-it` (falls back to 26B on server errors) | `minimal` |
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
