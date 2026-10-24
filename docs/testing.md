# Testing the current interview simulator

Run the offline regression suite from the repository root:

```bash
npm test
```

Run a focused file with individual test names and assertion details:

```bash
node test/delivery-tracker.test.js
node test/report.test.js
node test/voice.test.js
```

The suite uses Node's built-in test runner and adds no dependencies. Browser APIs,
device streams, clocks, storage, speech services, and HTTP responses are simulated.
No real microphone, camera, model download, API key, network request, or paid model
call is needed. Each test restores its mocks and browser globals.

## Automated coverage

| Area | Tests | Behaviors checked |
| --- | --- | --- |
| Interview flow | `test/interview.test.js` | Role-specific plans, round lengths, introduction through wrap-up, retry-safe preparation, follow-up limits, code/problem retention, unchanged-code suppression, hint accounting, early exit, delivery aggregation, weak-question retries |
| Hint storage | `test/hints.test.js` | Shared daily allowance, reload persistence, local-midnight reset, unavailable or malformed storage |
| Model output parsing | `test/parse.test.js` | Hidden action/reasoning cleanup, coding/SQL statements, retry round trips, malformed JSON, valid score mapping by ID, missing scores |
| Prompt contracts | `test/prompts.test.js`, `test/evaluation-delivery.test.js` | Neutral interviewing, code-review reasoning level, escalating hints, forced transitions, final code and transcript inclusion, optional delivery coaching |
| HTTP client | `test/api.test.js` | JSON requests, raw WAV uploads, network failure, structured API errors, non-JSON server errors |
| Delivery capture lifecycle | `test/delivery-tracker.test.js` | Permission denial, insecure contexts, cancellation during device startup, answer/listening separation, session timestamps and markers, WAV format, transcription fallback, device/worker cleanup, reset isolation |
| Delivery measurement | `test/delivery-metrics.test.js`, `test/body-language.test.js` | Existing synthetic face, pose, speech, pitch, pauses, fillers, and delivery aggregation checks |
| Phase 1 tracks | `test/voice-tracks.test.js`, `test/report.test.js` | Per-second averaging, voice/mic baseline normalization, missing pitch, common time axis, question markers, gaps, sparse tracks, bounded plot values, failed-evaluation fallback, escaped content |
| Browser voice adapters | `test/voice.test.js` | Unsupported APIs, final/interim dictation, stop-and-flush, permission denial, bounded restarts, speech cleanup, voice selection, completion/cancellation, stalled or failed playback |
| Performance and background work | `test/delivery-metrics.test.js`, `test/delivery-tracker.test.js`, `test/parse.test.js` | Large-buffer speech analysis, bounded frame scans across many phrases, exact WAV cap and whole-answer fallback, transcription deadline cleanup, reset isolation, string-preserving JSON repair |
| Progressive report lifecycle | `test/report-controller.test.js`, `test/report.test.js` | Immediate local mounting while transcription/AI stay unresolved, snapshot isolation, independent count/AI slots, preserved expanded answers/charts, duplicate entry, retry, stale success/error/finally guards, empty interviews |
| Request deadlines | `test/request-deadlines.test.js`, `test/api.test.js` | Default-model hangs, total budget across fallback and JSON repair, backoff cancellation, body-read timeout, server disconnect propagation, audio fallback isolation, Express route handler contracts |

Report tests inspect generated HTML/SVG and numerical coordinates. They do not
launch a browser or validate visual layout. Prompt tests check the instructions
sent to the model; they do not establish that live model replies follow them.
Synthetic sensor tests verify algorithms and lifecycle behavior, not accuracy on
real people or the validity of interview scores.

## Offline performance checks

```bash
node scripts/benchmark-report.mjs
```

This measures synthetic 1-, 5-, and 30-minute audio summaries, voice tracks,
report HTML generation, and a pitch-analysis frame. Each case uses two warmups
and reports the median of seven runs. It does not measure DOM layout/paint or
provider latency and has no pass/fail wall-clock threshold. Complexity regressions
in the test suite instead count frame timestamp accesses.

