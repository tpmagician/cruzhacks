# Interview Prep Studio

A realistic, continuous mock job interview with a behavioral round and a technical round. The interviewer runs on Google's **Gemma 4** through the Gemini API. When the interview ends, you get a scored feedback report.

## Setup

1. **Get an API key.** Go to [Google AI Studio](https://aistudio.google.com/apikey) and create a Gemini API key.
2. **Install dependencies** (Node 18 or newer):
   ```bash
   npm install
   ```
3. **Download the camera models** (for delivery feedback):
   ```bash
   npm run setup:models
   ```
4. **Add your key.** Copy the example env file and paste your key into it:
   ```bash
   cp .env.example .env
   # then edit .env:  GEMINI_API_KEY=your_real_key
   ```
5. **Start the app:**
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
| Pauses | -25 dB silence threshold relative to the loudest frame, 0.5 s minimum silent and sounding intervals | MACH (Praat settings) |
| Pitch variation | Autocorrelation pitch (100–500 Hz), standard deviation in semitones | MACH (autocorrelation) |
| Pace, fillers | Words per minute from the dictated transcript; filler words as a share of words, counted from the word-for-word transcript when it is available (otherwise from dictation, which undercounts "um"/"uh") | MACH "weak language" |
| Looking away, time to first word | Head direction vs. your median position; silence before speech | Added |
| Talking speed | Words per minute of actual sound, pauses excluded (articulation rate) | Speeko-style |
| Rising endings (uptalk) | Last 0.4 s of a phrase (≥1 s long) is 2.5+ semitones above the rest of the phrase; octave jumps ignored | Speeko-style |
| Trailing off | Last 0.5 s of a phrase is 6+ dB quieter than the rest | Speeko-style |
| Think-aloud (coding questions, voice on) | Silences of 15 s or more while solving, split by whether you were typing code | Added (SWE-specific) |
| Side-to-side movement | Shoulder center more than 0.3 current shoulder widths from your usual (median) position, smoothed over ~250 ms | Added (MediaPipe Pose Lite) |
| Gesturing | Share of the time both hands are visible with wrist speed over 0.35 shoulder widths per second | Added (MediaPipe Pose Lite) |

Gemma also gets guidance to flag hedging language ("I just", "sort of", "I guess") from the transcript.

The report adds a **Delivery** section (metrics, smile, loudness, and pitch tracks
on one time axis with markers per question, and Gemma's delivery coaching) and a short
delivery note per question. These are approximate coaching signals, not validated
measures of skill, emotion, or confidence. Pure measurement code lives in
`frontend/js/delivery-metrics.js` (shared with the server and tested with
synthetic signals in `test/delivery-metrics.test.js`); `delivery.js` runs the
camera/microphone capture, `delivery-worker.js` runs face and pose tracking, and
`voice.js` handles speech. Face tracking needs `npm run setup:models`.

### Camera tracking

Download the two pinned MediaPipe model bundles (Face Landmarker and Pose Lite)
once after installing dependencies:

```bash
npm run setup:models
```

The setup script downloads version 1 float16 bundles from Google's official
MediaPipe model storage and verifies their SHA-256 checksums. Models are stored
in `frontend/models/` and ignored by Git; run the command on each new checkout or
deployment. The MediaPipe JavaScript and WASM runtime is served from the pinned
`@mediapipe/tasks-vision` dependency, so no CDN is needed.

Use localhost or HTTPS in current Chrome or Edge. Put the camera at eye level with
your head and shoulders in view; include your hands for gesture feedback. There is
no calibration step: head direction and side-to-side movement are measured against
your median position over the interview.

Frames are analyzed in a dedicated worker (`delivery-worker.js`), up to 15 frames
per second at 640 pixels wide with one frame in flight. The face model runs on
every frame and the pose model on every other frame to keep the CPU load down.
MACH's head nod and shake counts are not measured; they were removed from the app. Only derived measurements leave the worker; video is never recorded,
uploaded, or stored. The preview is mirrored; analysis uses the original
orientation.

Movement and gesture shares need at least 5 seconds of usable tracking; missing
landmarks and processing gaps over 500 ms count as neither good nor bad.
Low-confidence or cropped landmarks are excluded. These thresholds are initial
coaching heuristics, not validated scores. Head direction does not measure eye
contact, wrist movement does not measure gesture quality, and moving the camera
or chair reads as side-to-side movement. The app does not infer emotions or
confidence.

Relevant files: `delivery.js` owns the camera and microphone; `delivery-worker.js`
runs both models; `delivery-metrics.js` holds the face and audio measurements;
`body-language.js` holds the pose geometry, smoothing, and coverage rules.
`npm test` exercises both with synthetic landmark and audio sequences.

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
| Live interviewer turns, including presenting a coding or SQL problem | `gemma-4-26b-a4b-it` (default) or `gemma-4-31b-it` (falls back to 26B on server errors) | `minimal` |
| Turns where you submit code | same | `high` |
| End-of-interview evaluation | same | `minimal` |

High thinking was too slow for two of these. Measured on 26B: presenting a
coding problem took 80 s with `high` (7.5 s with `minimal`), and evaluating two
questions took over 150 s (19 s). Interviewer turns have 30 s per attempt and 60 s
in total; evaluation has 60 s per attempt, 90 s per generation, and 95 s for the
route including one JSON repair. Every interview has one main question per round
(1 behavioral + 1 technical, or 1 in a single round); for engineering and analyst
roles the technical question is the coding or SQL problem. A two-question
evaluation measured about 19 s.

Conversation history goes to the model as multi-turn `contents`, with `user` for the candidate and `model` for the interviewer. The persona goes in `config.systemInstruction`. If a model ever rejects system instructions or the thinking config, `gemini.js` retries with that feature adapted.

### Evaluation

`POST /api/evaluate` asks for strict JSON. The server strips code fences and pulls out the JSON object. If the JSON is invalid, it asks the model again once. If that also fails, it returns `{ ok: false, error: "unable_to_score" }`, and the report shows "unable to score" instead of crashing. Missing or out-of-range scores also show as "unable to score".

The report shows local delivery metrics, tracks, and your answers immediately.
AI scores and coaching load independently; filler transcription continues in the
background and updates labeled counts without rescoring or resetting the report.
Unavailable transcription keeps dictation estimates. Filler numbers are omitted
from the AI snapshot so later counts cannot contradict its advice.

API work has a 60-second server budget (including evaluation JSON repair), with
30-second model attempts and at most one transient retry per model. The browser
allows 65 seconds for a structured server response. New interviews and page exit
cancel outstanding requests; late responses cannot update another session.
AI failure keeps the local report available and offers **Try scoring again**.
See the [report performance plan](docs/report-performance-plan.md) for the audit,
implementation status, and remaining CPU/memory improvements.

### API

| Route | Body | Response |
| --- | --- | --- |
| `GET /api/health` | none | `{ hasKey, models }` |
| `POST /api/interview` | `{ setup, turn, history }` | `{ text, action }` |
| `POST /api/evaluate` | `{ setup, records }` | `{ ok, report }` or `{ ok: false, error }` |

Errors come back as `{ error: { code, message } }`. The codes are `MISSING_API_KEY`, `INVALID_API_KEY`, `RATE_LIMIT`, `MODEL_NOT_FOUND`, `UPSTREAM_UNAVAILABLE`, `NETWORK`, and `NOTHING_TO_SCORE`.