The [report performance plan](report-performance-plan.md) records the repository
audit, before/after timings, implemented progressive report lifecycle, and
remaining performance work.

## Progressive report browser fixture

```bash
node scripts/report-smoke-server.mjs
```

Open `http://127.0.0.1:3001/__report_smoke`. This serves the real application with
simulated microphone analysis and API adapters installed before app startup. It
does not request devices or make model calls. Finish the three-question interview;
AI and transcription remain pending until their fixture buttons are clicked.

- Verify metrics/tracks/transcript are available while AI is loading.
- Expand an answer, complete transcription, and verify counts change without
  closing the answer or replacing the chart.
- Fail AI, retry, then complete AI. Local results must stay visible throughout.
- Leave an evaluation pending, start a new interview, then complete older AI;
  the old response must not modify the new session.

Browser smoke checks performed October 24, 2026 confirmed immediate local output,
background count refinement with expanded-answer preservation, AI failure, and
successful retry in the real app. Stale-response permutations and request
deadlines are additionally covered offline. Fixture results do not establish live
provider latency or actual microphone/camera accuracy.

## Phase 2 status and acceptance checks

The reviewed checkout contains Phase 1 tracks. Phase 2's `MediaRecorder`,
`recording()` API, replay player, jump buttons, and playhead are not implemented
yet. There are no skipped placeholder tests claiming to cover those features.
Use the following checklist when implementing Phase 2, and convert the
deterministic cases into automated tests alongside that code.

### Recording and lifecycle

- Recording is off by default and starts only with explicit replay opt-in.
- Choose the first supported recording MIME type in the plan's priority order;
  unsupported recording leaves the interview and track report usable.
- Denied camera/microphone permission and recorder construction/start errors
  leave typed answers and content feedback usable.
- `recStart` uses the same session clock as sensor samples and question markers.
- Stop the recorder before stopping its tracks; await its final `dataavailable`
  and `stop` events before exposing a replay blob.
- Repeated stop/report actions do not create duplicate recorders or players.
- Starting a new interview or retry revokes the old replay URL and clears its
  recording chunks. An old recorder completing late cannot populate a new report.
- Recorder blobs and camera frames never go to interview/evaluation endpoints.
  Existing per-answer audio transcription remains a separately disclosed upload.

### Playback and synchronization

- With a nonzero `recStart`, a question jump seeks to `mark.t - recStart`.
  Clamp seeks outside the recording and handle recordings with no question marks.
- In the full version, the playhead follows `video.currentTime + recStart` across
  all lanes, including pause, resume, seek, and replay from the beginning.
- Clicking a track seeks to its session time minus `recStart`, accounting for
  SVG scaling and the chart's left/right margins.
- Test missing tracks, sparse tracks, capture gaps, and audio-only delivery data.
- Check WebM with an initially infinite duration: metadata correction must not
  leave playback at the large probe time or create a repeated seek loop.

### Browser smoke checks (manual)

These remain unexecuted browser acceptance checks, not automated test results.

1. In Chrome or Edge on localhost/HTTPS, finish a short interview with voice and
   delivery enabled. Check that dictation pauses during Jordan's speech, Skip/Esc
   hands control back, and the report contains available tracks and question marks.
2. Deny camera permission, then separately deny microphone permission. Confirm
   typed answering and content feedback work and missing measurements stay absent.
3. Once Phase 2 exists, test replay both enabled and disabled. Check question
   jumps, playhead alignment, no recording upload, and URL cleanup on retry/new.
4. Test recording plus face/pose tracking for ten minutes on the demo laptop.
   Watch playback, responsiveness, memory, and device release on exit.

Live provider availability, full HTTP/socket/body-parser integration, model scoring
calibration, and complete DOM/UI interactions are outside this offline suite.
Server tests invoke the registered Express route handlers with simulated requests
and responses. The scoring
normalizer's known out-of-range coercion and positional-ID fallback are also not
fixed by this test-only change.
